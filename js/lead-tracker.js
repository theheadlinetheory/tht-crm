// ═══════════════════════════════════════════════════════════
// LEAD TRACKER — Editable grid view for lead billing & status
// ═══════════════════════════════════════════════════════════
import { state, store, pendingWrites } from './app.js';
import { sbGetTrackerEntries, sbUpdateTrackerEntry, invokeEdgeFunction, camelToSnake, normalizeRow } from './api.js';
import { isAdmin } from './auth.js';
import { esc, svgIcon, str } from './utils.js';
import { render } from './render.js';

// ─── Column Definitions ───
const COLUMNS = [
  { key: 'clientName',      label: 'Client',         editable: false,     adminOnly: false },
  { key: 'month',           label: 'Month',          editable: false,     adminOnly: false },
  { key: 'leadName',        label: 'Lead Name',      editable: false,     adminOnly: false },
  { key: 'leadEmail',       label: 'Email',           editable: false,     adminOnly: false },
  { key: 'dateAdded',       label: 'Date',            editable: false,     adminOnly: false },
  { key: 'leadCost',        label: 'Lead Cost',       editable: true,      adminOnly: true },
  { key: 'invoice',         label: 'Invoice',         editable: true,      adminOnly: true },
  { key: 'paidStatus',      label: 'Paid',            editable: false,     adminOnly: true },
  { key: 'datePaid',        label: 'Date Paid',       editable: false,     adminOnly: true },
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
  entries.sort((a, b) => {
    const av = str(a[field]).toLowerCase();
    const bv = str(b[field]).toLowerCase();
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return dir === 'asc' ? cmp : -cmp;
  });

  return entries;
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
    invokeEdgeFunction('sync-lead-tracker', { action: 'sync-row', entryId }).catch(e => console.warn('Sheet sync failed:', e));
  } catch (e) {
    entry[field] = oldValue;
    render();
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
    .then(() => invokeEdgeFunction('sync-lead-tracker', { action: 'sync-row', entryId }).catch(() => {}))
    .catch(e => console.error('Mark paid failed:', e))
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
    .then(() => invokeEdgeFunction('sync-lead-tracker', { action: 'sync-row', entryId }).catch(() => {}))
    .catch(e => console.error('Toggle callback failed:', e))
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
export function renderLeadTracker() {
  const cols = getVisibleColumns();
  const entries = getFilteredEntries();
  const clients = [...new Set(state.trackerEntries.map(e => e.clientName))].sort();
  const f = state.trackerFilters;

  let html = `<div class="tracker-container">`;

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
    <span style="font-size:12px;color:var(--text-muted)">${entries.length} entries</span>
    ${isAdmin() ? `<button id="tracker-reconcile-btn" class="btn btn-ghost" style="font-size:11px;padding:4px 10px" onclick="reconcileSheet()">Reconcile Sheet</button>` : ''}
  </div>`;

  // Table
  html += `<div class="tracker-table-wrap"><table class="tracker-table">`;

  // Header
  html += `<thead><tr>`;
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

    html += `<tr class="${rowClass}">`;
    for (const col of cols) {
      const val = str(entry[col.key]);
      const isEditing = state.trackerEditingCell && state.trackerEditingCell.id === entry.id && state.trackerEditingCell.field === col.key;

      if (col.editable && isEditing) {
        html += `<td><input class="tracker-cell-input" type="text" value="${esc(val)}"
          onblur="trackerSaveCell('${entry.id}','${col.key}',this.value)"
          onkeydown="if(event.key==='Enter'){this.blur();}"
          autofocus></td>`;
      } else if (col.editable) {
        html += `<td class="tracker-cell-editable" onclick="trackerEditCell('${entry.id}','${col.key}')">${val ? esc(val) : '<span style="color:#d1d5db">—</span>'}</td>`;
      } else if (col.key === 'leadName' && isCalledBack) {
        html += `<td><s style="color:var(--text-muted)">${esc(val)}</s></td>`;
      } else if (col.key === 'leadEmail' && val) {
        html += `<td><a href="mailto:${esc(val)}" style="color:var(--purple);text-decoration:none;font-size:12px">${esc(val)}</a></td>`;
      } else {
        html += `<td>${esc(val)}</td>`;
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
window.reconcileSheet = reconcileSheet;
