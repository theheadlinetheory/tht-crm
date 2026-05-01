// ═══════════════════════════════════════════════════════════
// LEAD TRACKER — Editable grid view for lead billing & status
// ═══════════════════════════════════════════════════════════
import { state, store, pendingWrites } from './app.js';
import { sbGetTrackerEntries, sbUpdateTrackerEntry, sbCreateTrackerEntry, invokeEdgeFunction, camelToSnake, normalizeRow } from './api.js';
import { isAdmin } from './auth.js';
import { esc, svgIcon, str } from './utils.js';
import { render } from './render.js';

// ─── Column Definitions ───
const COLUMNS = [
  { key: 'clientName',      label: 'Client',         editable: true,      adminOnly: false },
  { key: 'month',           label: 'Month',          editable: true,      adminOnly: false },
  { key: 'leadName',        label: 'Lead Name',      editable: true,      adminOnly: false },
  { key: 'leadEmail',       label: 'Email',           editable: true,      adminOnly: false },
  { key: 'dateAdded',       label: 'Date',            editable: true,      adminOnly: false },
  { key: 'leadCost',        label: 'Lead Cost',       editable: true,      adminOnly: true },
  { key: 'invoice',         label: 'Invoice',         editable: true,      adminOnly: true },
  { key: 'paidStatus',      label: 'Paid',            editable: false,     adminOnly: true },
  { key: 'datePaid',        label: 'Date Paid',       editable: true,      adminOnly: true },
  { key: 'notes',           label: 'Notes',           editable: true,      adminOnly: false },
  { key: 'paymentLink',     label: 'Payment Link',    editable: true,      adminOnly: true },
  { key: 'callbackStatus',  label: 'Callback',        editable: false,     adminOnly: false },
];

function getVisibleColumns() {
  if (isAdmin()) return COLUMNS;
  return COLUMNS.filter(c => !c.adminOnly);
}

// ─── Load Tracker Data ───
let _trackerLoading = false;
export async function loadTrackerEntries() {
  if (state.trackerLoaded || _trackerLoading) return;
  _trackerLoading = true;
  try {
    const data = await sbGetTrackerEntries();
    state.trackerEntries = data.map(normalizeRow);
    state.trackerLoaded = true;
  } catch (e) {
    console.error('Failed to load tracker entries:', e);
    state.trackerLoaded = true; // prevent infinite retry loop
  } finally {
    _trackerLoading = false;
  }
}

// ─── Date parsing for M/D/YY format ───
function parseDateMDY(s) {
  if (!s) return 0;
  const parts = s.split('/');
  if (parts.length !== 3) return 0;
  const m = parseInt(parts[0], 10);
  const d = parseInt(parts[1], 10);
  let y = parseInt(parts[2], 10);
  if (y < 100) y += 2000; // handle 2-digit years (26 → 2026)
  return y * 10000 + m * 100 + d; // numeric sortable: 20260408
}

// ─── Filtering & Sorting ───
function getFilteredEntries() {
  let entries = [...state.trackerEntries];
  const f = state.trackerFilters;

  if (f.client) {
    entries = entries.filter(e => e.clientName === f.client);
  }
  if (f.paidStatus === 'paid') {
    entries = entries.filter(e => str(e.paidStatus).toLowerCase() === 'paid');
  } else if (f.paidStatus === 'unpaid') {
    entries = entries.filter(e => str(e.paidStatus).toLowerCase() !== 'paid');
  }
  if (f.hideCalledBack) {
    entries = entries.filter(e => str(e.callbackStatus).toLowerCase() !== 'called back');
  }

  const { field, dir } = state.trackerSort;
  const isDateField = field === 'dateAdded' || field === 'datePaid';
  entries.sort((a, b) => {
    let cmp;
    if (isDateField) {
      cmp = parseDateMDY(str(a[field])) - parseDateMDY(str(b[field]));
    } else {
      const av = str(a[field]).toLowerCase();
      const bv = str(b[field]).toLowerCase();
      cmp = av < bv ? -1 : av > bv ? 1 : 0;
    }
    return dir === 'asc' ? cmp : -cmp;
  });

  return entries;
}

// ─── Save status flash ───
function flashSaveStatus(ok) {
  const el = document.getElementById('tracker-save-status');
  if (!el) return;
  el.textContent = ok ? '✓ Saved' : '✗ Failed';
  el.style.color = ok ? '#16a34a' : '#dc2626';
  el.style.opacity = '1';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.opacity = '0'; }, 1500);
}

// ─── Inline Edit Helpers ───
async function saveTrackerCell(entryId, field, value) {
  const entry = state.trackerEntries.find(e => e.id === entryId);
  if (!entry) return;
  const oldValue = entry[field];
  if (oldValue === value) { state.trackerEditingCell = null; render(); return; }

  entry[field] = value;
  state.trackerEditingCell = null;
  render();

  pendingWrites.value++;
  try {
    const snakeFields = camelToSnake({ [field]: value });
    await sbUpdateTrackerEntry(entryId, snakeFields);
    flashSaveStatus(true);
    invokeEdgeFunction('sync-lead-tracker', { action: 'sync-row', entryId }).catch(e => console.warn('Sheet sync failed:', e));
  } catch (e) {
    entry[field] = oldValue;
    render();
    flashSaveStatus(false);
    console.error('Tracker update failed:', e);
  } finally {
    pendingWrites.value--;
  }
}

function markPaid(entryId) {
  const today = new Date();
  const datePaid = `${today.getMonth() + 1}/${today.getDate()}/${String(today.getFullYear()).slice(-2)}`;
  const entry = state.trackerEntries.find(e => e.id === entryId);
  if (!entry) return;

  const newStatus = str(entry.paidStatus).toLowerCase() === 'paid' ? '' : 'Paid';
  const newDate = newStatus === 'Paid' ? datePaid : '';

  entry.paidStatus = newStatus;
  entry.datePaid = newDate;
  render();

  pendingWrites.value++;
  const snakeFields = camelToSnake({ paidStatus: newStatus, datePaid: newDate });
  sbUpdateTrackerEntry(entryId, snakeFields)
    .then(() => { flashSaveStatus(true); invokeEdgeFunction('sync-lead-tracker', { action: 'sync-row', entryId }).catch(() => {}); })
    .catch(e => { flashSaveStatus(false); console.error('Mark paid failed:', e); })
    .finally(() => { pendingWrites.value--; });
}

function toggleCallback(entryId) {
  const entry = state.trackerEntries.find(e => e.id === entryId);
  if (!entry) return;

  const newStatus = str(entry.callbackStatus).toLowerCase() === 'called back' ? '' : 'Called Back';
  entry.callbackStatus = newStatus;
  render();

  pendingWrites.value++;
  const snakeFields = camelToSnake({ callbackStatus: newStatus });
  sbUpdateTrackerEntry(entryId, snakeFields)
    .then(() => { flashSaveStatus(true); invokeEdgeFunction('sync-lead-tracker', { action: 'sync-row', entryId }).catch(() => {}); })
    .catch(e => { flashSaveStatus(false); console.error('Toggle callback failed:', e); })
    .finally(() => { pendingWrites.value--; });
}

async function reconcileSheet() {
  const btn = document.getElementById('tracker-reconcile-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Reconciling...'; }
  try {
    await invokeEdgeFunction('sync-lead-tracker', { action: 'full-reconcile' });
    if (btn) { btn.textContent = 'Done!'; setTimeout(() => { btn.textContent = 'Reconcile Sheet'; btn.disabled = false; }, 2000); }
  } catch (e) {
    alert('Reconcile failed: ' + e.message);
    if (btn) { btn.textContent = 'Reconcile Sheet'; btn.disabled = false; }
  }
}

// ─── Render ───
// ─── Client color map ───
function getClientColorMap() {
  const map = {};
  for (const c of state.clients) {
    if (c.name && c.color) map[c.name] = c.color;
  }
  return map;
}

export function renderLeadTracker() {
  const cols = getVisibleColumns();
  const entries = getFilteredEntries();
  const clients = [...new Set(state.trackerEntries.map(e => e.clientName))].sort();
  const f = state.trackerFilters;
  const clientColors = getClientColorMap();

  let html = `<div class="tracker-container">`;

  const sel = state.trackerSelected;
  const selCount = sel.size;

  // Filter bar
  html += `<div class="tracker-filters">
    <select onchange="trackerFilterClient(this.value)" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
      <option value="">All Clients</option>
      ${clients.map(c => `<option value="${esc(c)}" ${f.client === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
    </select>
    <select onchange="trackerFilterPaid(this.value)" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
      <option value="" ${!f.paidStatus ? 'selected' : ''}>All Status</option>
      <option value="paid" ${f.paidStatus === 'paid' ? 'selected' : ''}>Paid</option>
      <option value="unpaid" ${f.paidStatus === 'unpaid' ? 'selected' : ''}>Unpaid</option>
    </select>
    <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--text-muted);cursor:pointer">
      <input type="checkbox" ${f.hideCalledBack ? 'checked' : ''} onchange="trackerFilterCallback(this.checked)"> Hide called back
    </label>
    <span style="flex:1"></span>
    <span id="tracker-save-status" style="font-size:11px;font-weight:600;opacity:0;transition:opacity 0.3s"></span>
    <span style="font-size:12px;color:var(--text-muted)">${entries.length} entries</span>
    ${isAdmin() ? `<button class="btn btn-primary" style="font-size:11px;padding:4px 12px" onclick="openInvoiceModal()">Generate Invoice</button>` : ''}
    ${isAdmin() ? `<button class="btn btn-ghost" style="font-size:11px;padding:4px 10px" onclick="trackerAddRow()">+ Add Row</button>` : ''}
    ${isAdmin() ? `<button id="tracker-reconcile-btn" class="btn btn-ghost" style="font-size:11px;padding:4px 10px" onclick="reconcileSheet()">Reconcile Sheet</button>` : ''}
  </div>`;

  // Bulk edit bar (shown when rows are selected)
  if (isAdmin() && selCount > 0) {
    const editableCols = COLUMNS.filter(c => c.editable);
    html += `<div class="tracker-bulk-bar">
      <span style="font-weight:600;font-size:12px">${selCount} selected</span>
      <select id="tracker-bulk-field" style="padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:var(--font)" onchange="trackerBulkFieldChange(this.value)">
        <option value="">Set field...</option>
        ${editableCols.map(c => `<option value="${c.key}" ${state.trackerBulkField === c.key ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
      </select>
      ${state.trackerBulkField ? `<input id="tracker-bulk-value" type="text" placeholder="New value" value="${esc(state.trackerBulkValue)}" oninput="trackerBulkValueChange(this.value)" style="padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;width:140px;font-family:var(--font)">
      <button class="btn btn-primary" style="font-size:11px;padding:4px 12px" onclick="trackerBulkApply()">Apply</button>` : ''}
      <button class="btn btn-ghost" style="font-size:11px;padding:4px 8px" onclick="trackerBulkClear()">Clear Selection</button>
    </div>`;
  }

  // Table
  html += `<div class="tracker-table-wrap"><table class="tracker-table">`;

  // Header
  const admin = isAdmin();
  html += `<thead><tr>`;
  if (admin) {
    const allChecked = entries.length > 0 && entries.every(e => sel.has(e.id));
    html += `<th style="width:30px;text-align:center"><input type="checkbox" ${allChecked ? 'checked' : ''} onchange="trackerSelectAll(this.checked)"></th>`;
  }
  for (const col of cols) {
    const isSorted = state.trackerSort.field === col.key;
    const arrow = isSorted ? (state.trackerSort.dir === 'asc' ? ' ↑' : ' ↓') : '';
    html += `<th onclick="trackerSort('${col.key}')" style="cursor:pointer;user-select:none">${esc(col.label)}${arrow}</th>`;
  }
  html += `<th style="width:90px">Actions</th></tr></thead>`;

  // Body
  html += `<tbody>`;
  for (const entry of entries) {
    const isCalledBack = str(entry.callbackStatus).toLowerCase() === 'called back';
    const rowClass = isCalledBack ? 'tracker-row-calledback' : '';
    const clientColor = clientColors[str(entry.clientName)] || '';
    const rowStyle = clientColor ? `border-left:4px solid ${clientColor}` : '';

    html += `<tr class="${rowClass}" style="${rowStyle}">`;
    if (admin) {
      html += `<td style="text-align:center"><input type="checkbox" ${sel.has(entry.id) ? 'checked' : ''} onchange="trackerToggleSelect('${entry.id}')"></td>`;
    }
    for (const col of cols) {
      const val = str(entry[col.key]);
      const isEditing = state.trackerEditingCell && state.trackerEditingCell.id === entry.id && state.trackerEditingCell.field === col.key;
      // Color the client name cell with client color
      const cellColorStyle = (col.key === 'clientName' && clientColor) ? `color:${clientColor};font-weight:600;` : '';

      if (col.editable && isEditing) {
        html += `<td><input class="tracker-cell-input" type="text" value="${esc(val)}"
          onblur="trackerSaveCell('${entry.id}','${col.key}',this.value)"
          onkeydown="if(event.key==='Enter'){this.blur();}"
          autofocus></td>`;
      } else if (col.editable && !isCalledBack) {
        html += `<td class="tracker-cell-editable" style="${cellColorStyle}" onclick="trackerEditCell('${entry.id}','${col.key}')">${val ? esc(val) : '<span style="color:#d1d5db">—</span>'}</td>`;
      } else if (isCalledBack) {
        html += `<td><s style="color:#ef4444">${esc(val)}</s></td>`;
      } else if (col.key === 'leadEmail' && val) {
        html += `<td><a href="mailto:${esc(val)}" style="color:var(--purple);text-decoration:none;font-size:12px">${esc(val)}</a></td>`;
      } else {
        html += `<td style="${cellColorStyle}">${esc(val)}</td>`;
      }
    }

    // Actions column
    const isPaid = str(entry.paidStatus).toLowerCase() === 'paid';
    const isCalledBackStatus = str(entry.callbackStatus).toLowerCase() === 'called back';
    html += `<td class="tracker-actions">`;
    if (isAdmin()) {
      html += `<button class="tracker-action-btn ${isPaid ? 'active' : ''}" onclick="trackerMarkPaid('${entry.id}')" title="${isPaid ? 'Unmark paid' : 'Mark as Paid'}">${isPaid ? '✓ Paid' : '$ Pay'}</button>`;
    }
    html += `<button class="tracker-action-btn ${isCalledBackStatus ? 'active' : ''}" onclick="trackerToggleCallback('${entry.id}')" title="${isCalledBackStatus ? 'Undo callback' : 'Mark Called Back'}">${isCalledBackStatus ? '↩ Undo' : '📞 CB'}</button>`;
    html += `</td></tr>`;
  }
  html += `</tbody></table></div></div>`;

  return html;
}

// ─── Window Handlers ───
window.trackerFilterClient = (v) => { state.trackerFilters.client = v; render(); };
window.trackerFilterPaid = (v) => { state.trackerFilters.paidStatus = v; render(); };
window.trackerFilterCallback = (v) => { state.trackerFilters.hideCalledBack = v; render(); };
window.trackerSort = (field) => {
  if (state.trackerSort.field === field) {
    state.trackerSort.dir = state.trackerSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    state.trackerSort = { field, dir: 'asc' };
  }
  render();
};
window.trackerEditCell = (id, field) => { state.trackerEditingCell = { id, field }; render(); };
window.trackerSaveCell = (id, field, value) => saveTrackerCell(id, field, value);
window.trackerMarkPaid = (id) => markPaid(id);
window.trackerToggleCallback = (id) => toggleCallback(id);
window.trackerAddRow = async () => {
  const today = new Date();
  const dateAdded = `${today.getMonth()+1}/${today.getDate()}/${String(today.getFullYear()).slice(-2)}`;
  const fields = { dealId: '', clientName: '', month: '', leadName: '', leadEmail: '', dateAdded, leadCost: '', invoice: '', paidStatus: '', datePaid: '', notes: '', paymentLink: '', callbackStatus: '' };
  pendingWrites.value++;
  try {
    const snakeFields = camelToSnake(fields);
    const created = await sbCreateTrackerEntry(snakeFields);
    if (created) {
      state.trackerEntries.push(normalizeRow(created));
      render();
    }
  } catch (e) {
    console.error('Failed to add tracker row:', e);
    alert('Failed to add row: ' + e.message);
  } finally {
    pendingWrites.value--;
  }
};
window.reconcileSheet = reconcileSheet;
window.trackerToggleSelect = (id) => {
  if (state.trackerSelected.has(id)) state.trackerSelected.delete(id);
  else state.trackerSelected.add(id);
  render();
};
window.trackerSelectAll = (checked) => {
  const entries = getFilteredEntries();
  if (checked) entries.forEach(e => state.trackerSelected.add(e.id));
  else state.trackerSelected.clear();
  render();
};
window.trackerBulkFieldChange = (field) => { state.trackerBulkField = field; state.trackerBulkValue = ''; render(); };
window.trackerBulkValueChange = (val) => { state.trackerBulkValue = val; };
window.trackerBulkClear = () => { state.trackerSelected.clear(); state.trackerBulkField = ''; state.trackerBulkValue = ''; render(); };
window.trackerBulkApply = async () => {
  const field = state.trackerBulkField;
  const value = state.trackerBulkValue;
  if (!field) return;

  const ids = [...state.trackerSelected];
  if (!ids.length) return;
  if (!confirm(`Set "${field}" to "${value}" for ${ids.length} entries?`)) return;

  // Update local state immediately
  for (const id of ids) {
    const entry = state.trackerEntries.find(e => e.id === id);
    if (entry) entry[field] = value;
  }
  state.trackerSelected.clear();
  state.trackerBulkField = '';
  state.trackerBulkValue = '';
  render();

  // Save to DB
  pendingWrites.value++;
  try {
    const snakeFields = camelToSnake({ [field]: value });
    await Promise.all(ids.map(id => sbUpdateTrackerEntry(id, snakeFields)));
  } catch (e) {
    console.error('Bulk update failed:', e);
    alert('Some updates may have failed. Please check the data.');
  } finally {
    pendingWrites.value--;
  }
};
