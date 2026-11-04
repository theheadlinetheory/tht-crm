// ═══════════════════════════════════════════════════════════
// LEAD DISPUTES — a client pushing back on a lead they were sent
// ═══════════════════════════════════════════════════════════
// A dispute lives on the lead_tracker row (dispute_status / dispute_reason /
// dispute_at). It never changes billing on its own: the lead is billed unless
// it is removed, and removing it is the same "Called Back" the CB button sets.
// Admins and employees can both log and resolve one — whoever handles the
// client handles the dispute.
import { state, pendingWrites } from './app.js?v=20261105023420';
import { sbUpdateTrackerEntry, invokeEdgeFunction, camelToSnake } from './api.js?v=20261105023420';
import { esc, str } from './utils.js?v=20261105023420';
import { render } from './render.js?v=20261105023420';

const LABELS = { open: 'Disputed', removed: 'Dispute: removed', billed: 'Dispute: billed' };

export function isOpenDispute(entry) {
  return str(entry.disputeStatus) === 'open';
}

// Small inline note for a lead's line in the invoice modal.
export function disputeNote(entry) {
  if (!isOpenDispute(entry)) return '';
  const reason = str(entry.disputeReason);
  return `<div style="font-size:10px;font-weight:600;color:#b45309">⚠ Disputed${reason ? `: ${esc(reason)}` : ''}</div>`;
}

// The row's action button: a flag to open a dispute, or the dispute's status.
export function renderDisputeButton(entry) {
  const status = str(entry.disputeStatus);
  const reason = str(entry.disputeReason);
  if (!status) {
    return `<button class="tracker-action-btn" onclick="trackerOpenDispute('${entry.id}')" title="Client is disputing this lead">⚑ Dispute</button>`;
  }
  const color = status === 'open' ? '#b45309' : '#6b7280';
  return `<button class="tracker-action-btn" style="color:${color};border-color:${color}" onclick="trackerOpenDispute('${entry.id}')" title="${esc(reason)}">${status === 'open' ? '⚠ ' : ''}${esc(LABELS[status] || status)}</button>`;
}

export function renderDisputeModal() {
  const d = state.trackerDispute;
  if (!d) return '';
  const entry = state.trackerEntries.find(e => e.id === d.id);
  if (!entry) return '';
  const status = str(entry.disputeStatus);

  return `<div class="modal-overlay">
    <div class="invoice-modal" style="max-width:420px">
      <div class="invoice-header">
        <h3 style="margin:0;font-size:16px">Dispute — ${esc(str(entry.leadName))}</h3>
        <button class="btn btn-ghost" onclick="trackerCloseDispute()" style="padding:4px 8px">✕</button>
      </div>
      <div class="invoice-body">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">${esc(str(entry.clientName))}${status ? ` · currently <strong>${esc(LABELS[status] || status)}</strong>` : ''}</div>
        <textarea id="dispute-reason" placeholder="What did the client say? e.g. no-show reported same day by text"
          style="width:100%;min-height:90px;border:1px solid var(--border);border-radius:6px;padding:10px;font-size:13px;font-family:var(--font);resize:vertical">${esc(str(entry.disputeReason))}</textarea>
        <div style="font-size:11px;color:var(--text-muted);margin:6px 0 12px">The lead stays billed unless you remove it.</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <button class="btn btn-primary" onclick="trackerSaveDispute('open')">Save — Still Open</button>
          <button class="btn btn-ghost" style="color:#dc2626;border-color:#fca5a5" onclick="trackerSaveDispute('removed')">Remove Lead (not charged)</button>
          <button class="btn btn-ghost" onclick="trackerSaveDispute('billed')">Keep Billing It</button>
          ${status ? `<button class="btn btn-ghost" style="color:var(--text-muted)" onclick="trackerSaveDispute('')">Clear Dispute</button>` : ''}
        </div>
      </div>
    </div>
  </div>`;
}

function saveDispute(entry, status, reason) {
  const fields = {
    disputeStatus: status,
    disputeReason: status ? reason : '',
    disputeAt: status ? (str(entry.disputeAt) || new Date().toISOString()) : null,
  };
  if (status === 'removed') fields.callbackStatus = 'Called Back';
  Object.assign(entry, fields);
  render();

  pendingWrites.value++;
  sbUpdateTrackerEntry(entry.id, camelToSnake(fields))
    .then(() => {
      if (status === 'removed') invokeEdgeFunction('sync-lead-tracker', { action: 'sync-row', entryId: entry.id }).catch(() => {});
    })
    .catch(e => { console.error('Save dispute failed:', e); alert('Saving the dispute failed: ' + e.message); })
    .finally(() => { pendingWrites.value--; });
}

window.trackerOpenDispute = (id) => { state.trackerDispute = { id }; render(); };
window.trackerCloseDispute = () => { state.trackerDispute = null; render(); };
window.trackerSaveDispute = (status) => {
  const entry = state.trackerEntries.find(e => e.id === state.trackerDispute?.id);
  if (!entry) return;
  const reason = (document.getElementById('dispute-reason')?.value || '').trim();
  if (status === 'open' && !reason) { alert('Add what the client said first.'); return; }
  state.trackerDispute = null;
  saveDispute(entry, status, reason);
};
