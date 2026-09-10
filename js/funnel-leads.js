// ═══════════════════════════════════════════════════════════
// FUNNEL LEADS — the lead lists behind a day / week view (2026-09-08)
// ═══════════════════════════════════════════════════════════
//
// Lars + Ioannis, 2026-09-08: to check the live tracking, the setter needs to
// see the actual companies at every level, not just the counts. In a period
// view each level sends two lists (pipeline-level0N, detail.leads and
// detail.activity_leads): the cohort with where each lead stands and why, and
// the events of the period for leads from any cohort. Temporary by intent —
// the tables stay small while the window is a week.

import { esc } from './utils.js?v=20260910095921';
import { state } from './app.js?v=20260910095921';
import { openDeal } from './deal-modal.js?v=20260910095921';

const STATUS = {
  'moved on': { bg: '#dcfce7', fg: '#166534' },
  'waiting':  { bg: '#f3f4f6', fg: '#6b7280' },
  'lost':     { bg: '#fee2e2', fg: '#b91c1c' },
  'removed':  { bg: '#fef3c7', fg: '#92400e' },
  'in':       { bg: '#e0e7ff', fg: '#3730a3' },
};

function day(iso) {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d)) return String(iso).slice(5, 10);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: '2-digit', day: '2-digit' }).format(d);
}

/** One table: Company · Contact · Came in · Status · Why. A company is a link
 *  when its deal is on the board (archived deals have no card to open). */
export function leadsTable(rows, label) {
  if (!rows || !rows.length) return '';
  let h = `<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px">
    <div style="font-size:11px;font-weight:700;color:#6b7280;margin-bottom:6px">${esc(String(label || 'LEADS').toUpperCase())} · ${rows.length}</div>
    <div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:12px">
      <thead><tr style="color:#9ca3af;font-size:10px;text-align:left"><th style="padding:2px 8px 4px 0;font-weight:600">Company</th><th style="padding:2px 8px 4px;font-weight:600">Contact</th><th style="padding:2px 8px 4px;font-weight:600;white-space:nowrap">Came in</th><th style="padding:2px 8px 4px;font-weight:600">Status</th><th style="padding:2px 0 4px 8px;font-weight:600">Why</th></tr></thead><tbody>`;
  rows.forEach(r => {
    const st = STATUS[r.status] || STATUS.waiting;
    const onBoard = r.deal_id && state.deals.some(d => String(d.id) === String(r.deal_id));
    const name = esc(r.company || r.contact || '—');
    const company = onBoard
      ? `<a href="#" onclick="event.preventDefault();funnelOpenDeal('${esc(r.deal_id)}')" style="color:#1e1b4b;font-weight:600;text-decoration:underline dotted">${name}</a>`
      : `<span style="color:#1f2937;font-weight:600">${name}</span>`;
    h += `<tr style="border-top:1px solid #f3f4f6;vertical-align:top">
      <td style="padding:5px 8px 5px 0;white-space:nowrap">${company}</td>
      <td style="padding:5px 8px;color:#6b7280;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.contact || '')}</td>
      <td style="padding:5px 8px;color:#6b7280;white-space:nowrap;font-variant-numeric:tabular-nums">${esc(day(r.came_in))}</td>
      <td style="padding:5px 8px;white-space:nowrap"><span style="padding:1px 7px;border-radius:4px;font-size:10px;font-weight:700;background:${st.bg};color:${st.fg}">${esc(r.status)}</span></td>
      <td style="padding:5px 0 5px 8px;color:#374151;line-height:1.35">${esc(r.note || '')}</td></tr>`;
  });
  return h + `</tbody></table></div></div>`;
}

window.funnelOpenDeal = (id) => openDeal(id);
