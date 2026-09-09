import { state, pendingWrites } from './app.js?v=20260909125754';
import { sbUpdatePassOff, sbDeletePassOff, camelToSnake, normalizeRow, showToast } from './api.js?v=20260909125754';
import { isAdmin, isEmployee } from './auth.js?v=20260909125754';
import { esc, str } from './utils.js?v=20260909125754';
import { render } from './render.js?v=20260909125754';
import { weekStartOf, ymd, weekLabel } from './dashboard.js?v=20260909125754';

// The billing month ('July/26') is deliberately not a column — the sheet shows
// the exact date the lead was passed off instead.
const COLUMNS = [
  { key: 'clientName',    label: 'Client',    editable: false },
  { key: 'company',       label: 'Company',   editable: false },
  { key: 'contact',       label: 'Contact',   editable: false },
  { key: 'email',         label: 'Email',     editable: false },
  { key: 'datePassed',    label: 'Date',      editable: false },
  { key: 'leadCategory',  label: 'Category',  editable: false },
  { key: 'notes',         label: 'Notes',     editable: true },
];

function parseDate(s) {
  if (!s) return 0;
  const d = new Date(s);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

// Exact date, full year — 'Jul 26, 2026' rather than a bare month.
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isoDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function getFilteredPassOffs() {
  let entries = [...state.passOffs];
  const f = state.passOffsFilters;

  if (f.client) entries = entries.filter(e => e.clientName === f.client);
  if (f.dateFrom) {
    // 'T00:00:00' forces a LOCAL midnight. A bare 'YYYY-MM-DD' is parsed as UTC,
    // which west of UTC put the start of the range 7 hours early — filtering to
    // September began at 5pm on Aug 31 and pulled that evening's pass-offs in,
    // so a summary card and its own filtered table could disagree by a lead.
    // dateTo below has always been local; this makes the two ends match.
    const from = new Date(f.dateFrom + 'T00:00:00').getTime();
    entries = entries.filter(e => parseDate(e.datePassed) >= from);
  }
  if (f.dateTo) {
    const to = new Date(f.dateTo + 'T23:59:59').getTime();
    entries = entries.filter(e => parseDate(e.datePassed) <= to);
  }

  const { field, dir } = state.passOffsSort;
  entries.sort((a, b) => {
    let cmp;
    if (field === 'datePassed') {
      cmp = parseDate(a.datePassed) - parseDate(b.datePassed);
    } else {
      const av = str(a[field]).toLowerCase();
      const bv = str(b[field]).toLowerCase();
      cmp = av < bv ? -1 : av > bv ? 1 : 0;
    }
    return dir === 'asc' ? cmp : -cmp;
  });
  return entries;
}

function getClientColorMap() {
  const map = {};
  const colors = ['#7c3aed','#059669','#dc2626','#2563eb','#d97706','#db2777','#0891b2','#4f46e5','#16a34a','#ea580c'];
  const clients = [...new Set(state.passOffs.map(e => e.clientName))].sort();
  clients.forEach((c, i) => { map[c] = colors[i % colors.length]; });
  return map;
}

async function savePassOffNote(id, value) {
  const entry = state.passOffs.find(e => e.id === id);
  if (!entry) return;
  entry.notes = value;
  state._passOffEditing = null;
  render();
  pendingWrites.value++;
  try {
    await sbUpdatePassOff(id, { notes: value });
  } catch (e) {
    console.error('Pass-off note save failed:', e);
  } finally {
    pendingWrites.value--;
  }
}

const PERIODS_SHOWN = 6;
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const pad2 = n => String(n).padStart(2, '0');
const monthKeyOf = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

// The period a pass-off counts in — its LOCAL calendar date, matching both
// formatDate() in the table below and localDay() in weekly-context.js. A UTC
// slice would file a late-evening pass-off under a different month than the
// date printed on its own row.
function periodKeyOf(datePassed, period) {
  if (!datePassed) return '';
  const d = new Date(datePassed);
  if (isNaN(d.getTime())) return '';
  if (period === 'week') {
    const ws = weekStartOf(d);
    return ws ? ymd(ws) : '';
  }
  return monthKeyOf(d);
}

/**
 * Summary buckets for the cards, OLDEST FIRST — the order they are read in.
 *
 * The run is CONTINUOUS and ends at the current period, rather than being the
 * keys that happen to have data. A period with no pass-offs used to vanish
 * from the row entirely, so six cards could silently span nine weeks and put
 * two non-adjacent numbers side by side: the row jumped Aug 3–9 → Jul 20–26
 * because Jul 27–Aug 2 was empty. An empty period now reads as a real zero.
 */
function getPeriodSummary(entries, period, count) {
  const buckets = new Map();
  const now = new Date();

  if (period === 'week') {
    const start = weekStartOf(now);
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(start);
      d.setDate(d.getDate() - i * 7);
      const key = ymd(d);
      buckets.set(key, { key, label: weekLabel(key), current: 'this week', counts: {}, total: 0 });
    }
  } else {
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.set(monthKeyOf(d), {
        key: monthKeyOf(d),
        label: `${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`,
        current: 'this month', counts: {}, total: 0,
      });
    }
  }

  for (const e of entries) {
    const b = buckets.get(periodKeyOf(e.datePassed, period));
    if (!b) continue;
    const client = e.clientName || 'Unknown';
    b.counts[client] = (b.counts[client] || 0) + 1;
    b.total++;
  }
  return [...buckets.values()];
}

// First and last day of a period key, as 'YYYY-MM-DD' — clicking a card writes
// these straight into the existing From/To filter.
function periodRange(key, period) {
  if (period === 'week') {
    const [y, m, d] = key.split('-').map(Number);
    const end = new Date(y, m - 1, d + 6);
    return { from: key, to: ymd(end) };
  }
  const [y, m] = key.split('-').map(Number);
  return { from: `${key}-01`, to: ymd(new Date(y, m, 0)) };
}

export function renderPassOffs() {
  const entries = getFilteredPassOffs();
  const clients = [...new Set(state.passOffs.map(e => e.clientName))].sort();
  const f = state.passOffsFilters;
  const clientColors = getClientColorMap();
  // Pass-offs are operational records, not pricing data — employees clean up
  // their own duplicates. Lead cost stays admin-only elsewhere.
  const canDelete = isAdmin() || isEmployee();

  let html = `<div class="tracker-container">`;

  // Summary cards — oldest on the LEFT, reading forward in time to the current
  // period on the right. They used to run newest-first, so the row read
  // backwards against the way the dates on it are read.
  const period = state.passOffsPeriod === 'week' ? 'week' : 'month';
  const periods = getPeriodSummary(entries, period, PERIODS_SHOWN);
  const currentKey = periods.length ? periods[periods.length - 1].key : '';
  const ranged = !!(f.dateFrom || f.dateTo);

  html += `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:stretch;padding:0 0 12px 0">`;

  // Total, pinned at the left as the anchor the period cards are read against.
  // Reflects whatever filter is applied, so it says which total it is rather
  // than claiming "all time" over a date range.
  const totalClients = new Set(entries.map(e => e.clientName || 'Unknown'));
  html += `<div style="background:var(--bg-card);border:1px solid var(--border);border-left:3px solid var(--purple);border-radius:8px;padding:10px 16px;min-width:150px">
    <div style="font-size:11px;color:var(--text-muted);font-weight:600">${ranged ? 'Total in range' : 'Total all time'}</div>
    <div style="font-size:22px;font-weight:700;color:var(--text)">${entries.length}</div>
    <div style="font-size:10px;color:var(--text-muted)">${f.client ? esc(f.client) : `across ${totalClients.size} client${totalClients.size === 1 ? '' : 's'}`}</div>
  </div>`;

  for (const p of periods) {
    const isCurrent = p.key === currentKey;
    const r = periodRange(p.key, period);
    const isPicked = f.dateFrom === r.from && f.dateTo === r.to;
    const breakdown = Object.entries(p.counts).map(([c, n]) => `${esc(c)}: ${n}`).join(', ');
    html += `<div onclick="passOffPickPeriod('${r.from}','${r.to}')" title="Filter the table to ${esc(p.label)}"
      style="background:${isPicked ? 'var(--bg-hover, #f1f5f9)' : 'var(--bg-card)'};border:1px solid ${isCurrent || isPicked ? 'var(--purple)' : 'var(--border)'};border-radius:8px;padding:10px 16px;min-width:150px;cursor:pointer">
      <div style="font-size:11px;color:var(--text-muted);font-weight:600">${esc(p.label)}${isCurrent ? ` · ${p.current}` : ''}</div>
      <div style="font-size:22px;font-weight:700;color:${p.total ? 'var(--text)' : 'var(--text-muted)'}">${p.total}</div>
      <div style="font-size:10px;color:var(--text-muted)">${breakdown || '&nbsp;'}</div>
    </div>`;
  }

  // Month is the default: a month is the unit clients are billed and reviewed
  // in. Week stays available — it is the unit the Weekly KPI bar counts in.
  html += `<div style="display:flex;flex-direction:column;justify-content:center;gap:4px">
    ${['month', 'week'].map(v => `<button type="button" onclick="passOffSetPeriod('${v}')"
      style="padding:3px 10px;border:1px solid ${period === v ? 'var(--purple)' : 'var(--border)'};border-radius:6px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:600;
             background:${period === v ? 'var(--purple)' : 'transparent'};color:${period === v ? '#fff' : 'var(--text-muted)'}">${v === 'month' ? 'Monthly' : 'Weekly'}</button>`).join('')}
  </div>`;

  html += `</div>`;

  // Filter bar
  html += `<div class="tracker-filters">
    <select onchange="passOffFilterClient(this.value)" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
      <option value="">All Clients</option>
      ${clients.map(c => `<option value="${esc(c)}" ${f.client === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
    </select>
    <span style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--text-muted)">
      <label>From</label>
      <input type="date" value="${f.dateFrom || ''}" onchange="passOffFilterDateFrom(this.value)" style="padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
      <label>To</label>
      <input type="date" value="${f.dateTo || ''}" onchange="passOffFilterDateTo(this.value)" style="padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
      ${(f.dateFrom || f.dateTo) ? '<button onclick="passOffClearDates()" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:14px;padding:0 4px" title="Clear dates">&times;</button>' : ''}
    </span>
    <span style="flex:1"></span>
    <span style="font-size:12px;color:var(--text-muted)">${entries.length} retainer leads</span>
  </div>`;

  // Table
  html += `<div class="tracker-table-wrap"><table class="tracker-table">`;
  html += `<thead><tr>`;
  for (const col of COLUMNS) {
    const isSorted = state.passOffsSort.field === col.key;
    const arrow = isSorted ? (state.passOffsSort.dir === 'asc' ? ' ↑' : ' ↓') : '';
    html += `<th onclick="passOffSort('${col.key}')" style="cursor:pointer;user-select:none">${esc(col.label)}${arrow}</th>`;
  }
  if (canDelete) html += `<th style="width:50px"></th>`;
  html += `</tr></thead>`;

  html += `<tbody>`;
  for (const entry of entries) {
    const clientColor = clientColors[str(entry.clientName)] || '';
    const rowStyle = clientColor ? `border-left:4px solid ${clientColor}` : '';
    const isEditing = state._passOffEditing === entry.id;

    html += `<tr style="${rowStyle}">`;
    for (const col of COLUMNS) {
      if (col.key === 'datePassed') {
        // Show a dash rather than an empty cell, so a missing/unmapped date is
        // visible instead of looking like a rendering gap.
        html += `<td>${formatDate(entry.datePassed) || '<span style="color:#d1d5db">—</span>'}</td>`;
      } else if (col.key === 'clientName' && clientColor) {
        html += `<td style="color:${clientColor};font-weight:600">${esc(str(entry[col.key]))}</td>`;
      } else if (col.key === 'notes' && isEditing) {
        html += `<td><input class="tracker-cell-input" type="text" value="${esc(str(entry.notes))}" onblur="passOffSaveNote('${entry.id}', this.value)" onkeydown="if(event.key==='Enter')this.blur();if(event.key==='Escape'){state._passOffEditing=null;render()}" autofocus style="width:100%;padding:2px 4px;font-size:12px;border:1px solid var(--purple);border-radius:3px;font-family:var(--font)"></td>`;
      } else if (col.key === 'notes') {
        html += `<td onclick="state._passOffEditing='${entry.id}';render()" style="cursor:pointer;min-width:80px" title="Click to edit">${esc(str(entry.notes)) || '<span style="color:var(--text-muted);font-style:italic">—</span>'}</td>`;
      } else {
        html += `<td>${esc(str(entry[col.key]))}</td>`;
      }
    }
    if (canDelete) {
      html += `<td><button onclick="passOffDelete('${entry.id}')" class="btn btn-ghost" style="font-size:10px;padding:2px 6px;color:#dc2626" title="Delete">✕</button></td>`;
    }
    html += `</tr>`;
  }
  if (entries.length === 0) {
    html += `<tr><td colspan="${COLUMNS.length + (canDelete ? 1 : 0)}" style="text-align:center;padding:20px;color:var(--text-muted)">No retainer leads found</td></tr>`;
  }
  html += `</tbody></table></div></div>`;
  return html;
}

// Window handlers
window.passOffFilterClient = (v) => { state.passOffsFilters.client = v; render(); };
window.passOffFilterDateFrom = (v) => { state.passOffsFilters.dateFrom = v; render(); };
window.passOffFilterDateTo = (v) => { state.passOffsFilters.dateTo = v; render(); };
window.passOffClearDates = () => { state.passOffsFilters.dateFrom = ''; state.passOffsFilters.dateTo = ''; render(); };
window.passOffSetPeriod = (v) => { state.passOffsPeriod = v === 'week' ? 'week' : 'month'; render(); };
// Clicking a summary card drives the SAME From/To filter the range inputs use,
// so the cards and the rows under them can never be counting different days.
// Clicking the card that is already applied clears it.
window.passOffPickPeriod = (from, to) => {
  const f = state.passOffsFilters;
  const on = f.dateFrom === from && f.dateTo === to;
  f.dateFrom = on ? '' : from;
  f.dateTo = on ? '' : to;
  render();
};
window.passOffSort = (field) => {
  if (state.passOffsSort.field === field) {
    state.passOffsSort.dir = state.passOffsSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    state.passOffsSort = { field, dir: 'desc' };
  }
  render();
};
window.passOffSaveNote = (id, value) => savePassOffNote(id, value);
window.passOffDelete = async (id) => {
  if (!confirm('Delete this retainer lead?')) return;
  state.passOffs = state.passOffs.filter(e => e.id !== id);
  render();
  try { await sbDeletePassOff(id); } catch (e) { console.error('Delete failed:', e); }
};
