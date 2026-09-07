// ═══════════════════════════════════════════════════════════
// LEAD-TRACKER-MONTHLY — PPM meetings booked, one bar per month
// ═══════════════════════════════════════════════════════════
// Counts by appointment month by default: a meeting booked on 31 Aug for 4 Sep
// is a September lead, which is how it is invoiced, and the same expression
// getPayoutData() already uses in lead-tracker.js — appointment date when there
// is one, booked date as the fallback (a bit over half the rows have no
// appointment date). A toggle switches the whole tab to booked month instead,
// because both questions are worth asking: what gets billed this month, and how
// much came in this month.
import { state } from './app.js?v=20260907130428';
import { esc, str } from './utils.js?v=20260907130428';

const MONTHS_SHOWN = 12;
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Bars are one series, so they carry one colour and need no legend — the
// heading names them. Indigo is the app's own action colour; validated against
// the card surface for contrast rather than picked by eye.
const BAR = '#4f46e5';

function parseMDY(s) {
  const p = str(s).split('/');
  if (p.length !== 3) return null;
  const m = parseInt(p[0], 10);
  const d = parseInt(p[1], 10);
  let y = parseInt(p[2], 10);
  if (!Number.isFinite(m) || !Number.isFinite(d) || !Number.isFinite(y)) return null;
  if (y < 100) y += 2000;
  return { y, m, d };
}

/**
 * The month a lead counts in.
 *  'appt'   — when the meeting happens. The billing rule, and the default.
 *             Falls back to the booked date for the rows with no appointment
 *             date (a bit over half of them).
 *  'booked' — the day the lead came in.
 * Both are offered because both are wanted: appointment month is what gets
 * invoiced, booked month is what shows how much came in that month.
 */
export function monthOf(entry, basis) {
  return basis === 'booked'
    ? parseMDY(entry.dateAdded)
    : (parseMDY(entry.apptDate) || parseMDY(entry.dateAdded));
}

const keyOf = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

/**
 * The last MONTHS_SHOWN months ending this month, each with its counts.
 * Always returns a full run of months so an empty month reads as a real zero
 * rather than silently vanishing from the axis.
 */
export function buildMonthlyData(basis, entries = state.trackerEntries || []) {
  const buckets = new Map();
  const now = new Date();
  for (let i = MONTHS_SHOWN - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.set(keyOf(d.getFullYear(), d.getMonth() + 1), {
      y: d.getFullYear(), m: d.getMonth() + 1,
      label: `${MONTH_ABBR[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`,
      total: 0, calledBack: 0, good: 0,
    });
  }
  for (const e of entries) {
    const when = monthOf(e, basis);
    if (!when) continue;
    const b = buckets.get(keyOf(when.y, when.m));
    if (!b) continue;
    b.total++;
    if (str(e.callbackStatus).toLowerCase() === 'called back') b.calledBack++;
    else b.good++;
  }
  return [...buckets.values()];
}

// One control, shared with the table's From/To range, so the chart and the rows
// underneath can never be counting on different dates.
function basisToggle(basis) {
  const btn = (val, label) => {
    const on = basis === val;
    return `<button type="button" onclick="trackerSetDateBasis('${val}')"
      style="padding:3px 9px;border:none;cursor:pointer;font-family:inherit;font-size:11px;font-weight:600;
             background:${on ? '#4f46e5' : 'transparent'};color:${on ? '#fff' : 'var(--text-muted)'}">${label}</button>`;
  };
  return `<span style="display:inline-flex;border:1px solid var(--border);border-radius:6px;overflow:hidden">
    ${btn('appt', 'Appt month')}${btn('booked', 'Booked month')}</span>`;
}

export function renderMonthly() {
  const basis = str(state.trackerFilters?.dateBasis) === 'booked' ? 'booked' : 'appt';
  const data = buildMonthlyData(basis);
  const max = Math.max(1, ...data.map(d => d.total));
  const grand = data.reduce((s, d) => s + d.total, 0);
  const sel = str(state.trackerFilters?.month);

  const rows = data.map(d => {
    const key = keyOf(d.y, d.m);
    const isSel = sel === key;
    const pct = (d.total / max) * 100;
    // Zero months keep a hairline so the row still reads as a bar at zero.
    const width = d.total ? Math.max(pct, 1.5) : 0;
    const tip = `${d.label}: ${d.total} booked` +
      (d.total ? ` — ${d.good} good, ${d.calledBack} called back` : '');
    return `<button type="button" data-month="${key}" onclick="trackerMonthlyPick('${key}')"
        title="${esc(tip)}"
        style="display:grid;grid-template-columns:52px 1fr 34px;align-items:center;gap:10px;width:100%;
               background:${isSel ? '#eef2ff' : 'none'};border:none;border-radius:6px;
               padding:5px 8px;cursor:pointer;text-align:left;font-family:inherit"
        onmouseover="this.style.background='${isSel ? '#e0e7ff' : '#f1f5f9'}'"
        onmouseout="this.style.background='${isSel ? '#eef2ff' : 'none'}'">
      <span style="font-size:11px;color:var(--text-muted);white-space:nowrap">${esc(d.label)}</span>
      <span style="display:block;height:14px;background:#f1f5f9;border-radius:4px;overflow:hidden">
        <span style="display:block;height:100%;width:${width}%;background:${BAR};
                     border-radius:4px"></span>
      </span>
      <span style="font-size:11px;font-weight:700;color:${d.total ? 'var(--text)' : 'var(--text-muted)'};text-align:right">${d.total}</span>
    </button>`;
  }).join('');

  return `<div style="padding:14px 20px;max-width:620px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px">
      <h3 style="margin:0;font-size:14px;color:var(--text)">PPM meetings booked by month</h3>
      <div style="display:flex;align-items:center;gap:8px">
        ${sel ? `<button onclick="trackerMonthlyClear()" style="background:none;border:none;color:#4f46e5;font-size:11px;font-weight:600;cursor:pointer;padding:0">Clear filter</button>` : ''}
        ${basisToggle(basis)}
      </div>
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px">
      ${basis === 'appt'
        ? 'Counted in the month the appointment takes place — one booked in August for September counts to September, the way it is invoiced.'
        : 'Counted in the month the lead came in, whenever the appointment happens.'}
      ${grand} in the last ${MONTHS_SHOWN} months.
    </div>
    <div style="display:flex;flex-direction:column;gap:2px">${rows}</div>
    <div style="font-size:10px;color:var(--text-muted);margin-top:10px">Click a month to filter the table below it.</div>
  </div>`;
}
