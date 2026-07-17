// ═══════════════════════════════════════════════════════════
// DEMO TRACKER — SDR commission tracking for acquisition calls
// ═══════════════════════════════════════════════════════════
import { state, pendingWrites, pendingDealFields } from './app.js?v=20260717g';
import { sbCreateDemoEntry, sbUpdateDemoEntry, sbDeleteDemoEntry, sbUpdateDeal, camelToSnake, normalizeRow } from './api.js?v=20260717g';
import { render, refreshModal } from './render.js?v=20260717g';
import { isAdmin, isEmployee } from './auth.js?v=20260717g';
import { esc, str, svgIcon } from './utils.js?v=20260717g';

const DEMO_BASE_PAYOUT = 100;
const DEMO_CLOSE_BONUS = 50;

const SHOW_OPTIONS = ['Showed', 'No-Show'];
const OUTCOME_OPTIONS = ['Qualified — Pending', 'Qualified — Closed Won', 'Qualified — Closed Lost', 'Not Qualified'];

const BOOKED_BY_OPTIONS = ['Ioannis', 'Aidan'];

const COLUMNS = [
  { key: 'bookedBy',    label: 'Booked By',   width: '100px', editable: true,  editType: 'select', options: BOOKED_BY_OPTIONS },
  { key: 'leadName',    label: 'Lead Name',   width: '',      editable: true,  editType: 'text' },
  { key: 'leadEmail',   label: 'Email',       width: '',      editable: true,  editType: 'text' },
  { key: 'dateBooked',  label: 'Date Booked', width: '90px',  editable: true,  editType: 'text' },
  { key: 'callDate',    label: 'Call Date',   width: '110px', editable: true,  editType: 'date' },
  { key: 'callTime',    label: 'Time',        width: '80px',  editable: true,  editType: 'time' },
  { key: 'callType',    label: 'Type',        width: '90px',  editable: true,  editType: 'select', options: ['Discovery', 'Demo'] },
  { key: 'showStatus',  label: 'Show',        width: '100px', editable: true,  editType: 'select', options: SHOW_OPTIONS },
  { key: 'outcome',     label: 'Outcome',     width: '190px', editable: true,  editType: 'select', options: OUTCOME_OPTIONS },
  { key: 'payout',      label: 'Payout',      width: '70px',  editable: false },
  { key: 'paidStatus',  label: 'Paid',        width: '70px',  editable: false },
  { key: 'datePaid',    label: 'Date Paid',   width: '90px',  editable: true,  editType: 'text' },
  { key: 'notes',       label: 'Notes',       width: '',      editable: true,  editType: 'text' },
];

function calcPayout(showStatus, outcome) {
  if (showStatus !== 'Showed') return 0;
  if (!outcome || outcome === 'Not Qualified') return 0;
  if (outcome === 'Qualified — Closed Won') return DEMO_BASE_PAYOUT + DEMO_CLOSE_BONUS;
  if (outcome.startsWith('Qualified')) return DEMO_BASE_PAYOUT;
  return 0;
}

function flashSaveStatus(ok) {
  const el = document.getElementById('demo-save-status');
  if (!el) return;
  el.textContent = ok ? '✓ Saved' : '✗ Failed';
  el.style.color = ok ? '#059669' : '#ef4444';
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 1500);
}

function getFilteredEntries() {
  const f = state.demoFilters;
  let entries = [...state.demoEntries];

  if (f.month) entries = entries.filter(e => str(e.month) === f.month);
  if (f.bookedBy) entries = entries.filter(e => str(e.bookedBy) === f.bookedBy);
  if (f.showStatus === 'showed') entries = entries.filter(e => str(e.showStatus) === 'Showed');
  else if (f.showStatus === 'noshow') entries = entries.filter(e => str(e.showStatus) === 'No-Show');
  else if (f.showStatus === 'pending') entries = entries.filter(e => !str(e.showStatus).trim());
  if (f.outcome) entries = entries.filter(e => str(e.outcome) === f.outcome);
  if (f.dateFrom) entries = entries.filter(e => str(e.callDate) >= f.dateFrom);
  if (f.dateTo) entries = entries.filter(e => str(e.callDate) <= f.dateTo);

  const s = state.demoSort;
  entries.sort((a, b) => {
    let va = str(a[s.field]), vb = str(b[s.field]);
    if (s.field === 'payout') { va = Number(va) || 0; vb = Number(vb) || 0; return s.dir === 'asc' ? va - vb : vb - va; }
    const cmp = va.localeCompare(vb, undefined, { sensitivity: 'base' });
    return s.dir === 'asc' ? cmp : -cmp;
  });

  return entries;
}

export function renderDemoTracker() {
  if (!isAdmin() && !isEmployee()) return '<div style="padding:40px;text-align:center;color:var(--text-muted)">Access restricted.</div>';

  const entries = getFilteredEntries();
  const visibleCols = isAdmin() ? COLUMNS : COLUMNS.filter(c => c.key !== 'payout' && c.key !== 'paidStatus' && c.key !== 'datePaid');
  const f = state.demoFilters;
  const months = [...new Set(state.demoEntries.map(e => str(e.month)).filter(Boolean))].sort().reverse();

  let html = '<div style="padding:12px 20px">';

  // Filter bar
  html += `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px">
    <select onchange="demoFilterBookedBy(this.value)" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
      <option value="" ${!f.bookedBy ? 'selected' : ''}>All Reps</option>
      ${BOOKED_BY_OPTIONS.map(o => `<option value="${esc(o)}" ${f.bookedBy === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
    </select>
    <select onchange="demoFilterMonth(this.value)" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
      <option value="">All Months</option>
      ${months.map(m => `<option value="${esc(m)}" ${f.month === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}
    </select>
    <select onchange="demoFilterShow(this.value)" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
      <option value="" ${!f.showStatus ? 'selected' : ''}>All Status</option>
      <option value="showed" ${f.showStatus === 'showed' ? 'selected' : ''}>Showed</option>
      <option value="noshow" ${f.showStatus === 'noshow' ? 'selected' : ''}>No-Show</option>
      <option value="pending" ${f.showStatus === 'pending' ? 'selected' : ''}>Pending</option>
    </select>
    <select onchange="demoFilterOutcome(this.value)" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
      <option value="" ${!f.outcome ? 'selected' : ''}>All Outcomes</option>
      ${OUTCOME_OPTIONS.map(o => `<option value="${esc(o)}" ${f.outcome === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
    </select>
    <span style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--text-muted)">
      <label>From</label>
      <input type="date" value="${f.dateFrom || ''}" onchange="demoFilterDateFrom(this.value)" style="padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:11px;font-family:var(--font)">
      <label>To</label>
      <input type="date" value="${f.dateTo || ''}" onchange="demoFilterDateTo(this.value)" style="padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:11px;font-family:var(--font)">
      ${(f.dateFrom || f.dateTo) ? '<button onclick="demoClearDates()" style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:14px">×</button>' : ''}
    </span>
    <span style="flex:1"></span>
    <span id="demo-save-status" style="font-size:11px;font-weight:600;transition:opacity .3s;opacity:0"></span>
    <span style="font-size:12px;color:var(--text-muted)">${entries.length} entries</span>
    ${isAdmin()?'<button class="btn btn-primary" style="font-size:12px;padding:6px 14px;background:#7c3aed;border-color:#7c3aed" onclick="openDemoPayoutReport()">Payout Report</button>':''}
    <button class="btn btn-ghost" style="font-size:12px;padding:6px 14px" onclick="demoAddRow()">+ Add Row</button>
  </div>`;

  // Table
  html += `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">`;
  html += `<thead><tr style="background:#f9fafb;border-bottom:2px solid var(--border)">`;
  for (const col of visibleCols) {
    const isSorted = state.demoSort.field === col.key;
    const arrow = isSorted ? (state.demoSort.dir === 'asc' ? ' ↑' : ' ↓') : '';
    html += `<th onclick="demoSort('${col.key}')" style="padding:8px 6px;text-align:left;font-weight:600;cursor:pointer;white-space:nowrap;${col.width ? 'width:' + col.width : ''}">${esc(col.label)}${arrow}</th>`;
  }
  html += `<th style="width:60px;padding:8px 6px">Actions</th></tr></thead><tbody>`;

  if (entries.length === 0) {
    html += `<tr><td colspan="${visibleCols.length + 1}" style="padding:30px;text-align:center;color:var(--text-muted)">No entries found.</td></tr>`;
  }

  for (const entry of entries) {
    const isNoShow = str(entry.showStatus) === 'No-Show';
    const isWon = str(entry.outcome) === 'Qualified — Closed Won';
    const rowStyle = isNoShow ? 'color:#9ca3af;' : isWon ? 'border-left:3px solid #059669;' : '';
    html += `<tr style="${rowStyle}border-bottom:1px solid var(--border)">`;

    for (const col of visibleCols) {
      const val = str(entry[col.key]);
      const isEditing = state.demoEditingCell && state.demoEditingCell.id === entry.id && state.demoEditingCell.field === col.key;

      if (col.key === 'payout') {
        const amt = Number(entry.payout) || 0;
        const color = amt >= 150 ? '#059669' : amt > 0 ? '#2563eb' : '#9ca3af';
        html += `<td style="padding:6px;font-weight:600;color:${color}">$${amt}</td>`;
        continue;
      }

      if (col.key === 'paidStatus') {
        const isPaid = str(entry.paidStatus).toLowerCase() === 'paid';
        html += `<td style="padding:6px"><button onclick="demoMarkPaid('${entry.id}')" style="padding:2px 8px;font-size:11px;font-weight:600;border-radius:4px;cursor:pointer;border:1px solid ${isPaid ? '#059669' : '#d1d5db'};background:${isPaid ? '#dcfce7' : '#f9fafb'};color:${isPaid ? '#059669' : '#6b7280'}">${isPaid ? '✓ Paid' : '$ Pay'}</button></td>`;
        continue;
      }

      if (col.key === 'outcome' && str(entry.showStatus) !== 'Showed') {
        html += `<td style="padding:6px;color:#d1d5db">—</td>`;
        continue;
      }

      if (col.editable && isEditing) {
        if (col.editType === 'select') {
          const opts = col.options || [];
          html += `<td style="padding:2px"><select onchange="demoSaveCell('${entry.id}','${col.key}',this.value)" onblur="demoSaveCell('${entry.id}','${col.key}',this.value)" autofocus style="width:100%;padding:4px;font-size:12px;font-family:var(--font);border:1px solid var(--purple);border-radius:4px">
            <option value="">—</option>
            ${opts.map(o => `<option value="${esc(o)}" ${val === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
          </select></td>`;
        } else {
          const inputType = col.editType === 'date' ? 'date' : col.editType === 'time' ? 'time' : 'text';
          html += `<td style="padding:2px"><input type="${inputType}" class="tracker-cell-input" value="${esc(val)}"
            onblur="demoSaveCell('${entry.id}','${col.key}',this.value)"
            onkeydown="if(event.key==='Enter')this.blur()"
            autofocus style="width:100%;padding:4px;font-size:12px;font-family:var(--font);border:1px solid var(--purple);border-radius:4px"></td>`;
        }
      } else if (col.editable) {
        const display = isNoShow && col.key === 'leadName' ? `<s>${esc(val)}</s>` : esc(val);
        html += `<td onclick="demoEditCell('${entry.id}','${col.key}')" style="padding:6px;cursor:pointer;${col.width ? 'max-width:' + col.width + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap' : ''}" title="${esc(val)}">${display || '<span style="color:#d1d5db">—</span>'}</td>`;
      } else {
        html += `<td style="padding:6px">${esc(val)}</td>`;
      }
    }

    html += `<td style="padding:6px">${isAdmin()?`<button onclick="demoDeleteRow('${entry.id}')" style="background:none;border:none;cursor:pointer;color:#d1d5db;font-size:14px" title="Delete">×</button>`:''}</td>`;
    html += `</tr>`;
  }

  html += `</tbody></table></div></div>`;
  return html;
}

// ─── Cell editing ───

async function saveDemoCell(entryId, field, value) {
  const entry = state.demoEntries.find(e => e.id === entryId);
  if (!entry) return;
  const oldValue = entry[field];
  if (oldValue === value) { state.demoEditingCell = null; render(); return; }

  entry[field] = value;

  if (field === 'showStatus' || field === 'outcome') {
    if (field === 'showStatus' && value === 'No-Show') {
      entry.outcome = '';
    }
    entry.payout = calcPayout(str(entry.showStatus), str(entry.outcome));
  }

  state.demoEditingCell = null;
  render();

  pendingWrites.value++;
  try {
    const updates = { [field]: value };
    if (field === 'showStatus' && value === 'No-Show') { updates.outcome = ''; updates.payout = 0; }
    else if (field === 'showStatus' || field === 'outcome') { updates.payout = entry.payout; }
    await sbUpdateDemoEntry(entryId, camelToSnake(updates));
    flashSaveStatus(true);
  } catch (e) {
    entry[field] = oldValue;
    entry.payout = calcPayout(str(entry.showStatus), str(entry.outcome));
    render();
    flashSaveStatus(false);
    console.error('Demo tracker update failed:', e);
  } finally {
    pendingWrites.value--;
  }
}

function markDemoPaid(entryId) {
  if (!isAdmin()) return;
  const entry = state.demoEntries.find(e => e.id === entryId);
  if (!entry) return;
  const today = new Date();
  const datePaid = `${today.getMonth() + 1}/${today.getDate()}/${String(today.getFullYear()).slice(-2)}`;
  const newStatus = str(entry.paidStatus).toLowerCase() === 'paid' ? '' : 'Paid';
  const newDate = newStatus === 'Paid' ? datePaid : '';

  entry.paidStatus = newStatus;
  entry.datePaid = newDate;
  render();

  pendingWrites.value++;
  sbUpdateDemoEntry(entryId, camelToSnake({ paidStatus: newStatus, datePaid: newDate }))
    .then(() => flashSaveStatus(true))
    .catch(e => { flashSaveStatus(false); console.error('Mark paid failed:', e); })
    .finally(() => { pendingWrites.value--; });
}

// ─── Add / Delete rows ───

async function addDemoRow() {
  const today = new Date();
  const dateBooked = `${today.getMonth() + 1}/${today.getDate()}/${String(today.getFullYear()).slice(-2)}`;
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const month = `${monthNames[today.getMonth()]}/${String(today.getFullYear()).slice(-2)}`;
  const fields = { dealId: '', leadName: '', leadEmail: '', dateBooked, callDate: '', callTime: '', callType: 'Discovery', showStatus: '', outcome: '', payout: 0, paidStatus: '', datePaid: '', month, notes: '', bookedBy: 'Ioannis' };
  pendingWrites.value++;
  try {
    const created = await sbCreateDemoEntry(camelToSnake(fields));
    if (created) {
      state.demoEntries.unshift(normalizeRow(created));
      render();
    }
  } catch (e) {
    console.error('Failed to add demo row:', e);
    alert('Failed to add row: ' + e.message);
  } finally {
    pendingWrites.value--;
  }
}

async function deleteDemoRow(entryId) {
  if (!confirm('Delete this entry?')) return;
  state.demoEntries = state.demoEntries.filter(e => e.id !== entryId);
  render();
  pendingWrites.value++;
  try { await sbDeleteDemoEntry(entryId); }
  catch (e) { console.error('Delete failed:', e); }
  finally { pendingWrites.value--; }
}

// ─── Push from deal modal ───

export async function pushToDemoTracker(dealId) {
  const deal = state.deals.find(d => d.id === dealId);
  if (!deal) return;
  if (deal.pushedToDemoTracker && str(deal.pushedToDemoTracker).trim() !== '') {
    if (!confirm('Already pushed to Demo Tracker. Push again?')) return;
  }

  const btn = document.getElementById('push-demo-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = 'Pushing...'; }

  const today = new Date();
  const dateBooked = `${today.getMonth() + 1}/${today.getDate()}/${String(today.getFullYear()).slice(-2)}`;
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const month = `${monthNames[today.getMonth()]}/${String(today.getFullYear()).slice(-2)}`;

  const callType = str(deal.stage).includes('Discovery') ? 'Discovery' : 'Demo';

  const fields = {
    dealId: deal.id,
    leadName: deal.company || deal.contact || 'Unknown',
    leadEmail: deal.email || '',
    dateBooked,
    callDate: deal.bookedDate || '',
    callTime: deal.bookedTime || '',
    callType,
    showStatus: '',
    outcome: '',
    payout: 0,
    paidStatus: '',
    datePaid: '',
    month,
    notes: '',
    bookedBy: 'Ioannis',
  };

  pendingWrites.value++;
  try {
    const created = await sbCreateDemoEntry(camelToSnake(fields));

    deal.pushedToDemoTracker = new Date().toISOString();
    pendingDealFields[dealId] = { ...pendingDealFields[dealId], pushedToDemoTracker: deal.pushedToDemoTracker };
    sbUpdateDeal(deal.id, camelToSnake({ pushedToDemoTracker: deal.pushedToDemoTracker })).catch(e => console.error('Update deal failed:', e));

    if (created) {
      state.demoEntries.unshift(normalizeRow(created));
    }
    if (state.selectedDeal && String(state.selectedDeal.id) === String(dealId)) {
      state.selectedDeal = deal;
    }
    refreshModal();
  } catch (e) {
    alert('Push to Demo Tracker failed: ' + e.message);
    if (btn) { btn.disabled = false; btn.innerHTML = 'Retry Push'; }
  } finally {
    pendingWrites.value--;
  }
}

// ─── Payout Report ───

function openDemoPayoutReportModal() {
  const now = new Date();
  state._demoPayoutMonth = now.getMonth() + 1;
  state._demoPayoutYear = now.getFullYear();
  const overlay = document.createElement('div');
  overlay.id = 'demo-payout-overlay';
  overlay.className = 'modal-overlay';
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
  renderDemoPayoutModal();
}

function renderDemoPayoutModal() {
  const overlay = document.getElementById('demo-payout-overlay');
  if (!overlay) return;
  const m = state._demoPayoutMonth;
  const y = state._demoPayoutYear;
  const monthNames = ['','January','February','March','April','May','June','July','August','September','October','November','December'];

  const monthLabel = `${monthNames[m]}/${String(y).slice(-2)}`;
  const entries = state.demoEntries.filter(e => str(e.month) === monthLabel);

  const total = entries.length;
  const noShows = entries.filter(e => str(e.showStatus) === 'No-Show').length;
  const showed = entries.filter(e => str(e.showStatus) === 'Showed').length;
  const qualified = entries.filter(e => str(e.outcome).startsWith('Qualified')).length;
  const closedWon = entries.filter(e => str(e.outcome) === 'Qualified — Closed Won').length;
  const notQualified = entries.filter(e => str(e.outcome) === 'Not Qualified').length;

  const qualifiedPayout = qualified * DEMO_BASE_PAYOUT;
  const closeBonuses = closedWon * DEMO_CLOSE_BONUS;
  const grandTotal = qualifiedPayout + closeBonuses;

  let h = `<div class="modal" style="width:520px;max-height:80vh" onclick="event.stopPropagation()">
    <div class="modal-header"><h3>Demo Payout Report</h3><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button></div>
    <div class="modal-body" style="max-height:60vh;overflow-y:auto">
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <select onchange="demoPayoutSetMonth(Number(this.value))" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
          ${[1,2,3,4,5,6,7,8,9,10,11,12].map(i => `<option value="${i}" ${i === m ? 'selected' : ''}>${monthNames[i]}</option>`).join('')}
        </select>
        <select onchange="demoPayoutSetYear(Number(this.value))" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
          ${[2025,2026,2027].map(yr => `<option value="${yr}" ${yr === y ? 'selected' : ''}>${yr}</option>`).join('')}
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px">
        <div style="padding:12px;background:#f9fafb;border-radius:8px;text-align:center">
          <div style="font-size:20px;font-weight:700">${total}</div>
          <div style="font-size:11px;color:var(--text-muted)">Total Calls</div>
        </div>
        <div style="padding:12px;background:#fef2f2;border-radius:8px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#ef4444">${noShows}</div>
          <div style="font-size:11px;color:var(--text-muted)">No-Shows</div>
        </div>
        <div style="padding:12px;background:#f0fdf4;border-radius:8px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#059669">${showed}</div>
          <div style="font-size:11px;color:var(--text-muted)">Showed</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
        <div style="padding:12px;background:#eff6ff;border-radius:8px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#2563eb">${qualified}</div>
          <div style="font-size:11px;color:var(--text-muted)">Qualified</div>
        </div>
        <div style="padding:12px;background:#f0fdf4;border-radius:8px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#059669">${closedWon}</div>
          <div style="font-size:11px;color:var(--text-muted)">Closed Won</div>
        </div>
      </div>
      <div style="border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px">
          <span>Qualified shows (${qualified} × $${DEMO_BASE_PAYOUT})</span><span style="font-weight:600">$${qualifiedPayout}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px">
          <span>Close bonuses (${closedWon} × $${DEMO_CLOSE_BONUS})</span><span style="font-weight:600">$${closeBonuses}</span>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:8px;margin-top:8px;display:flex;justify-content:space-between;font-size:16px;font-weight:700">
          <span>Total Payout</span><span style="color:#059669">$${grandTotal}</span>
        </div>
      </div>
    </div>
  </div>`;
  overlay.innerHTML = h;
}

// ─── Filter handlers ───

window.demoFilterBookedBy = v => { state.demoFilters.bookedBy = v; render(); };
window.demoFilterMonth = v => { state.demoFilters.month = v; render(); };
window.demoFilterShow = v => { state.demoFilters.showStatus = v; render(); };
window.demoFilterOutcome = v => { state.demoFilters.outcome = v; render(); };
window.demoFilterDateFrom = v => { state.demoFilters.dateFrom = v; render(); };
window.demoFilterDateTo = v => { state.demoFilters.dateTo = v; render(); };
window.demoClearDates = () => { state.demoFilters.dateFrom = ''; state.demoFilters.dateTo = ''; render(); };
window.demoSort = field => {
  if (state.demoSort.field === field) state.demoSort.dir = state.demoSort.dir === 'asc' ? 'desc' : 'asc';
  else { state.demoSort.field = field; state.demoSort.dir = 'asc'; }
  render();
};
window.demoEditCell = (id, field) => { state.demoEditingCell = { id, field }; render(); };
window.demoSaveCell = (id, field, value) => saveDemoCell(id, field, value);
window.demoMarkPaid = id => markDemoPaid(id);
window.demoAddRow = () => addDemoRow();
window.demoDeleteRow = id => deleteDemoRow(id);
window.openDemoPayoutReport = () => openDemoPayoutReportModal();
window.demoPayoutSetMonth = m => { state._demoPayoutMonth = m; renderDemoPayoutModal(); };
window.demoPayoutSetYear = y => { state._demoPayoutYear = y; renderDemoPayoutModal(); };
window.pushToDemoTracker = pushToDemoTracker;
