// ═══════════════════════════════════════════════════════════
// DEMO HAND-OFF — Acquisition card at Demo Scheduled → #demo-handoffs draft
// ═══════════════════════════════════════════════════════════
// Brief 6 (2026-11-18). The booker used to download the JustCall recording, transcribe it, make the
// "<Person> - <Company>" Doc in Demo Call Resources, run it through his Claude project and post the
// result + thread to #demo-handoffs by hand (15–20 min, ~4×/week).
//
// Here the card asks which kind of disco it was — phone (JustCall recording, pre-picked from the
// timeline) or Google Meet (Fathom share link) — and edge fn demo-handoff writes the transcript, the
// Doc and the two Slack blocks. Both blocks are editable. Nothing reaches Slack until the booker
// presses "Post to #demo-handoffs" (Ioannis, 2026-11-18: option A — the bot posts on his press).
//
// Staff only, never SDRs (RLS on demo_handoffs agrees). The panel's content lives in its own
// container (#dh-<id>) and in _cache, so refreshModal's targeted swap never blanks it.

import { esc, escAttr, jsArg, str } from './utils.js?v=20261124113704';
import { invokeEdgeFunction, showToast } from './api.js?v=20261124113704';
import { isAdmin, isEmployee, isSdr } from './auth.js?v=20261124113704';

const POLL_MS = 4000;
const _cache = {};   // dealId → { row, suggest, docName, source, recordingUrl, fathomUrl, top, thread, busy }
const _timers = {};

export function demoHandoffVisible(deal) {
  if (!deal || deal.pipeline !== 'Acquisition') return false;
  if (!(isAdmin() || isEmployee()) || isSdr()) return false;
  return deal.stage === 'Demo Scheduled' || !!_cache[deal.id]?.row?.top_message;
}

export function renderDemoHandoffSection(deal) {
  if (!demoHandoffVisible(deal)) return '';
  if (!_cache[deal.id]) { _cache[deal.id] = { loading: true }; setTimeout(() => load(deal.id), 0); }
  return `<div id="dh-${escAttr(deal.id)}" style="margin:0 0 10px 0;padding:10px 12px;border:1px solid #bae6fd;background:#f0f9ff;border-radius:var(--radius)">${body(deal.id)}</div>`;
}

function paint(dealId) {
  const el = document.getElementById('dh-' + dealId);
  if (el) el.innerHTML = body(dealId);
}

async function load(dealId) {
  try {
    const data = await invokeEdgeFunction('demo-handoff', { action: 'state', dealId });
    const c = _cache[dealId] = { ..._cache[dealId], ...data, loading: false };
    const row = data.row || {};
    c.source = c.source || row.source || (data.suggest?.recordingUrl ? 'phone' : data.suggest?.fathomUrl ? 'meet' : 'phone');
    // Fresh suggestion first, on every load: the Demo Scheduled call can land on the timeline after the panel first
    // opened, and the URL saved by an earlier generate may be a No Answer dial (Cary Hunter, 2026-11-18).
    c.recordingUrl = data.suggest?.recordingUrl || row.recording_url || '';
    c.fathomUrl = c.fathomUrl ?? row.fathom_url ?? data.suggest?.fathomUrl ?? '';
    // Never overwrite what the booker is editing.
    if (c.top == null || row.status !== 'ready') c.top = row.top_message || '';
    if (c.thread == null || row.status !== 'ready') c.thread = row.thread_message || '';
    if (row.status === 'generating' || row.status === 'posting') schedulePoll(dealId); else stopPoll(dealId);
  } catch (e) {
    _cache[dealId] = { ..._cache[dealId], loading: false, loadError: e.message };
  }
  paint(dealId);
}

function schedulePoll(dealId) {
  stopPoll(dealId);
  _timers[dealId] = setTimeout(() => {
    if (!document.getElementById('dh-' + dealId)) { stopPoll(dealId); delete _cache[dealId]; return; }
    _cache[dealId].top = null; _cache[dealId].thread = null;
    load(dealId);
  }, POLL_MS);
}
function stopPoll(dealId) { clearTimeout(_timers[dealId]); delete _timers[dealId]; }

const BTN = 'padding:5px 12px;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font)';
const BOX = 'width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;font-family:var(--font);';
const head = (extra = '') => `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b style="font-size:13px;color:#0c4a6e">Demo hand-off → #demo-handoffs</b>${extra}</div>`;

function body(dealId) {
  const c = _cache[dealId] || {};
  if (c.loading) return head() + '<div style="font-size:12px;color:#64748b">Loading…</div>';
  if (c.loadError) return head() + `<div style="font-size:12px;color:#b91c1c">${esc(c.loadError)}</div>`;
  const row = c.row || {};
  const id = jsArg(dealId);
  const docLink = row.doc_url ? `<a href="${escAttr(row.doc_url)}" target="_blank" style="font-size:12px">${esc(c.docName || 'Transcript Doc')} ↗</a>` : '';

  if (row.status === 'posted') {
    return head('<span style="font-size:11px;color:#059669;font-weight:600">✓ Posted</span>')
      + `<div style="font-size:12px;color:#334155">Posted ${esc(fmt(row.posted_at))} by ${esc(row.posted_by || '')}. Recording: ${esc(row.recording_note || '—')}</div>`
      + (row.error ? `<div style="font-size:12px;color:#b91c1c;margin-top:4px">${esc(row.error)}</div>` : '')
      + `<div style="margin-top:4px">${docLink}</div>`;
  }
  if (row.status === 'generating' || row.status === 'posting') {
    const what = row.status === 'posting' ? 'Posting to Slack…' : 'Transcribing, making the Doc and drafting… (about a minute)';
    return head() + `<div style="font-size:12px;color:#0369a1">⏳ ${what}</div>`;
  }

  let h = head();
  h += sourcePicker(dealId, c);
  if (row.status === 'failed' && row.error) h += `<div style="font-size:12px;color:#b91c1c;margin:6px 0">${esc(row.error)}</div>`;
  h += `<button style="${BTN};background:#0284c7;color:#fff;margin-top:6px" onclick="dhGenerate(${id})">${row.status === 'ready' ? 'Re-generate draft' : 'Generate draft'}</button>`;
  if (row.status !== 'ready') return h;

  h += `<div style="margin-top:10px;font-size:12px">${docLink}</div>`;
  if (row.warning) h += `<div style="margin-top:6px;padding:6px 8px;background:#fef3c7;border-radius:6px;font-size:12px;color:#92400e">${esc(row.warning)}</div>`;
  h += `<label style="display:block;font-size:11px;font-weight:600;color:#475569;margin:8px 0 2px">Channel message</label>`
    + `<textarea id="dh-top-${escAttr(dealId)}" rows="2" style="${BOX}" oninput="dhEdit(${id},'top',this.value)">${esc(str(c.top))}</textarea>`
    + `<label style="display:block;font-size:11px;font-weight:600;color:#475569;margin:8px 0 2px">Thread reply <span style="font-weight:400">(the Doc link goes first${row.source === 'meet' ? ', the Fathom link last' : ', the recording after it'})</span></label>`
    + `<textarea id="dh-thread-${escAttr(dealId)}" rows="12" style="${BOX}" oninput="dhEdit(${id},'thread',this.value)">${esc(str(c.thread))}</textarea>`;
  if (row.fact_check) {
    h += `<div style="margin-top:8px;padding:6px 8px;background:#ecfdf5;border-radius:6px;font-size:12px;color:#065f46;white-space:pre-wrap"><b>✅ Fact check before you post</b>\n${esc(row.fact_check)}</div>`;
  }
  if (row.error) h += `<div style="font-size:12px;color:#b91c1c;margin-top:6px">${esc(row.error)}</div>`;
  h += `<button style="${BTN};background:#16a34a;color:#fff;margin-top:8px;width:100%" onclick="dhPost(${id})">Post to #demo-handoffs</button>`;
  return h;
}

function sourcePicker(dealId, c) {
  const id = jsArg(dealId);
  const radio = (v, label) => `<label style="font-size:12px;cursor:pointer;margin-right:12px"><input type="radio" name="dh-src-${escAttr(dealId)}" ${c.source === v ? 'checked' : ''} onchange="dhSource(${id},'${v}')"> ${label}</label>`;
  let h = `<div style="margin-bottom:4px">${radio('phone', 'Phone disco (JustCall)')}${radio('meet', 'Google Meet disco (Fathom)')}</div>`;
  if (c.source === 'phone') {
    h += c.recordingUrl
      ? `<div style="font-size:11px;color:#475569">Recording: ${esc(c.suggest?.recordingUrl === c.recordingUrl ? (c.suggest.recordingLabel || '') : 'the one used last time')} · <a href="${escAttr(c.recordingUrl)}" target="_blank">play</a></div>`
      : `<div style="font-size:11px;color:#b91c1c">No Demo Scheduled call recording on this card's timeline yet — it lands a minute or two after the call is dispositioned. Reopen the card then.</div>`;
  } else {
    h += `<input type="url" placeholder="Fathom share link (fathom.video/share/…)" value="${escAttr(c.fathomUrl || '')}" oninput="dhEdit(${id},'fathomUrl',this.value)" style="${BOX}">`;
  }
  return h;
}

const fmt = (ts) => { try { return new Date(ts).toLocaleString(); } catch { return str(ts); } };

window.dhSource = (dealId, v) => { const c = _cache[dealId]; if (!c) return; c.source = v; paint(dealId); };
window.dhEdit = (dealId, field, v) => { const c = _cache[dealId]; if (c) c[field] = v; };

window.dhGenerate = async (dealId) => {
  const c = _cache[dealId];
  if (!c || c.busy) return;
  if (c.row?.status === 'ready' && !confirm('Replace the current draft (and any edits) with a new one?')) return;
  c.busy = true;
  try {
    await invokeEdgeFunction('demo-handoff', { action: 'generate', dealId, source: c.source, recordingUrl: c.recordingUrl, fathomUrl: str(c.fathomUrl).trim() });
    c.top = null; c.thread = null;
    c.row = { ...(c.row || {}), status: 'generating' };
    paint(dealId);
    schedulePoll(dealId);
  } catch (e) {
    showToast(e.message, 'error');
  } finally { c.busy = false; }
};

window.dhPost = async (dealId) => {
  const c = _cache[dealId];
  if (!c || c.busy) return;
  const top = str(document.getElementById('dh-top-' + dealId)?.value ?? c.top).trim();
  const thread = str(document.getElementById('dh-thread-' + dealId)?.value ?? c.thread).trim();
  if (!top || !thread) { showToast('Both boxes need text', 'warn'); return; }
  if (!confirm('Post this to #demo-handoffs now?')) return;
  c.busy = true;
  c.row = { ...(c.row || {}), status: 'posting' };
  paint(dealId);
  try {
    const r = await invokeEdgeFunction('demo-handoff', { action: 'post', dealId, topMessage: top, threadMessage: thread });
    showToast(r.recordingNote && r.recordingNote !== 'file' ? `Posted — recording went in as a ${r.recordingNote.split(' (')[0]}` : 'Posted to #demo-handoffs', 'success');
  } catch (e) {
    showToast('Could not post: ' + e.message, 'error');
  } finally {
    c.busy = false; c.top = null; c.thread = null;
    load(dealId);
  }
};
