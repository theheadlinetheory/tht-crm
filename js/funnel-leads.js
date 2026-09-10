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

import { esc } from './utils.js?v=20260910114335';
import { state } from './app.js?v=20260910114335';
import { openDeal } from './deal-modal.js?v=20260910114335';
import { markDisco, markDemo, DISCO_OUTCOMES, DEMO_OUTCOMES } from './disco-outcome.js?v=20260910114335';
import { writeRemovalNote, showAcquisitionRemovalPicker } from './removal-reason.js?v=20260910114335';
import { deleteDeal } from './deals.js?v=20260910114335';
import { showClientEndPicker } from './client-end.js?v=20260910114335';

// ── Record the outcome from the list (Lars, 2026-09-10) ──
// A flagged row gets the same options the reps use live, and writes through the
// same functions, so the ledger reads it exactly as if it had been answered on
// the card: the pre-disco removal reasons at level 02, the discovery outcome at
// 03, the demo outcome at 05 and 06, the offboard picker at 07.
const PRE_DISCO_REASONS = ['Desk DQ', 'Miscategorized', 'Duplicate', 'Lost', 'Other…'];
const FINAL_DEMO = DEMO_OUTCOMES.filter(o => o !== 'No-Show' && o !== 'Qualified — Pending');
function optionsFor(level) {
  if (level === '02') return PRE_DISCO_REASONS;
  if (level === '03') return DISCO_OUTCOMES;
  if (level === '05') return DEMO_OUTCOMES;
  if (level === '06') return FINAL_DEMO;
  return null;
}
function outcomeControl(level, r, rowId) {
  if (level === '07') {
    return r.client_id ? `<button onclick="funnelRecordEnd('${esc(r.client_id)}','${rowId}')" style="margin-left:8px;padding:2px 8px;border:1px solid #fde68a;border-radius:5px;background:#fff;font-size:11px;color:#92400e;cursor:pointer">Record the end…</button>` : '';
  }
  const opts = optionsFor(level);
  if (!opts || !r.deal_id) return '';
  return `<select onchange="funnelSetOutcome('${level}','${esc(r.deal_id)}',this.value,'${rowId}')" style="margin-left:8px;padding:2px 6px;border:1px solid #fde68a;border-radius:5px;background:#fff;font-size:11px;color:#92400e">
    <option value="">record what happened…</option>${opts.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>`;
}
function markRecorded(rowId, text) {
  const row = document.getElementById(rowId);
  if (!row) return;
  row.style.background = '#f0fdf4';
  const cell = row.querySelector('[data-outcome]');
  if (cell) cell.innerHTML = `<span style="font-size:11px;font-weight:600;color:#166534">✓ ${esc(text)} · shows in the numbers within the hour</span>`;
}
window.funnelSetOutcome = async (level, dealId, value, rowId) => {
  if (!value) return;
  try {
    if (level === '02') {
      const onBoard = state.deals.some(d => String(d.id) === String(dealId));
      if (onBoard) {
        // Still on the board: the normal archive flow, which asks the reason and archives.
        showAcquisitionRemovalPicker([dealId], { onPick: (label) => { deleteDeal(dealId, label); markRecorded(rowId, label); } });
        return;
      }
      let note = value;
      if (value === 'Other…') { const r = prompt('Reason:'); if (!r || !r.trim()) return; note = 'Other: ' + r.trim(); }
      await writeRemovalNote(dealId, note);
      markRecorded(rowId, note);
    } else if (level === '03') {
      await markDisco(dealId, value); markRecorded(rowId, value);
    } else {
      const ok = await markDemo(dealId, value); if (ok !== false) markRecorded(rowId, value);
    }
  } catch (e) { console.warn('[funnel-leads] could not record', e && e.message); }
};
window.funnelRecordEnd = (clientId, rowId) => showClientEndPicker(clientId, { onDone: () => markRecorded(rowId, 'end recorded') });

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
export function leadsTable(rows, label, level) {
  if (!rows || !rows.length) return '';
  const missing = rows.filter(r => r.needs_info).length;
  let h = `<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px">
    <div style="font-size:11px;font-weight:700;color:#6b7280;margin-bottom:6px">${esc(String(label || 'LEADS').toUpperCase())} · ${rows.length}${missing ? ` <span style="font-weight:700;color:#92400e">· ${missing} with no record of what happened next</span>` : ''}</div>
    <div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:12px">
      <thead><tr style="color:#9ca3af;font-size:10px;text-align:left"><th style="padding:2px 8px 4px 0;font-weight:600">Company</th><th style="padding:2px 8px 4px;font-weight:600">Contact</th><th style="padding:2px 8px 4px;font-weight:600;white-space:nowrap">Came in</th><th style="padding:2px 8px 4px;font-weight:600">Status</th><th style="padding:2px 0 4px 8px;font-weight:600">Why</th></tr></thead><tbody>`;
  rows.forEach(r => {
    const st = STATUS[r.status] || STATUS.waiting;
    const onBoard = r.deal_id && state.deals.some(d => String(d.id) === String(r.deal_id));
    const name = esc(r.company || r.contact || '—');
    const company = onBoard
      ? `<a href="#" onclick="event.preventDefault();funnelOpenDeal('${esc(r.deal_id)}')" style="color:#1e1b4b;font-weight:600;text-decoration:underline dotted">${name}</a>`
      : `<span style="color:#1f2937;font-weight:600">${name}</span>`;
    // No record of what happened next: highlighted so Aidan and Ioannis can fill it in while they QC (Lars, 2026-09-10).
    const flag = r.needs_info;
    const rowId = 'lead-' + Math.random().toString(36).slice(2, 9);
    h += `<tr id="${rowId}" style="border-top:1px solid #f3f4f6;vertical-align:top${flag ? ';background:#fffbeb' : ''}">
      <td style="padding:5px 8px 5px 0;white-space:nowrap">${company}${flag ? ' <span style="margin-left:6px;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;background:#fde68a;color:#92400e">no record</span>' : ''}</td>
      <td style="padding:5px 8px;color:#6b7280;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.contact || '')}</td>
      <td style="padding:5px 8px;color:#6b7280;white-space:nowrap;font-variant-numeric:tabular-nums">${esc(day(r.came_in))}</td>
      <td style="padding:5px 8px;white-space:nowrap"><span style="padding:1px 7px;border-radius:4px;font-size:10px;font-weight:700;background:${st.bg};color:${st.fg}">${esc(r.status)}</span></td>
      <td style="padding:5px 0 5px 8px;color:#374151;line-height:1.35" data-outcome>${esc(r.note || '')}${flag ? outcomeControl(level, r, rowId) : ''}</td></tr>`;
  });
  return h + `</tbody></table></div></div>`;
}

window.funnelOpenDeal = (id) => openDeal(id);
