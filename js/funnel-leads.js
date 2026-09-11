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

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=20260911110145';
import { esc } from './utils.js?v=20260911110145';
import { state } from './app.js?v=20260911110145';
import { openDeal } from './deal-modal.js?v=20260911110145';
import { openArchivedDeal } from './archive.js?v=20260911110145';
import { markDisco, markDemo, DISCO_OUTCOMES, DEMO_OUTCOMES } from './disco-outcome.js?v=20260911110145';
import { writeRemovalNote, showAcquisitionRemovalPicker } from './removal-reason.js?v=20260911110145';
import { deleteDeal } from './deals.js?v=20260911110145';
import { showClientEndPicker } from './client-end.js?v=20260911110145';

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
  return `<select onchange="funnelSetOutcome('${level}','${esc(r.deal_id)}',this.value,'${rowId}','${esc(r.as_of || '')}')" style="margin-left:8px;padding:2px 6px;border:1px solid #fde68a;border-radius:5px;background:#fff;font-size:11px;color:#92400e">
    <option value="">record what happened…</option>${opts.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>`;
}
// An outcome recorded from the list is remembered (per browser) until the ledger has read it — hourly — so a
// re-render in between (a realtime deal update, a chip change) does not put the yellow back on a row the rep
// already answered (Aidan, 2026-09-10: "when I change the designation via dropdown it seems to not update").
const RECORDED_KEY = 'funnelRecorded';
const RECORDED_TTL = 3 * 3600e3;
function recordedMap() { try { return JSON.parse(localStorage.getItem(RECORDED_KEY) || '{}'); } catch { return {}; } }
function remember(level, id, text) {
  if (!id) return;
  const m = recordedMap(); const now = Date.now();
  for (const k of Object.keys(m)) if (now - (m[k].at || 0) > RECORDED_TTL) delete m[k];
  m[`${level}:${id}`] = { text, at: now };
  try { localStorage.setItem(RECORDED_KEY, JSON.stringify(m)); } catch { /* private mode: the row still turns green for this render */ }
}
function recordedFor(level, id) { const e = id ? recordedMap()[`${level}:${id}`] : null; return e && Date.now() - e.at < RECORDED_TTL ? e : null; }
// The ledger reads answers on its own clock (hourly). Run it now and refresh the tab, so the row and the day/week
// numbers agree for everyone within seconds — not only in the browser that answered (Lars, 2026-09-10). The
// all-time cards keep their hourly rhythm so level 01's removals and the later levels' intake stay one generation.
async function syncLedger(delayMs = 0) {
  if (delayMs) await new Promise(r => setTimeout(r, delayMs));
  try {
    const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY };
    const r = await fetch(`${SUPABASE_URL}/functions/v1/pipeline-leads`, { method: 'POST', headers, body: '{}' });
    if (!r.ok) throw new Error('pipeline-leads answered ' + r.status);
    if (typeof window.refreshFunnel === 'function') window.refreshFunnel();
  } catch (e) { console.warn('[funnel-leads] ledger refresh — the hourly run will catch up:', e && e.message); }
}
const recordedMark = (text) => `<span style="font-size:11px;font-weight:600;color:#166534">✓ ${esc(text)} · in the numbers in a moment</span>`;
function markRecorded(rowId, text) {
  const row = document.getElementById(rowId);
  if (!row) return;
  row.style.background = '#f0fdf4';
  const badge = row.querySelector('[data-badge]');
  if (badge) { badge.textContent = 'recorded'; badge.style.background = '#bbf7d0'; badge.style.color = '#166534'; }
  const cell = row.querySelector('[data-outcome]');
  if (cell) cell.innerHTML = recordedMark(text);
}
window.funnelSetOutcome = async (level, dealId, value, rowId, asOf) => {
  if (!value) return;
  // asOf: the row's own day (the call, the demo) — the answer is dated there, not today (Ioannis, 2026-09-10).
  const opts = asOf ? { asOf } : {};
  const dated = (text) => asOf ? `${text} · as of ${asOf}` : text;
  try {
    if (level === '02') {
      const onBoard = state.deals.some(d => String(d.id) === String(dealId));
      if (onBoard) {
        // Still on the board: the normal archive flow, which asks the reason and archives.
        showAcquisitionRemovalPicker([dealId], { onPick: (label) => { deleteDeal(dealId, label); remember(level, dealId, label); markRecorded(rowId, label); syncLedger(2000); } });
        return;
      }
      let note = value;
      if (value === 'Other…') { const r = prompt('Reason:'); if (!r || !r.trim()) return; note = 'Other: ' + r.trim(); }
      await writeRemovalNote(dealId, note, opts);
      remember(level, dealId, dated(note)); markRecorded(rowId, dated(note)); syncLedger();
    } else if (level === '03') {
      await markDisco(dealId, value, opts); remember(level, dealId, dated(value)); markRecorded(rowId, dated(value)); syncLedger();
    } else {
      const ok = await markDemo(dealId, value, opts); if (ok !== false) { remember(level, dealId, dated(value)); markRecorded(rowId, dated(value)); syncLedger(); }
    }
  } catch (e) { console.warn('[funnel-leads] could not record', e && e.message); }
};
window.funnelRecordEnd = (clientId, rowId) => showClientEndPicker(clientId, { onDone: () => { remember('07', clientId, 'end recorded'); markRecorded(rowId, 'end recorded'); syncLedger(2000); } });

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
  const missing = rows.filter(r => r.needs_info && !recordedFor(level, r.deal_id || r.client_id)).length;
  const staleN = rows.filter(r => !r.needs_info && r.stale && !recordedFor(level, r.deal_id || r.client_id)).length;
  let h = `<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px">
    <div style="font-size:11px;font-weight:700;color:#6b7280;margin-bottom:6px">${esc(String(label || 'LEADS').toUpperCase())} · ${rows.length}${missing ? ` <span style="font-weight:700;color:#92400e">· ${missing} with no record of what happened next</span>` : ''}${staleN ? ` <span style="font-weight:700;color:#9a3412">· ${staleN} stale — still in the pipeline, untouched for a week</span>` : ''}</div>
    <div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:12px">
      <thead><tr style="color:#9ca3af;font-size:10px;text-align:left"><th style="padding:2px 8px 4px 0;font-weight:600">Company</th><th style="padding:2px 8px 4px;font-weight:600">Contact</th><th style="padding:2px 8px 4px;font-weight:600;white-space:nowrap">Came in</th><th style="padding:2px 8px 4px;font-weight:600">Status</th><th style="padding:2px 0 4px 8px;font-weight:600;min-width:360px">Why</th></tr></thead><tbody>`;
  rows.forEach(r => {
    const st = STATUS[r.status] || STATUS.waiting;
    // Every lead with a deal opens its card from here — on the board or archived — so nobody switches tabs to see
    // what happened (Lars, 2026-09-10). An archived card opens read-only with its banner (archive.js).
    const onBoard = r.deal_id && state.deals.some(d => String(d.id) === String(r.deal_id));
    const name = esc(r.company || r.contact || '—');
    const company = r.deal_id
      ? `<a href="#" onclick="event.preventDefault();funnelOpenDeal('${esc(r.deal_id)}')" title="${onBoard ? 'Open the deal card' : 'Open the archived deal card (read-only)'}" style="color:#1e1b4b;font-weight:600;text-decoration:underline dotted">${name}</a>`
      : `<span style="color:#1f2937;font-weight:600">${name}</span>`;
    // No record of what happened next: highlighted so Aidan and Ioannis can fill it in while they QC (Lars, 2026-09-10).
    // Two flags (Lars, 2026-09-11): yellow = no record of what happened (left without a reason, a slot passed, moved on
    // unrecorded) — answer it; orange = still in the pipeline but untouched for a week — is it alive? Both get the dropdown.
    const rec = (r.needs_info || r.stale) ? recordedFor(level, r.deal_id || r.client_id) : null; // answered from this browser, ledger not yet through
    const flag = r.needs_info && !rec;
    const stale = !r.needs_info && !!r.stale && !rec;
    const rowId = 'lead-' + Math.random().toString(36).slice(2, 9);
    h += `<tr id="${rowId}" style="border-top:1px solid #f3f4f6;vertical-align:top${flag ? ';background:#fffbeb' : stale ? ';background:#fff7ed' : rec ? ';background:#f0fdf4' : ''}">
      <td style="padding:5px 8px 5px 0;white-space:nowrap">${company}${flag ? ' <span data-badge style="margin-left:6px;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;background:#fde68a;color:#92400e">no record</span>' : stale ? ` <span data-badge style="margin-left:6px;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;background:#fed7aa;color:#9a3412">${r.stale_label ? esc(r.stale_label) : 'stale since ' + esc(day(r.stale))}</span>` : rec ? ' <span data-badge style="margin-left:6px;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;background:#bbf7d0;color:#166534">recorded</span>' : ''}</td>
      <td style="padding:5px 8px;color:#6b7280;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.contact || '')}</td>
      <td style="padding:5px 8px;color:#6b7280;white-space:nowrap;font-variant-numeric:tabular-nums">${esc(day(r.came_in))}</td>
      <td style="padding:5px 8px;white-space:nowrap"><span style="padding:1px 7px;border-radius:4px;font-size:10px;font-weight:700;background:${st.bg};color:${st.fg}">${esc(r.status)}</span></td>
      <td style="padding:5px 0 5px 8px;color:#374151;line-height:1.35" data-outcome>${(flag || stale) ? esc(r.note || '') + outcomeControl(level, r, rowId) : rec ? recordedMark(rec.text) : esc(r.note || '')}</td></tr>`;
  });
  return h + `</tbody></table></div></div>`;
}

window.funnelOpenDeal = (id) => state.deals.some(d => String(d.id) === String(id)) ? openDeal(id) : openArchivedDeal(id);
