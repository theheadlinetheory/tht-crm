// ═══════════════════════════════════════════════════════════
// NOT A REAL LEAD — take a bad client lead out of the CRM AND out of Smartlead's positives
// ═══════════════════════════════════════════════════════════
// Tim, 2026-11-10: a client campaign showed 17 "positive replies" in Smartlead but
// only 3 were passed off, so the campaign (and what we have done for the client)
// looked better than it was. One button on a client lead's card now:
//   1. writes "Removed — Miscategorized · client lead: <reason>" on the Timeline.
//      The DB trigger interactions_miscategorized_to_smartlead (tht-crm-backend
//      20261109_miscategorized_to_smartlead.sql) hands that to the
//      smartlead-recategorize edge function, which moves the lead to
//      "Uncategorizable by Ai" in its campaign. It only changes a lead that is
//      still positive there, so a person's own later tag is never overwritten.
//   2. archives the card with the reason, the same way the Archive button does.
// Staff only. Acquisition leads keep their own removal picker (removal-reason.js).
import { state } from './app.js?v=20261110103444';
import { esc } from './utils.js?v=20261110103444';
import { sbCreateInteraction, showToast } from './api.js?v=20261110103444';
import { isAdmin, isEmployee } from './auth.js?v=20261110103444';
import { deleteDeal } from './deals.js?v=20261110103444';
import { REMOVAL_PREFIX } from './removal-reason.js?v=20261110103444';

const REASONS = [
  { label: 'Not actually interested',        hint: 'the AI tagged a no / an auto-reply / a question as positive' },
  { label: 'Wrong contact',                  hint: 'not the decision maker, left the company, wrong property' },
  { label: 'Not a fit for the client',       hint: 'outside the service area, wrong service, too small' },
  { label: 'Duplicate or existing customer', hint: 'already on the board, or already works with the client' },
  { label: 'Other',                          hint: 'say why in the box below' },
];

export function isClientLead(deal) {
  return !!deal && deal.pipeline === 'Client' && deal.leadSource !== 'cold_call';
}

export function renderNotALeadButton(deal) {
  if (!isClientLead(deal) || !(isAdmin() || isEmployee())) return '';
  return `<div style="margin-top:12px;padding-top:10px;border-top:1px solid #e9d5ff">
    <button onclick="event.stopPropagation();openNotALead('${esc(deal.id)}')" title="Take this lead off the board and stop Smartlead counting it as a positive reply"
      style="padding:7px 14px;background:#fff;color:#b91c1c;border:1px solid #fca5a5;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font)">
      Not a real lead: remove + recategorize in Smartlead
    </button>
  </div>`;
}

function modalHtml(deal) {
  const delivered = deal.pushedToTracker || deal.forwardedAt || deal.pushedToClientSheet;
  return `<div class="modal" style="width:480px" onclick="event.stopPropagation()">
    <div class="modal-header"><h3>Not a real lead</h3><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button></div>
    <div class="modal-body">
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
        <b>${esc(deal.company || deal.contact || deal.email || 'This lead')}</b> leaves the board (it stays in the Archive) and
        stops counting as a positive reply in Smartlead (moved to "Uncategorizable by Ai").
      </div>
      ${delivered ? `<div style="font-size:12px;background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:8px;margin-bottom:12px">
        This lead was already sent to the client. Removing it here does not un-send it; if it was billed, flag it in the Lead Tracker (🚫 CB) too.</div>` : ''}
      <div style="display:flex;flex-direction:column;gap:6px">
        ${REASONS.map((r, i) => `<label style="display:flex;gap:8px;align-items:flex-start;padding:8px;border:1px solid var(--border);border-radius:6px;cursor:pointer">
          <input type="radio" name="not-a-lead-reason" value="${i}" ${i === 0 ? 'checked' : ''} style="margin-top:2px">
          <span><b style="font-size:13px">${esc(r.label)}</b><br><span style="font-size:11px;color:var(--text-muted)">${esc(r.hint)}</span></span>
        </label>`).join('')}
      </div>
      <input id="not-a-lead-detail" type="text" placeholder="Detail (optional)" style="width:100%;box-sizing:border-box;margin-top:10px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
      <button id="not-a-lead-go" class="btn btn-primary" style="width:100%;margin-top:12px;justify-content:center;background:#dc2626;border-color:#dc2626"
        onclick="confirmNotALead('${esc(deal.id)}')">Remove from CRM + recategorize in Smartlead</button>
    </div>
  </div>`;
}

window.openNotALead = (dealId) => {
  const deal = state.deals.find(d => d.id === dealId);
  if (!deal) return;
  const overlay = document.createElement('div');
  overlay.id = 'not-a-lead-overlay';
  overlay.className = 'modal-overlay';
  overlay.onclick = () => overlay.remove();
  overlay.innerHTML = modalHtml(deal);
  document.body.appendChild(overlay);
};

window.confirmNotALead = async (dealId) => {
  const deal = state.deals.find(d => d.id === dealId);
  const overlay = document.getElementById('not-a-lead-overlay');
  if (!deal) { overlay?.remove(); return; }
  const idx = Number(document.querySelector('input[name="not-a-lead-reason"]:checked')?.value || 0);
  const reason = REASONS[idx].label;
  const detail = (document.getElementById('not-a-lead-detail')?.value || '').trim();
  if (reason === 'Other' && !detail) { showToast('Say why in the detail box', 'error'); return; }
  const btn = document.getElementById('not-a-lead-go');
  if (btn) { btn.disabled = true; btn.textContent = 'Removing…'; }

  const why = reason + (detail ? ' — ' + detail : '');
  try {
    // The trigger keys on this exact prefix ("Removed — Miscategorized").
    await sbCreateInteraction({ deal_id: dealId, type: 'Note', content: `${REMOVAL_PREFIX}Miscategorized · client lead: ${why} · marked in the CRM` });
  } catch (e) {
    // No note = no Smartlead change, so do not archive either: nothing half-done.
    showToast('Could not save the reason, nothing was removed: ' + (e && e.message || e), 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Remove from CRM + recategorize in Smartlead'; }
    return;
  }
  overlay?.remove();
  await deleteDeal(dealId, 'Not a real lead — ' + why, deal.stage);
  showToast('Removed. Smartlead is being updated (if the lead is still positive there).', 'success');
};
