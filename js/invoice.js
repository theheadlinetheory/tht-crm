// ═══════════════════════════════════════════════════════════
// INVOICE — Stripe invoice generation from Lead Tracker
// ═══════════════════════════════════════════════════════════
import { state, pendingWrites } from './app.js';
import { invokeEdgeFunction } from './api.js';
import { esc, str } from './utils.js';
import { render } from './render.js';

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

// ─── Get billable entries for a client/month ───
function getBillableEntries(client, month) {
  return state.trackerEntries.filter(e =>
    str(e.clientName) === client &&
    str(e.month) === month &&
    str(e.callbackStatus).toLowerCase() !== 'called back' &&
    !str(e.stripeInvoiceId)
  );
}

// ─── Parse lead cost to cents ───
function parseCostCents(costStr) {
  const n = parseFloat(str(costStr).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : Math.round(n * 100);
}

function formatDollars(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

// ─── Render the invoice modal ───
export function renderInvoiceModal() {
  const m = state.invoiceModal;
  if (!m) return '';

  let html = `<div class="modal-overlay" onclick="closeInvoiceModal()">
    <div class="invoice-modal" onclick="event.stopPropagation()">`;

  if (m.step === 'select') {
    html += renderSelectStep(m);
  } else if (m.step === 'preview') {
    html += renderPreviewStep(m);
  } else if (m.step === 'sending') {
    html += `<div style="text-align:center;padding:40px">
      <div style="font-size:16px;font-weight:600;margin-bottom:12px">Creating Invoice...</div>
      <div style="color:var(--text-muted);font-size:13px">Sending to Stripe and finalizing. This may take a moment.</div>
    </div>`;
  } else if (m.step === 'done') {
    html += renderDoneStep(m);
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

function renderPreviewStep(m) {
  const entries = m.entries;
  const excluded = m.excluded;
  const included = entries.filter(e => !excluded.has(e.id));
  const subtotal = included.reduce((sum, e) => sum + parseCostCents(e.leadCost), 0);

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

  return `
    <div class="invoice-header">
      <h3 style="margin:0;font-size:16px">Invoice Preview — ${esc(m.client)}</h3>
      <button class="btn btn-ghost" onclick="closeInvoiceModal()" style="padding:4px 8px">✕</button>
    </div>
    <div class="invoice-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:12px;color:var(--text-muted)">${esc(m.month)} — ${included.length} of ${entries.length} leads</span>
        <button class="btn btn-ghost" style="font-size:11px;padding:2px 8px" onclick="invoiceBack()">← Back</button>
      </div>
      ${entries.length === 0
        ? '<div style="text-align:center;padding:20px;color:var(--text-muted)">No billable leads found for this client/month. Called-back and already-invoiced leads are excluded.</div>'
        : `<div style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;margin-bottom:12px">
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
          <span>Lead generation services — ${esc(m.month)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="color:var(--text-muted)">Payment Terms</span>
          <span>Net 7</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-weight:700;font-size:15px;margin-top:8px">
          <span>Total</span>
          <span>${formatDollars(subtotal)}</span>
        </div>
      </div>
      <button class="btn btn-primary" style="width:100%;margin-top:16px" onclick="invoiceCreateAndSend()" ${included.length === 0 ? 'disabled' : ''}>
        Create & Send Invoice (${formatDollars(subtotal)})
      </button>`
      }
    </div>`;
}

function renderDoneStep(m) {
  const r = m.result;
  return `
    <div class="invoice-header">
      <h3 style="margin:0;font-size:16px;color:#059669">Invoice Sent</h3>
      <button class="btn btn-ghost" onclick="closeInvoiceModal()" style="padding:4px 8px">✕</button>
    </div>
    <div class="invoice-body" style="text-align:center">
      <div style="font-size:40px;margin:12px 0">✓</div>
      <div style="font-size:14px;font-weight:600;margin-bottom:4px">${esc(r.invoiceNumber)}</div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px">${r.lineItems} line items sent to ${esc(m.client)}</div>
      <a href="${esc(r.hostedUrl)}" target="_blank" class="btn btn-ghost" style="margin-bottom:8px;display:inline-flex;align-items:center;gap:4px">
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

window.invoiceCreateAndSend = async () => {
  const m = state.invoiceModal;
  if (!m) return;

  const included = m.entries.filter(e => !m.excluded.has(e.id));
  if (!included.length) return;

  if (!confirm(`Send invoice to ${m.client} for ${included.length} leads?`)) return;

  m.step = 'sending';
  render();

  try {
    const result = await invokeEdgeFunction('create-stripe-invoice', {
      clientName: m.client,
      month: m.month,
      entryIds: included.map(e => e.id),
    });

    // Update local state to reflect invoiced status
    for (const entry of included) {
      entry.paidStatus = 'Invoiced';
      entry.invoice = result.invoiceNumber || '';
      entry.paymentLink = result.hostedUrl || '';
      entry.stripeInvoiceId = result.invoiceId || '';
    }

    m.step = 'done';
    m.result = result;
    render();
  } catch (e) {
    alert('Invoice creation failed: ' + e.message);
    m.step = 'preview';
    render();
  }
};
