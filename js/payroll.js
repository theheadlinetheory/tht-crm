// ═══════════════════════════════════════════════════════════
// PAYROLL — Employee payment tracking & PayPal payouts
// ═══════════════════════════════════════════════════════════
import { state } from './app.js?v=20260601a';
import { invokeEdgeFunction, showToast } from './api.js?v=20260601a';
import { esc, str } from './utils.js?v=20260601a';
import { render } from './render.js?v=20260601a';

const EMPLOYEES = [
  { name: 'Ioannis', type: 'commission', basePay: 250, perLead: 27, paypalEmail: 'ioannis.serafeim@gmail.com', biweekly: true },
  { name: 'Tim', type: 'salary', monthlySalary: 1750, paypalEmail: '', biweekly: false },
];

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function parseMDY(s) {
  const parts = s.split('/');
  if (parts.length !== 3) return null;
  const m = parseInt(parts[0], 10);
  let y = parseInt(parts[2], 10);
  if (y < 100) y += 2000;
  return { m, y };
}

function getLeadCountForMonth(month, year) {
  let good = 0, total = 0;
  for (const e of state.trackerEntries) {
    const appt = str(e.apptDate);
    const added = str(e.dateAdded);
    const parsed = (appt && appt.includes('/')) ? parseMDY(appt) : parseMDY(added);
    if (!parsed || parsed.m !== month || parsed.y !== year) continue;
    total++;
    if (str(e.callbackStatus).toLowerCase() !== 'called back') good++;
  }
  return { good, total, calledBack: total - good };
}

function calcPayout(emp, month, year) {
  if (emp.type === 'salary') return { total: emp.monthlySalary, breakdown: `Fixed salary: $${emp.monthlySalary.toLocaleString()}` };
  const data = getLeadCountForMonth(month, year);
  const commission = data.good * emp.perLead;
  const base = emp.biweekly ? emp.basePay * 2 : emp.basePay;
  return { total: commission + base, commission, base, leads: data.good, calledBack: data.calledBack, breakdown: `${data.good} leads × $${emp.perLead} + base $${base}` };
}

export function renderPayroll() {
  if (!state._payrollMonth) {
    const now = new Date();
    state._payrollMonth = now.getMonth() + 1;
    state._payrollYear = now.getFullYear();
  }
  const month = state._payrollMonth;
  const year = state._payrollYear;

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
      </div>
    </div>`;

  for (const emp of EMPLOYEES) {
    const payout = calcPayout(emp, month, year);
    const hasPayPal = !!emp.paypalEmail;
    const typeLabel = emp.type === 'salary' ? 'Fixed Salary' : 'Commission';
    const typeBg = emp.type === 'salary' ? '#dbeafe' : '#f0fdf4';
    const typeColor = emp.type === 'salary' ? '#2563eb' : '#16a34a';

    html += `<div style="border:1px solid var(--border);border-radius:10px;padding:20px;margin-bottom:16px;background:var(--card)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div>
          <h3 style="margin:0;font-size:16px">${esc(emp.name)}</h3>
          <span style="font-size:11px;padding:2px 8px;border-radius:4px;background:${typeBg};color:${typeColor};font-weight:600">${typeLabel}</span>
        </div>
        <div style="text-align:right">
          <div style="font-size:24px;font-weight:700;color:#7c3aed">$${payout.total.toLocaleString()}</div>
          <div style="font-size:11px;color:var(--text-muted)">${esc(payout.breakdown)}</div>
        </div>
      </div>`;

    if (emp.type === 'commission') {
      html += `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px">
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#16a34a">${payout.leads}</div>
          <div style="font-size:10px;color:#4d7c0f">Good Leads</div>
        </div>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#dc2626">${payout.calledBack}</div>
          <div style="font-size:10px;color:#991b1b">Called Back</div>
        </div>
        <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#7c3aed">$${payout.base}</div>
          <div style="font-size:10px;color:#5b21b6">Base Pay</div>
        </div>
      </div>`;
    }

    html += `<div style="display:flex;gap:8px;align-items:end">
        <div style="flex:1">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">Amount</label>
          <input id="payroll-amt-${esc(emp.name)}" type="number" step="0.01" value="${payout.total}" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
        </div>
        <div style="flex:1">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">Note</label>
          <input id="payroll-note-${esc(emp.name)}" type="text" value="${MONTHS[month-1]} ${year}" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
        </div>
        <button id="payroll-btn-${esc(emp.name)}" class="btn btn-primary" style="white-space:nowrap" onclick="payrollSend('${esc(emp.name)}')">${hasPayPal ? 'Send via PayPal' : 'Record Payment'}</button>
      </div>
      ${!hasPayPal ? `<div style="font-size:11px;color:#d97706;margin-top:6px">PayPal not configured — payment will be recorded only, not sent.</div>` : ''}
    </div>`;
  }

  html += `<div style="border:1px solid var(--border);border-radius:10px;padding:20px;background:var(--card)">
    <h3 style="margin:0 0 12px;font-size:14px;color:var(--text-muted)">Payment History</h3>
    <div id="payroll-history" style="font-size:12px">Loading...</div>
  </div></div>`;

  return html;
}

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
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  }).catch(() => {
    const el = document.getElementById('payroll-history');
    if (el) el.innerHTML = '<div style="color:#dc2626">Failed to load.</div>';
  });
}

window.payrollSetMonth = (m) => { state._payrollMonth = m; render(); };
window.payrollSetYear = (y) => { state._payrollYear = y; render(); };

window.payrollSend = async (name) => {
  const emp = EMPLOYEES.find(e => e.name === name);
  if (!emp) return;
  const amount = parseFloat(document.getElementById(`payroll-amt-${name}`)?.value || '0');
  const note = document.getElementById(`payroll-note-${name}`)?.value || '';
  if (!amount || amount <= 0) { showToast('Enter a valid amount', 'error'); return; }

  const btn = document.getElementById(`payroll-btn-${name}`);
  const sendViaPayPal = !!emp.paypalEmail;

  if (!confirm(`${sendViaPayPal ? 'Send' : 'Record'} $${amount.toFixed(2)} to ${name}${sendViaPayPal ? ` (${emp.paypalEmail})` : ''}?`)) return;

  btn.disabled = true;
  btn.textContent = 'Creating record...';

  try {
    const month = state._payrollMonth;
    const year = state._payrollYear;
    const leads = emp.type === 'commission' ? getLeadCountForMonth(month, year) : null;

    const createResp = await invokeEdgeFunction('paypal-payout', {
      action: 'create',
      employee_name: name,
      base_amount: emp.type === 'salary' ? emp.monthlySalary : emp.basePay * 2,
      booked_meetings: leads?.good || null,
      rate_per_meeting: emp.type === 'commission' ? emp.perLead : null,
      subtotal: amount,
      total: amount,
      payment_date: new Date().toISOString().split('T')[0],
      payment_method: sendViaPayPal ? 'AH paypal' : 'Manual',
      notes: note,
    });
    if (!createResp.ok) throw new Error(createResp.error);

    if (sendViaPayPal) {
      btn.textContent = 'Sending via PayPal...';
      const sendResp = await invokeEdgeFunction('paypal-payout', {
        action: 'send',
        paymentId: createResp.payment.id,
        recipientEmail: emp.paypalEmail,
        amount: amount.toFixed(2),
        note: note || `THT Payment - ${name}`,
      });
      if (!sendResp.ok) throw new Error(sendResp.error);
      showToast(`$${amount.toFixed(2)} sent to ${emp.paypalEmail}`, 'success');
    } else {
      showToast(`$${amount.toFixed(2)} recorded for ${name}`, 'success');
    }

    btn.textContent = sendViaPayPal ? 'Sent ✓' : 'Recorded ✓';
    btn.style.background = '#059669';
    loadPayrollHistory();
  } catch (err) {
    showToast(`Payment failed: ${err.message}`, 'error');
    btn.disabled = false;
    btn.textContent = emp.paypalEmail ? 'Send via PayPal' : 'Record Payment';
  }
};
