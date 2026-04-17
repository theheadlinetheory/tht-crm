// ═══════════════════════════════════════════════════════════
// PASSOFF — Passoff instructions generator + transcript polling
// ═══════════════════════════════════════════════════════════

import { state, pendingWrites } from './app.js';
import { invokeEdgeFunction, sbUpdateDeal } from './api.js';
import { esc, str } from './utils.js';
import { refreshModal } from './render.js';
import { isAdmin, isEmployee } from './auth.js';

// ─── Transcript Polling ───

let transcriptPollTimer = null;
let transcriptPollCount = 0;
const MAX_POLL_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 30000;

export function startTranscriptPolling(dealId, phone) {
  stopTranscriptPolling();
  transcriptPollCount = 0;
  pollTranscript(dealId, phone);
}

export function stopTranscriptPolling() {
  if (transcriptPollTimer) {
    clearTimeout(transcriptPollTimer);
    transcriptPollTimer = null;
  }
  transcriptPollCount = 0;
}

async function pollTranscript(dealId, phone) {
  if (transcriptPollCount >= MAX_POLL_ATTEMPTS) {
    stopTranscriptPolling();
    return;
  }
  transcriptPollCount++;

  try {
    const resp = await invokeEdgeFunction('justcall-transcript', { phone, dealId });
    if (resp.transcript) {
      const deal = state.deals.find(d => d.id === dealId);
      if (deal) {
        deal.callTranscript = resp.transcript;
        if (state.selectedDeal === dealId) refreshModal();
      }
      stopTranscriptPolling();
      return;
    }
    if (resp.pending) {
      transcriptPollTimer = setTimeout(() => pollTranscript(dealId, phone), POLL_INTERVAL_MS);
    }
  } catch (e) {
    console.warn('Transcript poll error:', e);
    stopTranscriptPolling();
  }
}

// ─── Generate Passoff ───

async function generatePassoff(dealId, clientName) {
  const btn = document.getElementById('passoff-generate-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }

  try {
    const resp = await invokeEdgeFunction('generate-passoff', { dealId, clientName });
    if (resp.error) throw new Error(resp.error);

    const deal = state.deals.find(d => d.id === dealId);
    if (deal) {
      deal.passoffInstructions = resp.instructions;
      if (state.selectedDeal === dealId) refreshModal();
    }
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Generate Passoff Instructions'; }
    alert('Failed to generate passoff: ' + e.message);
  }
}

async function regeneratePassoff(dealId, clientName) {
  if (!confirm('This will overwrite your current edits. Continue?')) return;
  generatePassoff(dealId, clientName);
}

// ─── Save Passoff Text (debounced) ───

let passoffSaveTimer = null;

function savePassoffText(dealId, text) {
  const deal = state.deals.find(d => d.id === dealId);
  if (deal) deal.passoffInstructions = text;

  clearTimeout(passoffSaveTimer);
  passoffSaveTimer = setTimeout(() => {
    pendingWrites.value++;
    sbUpdateDeal(dealId, { passoffInstructions: text })
      .finally(() => { pendingWrites.value--; });
  }, 1500);
}

// ─── Send Passoff to Client ───

async function sendPassoffToClient(dealId, clientName) {
  const deal = state.deals.find(d => d.id === dealId);
  if (!deal || !deal.passoffInstructions) return;

  const sendBtn = document.getElementById('passoff-send-btn');
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sending...'; }

  try {
    await invokeEdgeFunction('send-email', {
      action: 'send_to_client_thread',
      dealId,
      clientName,
      messageBody: deal.passoffInstructions,
    });

    deal.passoffSentAt = new Date().toISOString();
    pendingWrites.value++;
    sbUpdateDeal(dealId, { passoffSentAt: deal.passoffSentAt })
      .finally(() => { pendingWrites.value--; });

    if (state.selectedDeal === dealId) refreshModal();
  } catch (e) {
    alert('Failed to send passoff: ' + e.message);
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send to Client →'; }
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

  if (!hasInstructions) {
    h += `<button id="passoff-generate-btn" class="btn btn-primary"
      style="width:100%;justify-content:center;gap:6px;font-size:13px;background:#7c3aed;border-color:#7c3aed"
      onclick="generatePassoffClick('${esc(deal.id)}','${esc(clientName)}')">
      Generate Passoff Instructions
    </button>
    <div style="font-size:10px;color:var(--text-muted);margin-top:6px">
      Call transcript: ${hasTranscript ? '<span style="color:#059669">Available</span>' : '<span style="color:#d97706">Pending</span>'}
    </div>`;
  } else {
    h += `<textarea id="passoff-text" rows="8"
      oninput="savePassoffTextClick('${esc(deal.id)}',this.value)"
      style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);background:var(--card);color:var(--text);resize:vertical;margin-bottom:8px">${esc(deal.passoffInstructions)}</textarea>
    <div style="display:flex;gap:6px">
      <button class="btn btn-ghost" style="flex:1;justify-content:center;font-size:12px"
        onclick="regeneratePassoffClick('${esc(deal.id)}','${esc(clientName)}')">
        Regenerate
      </button>
      <button id="passoff-send-btn" class="btn btn-primary" style="flex:1;justify-content:center;font-size:12px;background:#7c3aed;border-color:#7c3aed"
        onclick="sendPassoffClick('${esc(deal.id)}','${esc(clientName)}')">
        ${hasSent ? 'Resend to Client' : 'Send to Client'}
      </button>
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
window.sendPassoffClick = function(dealId, clientName) {
  sendPassoffToClient(dealId, clientName);
};
window.toggleTranscriptSection = function() {
  const body = document.getElementById('transcript-body');
  const arrow = document.getElementById('transcript-arrow');
  if (body && arrow) {
    const show = body.style.display === 'none';
    body.style.display = show ? 'block' : 'none';
    arrow.textContent = show ? '▼' : '▶';
  }
};
