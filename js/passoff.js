// ═══════════════════════════════════════════════════════════
// PASSOFF — Passoff instructions generator + transcript polling
// ═══════════════════════════════════════════════════════════

import { state, pendingWrites } from './app.js?v=20261114163106';
import { invokeEdgeFunction, sbUpdateDeal, camelToSnake, supabase } from './api.js?v=20261114163106';
import { esc, jsArg, str, confirmNoPlaceholders } from './utils.js?v=20261114163106';
import { refreshModal } from './render.js?v=20261114163106';
import { isAdmin, isEmployee } from './auth.js?v=20261114163106';
import { renderCallPoints } from './call-points.js?v=20261114163106';
import { passoffInFlight, buttonState, textLocked, onScreenText, reviseBody, checkDraft, mayHaveFinished, recoveredDrafts, sendOnce } from './passoff-core.js?v=20261114163106';

// passoffInFlight (passoff-core.js): what is running per deal + action (generate / revise / send /
// gmail-draft). Renders draw the buttons from it, so a re-render mid-request can no longer bring them
// back idle (Tim, 2026-11-12). cold-call-email.js shares it for the Gmail draft button.

const isOpen = dealId => !!state.selectedDeal && String(state.selectedDeal.id) === String(dealId);

// Deals whose last draft was written without the Smartlead email thread (generate-passoff threadMissing, audit
// A4 #1, 2026-11-13). The card says so until the next draft, so the SDR checks the reply before sending.
const threadMissing = new Set();

// Draw the in-flight state onto the card that is on screen now, without waiting for a re-render.
export function paintPassoffButtons(dealId) {
  for (const el of document.querySelectorAll('[data-passoff-deal]')) {
    if (el.dataset.passoffDeal !== String(dealId)) continue;
    if (el.dataset.passoffAction === 'text') {
      const locked = textLocked(passoffInFlight, dealId);
      if (locked && document.activeElement === el) el.blur();
      el.disabled = locked;
      continue;
    }
    const st = buttonState(passoffInFlight, dealId, el.dataset.passoffAction, el.dataset.idleLabel || '');
    el.disabled = st.disabled;
    if (el.dataset.idleLabel !== undefined) el.textContent = st.label; // buttons without one keep their own markup
  }
}

// Attributes for a pass-off button, drawn from the in-flight map.
function btnAttrs(dealId, action, idleLabel) {
  const st = buttonState(passoffInFlight, dealId, action, idleLabel);
  return { attrs: `data-passoff-deal="${esc(String(dealId))}" data-passoff-action="${action}" data-idle-label="${esc(idleLabel)}"${st.disabled ? ' disabled' : ''}`, label: esc(st.label) };
}

function textAttrs(dealId) {
  return `data-passoff-deal="${esc(String(dealId))}" data-passoff-action="text"${textLocked(passoffInFlight, dealId) ? ' disabled' : ''}`;
}

// ─── Transcript Polling ───
// One poller per deal: calling deal B used to cancel deal A's polling (Tim, 2026-11-12).

const transcriptPolls = new Map(); // deal id -> { timer, count }
const MAX_POLL_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 30000;

export function startTranscriptPolling(dealId, phone) {
  stopTranscriptPolling(dealId);
  transcriptPolls.set(String(dealId), { timer: null, count: 0 });
  pollTranscript(dealId, phone);
}

/** Stops one deal's poller, or every poller when called without a deal (closing the card). */
export function stopTranscriptPolling(dealId) {
  const ids = dealId === undefined ? [...transcriptPolls.keys()] : [String(dealId)];
  for (const id of ids) {
    const p = transcriptPolls.get(id);
    if (p && p.timer) clearTimeout(p.timer);
    transcriptPolls.delete(id);
  }
}

async function pollTranscript(dealId, phone) {
  const p = transcriptPolls.get(String(dealId));
  if (!p) return; // stopped meanwhile
  if (p.count >= MAX_POLL_ATTEMPTS) {
    stopTranscriptPolling(dealId);
    return;
  }
  p.count++;

  try {
    const resp = await invokeEdgeFunction('justcall-transcript', { phone, dealId });
    if (transcriptPolls.get(String(dealId)) !== p) return; // stopped or restarted meanwhile
    if (resp.transcript) {
      const deal = state.deals.find(d => String(d.id) === String(dealId));
      if (deal) {
        setLocal(dealId, 'callTranscript', resp.transcript);
        // Compared an object with an id, so the open card never showed the transcript (Tim, 2026-11-12).
        if (isOpen(dealId)) refreshModal();
      }
      stopTranscriptPolling(dealId);
      return;
    }
    if (resp.pending) {
      p.timer = setTimeout(() => pollTranscript(dealId, phone), POLL_INTERVAL_MS);
    } else {
      stopTranscriptPolling(dealId);
    }
  } catch (e) {
    console.warn('Transcript poll error:', e);
    stopTranscriptPolling(dealId);
  }
}

// ─── Calendly notes from the same draft ───
// The calendar invite carries the same details as the pass-off (Ioannis, 2026-11-06), so Claude's
// calendly_notes block goes into the Calendly box: when nobody has typed there (cal_notes is empty;
// the template is only the box's placeholder), when it still holds the block Claude wrote last, or
// on a revise (Claude was shown the box and changes only what the caller asked).
const lastAutoCalNotes = new Map(); // deal id -> the block we last put in

function applyCalendlyNotes(dealId, notes, isRevise) {
  if (!str(notes).trim()) return;
  const deal = state.deals.find(d => String(d.id) === String(dealId)) || state.selectedDeal;
  const current = str(deal && deal.calNotes).trim();
  const untouched = !current || current === str(lastAutoCalNotes.get(String(dealId))).trim();
  if (!untouched && !isRevise) return;
  lastAutoCalNotes.set(String(dealId), notes);
  setLocal(dealId, 'calNotes', notes);
  pendingWrites.value++;
  sbUpdateDeal(dealId, camelToSnake({ calNotes: notes }))
    .catch(e => console.error('Saving Calendly notes failed:', e))
    .finally(() => { pendingWrites.value--; });
}

// ─── Talking to generate-passoff (C1) ───
// 90s abort (the server gives up at ~55s). On our abort or a dropped connection the server may
// still have finished, so re-read the deal and show what it saved instead of "timed out".

async function callGeneratePassoff(dealId, body, before) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    return { live: true, resp: checkDraft(await invokeEdgeFunction('generate-passoff', body, controller.signal)) };
  } catch (e) {
    if (!mayHaveFinished(e)) throw e;
    let row = null;
    try {
      const { data, error } = await supabase.from('deals')
        .select('passoff_instructions, passoff_lead_message, call_points').eq('id', dealId).maybeSingle();
      if (!error) row = data;
    } catch { /* offline: fall through to the timeout message */ }
    const got = recoveredDrafts(row, before);
    if (!got) throw new Error(e.name === 'AbortError' ? 'Request timed out — try again' : 'Connection lost — try again');
    return { live: false, resp: got };
  } finally {
    clearTimeout(timeout);
  }
}

function applyDrafts(dealId, resp) {
  setLocal(dealId, 'passoffInstructions', resp.instructions);
  if (resp.leadMessage !== undefined) setLocal(dealId, 'passoffLeadMessage', resp.leadMessage);
  if (Array.isArray(resp.callPoints)) setLocal(dealId, 'callPoints', resp.callPoints.join('\n')); // call-points.js
  else if (typeof resp.callPoints === 'string') setLocal(dealId, 'callPoints', resp.callPoints);
}

// ─── Generate Passoff ───

async function generatePassoff(dealId, clientName) {
  if (!passoffInFlight.begin(dealId, 'generate')) return; // already running for this deal
  paintPassoffButtons(dealId);
  try {
    const before = onScreenText(document.getElementById('passoff-text')?.value, currentCopy(dealId, 'passoffInstructions'));
    await flushPassoffSaves(dealId); // the database matches the screen, so a re-read after a timeout is comparable
    const { live, resp } = await callGeneratePassoff(dealId, { dealId, clientName }, before);
    applyDrafts(dealId, resp);
    if (live) {
      if (resp.threadMissing) threadMissing.add(String(dealId)); else threadMissing.delete(String(dealId));
    }
    if (live) applyCalendlyNotes(dealId, resp.calendlyNotes, false);
  } catch (e) {
    alert('Failed to generate passoff: ' + e.message);
  } finally {
    passoffInFlight.end(dealId, 'generate');
    // refreshModal() alone only swaps the activity/meeting/reply boxes, never this panel.
    if (isOpen(dealId)) refreshModal(true); else paintPassoffButtons(dealId);
  }
}

async function regeneratePassoff(dealId, clientName) {
  if (passoffInFlight.any(dealId)) return;
  if (!confirm('This will overwrite your current edits. Continue?')) return;
  generatePassoff(dealId, clientName);
}

// ─── Save Passoff Text (debounced) ───

// Every in-memory copy of the deal gets the text on each keystroke (state.selectedDeal can be a
// different object from the state.deals row after a background sync); only the write is debounced.
function setLocal(dealId, field, value) {
  for (const d of new Set([state.deals.find(x => String(x.id) === String(dealId)), state.selectedDeal])) {
    if (d && String(d.id) === String(dealId)) d[field] = value;
  }
}

function currentCopy(dealId, field) {
  const row = state.deals.find(d => String(d.id) === String(dealId));
  return onScreenText(row && row[field], isOpen(dealId) ? state.selectedDeal[field] : '');
}

// One pending save per deal + field. A single shared timer let typing on card B cancel card A's
// unsaved text (Tim, 2026-11-12).
const pendingSaves = new Map(); // "dealId|field" -> { timer, dealId, field, text }

function writeSave(p) {
  pendingWrites.value++;
  return sbUpdateDeal(p.dealId, camelToSnake({ [p.field]: p.text }))
    .catch(e => console.error('Saving pass-off text failed:', e))
    .finally(() => { pendingWrites.value--; });
}

function queueSave(dealId, field, text) {
  const key = String(dealId) + '|' + field;
  const old = pendingSaves.get(key);
  if (old) clearTimeout(old.timer);
  const p = { dealId, field, text, timer: null };
  p.timer = setTimeout(() => { pendingSaves.delete(key); writeSave(p); }, 1500);
  pendingSaves.set(key, p);
}

/** Write every pending pass-off box save now (or just this deal's). For closing / switching cards. */
export function flushPassoffSaves(dealId) {
  const writes = [];
  for (const [key, p] of pendingSaves) {
    if (dealId !== undefined && String(p.dealId) !== String(dealId)) continue;
    clearTimeout(p.timer);
    pendingSaves.delete(key);
    writes.push(writeSave(p));
  }
  return Promise.all(writes);
}

function savePassoffText(dealId, text) {
  setLocal(dealId, 'passoffInstructions', text);
  queueSave(dealId, 'passoffInstructions', text);
}

function saveLeadMessage(dealId, text) {
  setLocal(dealId, 'passoffLeadMessage', text);
  queueSave(dealId, 'passoffLeadMessage', text);
}

// ─── Chat with Claude about the drafts (cold-call leads) ───
// The caller types what to change; generate-passoff (mode 'revise') rewrites both drafts on THT's key.
const chatLog = new Map(); // deal id → [{role, content}] for this session

async function reviseWithClaude(dealId, clientName) {
  const input = document.getElementById('passoff-chat-input');
  const instruction = (input && input.value || '').trim();
  if (!instruction) return;
  if (!passoffInFlight.begin(dealId, 'revise')) return;
  // Revise what is on screen, not the last saved copy (C1).
  const clientBox = document.getElementById('passoff-text');
  const leadBox = document.getElementById('passoff-lead-text');
  const clientText = clientBox ? clientBox.value : null;
  const leadText = leadBox ? leadBox.value : '';
  paintPassoffButtons(dealId); // locks + blurs both boxes, so a re-render has no typed text to put back over Claude's
  if (input) input.disabled = true;
  const log = chatLog.get(dealId) || [];
  let ok = false;
  try {
    await flushPassoffSaves(dealId);
    const body = reviseBody(dealId, clientName, instruction, log, clientText, leadText);
    const { live, resp } = await callGeneratePassoff(dealId, body, clientText ?? currentCopy(dealId, 'passoffInstructions'));
    log.push({ role: 'user', content: instruction });
    chatLog.set(dealId, log);
    applyDrafts(dealId, resp);
    if (live) applyCalendlyNotes(dealId, resp.calendlyNotes, true);
    ok = true;
  } catch (e) {
    alert('Claude could not apply that: ' + e.message);
  } finally {
    passoffInFlight.end(dealId, 'revise');
    const inp = document.getElementById('passoff-chat-input');
    if (inp) { inp.disabled = false; if (ok) inp.value = ''; }
    // Only the card this revise was for (it used to refresh whichever card was open).
    if (isOpen(dealId)) refreshModal(true); else paintPassoffButtons(dealId);
  }
}

// ─── Send Passoff to Client ───

async function sendPassoffToClient(dealId, clientName) {
  if (passoffInFlight.any(dealId)) return; // a second click while the first send runs
  // What goes out is what is on screen: the box first, then whichever copy of the deal has the
  // text. This used to read only the state.deals row and return without a word when that copy
  // had lost the text (see realtime-merge.js) — the button looked dead (Ioannis, 2026-11-10).
  const box = document.getElementById('passoff-text');
  const row = state.deals.find(d => String(d.id) === String(dealId));
  const open = isOpen(dealId) ? state.selectedDeal : null;
  const text = onScreenText(box ? box.value : '', row && row.passoffInstructions, open && open.passoffInstructions);
  if (!str(text).trim()) { alert('There is no pass-off text to send.'); return; }
  if (!confirmNoPlaceholders(text)) return;

  if (!passoffInFlight.begin(dealId, 'send')) return;
  paintPassoffButtons(dealId);
  const sentBefore = str((row && row.passoffSentAt) || (open && open.passoffSentAt));
  try {
    const body = { action: 'send_to_client_thread', dealId, clientName, messageBody: text };
    // "Resend" is an explicit resend; "Send" on a pass-off someone already sent gets asked first (C2).
    if (sentBefore) body.resend = true;
    const resp = await sendOnce(b => invokeEdgeFunction('send-email', b), body, {
      confirm: msg => confirm(msg), clientName, sentAt: sentBefore ? new Date(sentBefore).toLocaleString() : '',
    });
    if (resp === null) return; // they chose not to send again
    // send-email answers some refusals ("No email configured for client") with HTTP 200.
    if (!resp || resp.ok === false || resp.error) throw new Error((resp && resp.error) || 'No response from server');

    // send-email stamps passoff_sent_at itself, after Gmail accepted the message (C2). The browser used to write its
    // own clock over it, which made a second SDR's Resend fail its compare-and-set (audit A3 #7, 2026-11-13).
    // The card shows the server's time; the realtime echo brings the same value.
    setLocal(dealId, 'passoffInstructions', text);
    setLocal(dealId, 'passoffSentAt', resp.sentAt || new Date().toISOString());
    if (resp.warning) alert('Sent, but: ' + resp.warning);
  } catch (e) {
    // 409 while another SDR's send is still running (send-email's claim, A4 #18).
    if (e && (e.message === 'already_sent' || e.inProgress)) {
      alert('Someone else is sending this pass-off right now. Wait a minute, then check the card before sending again.');
      return;
    }
    alert('Failed to send passoff: ' + e.message);
  } finally {
    passoffInFlight.end(dealId, 'send');
    if (isOpen(dealId)) refreshModal(true); else paintPassoffButtons(dealId);
  }
}

// ─── Render ───

function fmtSentDate(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
  } catch { return ''; }
}

export function renderPassoffSection(deal, clientName) {
  if (!isAdmin() && !isEmployee()) return '';
  if (deal.pipeline !== 'Client') return '';

  const hasInstructions = str(deal.passoffInstructions).trim();
  const hasSent = str(deal.passoffSentAt).trim();
  const hasTranscript = str(deal.callTranscript).trim();

  let h = `<div style="margin:16px 0 8px 0;padding:12px;background:#fdf4ff;border:1px solid #e9d5ff;border-radius:8px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div style="font-size:12px;font-weight:700;color:#7c3aed">Passoff Instructions</div>
      ${hasSent ? `<div style="font-size:10px;color:#059669;font-weight:600">✓ Sent ${fmtSentDate(deal.passoffSentAt)}</div>` : ''}
    </div>`;
  if (threadMissing.has(String(deal.id)) && hasInstructions) {
    h += `<div style="margin:0 0 8px 0;padding:6px 10px;background:#fef3c7;border:1px solid #fde68a;border-radius:6px;font-size:11px;color:#92400e">
      ⚠️ Smartlead's email thread could not be read, so this draft was written from the card only. Check the lead's reply before sending.</div>`;
  }

  const coldCall = str(deal.leadSource) === 'cold_call';
  if (coldCall && hasInstructions) {
    const log = chatLog.get(deal.id) || [];
    const box = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);background:var(--card);color:var(--text);resize:vertical;margin-bottom:8px';
    const ask = btnAttrs(deal.id, 'revise', 'Ask Claude');
    const again = btnAttrs(deal.id, 'generate', 'Start over');
    const send = btnAttrs(deal.id, 'send', hasSent ? 'Resend pass-off to client' : 'Send pass-off to client');
    h += `<div style="font-size:11px;font-weight:700;color:#6b7280;margin-bottom:4px">1. Pass-off to ${esc(clientName)}</div>
    <textarea id="passoff-text" rows="9" data-keep-focus="1" ${textAttrs(deal.id)} oninput="savePassoffTextClick(${jsArg(deal.id)},this.value)" style="${box}">${esc(deal.passoffInstructions)}</textarea>
    ${renderCallPoints(deal, clientName)}
    <div style="font-size:11px;font-weight:700;color:#6b7280;margin-bottom:4px">2. Confirmation to the lead (saved as a draft in the client's cold-call inbox by "Create draft" below)</div>
    <textarea id="passoff-lead-text" rows="6" data-keep-focus="1" ${textAttrs(deal.id)} oninput="saveLeadMessageClick(${jsArg(deal.id)},this.value)" style="${box}">${esc(deal.passoffLeadMessage)}</textarea>
    <div style="background:#fff;border:1px solid #e9d5ff;border-radius:6px;padding:8px;margin-bottom:8px">
      <div style="font-size:11px;font-weight:700;color:#7c3aed;margin-bottom:4px">Ask Claude to change something</div>
      ${log.length ? `<div style="font-size:11px;color:#6b7280;margin-bottom:6px">${log.map(m => '✓ ' + esc(m.content)).join('<br>')}</div>` : ''}
      <div style="display:flex;gap:6px">
        <input id="passoff-chat-input" type="text" placeholder="e.g. The meeting is Thursday at 10am, and mention the gate code 4411"
          ${passoffInFlight.has(deal.id, 'revise') ? 'disabled' : ''}
          onkeydown="if(event.key==='Enter'){event.preventDefault();reviseWithClaudeClick(${jsArg(deal.id)},${jsArg(clientName)})}"
          style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
        <button id="passoff-chat-btn" class="btn btn-primary" ${ask.attrs} style="font-size:12px;background:#7c3aed;border-color:#7c3aed"
          onclick="reviseWithClaudeClick(${jsArg(deal.id)},${jsArg(clientName)})">${ask.label}</button>
      </div>
    </div>
    <div style="display:flex;gap:6px">
      <button class="btn btn-ghost" ${again.attrs} style="flex:1;justify-content:center;font-size:12px"
        onclick="regeneratePassoffClick(${jsArg(deal.id)},${jsArg(clientName)})">${again.label}</button>
      <button id="passoff-send-btn" class="btn btn-primary" ${send.attrs} style="flex:1;justify-content:center;font-size:12px;background:#7c3aed;border-color:#7c3aed"
        onclick="sendPassoffClick(${jsArg(deal.id)},${jsArg(clientName)})">${send.label}</button>
    </div>`;
  } else if (!hasInstructions) {
    const gen = btnAttrs(deal.id, 'generate', coldCall ? 'Draft pass-off + lead confirmation with Claude' : 'Generate Passoff Instructions');
    h += `<button id="passoff-generate-btn" class="btn btn-primary" ${gen.attrs}
      style="width:100%;justify-content:center;gap:6px;font-size:13px;background:#7c3aed;border-color:#7c3aed"
      onclick="generatePassoffClick(${jsArg(deal.id)},${jsArg(clientName)})">${gen.label}</button>
    <div style="font-size:10px;color:var(--text-muted);margin-top:6px">
      ${coldCall ? 'Claude reads the call (your JustCall notes, and the transcript when there is one) and drafts the pass-off, the lead confirmation and the Calendly notes. Book on Calendly first so the meeting time is on the card.'
        : `Call transcript: ${hasTranscript ? '<span style="color:#059669">Available</span>' : '<span style="color:#d97706">Pending</span>'}`}
    </div>`;
  } else {
    const again = btnAttrs(deal.id, 'generate', 'Regenerate');
    const send = btnAttrs(deal.id, 'send', hasSent ? 'Resend to Client' : 'Send to Client');
    h += `<textarea id="passoff-text" rows="8" data-keep-focus="1" ${textAttrs(deal.id)}
      oninput="savePassoffTextClick(${jsArg(deal.id)},this.value)"
      style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);background:var(--card);color:var(--text);resize:vertical;margin-bottom:8px">${esc(deal.passoffInstructions)}</textarea>
    <div style="display:flex;gap:6px">
      <button class="btn btn-ghost" ${again.attrs} style="flex:1;justify-content:center;font-size:12px"
        onclick="regeneratePassoffClick(${jsArg(deal.id)},${jsArg(clientName)})">${again.label}</button>
      <button id="passoff-send-btn" class="btn btn-primary" ${send.attrs} style="flex:1;justify-content:center;font-size:12px;background:#7c3aed;border-color:#7c3aed"
        onclick="sendPassoffClick(${jsArg(deal.id)},${jsArg(clientName)})">${send.label}</button>
    </div>`;
  }

  // Collapsible call transcript
  if (hasTranscript) {
    h += `<div style="margin-top:10px;border-top:1px solid #e9d5ff;padding-top:8px">
      <div onclick="toggleTranscriptSection()" style="cursor:pointer;font-size:11px;font-weight:600;color:#6b7280;display:flex;align-items:center;gap:4px">
        <span id="transcript-arrow">▶</span> Call Transcript
      </div>
      <div id="transcript-body" style="display:none;margin-top:6px;padding:8px;background:var(--bg);border-radius:6px;font-size:11px;color:var(--text);white-space:pre-wrap;max-height:300px;overflow-y:auto">${esc(deal.callTranscript)}</div>
    </div>`;
  }

  h += '</div>';
  return h;
}

// ─── Window Handlers ───

window.generatePassoffClick = function(dealId, clientName) {
  generatePassoff(dealId, clientName);
};
window.regeneratePassoffClick = function(dealId, clientName) {
  regeneratePassoff(dealId, clientName);
};
window.savePassoffTextClick = function(dealId, text) {
  savePassoffText(dealId, text);
};
window.saveLeadMessageClick = function(dealId, text) {
  saveLeadMessage(dealId, text);
};
window.reviseWithClaudeClick = function(dealId, clientName) {
  reviseWithClaude(dealId, clientName);
};
window.sendPassoffClick = function(dealId, clientName) {
  sendPassoffToClient(dealId, clientName);
};
window.flushPassoffSaves = flushPassoffSaves;
window.toggleTranscriptSection = function() {
  const body = document.getElementById('transcript-body');
  const arrow = document.getElementById('transcript-arrow');
  if (body && arrow) {
    const show = body.style.display === 'none';
    body.style.display = show ? 'block' : 'none';
    arrow.textContent = show ? '▼' : '▶';
  }
};
