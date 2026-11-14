// ═══════════════════════════════════════════════════════════
// HIRING — "not moving forward" email (Aidan, 2026-11-14).
// Moving an applicant to Not a Fit opens a confirm box with a "send" checkbox
// (ticked by default) and a preview of the email. Confirm moves the card and,
// if ticked, sends one email via hiring-reject (first name, signed by the team,
// never twice: rejection_sent_at). Applicants already in Not a Fit get nothing
// automatically; their card has a Send button that opens the same box.
// ═══════════════════════════════════════════════════════════
import { render } from './render.js?v=20261114103724';
import { supabase } from './supabase-client.js?v=20261114103724';
import { showToast } from './api.js?v=20261114103724';
import { esc } from './utils.js?v=20261114103724';
import { findCandidate, applyMove } from './hiring.js?v=20261114103724';
import { addHiringActivity } from './hiring-activity.js?v=20261114103724';

export const REJECT_STAGE = 'Not a Fit';

// { id, send, preview: { to, subject, body } | { error } | null }
let _box = null;

export const needsRejectPrompt = (c, stage) => stage === REJECT_STAGE && c.kind === 'applicant' && !c.rejection_sent_at;

const invokeReject = (body) => supabase.functions.invoke('hiring-reject', { body });

export async function openRejectBox(c) {
  _box = { id: c.id, send: !!c.email, preview: null };
  render();
  if (!c.email) return;
  const { data, error } = await invokeReject({ candidateId: c.id, preview: true });
  if (_box?.id !== c.id) return;
  _box.preview = error || data?.error ? { error: error?.message || data.error } : data;
  render();
}

async function sendRejection(c) {
  const { data, error } = await invokeReject({ candidateId: c.id });
  if (error || data?.error) { showToast(`Email NOT sent to ${c.name || c.email}: ${error?.message || data.error}`); return; }
  c.rejection_sent_at = data.rejectionSentAt;
  if (data.alreadySent) return;
  await addHiringActivity(c.id, { type: 'message_out', body: `"Not moving forward" email sent to ${data.sentTo}`, channel: 'Email' });
  showToast(`Email sent to ${data.sentTo}`, 'success');
}

async function confirmBox() {
  const c = _box && findCandidate(_box.id);
  if (!c) return;
  const send = _box.send;
  _box = null;
  render();
  if (c.stage !== REJECT_STAGE) await applyMove(c, REJECT_STAGE);
  if (send) await sendRejection(c);
  render();
}

function previewHtml(c) {
  if (!c.email) return '<div style="color:#b91c1c">No email on this card, so nothing can be sent.</div>';
  const p = _box.preview;
  if (!p) return '<div style="color:var(--text-muted)">Loading preview…</div>';
  if (p.error) return `<div style="color:#b91c1c">Preview failed: ${esc(p.error)}</div>`;
  return `<div style="color:var(--text-muted);margin-bottom:4px">To ${esc(p.to)} · ${esc(p.subject)}</div>
    <div style="white-space:pre-wrap;line-height:1.5;background:#f9fafb;border:1px solid var(--border);border-radius:8px;padding:10px">${esc(p.body)}</div>`;
}

export function renderRejectBox() {
  const c = _box && findCandidate(_box.id);
  if (!c) return '';
  const moving = c.stage !== REJECT_STAGE;
  return `<div class="modal-overlay" onclick="if(event.target===this)hiringRejectCancel()">
    <div class="modal" style="width:480px;max-width:95vw" onclick="event.stopPropagation()">
      <div class="modal-header"><h3>${moving ? 'Move' : 'Email'} ${esc(c.name || c.email)}${moving ? ' to Not a Fit' : ''}</h3>
        <button class="modal-close" onclick="hiringRejectCancel()">×</button></div>
      <div class="modal-body" style="font-size:13px">
        <label style="display:flex;gap:8px;align-items:center;font-weight:600;margin-bottom:10px;cursor:pointer">
          <input type="checkbox" ${_box.send ? 'checked' : ''} ${c.email ? '' : 'disabled'} onchange="hiringRejectToggle(this.checked)">
          Send "not moving forward" email
        </label>
        ${_box.send ? previewHtml(c) : ''}
      </div>
      <div class="modal-footer"><span></span><div style="display:flex;gap:8px">
        <button class="btn" style="background:#f9fafb;color:#6b7280;border:1px solid #e5e7eb" onclick="hiringRejectCancel()">Cancel</button>
        <button class="btn btn-primary" ${!moving && !_box.send ? 'disabled' : ''} onclick="hiringRejectConfirm()">${moving ? (_box.send ? 'Move & send' : 'Move') : 'Send'}</button>
      </div></div>
    </div>
  </div>`;
}

// Card modal line: sent date, or a Send button for applicants already in Not a Fit.
export function rejectStatusHtml(c) {
  if (c.kind !== 'applicant') return '';
  if (c.rejection_sent_at) return `<span style="color:var(--text-muted)">Rejection email sent ${esc(new Date(c.rejection_sent_at).toLocaleDateString())}</span>`;
  if (c.stage !== REJECT_STAGE || !c.email) return '';
  return `<button class="btn btn-ghost" style="font-size:12px" onclick="hiringRejectOpen('${esc(c.id)}')">✉️ Send rejection email</button>`;
}

// ─── Handlers (inline onclick: data-action does not survive inside modals) ───
window.hiringRejectToggle = (on) => { if (_box) { _box.send = on; render(); } };
window.hiringRejectCancel = () => { _box = null; render(); };
window.hiringRejectConfirm = () => confirmBox();
window.hiringRejectOpen = (id) => { const c = findCandidate(id); if (c) openRejectBox(c); };
