// ═══════════════════════════════════════════════════════════
// INVOICE — Stripe invoice generation from Lead Tracker
// ═══════════════════════════════════════════════════════════
import { state, pendingWrites } from './app.js?v=20260531e';
import { invokeEdgeFunction } from './api.js?v=20260531e';
import { esc, str } from './utils.js?v=20260531e';
import { render } from './render.js?v=20260531e';

// ─── Month helpers ───
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function getCurrentMonth() {
  const d = new Date();
  return `${MONTHS[d.getMonth()]}/${String(d.getFullYear()).slice(-2)}`;
}

function getAvailableMonths() {
  const months = new Set();
  for (const e of state.trackerEntries) {
    if (str(e.month).trim()) months.add(str(e.month).trim());
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

// ─── Get billable entries for a client/month ───
function getBillableEntries(client, month) {
  return state.trackerEntries.filter(e =>
    str(e.clientName) === client &&
    str(e.month) === month &&
    str(e.callbackStatus).toLowerCase() !== 'called back' &&
    !str(e.stripeInvoiceId)
  );
}

function getExistingInvoices(client, month) {
  const byInvoice = {};
  for (const e of state.trackerEntries) {
    if (str(e.clientName) !== client || str(e.month) !== month || !str(e.stripeInvoiceId)) continue;
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

function renderPreviewStep(m) {
  const entries = m.entries;
  const excluded = m.excluded;
  const included = entries.filter(e => !excluded.has(e.id));
  const subtotal = included.reduce((sum, e) => sum + parseCostCents(e.leadCost), 0);
  const existing = getExistingInvoices(m.client, m.month);

  let existingHtml = '';
  if (existing.length) {
    existingHtml = `<div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:8px">EXISTING INVOICES</div>
      ${existing.map(inv => renderExistingInvoiceCard(inv)).join('')}
    </div>`;
  }

  let rows = '';
  for (const e of entries) {
    const checked = !excluded.has(e.id);
    const cost = parseCostCents(e.leadCost);
    rows += `<tr style="${checked ? '' : 'opacity:0.4;text-decoration:line-through'}">
      <td style="padding:6px 8px"><input type="checkbox" ${checked ? 'checked' : ''} onchange="invoiceToggleEntry('${e.id}')"></td>
      <td style="padding:6px 8px">${esc(str(e.leadName))}</td>
      <td style="padding:6px 8px;font-size:11px;color:var(--text-muted)">${esc(str(e.leadEmail))}</td>
      <td style="padding:6px 8px;text-align:right">${formatDollars(cost)}</td>
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

  const defaultBody = `Hey ${greeting},\n\nInvoice for ${formatMonthDisplay(m.month)} is attached below. ${leadCount} ${leadWord} this month.\n\nLooking forward to keeping the momentum going.`;

  return `
    <div class="invoice-header">
      <h3 style="margin:0;font-size:16px">Email Preview</h3>
      <button class="btn btn-ghost" onclick="closeInvoiceModal()" style="padding:4px 8px">✕</button>
    </div>
    <div class="invoice-body">
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;border:1px solid var(--border);border-radius:6px;padding:10px">
        <div style="margin-bottom:4px"><strong>From:</strong> aidan@theheadlinetheory.com</div>
        <div style="margin-bottom:4px"><strong>To:</strong> ${esc(info.invoiceEmails)}</div>
        <div style="margin-bottom:4px"><strong>CC:</strong> lars@theheadlinetheory.com, aidan@theheadlinetheory.com</div>
        <div><strong>Subject:</strong> Invoice - Lead Generation Services - ${esc(formatMonthDisplay(m.month))}</div>
      </div>
      <textarea id="invoice-email-body" style="width:100%;min-height:140px;border:1px solid var(--border);border-radius:6px 6px 0 0;padding:12px;font-size:13px;line-height:1.6;font-family:var(--font);resize:vertical;border-bottom:none">${esc(defaultBody)}</textarea>
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
      <br>
      <button class="btn btn-primary" style="margin-top:8px" onclick="closeInvoiceModal()">Done</button>
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

window.invoiceSendEmail = async () => {
  const m = state.invoiceModal;
  if (!m?.finalized) return;

  m.step = 'emailSending';
  render();

  try {
    const info = getClientInfo(m.client);
    const emailBody = document.getElementById('invoice-email-body')?.value || '';

    const result = await invokeEdgeFunction('send-email', {
      action: 'send_invoice_email',
      clientName: m.client,
      month: m.month,
      emailBody,
      paymentLink: m.finalized.hostedInvoiceUrl,
    });

    m.emailSentTo = result.sentTo || info.email;
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
