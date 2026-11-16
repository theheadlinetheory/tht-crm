// ═══════════════════════════════════════════════════════════
// HIRING LIST — the sheet-style view of the Hiring tab (Aidan, 2026-11-16):
// one row per person, newest first, same filters as the board. Stage is a
// dropdown in the row (Not a Fit still asks about the email), the name opens
// the card, and ticked applicants can be moved to Not a Fit + emailed at once.
// Stage dropdowns call hiringMove (the board's path), so Not a Fit still asks.
// ═══════════════════════════════════════════════════════════
import { state } from './app.js?v=20261116154739';
import { render } from './render.js?v=20261116154739';
import { showToast } from './api.js?v=20261116154739';
import { esc, escAttr, safeUrl, str, jsArg } from './utils.js?v=20261116154739';
import { STAGES, CONTACT_TYPES, stageLabel, shortDate, replyText, waitingDays, findCandidate } from './hiring.js?v=20261116154739';
import { channelPill } from './hiring-channel.js?v=20261116154739';
import { withScheme } from './hiring-modal.js?v=20261116154739';
import { REJECT_STAGE, rejectNow } from './hiring-reject.js?v=20261116154739';

export const whatsappUrl = (phone) => `https://wa.me/${str(phone).replace(/\D/g, '')}`;

const _selected = new Set();
let _confirmBulk = false;

const link = (href, label) => href ? `<a href="${escAttr(href)}" target="_blank" rel="noopener" style="color:var(--purple)">${label}</a>` : '';

function stageSelect(c) {
  return `<select onchange="hiringMove(${jsArg(c.id)}, this.value)" style="padding:3px 6px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
    ${STAGES[c.kind].map(s => `<option value="${esc(s.id)}" ${s.id === c.stage ? 'selected' : ''}>${esc(stageLabel(s))}</option>`).join('')}
  </select>`;
}

function appliedCell(c) {
  const days = waitingDays(c);
  return esc(shortDate(c.applied_at)) + (days ? ` <span style="color:${days >= 3 ? '#d97706' : 'var(--text-muted)'}">· ${days}d</span>` : '');
}

const COLUMNS = {
  applicant: [
    ['Applied', appliedCell],
    ['Channel', c => esc(c.channel || '')],
    ['Country', c => esc(c.location || '')],
    ['Email', c => esc(c.email || '')],
    ['WhatsApp', c => c.phone ? link(whatsappUrl(c.phone), esc(c.phone)) : ''],
    ['Video', c => link(safeUrl(c.video_url), '▶ Loom')],
    ['LinkedIn', c => c.linkedin ? link(safeUrl(withScheme(c.linkedin)), 'in ↗') : ''],
  ],
  partner: [
    ['Type', c => esc(CONTACT_TYPES[c.contact_type || ''].label)],
    ['Channel', c => esc(c.channel || '')],
    ['Date', c => esc(shortDate(c.applied_at || c.created_at))],
    ['Last reply', c => `<div style="max-width:360px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-muted)">${esc(replyText(c.answers?.reply).replace(/\s+/g, ' '))}</div>`],
  ],
};

function rowHtml(c, cols, canTick) {
  const id = jsArg(c.id);
  return `<tr style="${c.has_new_activity ? 'background:#eff6ff' : ''}">
    ${canTick ? `<td><input type="checkbox" ${_selected.has(c.id) ? 'checked' : ''} onchange="hiringListTick(${id}, this.checked)"></td>` : ''}
    <td><span onclick="hiringToggleStar(${id})" style="cursor:pointer;color:${c.starred ? '#f59e0b' : '#d1d5db'}">★</span></td>
    <td style="font-weight:${c.has_new_activity ? 800 : 600};white-space:nowrap"><a href="#" onclick="event.preventDefault();hiringOpen(${id})" style="color:inherit;text-decoration:none">${channelPill(c)}${esc(c.name || c.email || 'Unknown')}</a></td>
    <td>${stageSelect(c)}</td>
    ${cols.map(([, cell]) => `<td>${cell(c)}</td>`).join('')}
  </tr>`;
}

function bulkBarHtml() {
  const n = _selected.size;
  if (!n) return '';
  const label = _confirmBulk ? `Confirm: move ${n} + email them?` : `Move ${n} to Not a Fit + send email`;
  return `<div style="padding:0 20px 8px;display:flex;gap:8px;align-items:center;font-size:12px">
    <button class="btn" style="background:${_confirmBulk ? '#b91c1c' : '#fef2f2'};color:${_confirmBulk ? '#fff' : '#b91c1c'};border:1px solid #fecaca;font-size:12px" onclick="hiringBulkReject()">${label}</button>
    <button class="btn btn-ghost" style="font-size:12px" onclick="hiringListClear()">Clear</button>
    <span style="color:var(--text-muted)">Already-emailed people are moved but not emailed again.</span>
  </div>`;
}

export function renderHiringList(list) {
  const kind = state.hiringKind;
  const cols = COLUMNS[kind];
  const canTick = kind === 'applicant';
  for (const id of _selected) if (!list.some(c => c.id === id)) _selected.delete(id);
  const head = `${canTick ? '<th></th>' : ''}<th></th><th>Name</th><th>Stage</th>${cols.map(([h]) => `<th>${h}</th>`).join('')}`;
  return `${bulkBarHtml()}<div style="padding:0 20px 20px;overflow-x:auto">
    <table class="rerun-table"><thead><tr>${head}</tr></thead>
    <tbody>${list.length ? list.map(c => rowHtml(c, cols, canTick)).join('') : `<tr><td colspan="${cols.length + 4}" style="color:var(--text-muted)">Nobody here</td></tr>`}</tbody></table>
  </div>`;
}

async function bulkReject() {
  if (!_confirmBulk) { _confirmBulk = true; render(); return; }
  const people = [..._selected].map(findCandidate).filter(Boolean);
  _selected.clear();
  _confirmBulk = false;
  render();
  let sent = 0;
  for (const c of people) if (await rejectNow(c)) sent++;
  showToast(`Moved ${people.length} to ${REJECT_STAGE}; emailed ${sent}`, 'success');
  render();
}

window.hiringListTick = (id, on) => { if (on) _selected.add(id); else _selected.delete(id); _confirmBulk = false; render(); };
window.hiringListClear = () => { _selected.clear(); _confirmBulk = false; render(); };
window.hiringBulkReject = () => bulkReject();
window.hiringView = (view) => {
  state.hiringView = view;
  try { localStorage.setItem('hiringView', view); } catch { /* storage blocked: view just resets */ }
  render();
};
