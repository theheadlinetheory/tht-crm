// ═══════════════════════════════════════════════════════════
// CHECKIN-CONFIRM — the "still good for tomorrow?" email on the Check-ins tab
// ═══════════════════════════════════════════════════════════
//
// The business day before each client check-in, aidan@ emails the client a
// confirmation with a reschedule link (edge fn checkin-confirm, 8am card + 1pm
// send in #checkin-call-attendance). This tab shows where each call stands and
// lets an admin Skip it or Send it now. Per-client on/off lives in Settings ›
// Clients ("Check-in confirmation email"). Rows: table checkin_confirmations.

import { supabase } from './supabase-client.js?v=20261114043221';
import { invokeEdgeFunctionAsUser } from './edge-auth.js?v=20261114043221';
import { esc, str, jsArg } from './utils.js?v=20261114043221';

const _s = { loading: false, rows: null, error: '', busy: '', note: {} };

const STATUS = {
  queued: ['Confirmation goes out 1 PM ET', '#f1f5f9', '#475569'],
  sending: ['Sending…', '#f1f5f9', '#475569'],
  sent: ['⏳ Emailed, no reply', '#fef9c3', '#854d0e'],
  confirmed: ['✅ Confirmed', '#dcfce7', '#166534'],
  moving: ['↻ Wants to move', '#ffedd5', '#9a3412'],
  rebooked: ['↻ Rebooked', '#ffedd5', '#9a3412'],
  replied: ['💬 Replied', '#dbeafe', '#1e40af'],
  skipped: ['Skipped', '#f1f5f9', '#64748b'],
  off: ['Confirmation off', '#f1f5f9', '#64748b'],
  recent: ['Just booked', '#f1f5f9', '#64748b'],
  failed: ['⚠️ Email failed', '#fee2e2', '#991b1b'],
  moved: ['Moved', '#f1f5f9', '#64748b'],
  cancelled: ['Cancelled', '#f1f5f9', '#64748b'],
};

/** Google's htmlLink carries eid = base64("<eventId> <calendar>"); the event id is shared by every guest's copy. */
export function eventIdFromLink(link) {
  const eid = /[?&]eid=([^&]+)/.exec(str(link))?.[1];
  if (!eid) return '';
  try { return atob(decodeURIComponent(eid).replace(/-/g, '+').replace(/_/g, '/')).split(' ')[0]; } catch { return ''; }
}

export async function loadConfirmations(paint, force = false) {
  if (_s.loading || (_s.rows && !force)) return;
  _s.loading = true;
  try {
    const since = new Date(Date.now() - 864e5).toISOString();
    const { data, error } = await supabase.from('checkin_confirmations')
      .select('id,event_id,event_start,status,reply_text,rebooked_label,recipients,result,test_mode')
      .gte('event_start', since).order('event_start');
    if (error) throw error;
    _s.rows = data || []; _s.error = '';
  } catch (e) { _s.error = e.message || 'Could not load confirmations'; _s.rows = _s.rows || []; }
  _s.loading = false;
  paint();
}

function rowFor(call) {
  const id = eventIdFromLink(call?.link);
  if (!id || !_s.rows) return null;
  const at = Date.parse(call.start);
  return _s.rows.find(r => r.event_id === id && Date.parse(r.event_start) === at) || null;
}

/** Small chip for the calls list. '' until loaded or when nothing is tracked yet. */
export function confirmChip(call) {
  const r = rowFor(call);
  if (!r) return '';
  const [label, bg, fg] = STATUS[r.status] || [r.status, '#f1f5f9', '#475569'];
  return `<span style="display:inline-block;font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;background:${bg};color:${fg};margin-top:3px">${esc(label)}</span>`;
}

const CAN_SKIP = ['queued', 'off', 'recent', 'failed'];
const CAN_SEND = ['queued', 'skipped', 'off', 'recent', 'failed', 'moved'];

/** Status line + Skip / Send now for the selected call. */
export function confirmPanel(call) {
  if (!call) return '';
  const eventId = eventIdFromLink(call.link);
  if (!eventId) return '';
  const r = rowFor(call);
  const status = r?.status || '';
  const [label] = STATUS[status] || ['Not queued yet — goes on the 8am card the business day before'];
  const btn = (fn, text) => `<button class="btn btn-ghost" style="font-size:11px;padding:3px 8px" ${_s.busy ? 'disabled' : ''} onclick="${fn}(${jsArg(eventId)})">${text}</button>`;
  const detail = r?.reply_text ? ` · “${esc(str(r.reply_text).slice(0, 140))}”` : r?.rebooked_label ? ` · to ${esc(r.rebooked_label)}` : r?.status === 'failed' && r?.result ? ` · ${esc(r.result)}` : '';
  const note = _s.note[eventId] ? `<div style="font-size:11px;color:#64748b;margin-top:4px">${esc(_s.note[eventId])}</div>` : '';
  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;background:#f8fafc;border:1px solid var(--border);border-radius:8px;padding:8px 12px;margin-bottom:14px;font-size:12px">
    <div><strong>Confirmation email:</strong> ${esc(label)}${detail}${r?.test_mode ? ' <span style="color:#b45309">(test mode)</span>' : ''}${note}</div>
    <div style="display:flex;gap:6px;flex-shrink:0">
      ${!status || CAN_SKIP.includes(status) ? btn('ccSkip', 'Skip this one') : ''}
      ${!status || CAN_SEND.includes(status) ? btn('ccSendNow', 'Send now') : ''}
    </div></div>`;
}

async function act(action, eventId, paint) {
  _s.busy = eventId; _s.note[eventId] = action === 'skip' ? 'Skipping…' : 'Sending…';
  paint();
  try {
    const r = await invokeEdgeFunctionAsUser('checkin-confirm', { action, eventId });
    _s.note[eventId] = r.note || (action === 'skip' ? 'Skipped.' : 'Sent.');
  } catch (e) { _s.note[eventId] = e.message || 'Failed'; }
  _s.busy = '';
  await loadConfirmations(paint, true);
}

export function wireConfirmHandlers(paint) {
  window.ccSkip = (eventId) => act('skip', eventId, paint);
  window.ccSendNow = (eventId) => act('send_now', eventId, paint);
}
