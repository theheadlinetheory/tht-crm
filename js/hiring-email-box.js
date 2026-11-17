// ═══════════════════════════════════════════════════════════
// HIRING EMAIL BOX — the editable box that opens before a hiring email goes out
// (Aidan, 2026-11-14 / 11-16). Moving applicants (one, or a bulk selection) to
// Interviewing or Not a Fit opens it: a "send" checkbox (ticked), the subject,
// and each person's own message, already greeting them by first name, so a wrong
// name or anything else can be fixed in place. Confirm moves them and sends each their copy via
// the stage's edge function. Never twice: invite_sent_at / rejection_sent_at.
// ═══════════════════════════════════════════════════════════
import { render } from './render.js?v=20261118043317';
import { supabase } from './supabase-client.js?v=20261118043317';
import { showToast } from './api.js?v=20261118043317';
import { esc, escAttr, jsArg } from './utils.js?v=20261118043317';
import { findCandidate, applyMove } from './hiring.js?v=20261118043317';
import { addHiringActivity } from './hiring-activity.js?v=20261118043317';

export const REJECT_STAGE = 'Not a Fit';
const TOKEN = '{first_name}';
export const STAGE_EMAILS = {
  Interviewing: { fn: 'hiring-invite', column: 'invite_sent_at', label: 'interview invite', sentLabel: 'Interview invite sent' },
  [REJECT_STAGE]: { fn: 'hiring-reject', column: 'rejection_sent_at', label: '"not moving forward" email', sentLabel: 'Rejection email sent' },
};
const INPUT = 'width:100%;padding:7px 9px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font);box-sizing:border-box';

// Same rule as the backend's firstName(): skip a lone initial ("J Karmina" → "Karmina").
const firstName = (full) => { const p = String(full || '').trim().split(/\s+/); return p.find(x => x.replace('.', '').length > 1) || p[0] || 'there'; };

const owes = (c, stage) => c.kind === 'applicant' && !!STAGE_EMAILS[stage] && !!c.email && !c[STAGE_EMAILS[stage].column];
export const needsEmailPrompt = (c, stage) => owes(c, stage);

// { stage, onConfirm, ids, send, bodies: {id: message}, subject, error, loaded }
let _box = null;

export async function openEmailBox(ids, stage, onConfirm = null) {
  const people = ids.map(findCandidate).filter(Boolean);
  const emailed = people.filter(c => owes(c, stage));
  _box = { stage, onConfirm, ids: people.map(c => c.id), send: emailed.length > 0, bodies: {}, subject: '', error: '', loaded: false };
  for (const c of emailed) _box.bodies[c.id] = '';
  render();
  if (!emailed.length) return;
  const { data, error } = await supabase.functions.invoke(STAGE_EMAILS[stage].fn, { body: { candidateId: emailed[0].id, preview: true } });
  if (!_box || _box.stage !== stage) return;
  if (error || data?.error) _box.error = error?.message || data.error;
  else {
    for (const c of emailed) _box.bodies[c.id] = data.template.split(TOKEN).join(firstName(c.name));
    Object.assign(_box, { subject: data.subject, loaded: true });
  }
  render();
}

async function sendOne(c, cfg, subject, body) {
  const { data, error } = await supabase.functions.invoke(cfg.fn, { body: { candidateId: c.id, subject, body } });
  if (error || data?.error) { showToast(`${cfg.label} NOT sent to ${c.name || c.email}: ${error?.message || data.error}`); return false; }
  c[cfg.column] = data.sentAt;
  if (data.alreadySent) return false;
  await addHiringActivity(c.id, { type: 'message_out', body: `${cfg.sentLabel} to ${data.sentTo}\n\n${body}`, channel: 'Email' });
  return true;
}

async function confirmBox() {
  const box = _box;
  if (!box || (box.send && !box.loaded)) return;
  _box = null;
  box.onConfirm?.();
  render();
  const cfg = STAGE_EMAILS[box.stage];
  let sent = 0;
  const people = box.ids.map(findCandidate).filter(Boolean);
  for (const c of people) {
    if (c.stage !== box.stage) await applyMove(c, box.stage);
    if (box.send && c.id in box.bodies && await sendOne(c, cfg, box.subject, box.bodies[c.id])) sent++;
  }
  showToast(box.send ? `${cfg.sentLabel} to ${sent} of ${Object.keys(box.bodies).length}` : `Moved ${people.length}`, 'success');
  render();
}

// One message per person, already addressed to them, edited in place.
function messagesHtml(many) {
  return Object.entries(_box.bodies).map(([id, body]) => {
    const c = findCandidate(id);
    return `<div style="margin-bottom:12px">
      ${many ? `<div style="font-size:12px;margin-bottom:4px"><b>${esc(c?.name || '')}</b> <span style="color:var(--text-muted)">${esc(c?.email || '')}</span></div>` : ''}
      <textarea oninput="hiringEmailBody(${jsArg(id)}, this.value)" style="${INPUT};min-height:${many ? 200 : 280}px;resize:vertical;line-height:1.5">${esc(body)}</textarea>
    </div>`;
  }).join('');
}

function editorHtml() {
  if (_box.error) return `<div style="color:#b91c1c">Could not load the email: ${esc(_box.error)}</div>`;
  if (!_box.loaded) return '<div style="color:var(--text-muted)">Loading the email…</div>';
  const many = Object.keys(_box.bodies).length > 1;
  return `<div style="font-weight:700;margin-bottom:6px">Subject</div>
    <input value="${escAttr(_box.subject)}" oninput="hiringEmailField('subject', this.value)" style="${INPUT};margin-bottom:10px">
    <div style="font-weight:700;margin-bottom:6px">${many ? 'Messages' : 'Message'}</div>
    ${messagesHtml(many)}`;
}

export function renderEmailBox() {
  if (!_box) return '';
  const cfg = STAGE_EMAILS[_box.stage];
  const people = _box.ids.map(findCandidate).filter(Boolean);
  const moving = people.filter(c => c.stage !== _box.stage).length;
  const owed = Object.keys(_box.bodies).length;
  const who = people.length === 1 ? esc(people[0].name || people[0].email) : `${people.length} people`;
  const already = people.length - owed;
  const action = [moving ? 'Move' : '', _box.send ? 'Send' : ''].filter(Boolean).join(' & ') || 'Move';
  return `<div class="modal-overlay">
    <div class="modal" style="width:600px;max-width:95vw">
      <div class="modal-header"><h3>${moving ? `Move ${who} to ${esc(_box.stage)}` : `Email ${who}`}</h3>
        <button class="modal-close" onclick="hiringEmailCancel()">×</button></div>
      <div class="modal-body" style="font-size:13px">
        ${owed ? `<label style="display:flex;gap:8px;align-items:center;font-weight:700;margin-bottom:10px;cursor:pointer">
          <input type="checkbox" ${_box.send ? 'checked' : ''} onchange="hiringEmailToggle(this.checked)" style="width:16px;height:16px">
          Send ${cfg.label}${owed > 1 ? ` to ${owed} people` : ''}</label>` : `<div style="color:var(--text-muted)">Nobody here is owed the ${cfg.label} (already sent, or no email).</div>`}
        ${already && owed ? `<div style="color:var(--text-muted);margin-bottom:8px">${already} already got it or have no email — they're moved but not emailed.</div>` : ''}
        ${_box.send ? editorHtml() : ''}
      </div>
      <div class="modal-footer"><span></span><div style="display:flex;gap:8px">
        <button class="btn" style="background:#f9fafb;color:#6b7280;border:1px solid #e5e7eb" onclick="hiringEmailCancel()">Cancel</button>
        <button class="btn btn-primary" ${(_box.send && !_box.loaded) || (!moving && !_box.send) ? 'disabled' : ''} onclick="hiringEmailConfirm()">${action}</button>
      </div></div>
    </div>
  </div>`;
}

// Card modal line: when each email went out, or a Send button if one is owed.
export function emailStatusHtml(c) {
  if (c.kind !== 'applicant') return '';
  return Object.entries(STAGE_EMAILS).map(([stage, cfg]) => {
    if (c[cfg.column]) return `<span style="color:var(--text-muted)">${cfg.sentLabel} ${esc(new Date(c[cfg.column]).toLocaleDateString())}</span>`;
    if (c.stage !== stage || !c.email) return '';
    return `<button class="btn btn-ghost" style="font-size:12px" onclick="hiringEmailOpen(${jsArg(c.id)}, ${jsArg(stage)})">✉️ Send ${cfg.label}</button>`;
  }).join('');
}

// ─── Handlers. Typing never re-renders, so the cursor stays put. ───
window.hiringEmailBody = (id, v) => { if (_box) _box.bodies[id] = v; };
window.hiringEmailField = (key, v) => { if (_box) _box[key] = v; };
window.hiringEmailToggle = (on) => { if (_box) { _box.send = on; render(); } };
window.hiringEmailCancel = () => { _box = null; render(); };
window.hiringEmailConfirm = () => confirmBox();
window.hiringEmailOpen = (id, stage) => openEmailBox([id], stage);
