// ═══════════════════════════════════════════════════════════
// INVOICE — Stripe invoice generation from Lead Tracker
// ═══════════════════════════════════════════════════════════
import { state, pendingWrites } from './app.js?v=20260623a';
import { invokeEdgeFunction } from './api.js?v=20260623a';
import { esc, str } from './utils.js?v=20260623a';
import { render } from './render.js?v=20260623a';

// ─── Month helpers ───
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function getCurrentMonth() {
  const d = new Date();
  return `${MONTHS[d.getMonth()]}/${String(d.getFullYear()).slice(-2)}`;
}

function getAvailableMonths() {
  const months = new Set();
  for (const e of state.trackerEntries) {
    const bm = billingMonth(e);
    if (bm) months.add(bm);
  }
  return [...months].sort((a, b) => parseMonth(a) - parseMonth(b));
}

function parseMonth(m) {
  const parts = m.split('/');
  if (parts.length !== 2) return 0;
  const mi = MONTHS.indexOf(parts[0]);
  let y = parseInt(parts[1], 10);
  if (y < 100) y += 2000;
  return y * 100 + (mi >= 0 ? mi : 0);
}

function formatMonthDisplay(m) {
  const parts = m.split('/');
  if (parts.length !== 2) return m;
  let y = parseInt(parts[1], 10);
  if (y < 100) y += 2000;
  return `${parts[0]} ${y}`;
}

// ─── Billing month: appointment month if set, otherwise push month ───
function billingMonth(entry) {
  const appt = str(entry.apptDate || entry.appt_date).trim();
  if (appt) {
    const parts = appt.split('/');
    if (parts.length >= 2) {
      const mi = parseInt(parts[0], 10) - 1;
      let y = parseInt(parts.length >= 3 ? parts[2] : parts[1], 10);
      if (y < 100) y += 2000;
      if (mi >= 0 && mi < 12) return `${MONTHS[mi]}/${String(y).slice(-2)}`;
    }
  }
  return str(entry.month).trim();
}

// ─── Get billable entries for a client/month ───
function getBillableEntries(client, month) {
  return state.trackerEntries.filter(e =>
    str(e.clientName) === client &&
    billingMonth(e) === month &&
    str(e.callbackStatus).toLowerCase() !== 'called back' &&
    !str(e.stripeInvoiceId)
  );
}

function getExistingInvoices(client, month) {
  const byInvoice = {};
  for (const e of state.trackerEntries) {
    if (str(e.clientName) !== client || billingMonth(e) !== month || !str(e.stripeInvoiceId)) continue;
    const invId = str(e.stripeInvoiceId);
    if (!byInvoice[invId]) byInvoice[invId] = { invoiceId: invId, entries: [], paidStatus: '' };
    byInvoice[invId].entries.push(e);
    if (str(e.paidStatus)) byInvoice[invId].paidStatus = str(e.paidStatus);
  }
  return Object.values(byInvoice);
}

// ─── Parse lead cost to cents ───
function parseCostCents(costStr) {
  const n = parseFloat(str(costStr).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : Math.round(n * 100);
}

function formatDollars(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function getClientPaymentTerms(clientName) {
  const client = state.clients.find(c => str(c.name) === clientName);
  return str(client?.paymentTerms) || 'Net 7';
}

// ─── Timeline stepper ───
const TIMELINE_STEPS = [
  { key: 'draft', label: 'Draft' },
  { key: 'finalized', label: 'Finalized' },
  { key: 'emailed', label: 'Emailed' },
];

function getTimelineState(step) {
  if (step === 'done' || step === 'sending') return { draft: 'done', finalized: 'pending', emailed: 'pending' };
  if (step === 'finalizing') return { draft: 'done', finalized: 'active', emailed: 'pending' };
  if (step === 'emailPreview' || step === 'emailSending') return { draft: 'done', finalized: 'done', emailed: 'active' };
  if (step === 'emailSent') return { draft: 'done', finalized: 'done', emailed: 'done' };
  return null;
}

function renderTimeline(step) {
  const ts = getTimelineState(step);
  if (!ts) return '';
  return `<div style="display:flex;align-items:center;justify-content:center;gap:0;margin:0 0 16px;padding:12px 16px">
    ${TIMELINE_STEPS.map((s, i) => {
      const status = ts[s.key];
      const color = status === 'done' ? '#059669' : status === 'active' ? '#4f46e5' : '#d1d5db';
      const bg = status === 'done' ? '#ecfdf5' : status === 'active' ? '#eef2ff' : '#f9fafb';
      const icon = status === 'done' ? '✓' : String(i + 1);
      const connector = i < TIMELINE_STEPS.length - 1
        ? `<div style="flex:1;height:2px;background:${ts[TIMELINE_STEPS[i + 1].key] === 'pending' ? '#e5e7eb' : '#059669'};min-width:24px"></div>`
        : '';
      return `<div style="display:flex;align-items:center;gap:6px">
        <div style="width:24px;height:24px;border-radius:50%;background:${bg};border:2px solid ${color};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:${color}">${icon}</div>
        <span style="font-size:11px;font-weight:600;color:${color}">${s.label}</span>
      </div>${connector}`;
    }).join('')}
  </div>`;
}

// ─── Render the invoice modal ───
export function renderInvoiceModal() {
  const m = state.invoiceModal;
  if (!m) return '';

  let html = `<div class="modal-overlay" onclick="closeInvoiceModal()">
    <div class="invoice-modal" onclick="event.stopPropagation()">`;

  html += renderTimeline(m.step);

  if (m.step === 'select') {
    html += renderSelectStep(m);
  } else if (m.step === 'preview') {
    html += renderPreviewStep(m);
  } else if (m.step === 'sending') {
    html += renderLoadingStep('Creating Invoice...', 'Creating draft in Stripe. This may take a moment.');
  } else if (m.step === 'done') {
    html += renderDoneStep(m);
  } else if (m.step === 'finalizing') {
    html += renderLoadingStep('Finalizing Invoice...', 'Finalizing in Stripe to generate payment link.');
  } else if (m.step === 'emailPreview') {
    html += renderEmailPreviewStep(m);
  } else if (m.step === 'emailSending') {
    html += renderLoadingStep('Sending Email...', 'Sending invoice email to client.');
  } else if (m.step === 'emailSent') {
    html += renderEmailSentStep(m);
  } else if (m.step === 'bulkSummary') {
    html += renderBulkSummaryStep(m);
  } else if (m.step === 'bulkCreating') {
    html += renderLoadingStep('Creating Invoices...', `Processing ${(m.bulkProgress || 0) + 1} of ${m.bulkIncluded.length} — ${esc(m.bulkIncluded[m.bulkProgress || 0]?.clientName || '')}...`);
  } else if (m.step === 'bulkReview') {
    html += renderBulkReviewStep(m);
  } else if (m.step === 'bulkDone') {
    html += renderBulkDoneStep(m);
  }

  html += `</div></div>`;
  return html;
}

function renderSelectStep(m) {
  const clients = [...new Set(state.trackerEntries.map(e => str(e.clientName)))].filter(Boolean).sort();
  const months = getAvailableMonths();
  const currentMonth = getCurrentMonth();

  return `
    <div class="invoice-header">
      <h3 style="margin:0;font-size:16px">Generate Invoice</h3>
      <button class="btn btn-ghost" onclick="closeInvoiceModal()" style="padding:4px 8px">✕</button>
    </div>
    <div class="invoice-body">
      <label style="display:block;margin-bottom:12px">
        <span style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Client</span>
        <select id="invoice-client" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
          <option value="">Select client...</option>
          ${clients.map(c => `<option value="${esc(c)}" ${m.client === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
      </label>
      <label style="display:block;margin-bottom:20px">
        <span style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">Month</span>
        <select id="invoice-month" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
          ${months.map(mo => `<option value="${esc(mo)}" ${(m.month || currentMonth) === mo ? 'selected' : ''}>${esc(mo)}</option>`).join('')}
        </select>
      </label>
      <button class="btn btn-primary" style="width:100%" onclick="invoicePreview()">Next — Preview Line Items</button>
      <div style="text-align:center;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
        <button class="btn btn-ghost" style="width:100%;font-weight:600" onclick="invoiceBulkStart()">⚡ Bill All Clients</button>
      </div>
    </div>`;
}

function renderExistingInvoiceCard(inv) {
  const status = inv.paidStatus.toLowerCase();
  const total = inv.entries.reduce((s, e) => s + parseCostCents(e.leadCost), 0);
  const statusColor = status === 'paid' ? '#059669' : status === 'sent' ? '#4f46e5' : '#d97706';
  const statusLabel = status === 'paid' ? 'Paid' : status === 'sent' ? 'Finalized' : 'Draft';

  let leadList = inv.entries.map(e =>
    `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px">
      <span>${esc(str(e.leadName))}</span>
      <span style="color:var(--text-muted)">${formatDollars(parseCostCents(e.leadCost))}</span>
    </div>`
  ).join('');

  let actions = '';
  if (status === 'draft') {
    actions = `<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="invoiceResumeFlow('${inv.invoiceId}','finalize')">Finalize & Send Email</button>`;
  } else if (status === 'sent') {
    actions = `<div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn btn-primary" style="flex:2" onclick="invoiceResumeFlow('${inv.invoiceId}','email')">Send Email</button>
      <button class="btn btn-ghost" style="flex:1;color:#dc2626;border-color:#dc2626" onclick="invoiceVoid('${inv.invoiceId}')">Void</button>
    </div>`;
  } else if (status === 'paid') {
    actions = `<div style="text-align:center;padding:8px;color:#059669;font-size:12px;font-weight:600">Paid — No actions available</div>`;
  }

  return `<div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:12px;background:#fafafa">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <span style="font-size:12px;font-weight:600">${inv.entries.length} lead${inv.entries.length !== 1 ? 's' : ''} — ${formatDollars(total)}</span>
      <span style="font-size:11px;font-weight:600;color:${statusColor};background:${statusColor}15;padding:2px 8px;border-radius:4px">${statusLabel}</span>
    </div>
    ${leadList}
    <div style="margin-top:6px">
      <a href="https://dashboard.stripe.com/invoices/${encodeURIComponent(inv.invoiceId)}" target="_blank" style="font-size:11px;color:var(--purple)">View in Stripe ↗</a>
    </div>
    ${actions}
  </div>`;
}

function getSetupFeeInfo(clientName) {
  const c = state.clients.find(cl => str(cl.name) === clientName);
  if (!c) return null;
  const total = Number(c.setupFeeTotal || 0);
  const deposit = Number(c.setupFeeDeposit || 0);
  const spread = Number(c.setupFeeSpreadCount || 0);
  const billed = Number(c.setupFeeLeadsBilled || 0);
  if (!spread || billed >= spread) return null;
  const remaining = total - deposit;
  const perLead = Math.round(remaining / spread * 100);
  return { perLead, left: spread - billed };
}

function getEffectiveCost(entry, surchargeInfo, surchargeIndex) {
  const base = parseCostCents(entry.leadCost);
  if (!surchargeInfo || surchargeIndex >= surchargeInfo.left) return base;
  const isCalledBack = str(entry.callbackStatus).toLowerCase() === 'called back';
  if (isCalledBack) return base;
  return base + surchargeInfo.perLead;
}

function getAllBillableClients(month) {
  const clientMap = {};
  for (const e of state.trackerEntries) {
    const name = str(e.clientName);
    if (!name || billingMonth(e) !== month) continue;
    if (str(e.callbackStatus).toLowerCase() === 'called back') continue;
    if (str(e.stripeInvoiceId)) continue;
    const client = state.clients.find(c => str(c.name) === name);
    if (!client || !client.leadCost) continue;
    if (!clientMap[name]) clientMap[name] = [];
    clientMap[name].push(e);
  }
  return Object.entries(clientMap).map(([name, entries]) => {
    const surchargeInfo = getSetupFeeInfo(name);
    let idx = 0, total = 0;
    for (const e of entries) {
      total += getEffectiveCost(e, surchargeInfo, idx);
      if (surchargeInfo && idx < surchargeInfo.left) idx++;
    }
    return { clientName: name, entries, total };
  }).filter(c => c.entries.length > 0).sort((a, b) => a.clientName.localeCompare(b.clientName));
}

function renderPreviewStep(m) {
  const entries = m.entries;
  const excluded = m.excluded;
  const surchargeInfo = getSetupFeeInfo(m.client);
  let surchargeIdx = 0;
  const entryCosts = entries.map(e => {
    const isIncluded = !excluded.has(e.id);
    const isCalledBack = str(e.callbackStatus).toLowerCase() === 'called back';
    const cost = getEffectiveCost(e, surchargeInfo, surchargeIdx);
    if (isIncluded && surchargeInfo && !isCalledBack && surchargeIdx < surchargeInfo.left) surchargeIdx++;
    return cost;
  });
  const included = entries.filter(e => !excluded.has(e.id));
  const subtotal = entries.reduce((sum, e, i) => sum + (excluded.has(e.id) ? 0 : entryCosts[i]), 0);
  const existing = getExistingInvoices(m.client, m.month);

  let existingHtml = '';
  if (existing.length) {
    existingHtml = `<div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:8px">EXISTING INVOICES</div>
      ${existing.map(inv => renderExistingInvoiceCard(inv)).join('')}
    </div>`;
  }

  let rows = '';
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const checked = !excluded.has(e.id);
    const cost = entryCosts[i];
    const baseCost = parseCostCents(e.leadCost);
    const hasSurcharge = cost > baseCost;
    rows += `<tr style="${checked ? '' : 'opacity:0.4;text-decoration:line-through'}">
      <td style="padding:6px 8px"><input type="checkbox" ${checked ? 'checked' : ''} onchange="invoiceToggleEntry('${e.id}')"></td>
      <td style="padding:6px 8px">${esc(str(e.leadName))}</td>
      <td style="padding:6px 8px;font-size:11px;color:var(--text-muted)">${esc(str(e.leadEmail))}</td>
      <td style="padding:6px 8px;text-align:right">${formatDollars(cost)}${hasSurcharge ? `<div style="font-size:10px;color:#4f46e5">incl. ${formatDollars(cost - baseCost)} setup</div>` : ''}</td>
    </tr>`;
  }

  const newLeadsSection = entries.length === 0
    ? (existing.length ? '' : '<div style="text-align:center;padding:20px;color:var(--text-muted)">No billable leads found for this client/month.</div>')
    : `<div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:8px">${existing.length ? 'NEW UNBILLED LEADS' : ''}</div>
      <div style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;margin-bottom:12px">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:#f8fafc;position:sticky;top:0">
            <th style="padding:6px 8px;width:30px"></th>
            <th style="padding:6px 8px;text-align:left">Lead Name</th>
            <th style="padding:6px 8px;text-align:left">Email</th>
            <th style="padding:6px 8px;text-align:right">Unit Price</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="border-top:1px solid var(--border);padding-top:12px;font-size:13px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="color:var(--text-muted)">Memo</span>
          <span>Lead generation services — ${esc(formatMonthDisplay(m.month))}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="color:var(--text-muted)">Payment Terms</span>
          <span>${esc(getClientPaymentTerms(m.client))}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-weight:700;font-size:15px;margin-top:8px">
          <span>Total</span>
          <span>${formatDollars(subtotal)}</span>
        </div>
      </div>
      <button class="btn btn-primary" style="width:100%;margin-top:16px" onclick="invoiceCreateDraft()" ${included.length === 0 ? 'disabled' : ''}>
        Create Draft Invoice (${formatDollars(subtotal)})
      </button>`;

  return `
    <div class="invoice-header">
      <h3 style="margin:0;font-size:16px">Invoice Preview — ${esc(m.client)}</h3>
      <button class="btn btn-ghost" onclick="closeInvoiceModal()" style="padding:4px 8px">✕</button>
    </div>
    <div class="invoice-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:12px;color:var(--text-muted)">${esc(m.month)}</span>
        <button class="btn btn-ghost" style="font-size:11px;padding:2px 8px" onclick="invoiceBack()">← Back</button>
      </div>
      ${existingHtml}
      ${newLeadsSection}
    </div>`;
}

function renderLoadingStep(title, subtitle) {
  return `<div style="text-align:center;padding:40px">
    <div style="font-size:16px;font-weight:600;margin-bottom:12px">${title}</div>
    <div style="color:var(--text-muted);font-size:13px">${subtitle}</div>
  </div>`;
}

function getClientInfo(clientName) {
  const client = state.clients.find(c => str(c.name).toLowerCase() === clientName.toLowerCase());
  return {
    firstName: str(client?.contactFirstName) || clientName,
    email: str(client?.notifyEmail) || '',
    invoiceEmails: str(client?.invoiceEmails) || str(client?.notifyEmail) || '',
    paymentTerms: str(client?.paymentTerms) || 'Net 7',
  };
}

function renderDoneStep(m) {
  const r = m.result;
  return `
    <div class="invoice-header">
      <h3 style="margin:0;font-size:16px;color:#059669">Draft Created</h3>
      <button class="btn btn-ghost" onclick="closeInvoiceModal()" style="padding:4px 8px">✕</button>
    </div>
    <div class="invoice-body" style="text-align:center">
      <div style="font-size:40px;margin:12px 0">✓</div>
      <div style="font-size:14px;font-weight:600;margin-bottom:4px">Draft invoice created</div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px">${r.lineItems} line items for ${esc(m.client)} — ${esc(r.paymentTerms || 'Net 7')}</div>
      <a href="https://dashboard.stripe.com/invoices/${encodeURIComponent(r.invoiceId)}" target="_blank" class="btn btn-ghost" style="margin-bottom:8px;display:inline-flex;align-items:center;gap:4px">
        Review in Stripe ↗
      </a>
      <br>
      <button class="btn btn-primary" style="margin-top:8px;width:100%" onclick="invoiceFinalizeAndEmail()">Finalize & Send Email</button>
      <button class="btn btn-ghost" style="margin-top:6px;width:100%" onclick="closeInvoiceModal()">Skip — Done</button>
    </div>`;
}

function hasMultipleContacts(clientName) {
  const extras = ['Dallas Land Care', 'Canopy Land Solutions'];
  return extras.some(e => e.toLowerCase() === clientName.toLowerCase());
}

function renderEmailPreviewStep(m) {
  const info = getClientInfo(m.client);
  const leadCount = m.entries.filter(e => !m.excluded.has(e.id)).length;
  const leadWord = leadCount === 1 ? 'lead' : 'leads';
  const greeting = hasMultipleContacts(m.client) ? 'team' : (info.firstName || 'team');

  const defaultBody = `Hey ${greeting},\n\nInvoice for ${formatMonthDisplay(m.month)} is attached below.\n\nLooking forward to keeping the momentum going.`;
  if (!m._emailInit) {
    m.emailTo = info.invoiceEmails;
    m.emailCc = 'lars@theheadlinetheory.com';
    m.emailBody = defaultBody;
    m._emailInit = true;
  }
  const toValue = m.emailTo;
  const ccValue = m.emailCc;
  const bodyValue = m.emailBody;
  const toEmails = toValue.split(',').map(e => e.trim()).filter(Boolean);
  const ccEmails = ccValue.split(',').map(e => e.trim()).filter(Boolean);
  const chipStyle = 'display:inline-flex;align-items:center;gap:3px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:4px;padding:2px 6px 2px 8px;font-size:11px;color:#4338ca';
  const xBtn = (field, email) => `<span onclick="invoiceRemoveEmail('${field}','${esc(email)}')" style="cursor:pointer;font-size:13px;color:#6366f1;font-weight:700;line-height:1">&times;</span>`;

  return `
    <div class="invoice-header">
      <h3 style="margin:0;font-size:16px">Email Preview</h3>
      <button class="btn btn-ghost" onclick="closeInvoiceModal()" style="padding:4px 8px">✕</button>
    </div>
    <div class="invoice-body">
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;border:1px solid var(--border);border-radius:6px;padding:10px">
        <div style="margin-bottom:4px"><strong>From:</strong> aidan@theheadlinetheory.com</div>
        <div style="margin-bottom:6px">
          <strong>To:</strong>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:3px">
            ${toEmails.map(e => `<span style="${chipStyle}">${esc(e)} ${xBtn('to', e)}</span>`).join('')}
            <input id="invoice-add-to" type="text" placeholder="+ add" onkeydown="if(event.key==='Enter'){event.preventDefault();invoiceAddEmail('to')}"
              style="width:100px;padding:2px 6px;border:1px solid var(--border);border-radius:4px;font-size:11px;font-family:var(--font);background:var(--card);color:var(--text)">
          </div>
        </div>
        <div style="margin-bottom:6px">
          <strong>CC:</strong>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:3px">
            ${ccEmails.map(e => `<span style="${chipStyle}">${esc(e)} ${xBtn('cc', e)}</span>`).join('')}
            <input id="invoice-add-cc" type="text" placeholder="+ add" onkeydown="if(event.key==='Enter'){event.preventDefault();invoiceAddEmail('cc')}"
              style="width:100px;padding:2px 6px;border:1px solid var(--border);border-radius:4px;font-size:11px;font-family:var(--font);background:var(--card);color:var(--text)">
          </div>
        </div>
        <div><strong>Subject:</strong> Invoice - Lead Generation Services - ${esc(formatMonthDisplay(m.month))}</div>
      </div>
      <textarea id="invoice-email-body" style="width:100%;min-height:140px;border:1px solid var(--border);border-radius:6px 6px 0 0;padding:12px;font-size:13px;line-height:1.6;font-family:var(--font);resize:vertical;border-bottom:none">${esc(bodyValue)}</textarea>
      <div style="border:1px solid var(--border);border-top:1px dashed var(--border);border-radius:0 0 6px 6px;padding:16px;background:#fafafa;font-size:13px;line-height:1.6">
        <div style="text-align:center;margin:0 0 16px">
          <span style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 28px;border-radius:6px;font-weight:600;font-size:13px">View & Pay Invoice</span>
        </div>
        <div style="margin-top:12px;font-size:13px">Best,</div>
        <table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,sans-serif;color:#131820;margin-top:8px">
          <tr>
            <td style="padding-right:12px;text-align:center;vertical-align:middle">
              <img src="https://theheadlinetheory.com/assets/logo-Dt8p9qSb.png" width="80" alt="THT" style="display:block">
            </td>
            <td style="border-left:1px solid #67717d;padding:0"> </td>
            <td style="padding-left:12px;vertical-align:middle">
              <div style="font-size:15px;font-weight:bold">Aidan Hutchinson</div>
              <div style="font-size:12px;font-weight:bold;color:#1e8c4e;margin-bottom:4px">Co-Founder</div>
              <div style="font-size:11px;line-height:1.5">(415) 578-8464<br>aidan@theheadlinetheory.com<br>theheadlinetheory.com</div>
            </td>
          </tr>
        </table>
      </div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn btn-ghost" style="flex:1" onclick="invoiceBackToDone()">← Back</button>
        <button class="btn btn-primary" style="flex:2" onclick="invoiceSendEmail()">Send Email</button>
      </div>
    </div>`;
}

function renderEmailSentStep(m) {
  return `
    <div class="invoice-header">
      <h3 style="margin:0;font-size:16px;color:#059669">Invoice Sent</h3>
      <button class="btn btn-ghost" onclick="closeInvoiceModal()" style="padding:4px 8px">✕</button>
    </div>
    <div class="invoice-body" style="text-align:center">
      <div style="font-size:40px;margin:12px 0">✉️</div>
      <div style="font-size:14px;font-weight:600;margin-bottom:4px">Invoice email sent</div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px">Sent to ${esc(m.emailSentTo || '')} from aidan@theheadlinetheory.com</div>
      <a href="https://dashboard.stripe.com/invoices/${encodeURIComponent(m.result?.invoiceId || '')}" target="_blank" class="btn btn-ghost" style="margin-bottom:8px;display:inline-flex;align-items:center;gap:4px">
        View in Stripe ↗
      </a>
      <div style="display:flex;gap:8px;margin-top:12px;justify-content:center">
        <button class="btn btn-ghost" onclick="invoiceSendAgain()">Send Again</button>
        <button class="btn btn-primary" onclick="closeInvoiceModal()">Done</button>
      </div>
    </div>`;
}

// ─── Bulk invoice rendering ───
function renderBulkSummaryStep(m) {
  const clients = m.bulkClients;
  const excluded = m.bulkExcluded;
  const included = clients.filter(c => !excluded.has(c.clientName));
  const grandTotal = included.reduce((sum, c) => sum + c.total, 0);
  const totalLeads = included.reduce((sum, c) => sum + c.entries.length, 0);

  const rows = clients.map(c => {
    const checked = !excluded.has(c.clientName);
    const surcharge = getSetupFeeInfo(c.clientName);
    const terms = getClientPaymentTerms(c.clientName);
    return `<tr style="${checked ? '' : 'opacity:0.35'}">
      <td style="padding:6px 8px"><input type="checkbox" ${checked ? 'checked' : ''} onchange="invoiceBulkToggle('${esc(c.clientName)}')"></td>
      <td style="padding:6px 8px;font-weight:500;font-size:13px">${esc(c.clientName)}</td>
      <td style="padding:6px 8px;text-align:center">${c.entries.length}</td>
      <td style="padding:6px 8px;text-align:right;font-size:12px;color:var(--text-muted)">${terms}</td>
      <td style="padding:6px 8px;text-align:right;font-weight:600">${formatDollars(c.total)}${surcharge ? '<div style="font-size:10px;color:#4f46e5">+setup</div>' : ''}</td>
    </tr>`;
  }).join('');

  return `
    <div class="invoice-header">
      <h3 style="margin:0;font-size:16px">Bulk Invoice — ${esc(formatMonthDisplay(m.month))}</h3>
      <button class="btn btn-ghost" onclick="closeInvoiceModal()" style="padding:4px 8px">✕</button>
    </div>
    <div class="invoice-body">
      ${!clients.length ? '<div style="text-align:center;padding:24px;color:var(--text-muted)">No unbilled leads for this month.</div>' : `
      <div style="max-height:400px;overflow-y:auto">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="border-bottom:2px solid var(--border);position:sticky;top:0;background:var(--card)">
          <th style="padding:6px 8px;width:30px"><input type="checkbox" ${excluded.size === 0 ? 'checked' : ''} onchange="invoiceBulkToggleAll()"></th>
          <th style="padding:6px 8px;text-align:left;font-size:11px;color:var(--text-muted)">CLIENT</th>
          <th style="padding:6px 8px;text-align:center;font-size:11px;color:var(--text-muted)">LEADS</th>
          <th style="padding:6px 8px;text-align:right;font-size:11px;color:var(--text-muted)">TERMS</th>
          <th style="padding:6px 8px;text-align:right;font-size:11px;color:var(--text-muted)">TOTAL</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr style="border-top:2px solid var(--border);font-weight:700">
          <td></td>
          <td style="padding:8px">${included.length} client${included.length !== 1 ? 's' : ''}</td>
          <td style="padding:8px;text-align:center">${totalLeads}</td>
          <td></td>
          <td style="padding:8px;text-align:right">${formatDollars(grandTotal)}</td>
        </tr></tfoot>
      </table>
      </div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn btn-ghost" style="flex:1" onclick="invoiceBack()">← Back</button>
        <button class="btn btn-primary" style="flex:2" onclick="invoiceBulkCreateAll()" ${!included.length ? 'disabled' : ''}>Create ${included.length} Draft${included.length !== 1 ? 's' : ''} & Send</button>
      </div>`}
    </div>`;
}

function renderBulkReviewStep(m) {
  const idx = m.bulkReviewIndex;
  const results = m.bulkResults.filter(r => !r.error);
  if (idx >= results.length) return '';
  const r = results[idx];
  const info = getClientInfo(r.clientName);
  const greeting = hasMultipleContacts(r.clientName) ? 'team' : (info.firstName || 'team');
  const defaultBody = `Hey ${greeting},\n\nInvoice for ${formatMonthDisplay(m.month)} is attached below.\n\nLooking forward to keeping the momentum going.`;

  if (!m._bulkEmailInit || m._bulkEmailClient !== r.clientName) {
    m.emailTo = info.invoiceEmails;
    m.emailCc = 'lars@theheadlinetheory.com';
    m.emailBody = defaultBody;
    m._bulkEmailInit = true;
    m._bulkEmailClient = r.clientName;
  }

  const toEmails = (m.emailTo || '').split(',').map(e => e.trim()).filter(Boolean);
  const ccEmails = (m.emailCc || '').split(',').map(e => e.trim()).filter(Boolean);
  const chipStyle = 'display:inline-flex;align-items:center;gap:3px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:4px;padding:2px 6px 2px 8px;font-size:11px;color:#4338ca';
  const xBtn = (field, email) => `<span onclick="invoiceRemoveEmail('${field}','${esc(email)}')" style="cursor:pointer;font-size:13px;color:#6366f1;font-weight:700;line-height:1">&times;</span>`;

  return `
    <div class="invoice-header">
      <h3 style="margin:0;font-size:16px">${esc(r.clientName)}</h3>
      <span style="font-size:12px;color:var(--text-muted)">${idx + 1} of ${results.length}</span>
      <button class="btn btn-ghost" onclick="closeInvoiceModal()" style="padding:4px 8px">✕</button>
    </div>
    <div class="invoice-body">
      <div style="display:flex;gap:12px;margin-bottom:12px">
        <div style="flex:1;padding:8px;background:#f0fdf4;border-radius:6px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#059669">${r.lineItems}</div>
          <div style="font-size:11px;color:var(--text-muted)">leads</div>
        </div>
        <div style="flex:1;padding:8px;background:#eef2ff;border-radius:6px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#4f46e5">${formatDollars(r.totalCents)}</div>
          <div style="font-size:11px;color:var(--text-muted)">total</div>
        </div>
        <div style="flex:1;padding:8px;background:#faf5ff;border-radius:6px;text-align:center">
          <div style="font-size:14px;font-weight:700;color:#7c3aed;margin-top:3px">${r.paymentTerms}</div>
          <div style="font-size:11px;color:var(--text-muted)">terms</div>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;border:1px solid var(--border);border-radius:6px;padding:10px">
        <div style="margin-bottom:4px"><strong>From:</strong> aidan@theheadlinetheory.com</div>
        <div style="margin-bottom:6px">
          <strong>To:</strong>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:3px">
            ${toEmails.map(e => `<span style="${chipStyle}">${esc(e)} ${xBtn('to', e)}</span>`).join('')}
            <input id="invoice-add-to" type="text" placeholder="+ add" onkeydown="if(event.key==='Enter'){event.preventDefault();invoiceAddEmail('to')}"
              style="width:100px;padding:2px 6px;border:1px solid var(--border);border-radius:4px;font-size:11px;font-family:var(--font);background:var(--card);color:var(--text)">
          </div>
        </div>
        <div style="margin-bottom:6px">
          <strong>CC:</strong>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:3px">
            ${ccEmails.map(e => `<span style="${chipStyle}">${esc(e)} ${xBtn('cc', e)}</span>`).join('')}
            <input id="invoice-add-cc" type="text" placeholder="+ add" onkeydown="if(event.key==='Enter'){event.preventDefault();invoiceAddEmail('cc')}"
              style="width:100px;padding:2px 6px;border:1px solid var(--border);border-radius:4px;font-size:11px;font-family:var(--font);background:var(--card);color:var(--text)">
          </div>
        </div>
        <div><strong>Subject:</strong> Invoice - Lead Generation Services - ${esc(formatMonthDisplay(m.month))}</div>
      </div>
      <textarea id="invoice-email-body" style="width:100%;min-height:100px;border:1px solid var(--border);border-radius:6px;padding:12px;font-size:13px;line-height:1.6;font-family:var(--font);resize:vertical">${esc(m.emailBody || '')}</textarea>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-ghost" style="flex:1" onclick="invoiceBulkSkipEmail()">Skip</button>
        <button class="btn btn-primary" style="flex:2" onclick="invoiceBulkSendEmail()">Send & Next →</button>
      </div>
      <div style="margin-top:8px;display:flex;justify-content:center">
        <div style="display:flex;gap:4px">${results.map((_, i) => `<div style="width:8px;height:8px;border-radius:50%;background:${i < idx ? '#059669' : i === idx ? '#4f46e5' : '#e5e7eb'}"></div>`).join('')}</div>
      </div>
    </div>`;
}

function renderBulkDoneStep(m) {
  const results = m.bulkResults || [];
  const created = results.filter(r => !r.error);
  const sent = results.filter(r => r.emailSent);
  const skipped = created.filter(r => !r.emailSent);
  const failed = results.filter(r => r.error);
  const grandTotal = created.reduce((sum, r) => sum + (r.totalCents || 0), 0);

  const rows = results.map(r => {
    const statusColor = r.error ? '#dc2626' : r.emailSent ? '#059669' : '#d97706';
    const statusLabel = r.error ? 'Failed' : r.emailSent ? 'Sent' : 'Draft';
    return `<tr>
      <td style="padding:6px 8px;font-size:13px">${esc(r.clientName)}</td>
      <td style="padding:6px 8px;text-align:center">${r.error ? '—' : r.lineItems}</td>
      <td style="padding:6px 8px;text-align:right">${r.error ? '—' : formatDollars(r.totalCents)}</td>
      <td style="padding:6px 8px;text-align:right"><span style="font-size:11px;font-weight:600;color:${statusColor};background:${statusColor}15;padding:2px 8px;border-radius:4px">${statusLabel}</span></td>
    </tr>`;
  }).join('');

  return `
    <div class="invoice-header">
      <h3 style="margin:0;font-size:16px;color:#059669">Billing Complete</h3>
      <button class="btn btn-ghost" onclick="closeInvoiceModal()" style="padding:4px 8px">✕</button>
    </div>
    <div class="invoice-body">
      <div style="display:flex;gap:12px;margin-bottom:16px">
        <div style="flex:1;padding:10px;background:#f0fdf4;border-radius:6px;text-align:center">
          <div style="font-size:22px;font-weight:700;color:#059669">${sent.length}</div>
          <div style="font-size:11px;color:var(--text-muted)">sent</div>
        </div>
        <div style="flex:1;padding:10px;background:#fffbeb;border-radius:6px;text-align:center">
          <div style="font-size:22px;font-weight:700;color:#d97706">${skipped.length}</div>
          <div style="font-size:11px;color:var(--text-muted)">drafts</div>
        </div>
        ${failed.length ? `<div style="flex:1;padding:10px;background:#fef2f2;border-radius:6px;text-align:center">
          <div style="font-size:22px;font-weight:700;color:#dc2626">${failed.length}</div>
          <div style="font-size:11px;color:var(--text-muted)">failed</div>
        </div>` : ''}
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        <thead><tr style="border-bottom:2px solid var(--border)">
          <th style="padding:6px 8px;text-align:left;font-size:11px;color:var(--text-muted)">CLIENT</th>
          <th style="padding:6px 8px;text-align:center;font-size:11px;color:var(--text-muted)">LEADS</th>
          <th style="padding:6px 8px;text-align:right;font-size:11px;color:var(--text-muted)">TOTAL</th>
          <th style="padding:6px 8px;text-align:right;font-size:11px;color:var(--text-muted)">STATUS</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr style="border-top:2px solid var(--border);font-weight:700">
          <td style="padding:8px">${created.length} invoices</td>
          <td style="padding:8px;text-align:center">${created.reduce((s, r) => s + r.lineItems, 0)}</td>
          <td style="padding:8px;text-align:right">${formatDollars(grandTotal)}</td>
          <td></td>
        </tr></tfoot>
      </table>
      <button class="btn btn-primary" style="width:100%" onclick="closeInvoiceModal()">Done</button>
    </div>`;
}

// ─── Window handlers ───
window.openInvoiceModal = () => {
  const prefilledClient = state.trackerFilters.client || '';
  state.invoiceModal = {
    step: 'select',
    client: prefilledClient,
    month: getCurrentMonth(),
    entries: [],
    excluded: new Set(),
    result: null,
  };
  render();
};

window.closeInvoiceModal = () => {
  state.invoiceModal = null;
  render();
};

window.invoiceBack = () => {
  if (state.invoiceModal) {
    state.invoiceModal.step = 'select';
    render();
  }
};

window.invoicePreview = () => {
  const m = state.invoiceModal;
  if (!m) return;
  const client = document.getElementById('invoice-client')?.value || '';
  const month = document.getElementById('invoice-month')?.value || '';
  if (!client) { alert('Please select a client.'); return; }
  if (!month) { alert('Please select a month.'); return; }

  m.client = client;
  m.month = month;
  m.entries = getBillableEntries(client, month);
  m.excluded = new Set();
  m.step = 'preview';
  render();
};

window.invoiceToggleEntry = (id) => {
  const m = state.invoiceModal;
  if (!m) return;
  if (m.excluded.has(id)) m.excluded.delete(id);
  else m.excluded.add(id);
  render();
};

window.invoiceCreateDraft = async () => {
  const m = state.invoiceModal;
  if (!m) return;

  const included = m.entries.filter(e => !m.excluded.has(e.id));
  if (!included.length) return;

  if (!confirm(`Create draft invoice for ${m.client} — ${included.length} leads?`)) return;

  m.step = 'sending';
  render();

  try {
    const result = await invokeEdgeFunction('create-stripe-invoice', {
      clientName: m.client,
      month: m.month,
      entryIds: included.map(e => e.id),
    });

    for (const entry of included) {
      entry.paidStatus = 'Draft';
      entry.invoice = result.invoiceId || '';
      entry.stripeInvoiceId = result.invoiceId || '';
    }

    const included2 = m.entries.filter(e => !m.excluded.has(e.id));
    m.subtotal = included2.reduce((sum, e) => sum + parseCostCents(e.leadCost), 0);
    m.step = 'done';
    m.result = result;
    render();
  } catch (e) {
    alert('Invoice creation failed: ' + e.message);
    m.step = 'preview';
    render();
  }
};

window.invoiceFinalizeAndEmail = async () => {
  const m = state.invoiceModal;
  if (!m?.result?.invoiceId) return;

  m.step = 'finalizing';
  render();

  try {
    const finalized = await invokeEdgeFunction('finalize-stripe-invoice', {
      invoiceId: m.result.invoiceId,
    });

    for (const entry of m.entries.filter(e => !m.excluded.has(e.id))) {
      entry.paidStatus = 'Sent';
    }

    m.finalized = finalized;
    m.step = 'emailPreview';
    render();
  } catch (e) {
    alert('Finalization failed: ' + e.message);
    m.step = 'done';
    render();
  }
};

window.invoiceBackToDone = () => {
  if (state.invoiceModal) {
    state.invoiceModal.step = 'done';
    render();
  }
};

window.invoiceSendAgain = () => {
  if (state.invoiceModal) {
    state.invoiceModal.step = 'emailPreview';
    render();
  }
};

window.invoiceRemoveEmail = (field, email) => {
  const m = state.invoiceModal;
  if (!m) return;
  const key = field === 'to' ? 'emailTo' : 'emailCc';
  const current = (m[key] || '').split(',').map(e => e.trim()).filter(Boolean);
  m[key] = current.filter(e => e !== email).join(', ');
  m.emailBody = document.getElementById('invoice-email-body')?.value || m.emailBody;
  render();
};

window.invoiceAddEmail = (field) => {
  const m = state.invoiceModal;
  if (!m) return;
  const input = document.getElementById(`invoice-add-${field}`);
  const val = (input?.value || '').trim();
  if (!val || !val.includes('@')) return;
  const key = field === 'to' ? 'emailTo' : 'emailCc';
  const current = (m[key] || '').split(',').map(e => e.trim()).filter(Boolean);
  if (!current.includes(val)) current.push(val);
  m[key] = current.join(', ');
  m.emailBody = document.getElementById('invoice-email-body')?.value || m.emailBody;
  render();
};

window.invoiceSendEmail = async () => {
  const m = state.invoiceModal;
  if (!m?.finalized) return;

  m.emailBody = document.getElementById('invoice-email-body')?.value || m.emailBody || '';
  const emailBody = m.emailBody;
  const emailTo = m.emailTo || '';
  const emailCc = m.emailCc || '';
  m.step = 'emailSending';
  render();

  try {
    const payload = {
      action: 'send_invoice_email',
      clientName: m.client,
      month: m.month,
      emailBody,
      paymentLink: m.finalized.hostedInvoiceUrl,
    };
    if (emailTo) payload.toOverride = emailTo;
    if (emailCc) payload.ccOverride = emailCc;

    const result = await invokeEdgeFunction('send-email', payload);

    m.emailSentTo = result.sentTo || emailTo;
    m.step = 'emailSent';
    render();
  } catch (e) {
    alert('Email send failed: ' + e.message);
    m.step = 'emailPreview';
    render();
  }
};

window.invoiceResumeFlow = async (invoiceId, action) => {
  const entries = state.trackerEntries.filter(e => str(e.stripeInvoiceId) === invoiceId);
  const m = state.invoiceModal;
  if (!m) return;

  m.entries = entries;
  m.excluded = new Set();
  m.result = { invoiceId };
  m.subtotal = entries.reduce((s, e) => s + parseCostCents(e.leadCost), 0);

  if (action === 'finalize') {
    m.step = 'finalizing';
    render();
    try {
      const finalized = await invokeEdgeFunction('finalize-stripe-invoice', { invoiceId });
      for (const e of entries) e.paidStatus = 'Sent';
      m.finalized = finalized;
      m.step = 'emailPreview';
      render();
    } catch (e) {
      alert('Finalization failed: ' + e.message);
      m.step = 'preview';
      render();
    }
  } else if (action === 'email') {
    m.step = 'finalizing';
    render();
    try {
      const finalized = await invokeEdgeFunction('finalize-stripe-invoice', { invoiceId });
      m.finalized = finalized;
      m.step = 'emailPreview';
      render();
    } catch (e) {
      alert('Failed to load invoice: ' + e.message);
      m.step = 'preview';
      render();
    }
  }
};

window.invoiceVoid = async (invoiceId) => {
  if (!confirm('Void this invoice? This cannot be undone. You will need to create a new invoice.')) return;
  const m = state.invoiceModal;

  try {
    await invokeEdgeFunction('finalize-stripe-invoice', { invoiceId, action: 'void' });
    for (const e of state.trackerEntries) {
      if (str(e.stripeInvoiceId) === invoiceId) {
        e.paidStatus = '';
        e.stripeInvoiceId = '';
        e.invoice = '';
        e.paymentLink = '';
      }
    }
    if (m) { m.step = 'preview'; m.entries = getBillableEntries(m.client, m.month); m.excluded = new Set(); }
    render();
  } catch (e) {
    alert('Void failed: ' + e.message);
  }
};

// ─── Bulk invoice handlers ───
window.invoiceBulkStart = () => {
  const m = state.invoiceModal;
  if (!m) return;
  const month = document.getElementById('invoice-month')?.value || m.month || getCurrentMonth();
  m.month = month;
  m.bulkClients = getAllBillableClients(month);
  m.bulkExcluded = new Set();
  m.step = 'bulkSummary';
  render();
};

window.invoiceBulkToggle = (clientName) => {
  const m = state.invoiceModal;
  if (!m) return;
  if (m.bulkExcluded.has(clientName)) m.bulkExcluded.delete(clientName);
  else m.bulkExcluded.add(clientName);
  render();
};

window.invoiceBulkToggleAll = () => {
  const m = state.invoiceModal;
  if (!m) return;
  if (m.bulkExcluded.size === 0) {
    m.bulkClients.forEach(c => m.bulkExcluded.add(c.clientName));
  } else {
    m.bulkExcluded.clear();
  }
  render();
};

window.invoiceBulkCreateAll = async () => {
  const m = state.invoiceModal;
  if (!m) return;
  const included = m.bulkClients.filter(c => !m.bulkExcluded.has(c.clientName));
  if (!included.length) return;
  if (!confirm(`Create and send ${included.length} invoice${included.length !== 1 ? 's' : ''}?`)) return;

  m.bulkIncluded = included;
  m.bulkResults = [];
  m.bulkProgress = 0;
  m.step = 'bulkCreating';
  render();

  for (let i = 0; i < included.length; i++) {
    m.bulkProgress = i;
    render();
    const c = included[i];
    try {
      const result = await invokeEdgeFunction('create-stripe-invoice', {
        clientName: c.clientName,
        month: m.month,
        entryIds: c.entries.map(e => e.id),
      });
      for (const entry of c.entries) {
        entry.paidStatus = 'Draft';
        entry.invoice = result.invoiceId || '';
        entry.stripeInvoiceId = result.invoiceId || '';
      }
      const finalized = await invokeEdgeFunction('finalize-stripe-invoice', {
        invoiceId: result.invoiceId,
      });
      for (const entry of c.entries) entry.paidStatus = 'Sent';
      m.bulkResults.push({
        clientName: c.clientName,
        invoiceId: result.invoiceId,
        lineItems: result.lineItems,
        totalCents: c.total,
        paymentTerms: result.paymentTerms || 'Net 7',
        hostedInvoiceUrl: finalized.hostedInvoiceUrl,
      });
    } catch (e) {
      m.bulkResults.push({ clientName: c.clientName, error: e.message });
    }
  }

  m.bulkReviewIndex = 0;
  m._bulkEmailInit = false;
  const hasSuccess = m.bulkResults.some(r => !r.error);
  m.step = hasSuccess ? 'bulkReview' : 'bulkDone';
  render();
};

window.invoiceBulkSendEmail = async () => {
  const m = state.invoiceModal;
  if (!m) return;
  const results = m.bulkResults.filter(r => !r.error);
  const r = results[m.bulkReviewIndex];
  if (!r) return;

  m.emailBody = document.getElementById('invoice-email-body')?.value || m.emailBody || '';

  try {
    const payload = {
      action: 'send_invoice_email',
      clientName: r.clientName,
      month: m.month,
      emailBody: m.emailBody,
      paymentLink: r.hostedInvoiceUrl,
    };
    if (m.emailTo) payload.toOverride = m.emailTo;
    if (m.emailCc) payload.ccOverride = m.emailCc;
    await invokeEdgeFunction('send-email', payload);
    r.emailSent = true;
  } catch (e) {
    alert(`Email failed for ${r.clientName}: ${e.message}`);
  }

  m.bulkReviewIndex++;
  m._bulkEmailInit = false;
  if (m.bulkReviewIndex >= results.length) {
    m.step = 'bulkDone';
  }
  render();
};

window.invoiceBulkSkipEmail = () => {
  const m = state.invoiceModal;
  if (!m) return;
  const results = m.bulkResults.filter(r => !r.error);
  m.bulkReviewIndex++;
  m._bulkEmailInit = false;
  if (m.bulkReviewIndex >= results.length) {
    m.step = 'bulkDone';
  }
  render();
};
