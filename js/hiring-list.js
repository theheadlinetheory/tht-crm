// ═══════════════════════════════════════════════════════════
// HIRING LIST — the sheet-style view of the Hiring tab (Aidan, 2026-11-16):
// one row per person, newest first, same filters as the board. Stage is a
// dropdown in the row (Not a Fit still asks about the email), the name opens
// the card. Ticking rows uses the same selection as the board (hiring-bulk.js).
// Stage dropdowns call hiringMove (the board's path), so the email box still opens.
// ═══════════════════════════════════════════════════════════
import { state } from './app.js?v=20261118033143';
import { render } from './render.js?v=20261118033143';
import { esc, escAttr, safeUrl, str, jsArg } from './utils.js?v=20261118033143';
import { STAGES, CONTACT_TYPES, stageLabel, shortDate, replyText, waitingDays } from './hiring.js?v=20261118033143';
import { channelPill } from './hiring-channel.js?v=20261118033143';
import { withScheme } from './hiring-modal.js?v=20261118033143';
import { tickBoxHtml } from './hiring-bulk.js?v=20261118033143';
import { videoButtonHtml } from './hiring-video.js?v=20261118033143';

export const whatsappUrl = (phone) => `https://wa.me/${str(phone).replace(/\D/g, '')}`;

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
    ['Video', c => videoButtonHtml(c.video_url)],
    ['LinkedIn', c => c.linkedin ? link(safeUrl(withScheme(c.linkedin)), 'in ↗') : ''],
  ],
  partner: [
    ['Type', c => esc(CONTACT_TYPES[c.contact_type || ''].label)],
    ['Channel', c => esc(c.channel || '')],
    ['Date', c => esc(shortDate(c.applied_at || c.created_at))],
    ['Last reply', c => `<div style="max-width:360px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-muted)">${esc(replyText(c.answers?.reply).replace(/\s+/g, ' '))}</div>`],
  ],
};

function rowHtml(c, cols) {
  const id = jsArg(c.id);
  return `<tr style="${c.has_new_activity ? 'background:#eff6ff' : ''}">
    <td>${tickBoxHtml(c)}</td>
    <td><span onclick="hiringToggleStar(${id})" style="cursor:pointer;color:${c.starred ? '#f59e0b' : '#d1d5db'}">★</span></td>
    <td style="font-weight:${c.has_new_activity ? 800 : 600};white-space:nowrap"><a href="#" onclick="event.preventDefault();hiringOpen(${id})" style="color:inherit;text-decoration:none">${channelPill(c)}${esc(c.name || c.email || 'Unknown')}</a></td>
    <td>${stageSelect(c)}</td>
    ${cols.map(([, cell]) => `<td>${cell(c)}</td>`).join('')}
  </tr>`;
}

export function renderHiringList(list) {
  const kind = state.hiringKind;
  const cols = COLUMNS[kind];
  const head = `<th></th><th></th><th>Name</th><th>Stage</th>${cols.map(([h]) => `<th>${h}</th>`).join('')}`;
  return `<div style="padding:0 20px 20px;overflow-x:auto">
    <table class="rerun-table"><thead><tr>${head}</tr></thead>
    <tbody>${list.length ? list.map(c => rowHtml(c, cols)).join('') : `<tr><td colspan="${cols.length + 4}" style="color:var(--text-muted)">Nobody here</td></tr>`}</tbody></table>
  </div>`;
}

window.hiringView = (view) => {
  state.hiringView = view;
  try { localStorage.setItem('hiringView', view); } catch { /* storage blocked: view just resets */ }
  render();
};
