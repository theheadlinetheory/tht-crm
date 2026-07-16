import { state, pendingWrites } from './app.js?v=20260716a';
import { sbUpdatePassOff, sbDeletePassOff, camelToSnake, normalizeRow, showToast } from './api.js?v=20260716a';
import { isAdmin } from './auth.js?v=20260716a';
import { esc, str } from './utils.js?v=20260716a';
import { render } from './render.js?v=20260716a';

const COLUMNS = [
  { key: 'clientName',    label: 'Client',    editable: false },
  { key: 'month',         label: 'Month',     editable: false },
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

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
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
    const from = new Date(f.dateFrom).getTime();
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

function getMonthlySummary(entries) {
  const byMonth = {};
  for (const e of entries) {
    const key = e.month || 'Unknown';
    if (!byMonth[key]) byMonth[key] = {};
    const client = e.clientName || 'Unknown';
    byMonth[key][client] = (byMonth[key][client] || 0) + 1;
  }
  return byMonth;
}

export function renderPassOffs() {
  const entries = getFilteredPassOffs();
  const clients = [...new Set(state.passOffs.map(e => e.clientName))].sort();
  const f = state.passOffsFilters;
  const clientColors = getClientColorMap();
  const admin = isAdmin();

  let html = `<div class="tracker-container">`;

  // Summary cards
  const summary = getMonthlySummary(entries);
  const months = Object.keys(summary).sort((a, b) => {
    const parse = m => { const [name, yr] = m.split('/'); return new Date(`${name} 1, 20${yr}`).getTime(); };
    return parse(b) - parse(a);
  });

  if (months.length > 0) {
    html += `<div style="display:flex;gap:12px;flex-wrap:wrap;padding:0 0 12px 0">`;
    for (const month of months.slice(0, 6)) {
      const clientCounts = summary[month];
      const total = Object.values(clientCounts).reduce((a, b) => a + b, 0);
      html += `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:10px 16px;min-width:140px">
        <div style="font-size:11px;color:var(--text-muted);font-weight:600">${esc(month)}</div>
        <div style="font-size:22px;font-weight:700;color:var(--text)">${total}</div>
        <div style="font-size:10px;color:var(--text-muted)">${Object.entries(clientCounts).map(([c, n]) => `${esc(c)}: ${n}`).join(', ')}</div>
      </div>`;
    }
    html += `</div>`;
  }

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
    <span style="font-size:12px;color:var(--text-muted)">${entries.length} pass-offs</span>
  </div>`;

  // Table
  html += `<div class="tracker-table-wrap"><table class="tracker-table">`;
  html += `<thead><tr>`;
  for (const col of COLUMNS) {
    const isSorted = state.passOffsSort.field === col.key;
    const arrow = isSorted ? (state.passOffsSort.dir === 'asc' ? ' ↑' : ' ↓') : '';
    html += `<th onclick="passOffSort('${col.key}')" style="cursor:pointer;user-select:none">${esc(col.label)}${arrow}</th>`;
  }
  if (admin) html += `<th style="width:50px"></th>`;
  html += `</tr></thead>`;

  html += `<tbody>`;
  for (const entry of entries) {
    const clientColor = clientColors[str(entry.clientName)] || '';
    const rowStyle = clientColor ? `border-left:4px solid ${clientColor}` : '';
    const isEditing = state._passOffEditing === entry.id;

    html += `<tr style="${rowStyle}">`;
    for (const col of COLUMNS) {
      if (col.key === 'datePassed') {
        html += `<td>${formatDate(entry.datePassed)}</td>`;
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
    if (admin) {
      html += `<td><button onclick="passOffDelete('${entry.id}')" class="btn btn-ghost" style="font-size:10px;padding:2px 6px;color:#dc2626" title="Delete">✕</button></td>`;
    }
    html += `</tr>`;
  }
  if (entries.length === 0) {
    html += `<tr><td colspan="${COLUMNS.length + (admin ? 1 : 0)}" style="text-align:center;padding:20px;color:var(--text-muted)">No pass-offs found</td></tr>`;
  }
  html += `</tbody></table></div></div>`;
  return html;
}

// Window handlers
window.passOffFilterClient = (v) => { state.passOffsFilters.client = v; render(); };
window.passOffFilterDateFrom = (v) => { state.passOffsFilters.dateFrom = v; render(); };
window.passOffFilterDateTo = (v) => { state.passOffsFilters.dateTo = v; render(); };
window.passOffClearDates = () => { state.passOffsFilters.dateFrom = ''; state.passOffsFilters.dateTo = ''; render(); };
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
  if (!confirm('Delete this pass-off entry?')) return;
  state.passOffs = state.passOffs.filter(e => e.id !== id);
  render();
  try { await sbDeletePassOff(id); } catch (e) { console.error('Delete failed:', e); }
};
