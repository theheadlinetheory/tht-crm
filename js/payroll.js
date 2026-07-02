// ═══════════════════════════════════════════════════════════
// PAYROLL — Employee management, payment tracking & PayPal
// ═══════════════════════════════════════════════════════════
import { state } from './app.js?v=20260702a';
import { invokeEdgeFunction, showToast, supabase } from './api.js?v=20260702a';
import { esc, str } from './utils.js?v=20260702a';
import { render } from './render.js?v=20260702a';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

let _employees = [];
let _employeesLoaded = false;

async function loadEmployees() {
  const { data } = await supabase.from('employees').select('*').order('created_at');
  _employees = data || [];
  _employeesLoaded = true;
}

function parseMDY(s) {
  const parts = s.split('/');
  if (parts.length !== 3) return null;
  const m = parseInt(parts[0], 10);
  let y = parseInt(parts[2], 10);
  if (y < 100) y += 2000;
  return { m, y };
}

function getLeadsForMonth(month, year) {
  const good = [], calledBack = [];
  for (const e of state.trackerEntries) {
    const appt = str(e.apptDate);
    const added = str(e.dateAdded);
    const parsed = (appt && appt.includes('/')) ? parseMDY(appt) : parseMDY(added);
    if (!parsed || parsed.m !== month || parsed.y !== year) continue;
    if (str(e.callbackStatus).toLowerCase() === 'called back') calledBack.push(e);
    else good.push(e);
  }
  return { good, calledBack, total: good.length + calledBack.length };
}

let _payments = [];
let _paymentsLoaded = false;

async function loadPayments() {
  const resp = await invokeEdgeFunction('paypal-payout', { action: 'list' });
  _payments = resp.ok ? (resp.payments || []) : [];
  _paymentsLoaded = true;
}

function getAlreadyPaidForMonth(empName, month, year) {
  const period = `${year}-${String(month).padStart(2,'0')}`;
  let basesPaid = 0, totalPaid = 0;
  for (const p of _payments) {
    if (p.employee_name !== empName) continue;
    if (p.pay_period === period) {
      totalPaid += Number(p.total) || 0;
      if (!p.booked_meetings) basesPaid++;
    }
  }
  return { basesPaid, totalPaid };
}

function getDemoEntriesForMonth(month, year) {
  const monthNames = ['','January','February','March','April','May','June','July','August','September','October','November','December'];
  const label = `${monthNames[month]}/${String(year).slice(-2)}`;
  const all = (state.demoEntries || []).filter(e => str(e.month) === label);
  const showed = all.filter(e => str(e.showStatus) === 'Showed');
  const noShows = all.filter(e => str(e.showStatus) === 'No-Show');
  const qualified = showed.filter(e => str(e.outcome).startsWith('Qualified'));
  const closedWon = showed.filter(e => str(e.outcome) === 'Qualified — Closed Won');
  const totalPayout = qualified.reduce((s, e) => s + (Number(e.payout) || 0), 0);
  return { all, showed, noShows, qualified, closedWon, totalPayout };
}

function calcPayout(emp, month, year) {
  if (emp.pay_type === 'salary') {
    return { total: Number(emp.monthly_salary) || 0, breakdown: `Fixed: $${(Number(emp.monthly_salary) || 0).toLocaleString()}/mo` };
  }
  const paid = getAlreadyPaidForMonth(emp.name + (emp.commission_source === 'demo_tracker' ? ' (SDR)' : ''), month, year);

  if (emp.commission_source === 'demo_tracker') {
    const demos = getDemoEntriesForMonth(month, year);
    return { totalOwed: demos.totalPayout, commission: demos.totalPayout, baseOwed: 0, basesOwed: 0, basesPaid: 0, totalPaid: paid.totalPaid, demos, source: 'demo_tracker' };
  }

  const leads = getLeadsForMonth(month, year);
  const perLead = Number(emp.per_lead) || 0;
  const basePay = Number(emp.base_pay) || 0;
  const commission = leads.good.length * perLead;
  const basesOwed = Math.max(0, 2 - paid.basesPaid);
  const baseOwed = basesOwed * basePay;
  const totalOwed = commission + baseOwed;
  return { totalOwed, commission, baseOwed, basesOwed, basesPaid: paid.basesPaid, totalPaid: paid.totalPaid, leads, perLead, basePay, source: 'lead_tracker' };
}

// ─── Render ───
export function renderPayroll() {
  if (!state._payrollMonth) {
    const now = new Date();
    state._payrollMonth = now.getMonth() + 1;
    state._payrollYear = now.getFullYear();
  }
  if (!_employeesLoaded || !_paymentsLoaded || !state.trackerLoaded) {
    Promise.all([
      _employeesLoaded ? Promise.resolve() : loadEmployees(),
      _paymentsLoaded ? Promise.resolve() : loadPayments(),
      state.trackerLoaded ? Promise.resolve() : import('./lead-tracker.js?v=20260702a').then(m => m.loadTrackerEntries()),
    ]).then(() => { if (state.pipeline === 'payroll') render(); });
    return '<div style="text-align:center;padding:40px;color:var(--text-muted)">Loading payroll...</div>';
  }

  const month = state._payrollMonth;
  const year = state._payrollYear;
  const active = _employees.filter(e => e.status === 'active');

  let html = `<div style="max-width:900px;margin:0 auto;padding:20px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <h2 style="margin:0;font-size:20px">Payroll</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <select onchange="payrollSetMonth(+this.value)" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
          ${MONTHS.map((m, i) => `<option value="${i+1}" ${i+1===month?'selected':''}>${m}</option>`).join('')}
        </select>
        <select onchange="payrollSetYear(+this.value)" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
          ${[year-1, year, year+1].map(y => `<option value="${y}" ${y===year?'selected':''}>${y}</option>`).join('')}
        </select>
        <button class="btn btn-primary" onclick="payrollAddEmployee()" style="font-size:12px">+ Add Employee</button>
      </div>
    </div>`;

  for (const emp of active) {
    const payout = calcPayout(emp, month, year);
    const hasPayPal = !!emp.paypal_email;
    const typeLabel = emp.pay_type === 'salary' ? 'Fixed Salary' : 'Commission';
    const typeBg = emp.pay_type === 'salary' ? '#dbeafe' : '#f0fdf4';
    const typeColor = emp.pay_type === 'salary' ? '#2563eb' : '#16a34a';
    const displayTotal = emp.pay_type === 'salary' ? payout.total : payout.totalOwed;
    const displayBreakdown = emp.pay_type === 'salary'
      ? `Fixed: $${payout.total.toLocaleString()}/mo`
      : payout.source === 'demo_tracker'
        ? `${payout.demos.qualified.length} qualified × payout = $${payout.commission}`
        : `$${payout.baseOwed} base + $${payout.commission} leads = $${payout.totalOwed} remaining`;

    html += `<div data-payroll style="border:1px solid var(--border);border-radius:10px;padding:20px;margin-bottom:16px;background:var(--card)">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:16px">
        <div>
          <div style="display:flex;align-items:center;gap:8px">
            <h3 style="margin:0;font-size:16px">${esc(emp.name)}</h3>
            <span style="font-size:11px;padding:2px 8px;border-radius:4px;background:${typeBg};color:${typeColor};font-weight:600">${typeLabel}</span>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(emp.role || '')}${hasPayPal ? ` · ${esc(emp.paypal_email)}` : ' · No PayPal'}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="text-align:right">
            <div style="font-size:24px;font-weight:700;color:#7c3aed">$${displayTotal.toLocaleString()}</div>
            <div style="font-size:11px;color:var(--text-muted)">${esc(displayBreakdown)}</div>
          </div>
          <button class="btn btn-ghost" onclick="payrollEditEmployee('${emp.id}')" style="padding:4px 6px" title="Edit">${editIcon()}</button>
        </div>
      </div>`;

    if (emp.pay_type === 'commission' && payout.source === 'demo_tracker') {
      const d = payout.demos;
      html += `<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:16px">
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#16a34a">${d.qualified.length}</div>
          <div style="font-size:10px;color:#4d7c0f">Qualified Shows</div>
        </div>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#2563eb">${d.closedWon.length}</div>
          <div style="font-size:10px;color:#1e40af">Closed Won</div>
        </div>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#dc2626">${d.noShows.length}</div>
          <div style="font-size:10px;color:#991b1b">No-Shows</div>
        </div>
        <div style="background:#fef9c3;border:1px solid #fde68a;border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#a16207">$${payout.totalPaid}</div>
          <div style="font-size:10px;color:#92400e">Already Paid</div>
        </div>
      </div>`;

      if (d.qualified.length) {
        html += `<div style="margin-bottom:16px">
          <div style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--text-muted)">Qualified Demos ($100/show + $50 close bonus)</div>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr style="border-bottom:2px solid var(--border)">
              <th style="text-align:left;padding:4px 8px">#</th>
              <th style="text-align:left;padding:4px 8px">Lead</th>
              <th style="text-align:left;padding:4px 8px">Type</th>
              <th style="text-align:left;padding:4px 8px">Outcome</th>
              <th style="text-align:right;padding:4px 8px">Payout</th>
            </tr></thead>
            <tbody>${d.qualified.map((e, i) => `<tr style="border-bottom:1px solid #f3f4f6">
              <td style="padding:4px 8px;color:var(--text-muted)">${i + 1}</td>
              <td style="padding:4px 8px;font-weight:500">${esc(str(e.leadName) || 'Unknown')}</td>
              <td style="padding:4px 8px">${esc(str(e.callType) || '-')}</td>
              <td style="padding:4px 8px">${esc(str(e.outcome) || '-')}</td>
              <td style="padding:4px 8px;text-align:right;font-weight:600;color:#059669">$${Number(e.payout) || 0}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>`;
      }

      if (d.noShows.length) {
        html += `<div style="margin-bottom:16px">
          <div style="font-size:12px;font-weight:600;margin-bottom:6px;color:#dc2626">No-Shows (not paid)</div>
          <div style="font-size:11px;color:var(--text-muted)">${d.noShows.map(e => esc(str(e.leadName) || 'Unknown')).join(', ')}</div>
        </div>`;
      }
    } else if (emp.pay_type === 'commission') {
      const goodLeads = payout.leads.good;
      const calledBack = payout.leads.calledBack;

      html += `<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:16px">
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#16a34a">${goodLeads.length}</div>
          <div style="font-size:10px;color:#4d7c0f">Good Leads</div>
        </div>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#dc2626">${calledBack.length}</div>
          <div style="font-size:10px;color:#991b1b">Called Back</div>
        </div>
        <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#7c3aed">$${payout.baseOwed}</div>
          <div style="font-size:10px;color:#5b21b6">Base Owed (${payout.basesOwed} of 2)</div>
        </div>
        <div style="background:#fef9c3;border:1px solid #fde68a;border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#a16207">$${payout.totalPaid}</div>
          <div style="font-size:10px;color:#92400e">Already Paid</div>
        </div>
      </div>`;

      if (goodLeads.length) {
        html += `<div style="margin-bottom:16px">
          <div style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--text-muted)">Qualified Leads ($${payout.perLead}/ea)</div>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr style="border-bottom:2px solid var(--border)">
              <th style="text-align:left;padding:4px 8px">#</th>
              <th style="text-align:left;padding:4px 8px">Lead</th>
              <th style="text-align:left;padding:4px 8px">Client</th>
              <th style="text-align:left;padding:4px 8px">Date</th>
            </tr></thead>
            <tbody>${goodLeads.map((lead, i) => `<tr style="border-bottom:1px solid #f3f4f6">
              <td style="padding:4px 8px;color:var(--text-muted)">${i + 1}</td>
              <td style="padding:4px 8px;font-weight:500">${esc(str(lead.leadName) || 'Unknown')}</td>
              <td style="padding:4px 8px">${esc(str(lead.clientName) || '-')}</td>
              <td style="padding:4px 8px">${esc(str(lead.apptDate) || str(lead.dateAdded) || '-')}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>`;
      }

      if (calledBack.length) {
        html += `<div style="margin-bottom:16px">
          <div style="font-size:12px;font-weight:600;margin-bottom:6px;color:#dc2626">Called Back (not paid)</div>
          <div style="font-size:11px;color:var(--text-muted)">${calledBack.map(l => esc(str(l.leadName) || 'Unknown')).join(', ')}</div>
        </div>`;
      }
    }

    if (emp.pay_type === 'salary') {
      const fullSalary = Number(emp.monthly_salary) || 0;
      const halfSalary = Math.round(fullSalary / 2 * 100) / 100;
      const salaryMode = state['_payrollBaseOnly_' + emp.id] || '';
      html += `<div style="display:flex;gap:6px;margin-bottom:8px">
        <button class="btn ${!salaryMode?'btn-primary':'btn-ghost'}" style="font-size:11px;padding:4px 12px" onclick="payrollSetBaseMode('${emp.id}','',${fullSalary},'${MONTHS[month-1]} ${year}')">Full ($${fullSalary})</button>
        <button class="btn ${salaryMode==='half'?'btn-primary':'btn-ghost'}" style="font-size:11px;padding:4px 12px" onclick="payrollSetBaseMode('${emp.id}','half',${halfSalary},'${MONTHS[month-1]} 1-15')">Half ($${halfSalary})</button>
      </div>`;
    }

    if (emp.pay_type === 'commission' && payout.source === 'lead_tracker') {
      const halfBase = Number(emp.base_pay) || 0;
      const fullBase = halfBase * 2;
      const baseMode = state['_payrollBaseOnly_' + emp.id] || '';
      html += `<div style="display:flex;gap:6px;margin-bottom:8px">
        <button class="btn ${!baseMode?'btn-primary':'btn-ghost'}" style="font-size:11px;padding:4px 12px" onclick="payrollSetBaseMode('${emp.id}','',${displayTotal},'${MONTHS[month-1]} ${year}')">Full ($${displayTotal})</button>
        <button class="btn ${baseMode==='half'?'btn-primary':'btn-ghost'}" style="font-size:11px;padding:4px 12px" onclick="payrollSetBaseMode('${emp.id}','half',${halfBase},'${MONTHS[month-1]} 1-15 base')">Half Base ($${halfBase})</button>
        <button class="btn ${baseMode==='full_base'?'btn-primary':'btn-ghost'}" style="font-size:11px;padding:4px 12px" onclick="payrollSetBaseMode('${emp.id}','full_base',${fullBase},'${MONTHS[month-1]} base (full)')">Full Base ($${fullBase})</button>
      </div>`;
    }

    html += `<div style="display:flex;gap:8px;align-items:end">
        <div style="flex:1">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">Amount</label>
          <input id="payroll-amt-${emp.id}" type="number" step="0.01" value="${displayTotal}" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
        </div>
        <div style="flex:1">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">Note</label>
          <input id="payroll-note-${emp.id}" type="text" value="${MONTHS[month-1]} ${year}" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
        </div>
        <button id="payroll-btn-${emp.id}" class="btn btn-primary" style="white-space:nowrap" onclick="payrollSend('${emp.id}')">${hasPayPal ? 'Send via PayPal' : 'Record Payment'}</button>
        ${hasPayPal ? `<button class="btn btn-ghost" style="white-space:nowrap;font-size:12px" onclick="payrollRecord('${emp.id}')">Record Only</button>` : ''}
      </div>
      ${!hasPayPal ? `<div style="font-size:11px;color:#d97706;margin-top:6px">PayPal not configured — payment will be recorded only.</div>` : ''}
    </div>`;
  }

  html += `<div style="border:1px solid var(--border);border-radius:10px;padding:20px;background:var(--card)">
    <h3 style="margin:0 0 12px;font-size:14px;color:var(--text-muted)">Payment History</h3>
    <div id="payroll-history" style="font-size:12px">Loading...</div>
  </div></div>`;

  return html;
}

function editIcon() {
  return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
}

// ─── Employee Modal ───
function showEmployeeModal(emp) {
  const isEdit = !!emp;
  const e = emp || { name: '', pay_type: 'commission', base_pay: 250, per_lead: 27, monthly_salary: 0, paypal_email: '', role: '', notes: '', commission_source: 'lead_tracker' };
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'payroll-emp-modal';
  overlay.onclick = (ev) => { if (ev.target === overlay) overlay.remove(); };

  overlay.innerHTML = `<div class="modal" style="width:460px" onclick="event.stopPropagation()">
    <div class="modal-header">
      <h3>${isEdit ? 'Edit' : 'Add'} Employee</h3>
      <button class="modal-close" onclick="document.getElementById('payroll-emp-modal').remove()">×</button>
    </div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:12px">
      <div>
        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:3px">Name</label>
        <input id="emp-name" type="text" value="${esc(e.name)}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
      </div>
      <div>
        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:3px">Role</label>
        <input id="emp-role" type="text" value="${esc(e.role || '')}" placeholder="e.g. Appointment Setter" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
      </div>
      <div>
        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:3px">Pay Type</label>
        <select id="emp-pay-type" onchange="payrollTogglePayFields()" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
          <option value="commission" ${e.pay_type==='commission'?'selected':''}>Commission (per lead + base)</option>
          <option value="salary" ${e.pay_type==='salary'?'selected':''}>Fixed Salary</option>
        </select>
      </div>
      <div id="emp-commission-fields" style="${e.pay_type==='salary'?'display:none':''}">
        <div style="margin-bottom:8px">
          <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:3px">Commission Source</label>
          <select id="emp-commission-source" onchange="payrollToggleCommissionSource()" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
            <option value="lead_tracker" ${(e.commission_source||'lead_tracker')==='lead_tracker'?'selected':''}>Lead Tracker (client appointments)</option>
            <option value="demo_tracker" ${e.commission_source==='demo_tracker'?'selected':''}>Demo Tracker (acquisition demos)</option>
          </select>
        </div>
        <div id="emp-lead-tracker-fields" style="${e.commission_source==='demo_tracker'?'display:none':''}">
          <div style="display:flex;gap:8px">
            <div style="flex:1">
              <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:3px">Base Pay (biweekly)</label>
              <input id="emp-base-pay" type="number" step="0.01" value="${e.base_pay || 0}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
            </div>
            <div style="flex:1">
              <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:3px">Per Lead</label>
              <input id="emp-per-lead" type="number" step="0.01" value="${e.per_lead || 0}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
            </div>
          </div>
        </div>
        <div id="emp-demo-tracker-fields" style="${e.commission_source==='demo_tracker'?'':'display:none'}">
          <div style="font-size:12px;color:var(--text-muted);padding:8px;background:#f5f3ff;border-radius:6px">$100 per qualified show + $50 close bonus (set in demo tracker)</div>
        </div>
      </div>
      <div id="emp-salary-fields" style="${e.pay_type!=='salary'?'display:none':''}">
        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:3px">Monthly Salary</label>
        <input id="emp-monthly-salary" type="number" step="0.01" value="${e.monthly_salary || 0}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
      </div>
      <div>
        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:3px">PayPal Email</label>
        <input id="emp-paypal" type="email" value="${esc(e.paypal_email || '')}" placeholder="Leave blank if not available" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
      </div>
      <div>
        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:3px">Notes</label>
        <input id="emp-notes" type="text" value="${esc(e.notes || '')}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
      </div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button class="btn btn-primary" style="flex:1" onclick="payrollSaveEmployee('${isEdit ? emp.id : ''}')">${isEdit ? 'Save Changes' : 'Add Employee'}</button>
        ${isEdit ? `<button class="btn btn-ghost" style="color:#dc2626" onclick="payrollDeactivateEmployee('${emp.id}')">Deactivate</button>` : ''}
      </div>
    </div>
  </div>`;

  document.body.appendChild(overlay);
}

// ─── Payment History ───
export function loadPayrollHistory() {
  invokeEdgeFunction('paypal-payout', { action: 'list' }).then(resp => {
    const el = document.getElementById('payroll-history');
    if (!el) return;
    if (!resp.ok || !resp.payments?.length) { el.innerHTML = '<div style="color:var(--text-muted)">No payments yet.</div>'; return; }
    el.innerHTML = `<table style="width:100%;border-collapse:collapse">
      <thead><tr style="border-bottom:2px solid var(--border)">
        <th style="text-align:left;padding:6px 8px">Employee</th>
        <th style="text-align:left;padding:6px 8px">Date</th>
        <th style="text-align:right;padding:6px 8px">Amount</th>
        <th style="text-align:left;padding:6px 8px">Method</th>
        <th style="text-align:left;padding:6px 8px">Status</th>
        <th style="text-align:left;padding:6px 8px">Notes</th>
        <th style="padding:6px 8px"></th>
      </tr></thead>
      <tbody>${resp.payments.map(p => {
        const statusBg = p.status === 'Paid' ? '#dcfce7' : p.status === 'Sent' ? '#dbeafe' : '#fef3c7';
        const statusColor = p.status === 'Paid' ? '#16a34a' : p.status === 'Sent' ? '#2563eb' : '#d97706';
        return `<tr style="border-bottom:1px solid #f3f4f6">
          <td style="padding:6px 8px;font-weight:500">${esc(p.employee_name)}</td>
          <td style="padding:6px 8px">${p.payment_date}</td>
          <td style="padding:6px 8px;text-align:right;font-weight:600">$${Number(p.total).toFixed(2)}</td>
          <td style="padding:6px 8px">${esc(p.payment_method)}</td>
          <td style="padding:6px 8px"><span style="padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;background:${statusBg};color:${statusColor}">${esc(p.status)}</span></td>
          <td style="padding:6px 8px;color:var(--text-muted);max-width:200px;overflow:hidden;text-overflow:ellipsis">${esc(p.notes || '')}</td>
          <td style="padding:6px 8px;white-space:nowrap">
            <button class="btn btn-ghost" style="font-size:10px;padding:2px 6px" onclick="payrollEditPayment('${p.id}')">Edit</button>
            <button class="btn btn-ghost" style="font-size:10px;padding:2px 6px;color:#dc2626" onclick="payrollDeletePayment('${p.id}')">Delete</button>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  }).catch(() => {
    const el = document.getElementById('payroll-history');
    if (el) el.innerHTML = '<div style="color:#dc2626">Failed to load.</div>';
  });
}

// ─── Window Handlers ───
window.payrollEditPayment = async (paymentId) => {
  const resp = await invokeEdgeFunction('paypal-payout', { action: 'list' });
  const p = (resp.payments || []).find(x => x.id === paymentId);
  if (!p) { showToast('Payment not found', 'error'); return; }

  const overlay = document.createElement('div');
  overlay.id = 'payroll-edit-modal';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.5);display:flex;justify-content:center;align-items:center';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `<div data-payroll style="background:#fff;border-radius:12px;padding:24px;width:420px;box-shadow:0 8px 30px rgba(0,0,0,.2)">
    <h3 style="margin:0 0 16px;font-size:16px">Edit Payment</h3>
    <div style="display:flex;flex-direction:column;gap:10px">
      <div><label style="font-size:11px;font-weight:600;color:#6b7280;display:block;margin-bottom:3px">Employee</label><input id="ep-name" value="${p.employee_name}" style="width:100%;padding:6px 10px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;font-family:var(--font)"></div>
      <div style="display:flex;gap:8px">
        <div style="flex:1"><label style="font-size:11px;font-weight:600;color:#6b7280;display:block;margin-bottom:3px">Amount</label><input id="ep-total" type="number" step="0.01" value="${p.total}" style="width:100%;padding:6px 10px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;font-family:var(--font)"></div>
        <div style="flex:1"><label style="font-size:11px;font-weight:600;color:#6b7280;display:block;margin-bottom:3px">Date</label><input id="ep-date" type="date" value="${p.payment_date}" style="width:100%;padding:6px 10px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;font-family:var(--font)"></div>
      </div>
      <div style="display:flex;gap:8px">
        <div style="flex:1"><label style="font-size:11px;font-weight:600;color:#6b7280;display:block;margin-bottom:3px">Status</label><select id="ep-status" style="width:100%;padding:6px 10px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;font-family:var(--font)">
          <option value="Pending" ${p.status==='Pending'?'selected':''}>Pending</option>
          <option value="Sent" ${p.status==='Sent'?'selected':''}>Sent</option>
          <option value="Paid" ${p.status==='Paid'?'selected':''}>Paid</option>
        </select></div>
        <div style="flex:1"><label style="font-size:11px;font-weight:600;color:#6b7280;display:block;margin-bottom:3px">Pay Period</label><input id="ep-period" value="${p.pay_period||''}" placeholder="YYYY-MM" style="width:100%;padding:6px 10px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;font-family:var(--font)"></div>
      </div>
      <div><label style="font-size:11px;font-weight:600;color:#6b7280;display:block;margin-bottom:3px">Notes</label><input id="ep-notes" value="${p.notes||''}" style="width:100%;padding:6px 10px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;font-family:var(--font)"></div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button class="btn btn-primary" style="flex:1" onclick="payrollSavePaymentEdit('${paymentId}')">Save</button>
        <button class="btn btn-ghost" onclick="document.getElementById('payroll-edit-modal').remove()">Cancel</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(overlay);
};

window.payrollSavePaymentEdit = async (paymentId) => {
  const updates = {
    employee_name: document.getElementById('ep-name')?.value,
    total: parseFloat(document.getElementById('ep-total')?.value || '0'),
    subtotal: parseFloat(document.getElementById('ep-total')?.value || '0'),
    payment_date: document.getElementById('ep-date')?.value,
    status: document.getElementById('ep-status')?.value,
    pay_period: document.getElementById('ep-period')?.value || null,
    notes: document.getElementById('ep-notes')?.value || null,
  };
  try {
    await supabase.from('employee_payments').update(updates).eq('id', paymentId);
    document.getElementById('payroll-edit-modal')?.remove();
    _paymentsLoaded = false;
    showToast('Payment updated', 'success');
    loadPayrollHistory();
    render();
  } catch (e) {
    showToast('Update failed: ' + e.message, 'error');
  }
};

window.payrollDeletePayment = async (paymentId) => {
  if (!confirm('Delete this payment record? This cannot be undone.')) return;
  try {
    await supabase.from('employee_payments').delete().eq('id', paymentId);
    _paymentsLoaded = false;
    showToast('Payment deleted', 'success');
    loadPayrollHistory();
    render();
  } catch (e) {
    showToast('Delete failed: ' + e.message, 'error');
  }
};

window.payrollSetBaseMode = (empId, mode, amount, note) => {
  state['_payrollBaseOnly_' + empId] = mode;
  const amtEl = document.getElementById('payroll-amt-' + empId);
  const noteEl = document.getElementById('payroll-note-' + empId);
  if (amtEl) amtEl.value = amount;
  if (noteEl) noteEl.value = note;
};
window.payrollSetMonth = (m) => { state._payrollMonth = m; render(); };
window.payrollSetYear = (y) => { state._payrollYear = y; render(); };

window.payrollAddEmployee = () => showEmployeeModal(null);
window.payrollEditEmployee = (id) => {
  const emp = _employees.find(e => e.id === id);
  if (emp) showEmployeeModal(emp);
};

window.payrollTogglePayFields = () => {
  const type = document.getElementById('emp-pay-type')?.value;
  const commFields = document.getElementById('emp-commission-fields');
  const salFields = document.getElementById('emp-salary-fields');
  if (commFields) commFields.style.display = type === 'commission' ? '' : 'none';
  if (salFields) salFields.style.display = type === 'salary' ? '' : 'none';
};

window.payrollToggleCommissionSource = () => {
  const src = document.getElementById('emp-commission-source')?.value;
  const leadFields = document.getElementById('emp-lead-tracker-fields');
  const demoFields = document.getElementById('emp-demo-tracker-fields');
  if (leadFields) leadFields.style.display = src === 'demo_tracker' ? 'none' : '';
  if (demoFields) demoFields.style.display = src === 'demo_tracker' ? '' : 'none';
};

window.payrollSaveEmployee = async (id) => {
  const fields = {
    name: document.getElementById('emp-name')?.value?.trim(),
    role: document.getElementById('emp-role')?.value?.trim() || '',
    pay_type: document.getElementById('emp-pay-type')?.value || 'commission',
    base_pay: parseFloat(document.getElementById('emp-base-pay')?.value || '0'),
    per_lead: parseFloat(document.getElementById('emp-per-lead')?.value || '0'),
    monthly_salary: parseFloat(document.getElementById('emp-monthly-salary')?.value || '0'),
    paypal_email: document.getElementById('emp-paypal')?.value?.trim() || '',
    commission_source: document.getElementById('emp-commission-source')?.value || 'lead_tracker',
    notes: document.getElementById('emp-notes')?.value?.trim() || '',
    updated_at: new Date().toISOString(),
  };
  if (!fields.name) { showToast('Name is required', 'error'); return; }

  try {
    let result;
    if (id) {
      result = await supabase.from('employees').update(fields).eq('id', id);
    } else {
      fields.status = 'active';
      result = await supabase.from('employees').insert(fields);
    }
    if (result.error) throw new Error(result.error.message);
    document.getElementById('payroll-emp-modal')?.remove();
    _employeesLoaded = false;
    showToast(id ? 'Employee updated' : 'Employee added', 'success');
    render();
  } catch (err) {
    showToast(`Save failed: ${err.message}`, 'error');
  }
};

window.payrollDeactivateEmployee = async (id) => {
  const emp = _employees.find(e => e.id === id);
  if (!emp || !confirm(`Deactivate ${emp.name}?`)) return;
  try {
    const { error } = await supabase.from('employees').update({ status: 'inactive', updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
    document.getElementById('payroll-emp-modal')?.remove();
    _employeesLoaded = false;
    showToast(`${emp.name} deactivated`, 'success');
    render();
  } catch (err) {
    showToast(`Failed: ${err.message}`, 'error');
  }
};

window.payrollSend = async (id) => {
  const emp = _employees.find(e => e.id === id);
  if (!emp) return;
  const amount = parseFloat(document.getElementById(`payroll-amt-${id}`)?.value || '0');
  const note = document.getElementById(`payroll-note-${id}`)?.value || '';
  if (!amount || amount <= 0) { showToast('Enter a valid amount', 'error'); return; }

  const btn = document.getElementById(`payroll-btn-${id}`);
  const sendViaPayPal = !!emp.paypal_email;

  if (!confirm(`${sendViaPayPal ? 'Send' : 'Record'} $${amount.toFixed(2)} to ${emp.name}${sendViaPayPal ? ` (${emp.paypal_email})` : ''}?`)) return;

  btn.disabled = true;
  btn.textContent = 'Creating record...';

  try {
    const month = state._payrollMonth;
    const year = state._payrollYear;
    const isDemo = emp.commission_source === 'demo_tracker';
    const leads = (emp.pay_type === 'commission' && !isDemo) ? getLeadsForMonth(month, year) : null;
    const demos = isDemo ? getDemoEntriesForMonth(month, year) : null;
    const empLabel = emp.name + (isDemo ? ' (SDR)' : '');

    const payPeriod = `${year}-${String(month).padStart(2,'0')}`;
    const createResp = await invokeEdgeFunction('paypal-payout', {
      action: 'create',
      employee_name: empLabel,
      base_amount: emp.pay_type === 'salary' ? Number(emp.monthly_salary) : isDemo ? 0 : Number(emp.base_pay) * 2,
      booked_meetings: isDemo ? demos?.qualified?.length : leads?.good?.length || null,
      rate_per_meeting: isDemo ? null : (emp.pay_type === 'commission' ? Number(emp.per_lead) : null),
      subtotal: amount,
      total: amount,
      payment_date: new Date().toISOString().split('T')[0],
      payment_method: sendViaPayPal ? 'AH paypal' : 'Manual',
      notes: note,
      pay_period: payPeriod,
    });
    if (!createResp.ok) throw new Error(createResp.error);

    if (sendViaPayPal) {
      btn.textContent = 'Sending via PayPal...';
      const sendResp = await invokeEdgeFunction('paypal-payout', {
        action: 'send',
        paymentId: createResp.payment.id,
        recipientEmail: emp.paypal_email,
        amount: amount.toFixed(2),
        note: note || `THT Payment - ${emp.name}`,
      });
      if (!sendResp.ok) throw new Error(sendResp.error);
      showToast(`$${amount.toFixed(2)} sent to ${emp.paypal_email}`, 'success');
    } else {
      showToast(`$${amount.toFixed(2)} recorded for ${emp.name}`, 'success');
    }

    btn.textContent = sendViaPayPal ? 'Sent ✓' : 'Recorded ✓';
    btn.style.background = '#059669';
    _paymentsLoaded = false;
    setTimeout(() => render(), 1500);
  } catch (err) {
    showToast(`Payment failed: ${err.message}`, 'error');
    btn.disabled = false;
    btn.textContent = emp.paypal_email ? 'Send via PayPal' : 'Record Payment';
  }
};

window.payrollRecord = async (id) => {
  const emp = _employees.find(e => e.id === id);
  if (!emp) return;
  const amount = parseFloat(document.getElementById(`payroll-amt-${id}`)?.value || '0');
  const note = document.getElementById(`payroll-note-${id}`)?.value || '';
  if (!amount || amount <= 0) { showToast('Enter a valid amount', 'error'); return; }
  if (!confirm(`Record $${amount.toFixed(2)} for ${emp.name} (no PayPal send)?`)) return;

  try {
    const month = state._payrollMonth;
    const year = state._payrollYear;
    const isDemo = emp.commission_source === 'demo_tracker';
    const leads = (emp.pay_type === 'commission' && !isDemo) ? getLeadsForMonth(month, year) : null;
    const demos = isDemo ? getDemoEntriesForMonth(month, year) : null;
    const empLabel = emp.name + (isDemo ? ' (SDR)' : '');

    const payPeriod = `${year}-${String(month).padStart(2,'0')}`;
    const createResp = await invokeEdgeFunction('paypal-payout', {
      action: 'create',
      employee_name: empLabel,
      base_amount: isDemo ? 0 : Number(emp.base_pay) * 2,
      booked_meetings: isDemo ? demos?.qualified?.length : leads?.good?.length || null,
      rate_per_meeting: isDemo ? null : Number(emp.per_lead),
      subtotal: amount,
      total: amount,
      payment_date: new Date().toISOString().split('T')[0],
      payment_method: 'Combined (PayPal)',
      notes: note + ' (included in combined payment)',
      pay_period: payPeriod,
    });
    if (!createResp.ok) throw new Error(createResp.error);
    showToast(`$${amount.toFixed(2)} recorded for ${emp.name}`, 'success');
    _paymentsLoaded = false;
    setTimeout(() => render(), 1500);
  } catch (err) {
    showToast(`Record failed: ${err.message}`, 'error');
  }
};
