// ═══════════════════════════════════════════════════════════
// DEAL-INVOICE — draft-first Stripe invoicing on an Acquisition deal.
// Admin-only. One live invoice per deal. Body-level overlay so render()
// cannot destroy it. Nothing is emailed except via diDoSend().
// ═══════════════════════════════════════════════════════════
import { state } from './app.js?v=20260923114158';
import { str, esc, escAttr } from './utils.js?v=20260923114158';
import { showToast } from './api.js?v=20260923114158';
import { isAdmin } from './auth.js?v=20260923114158';
import { render } from './render.js?v=20260923114158';
import { newDraft, addLineItem, removeLineItem, addCustomField, centsFromInput, normalizePriceText, formatCents, toPayload } from './deal-invoice-state.js?v=20260923114158';
import { renderComposeStep, renderReviewStep, renderDraftStep, renderSentStep, renderConfirmSend } from './deal-invoice-form.js?v=20260923114158';
import * as api from './deal-invoice-api.js?v=20260923114158';

const INVOICE_STAGES = ['Under Review', 'Waiting for Payment/Contract'];
const LIVE = ['draft', 'open', 'paid'];

let _dealId = '';
let _draft = null;
let _invoice = null;
let _step = 'compose';
let _searchTimer = null;

const deal = () => state.deals.find((d) => String(d.id) === String(_dealId));

// ─── Background status refresh ───
// render() runs this repeatedly, so the seen-set is what stops it becoming a
// request loop: one refresh per invoice per page load, and never for a status
// that can no longer change.
const _refreshed = new Set();

function maybeRefreshStatus(d) {
  const id = str(d.invoiceId);
  const status = str(d.invoiceStatus);
  if (!id || _refreshed.has(id)) return;
  if (status !== 'draft' && status !== 'open') return;
  _refreshed.add(id);
  api.getInvoice(id)
    .then((r) => {
      const inv = r.invoice;
      if (inv.status === status) return;              // nothing moved
      const fresh = state.deals.find((x) => String(x.id) === String(d.id));
      if (!fresh || str(fresh.invoiceId) !== id) return; // deal changed under us
      const fields = ['void', 'uncollectible', 'deleted'].includes(inv.status)
        ? null
        : api.fieldsFromInvoice(inv, fresh);
      (fields ? api.persistInvoiceFields(fresh, fields) : api.clearInvoiceFields(fresh))
        .then(() => render());
    })
    .catch((e) => {
      // Deleted in the Stripe dashboard: the invoice is gone for good, so clear
      // the deal rather than leaving the card reading 🟡 Draft forever. Only the
      // server's typed code says that — a missing CUSTOMER raises the same
      // resource_missing text and must not wipe a live invoice off the deal.
      const gone = e?.code === 'invoice_missing';
      if (!gone) return;
      const fresh = state.deals.find((x) => String(x.id) === String(d.id));
      if (!fresh || str(fresh.invoiceId) !== id) return;
      api.clearInvoiceFields(fresh).then(() => render()).catch(() => {});
    });
}

// ─── Button and chip on the deal modal ───

export function renderDealInvoiceButton(d) {
  if (!isAdmin() || d.pipeline !== 'Acquisition' || !INVOICE_STAGES.includes(d.stage)) return '';
  maybeRefreshStatus(d);
  const status = str(d.invoiceStatus);
  if (!str(d.invoiceId) || !LIVE.includes(status)) {
    return `<div class="form-group form-span2" style="margin-bottom:16px">
      <button onclick="openDealInvoiceModal('${escAttr(d.id)}')" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">Send Invoice</button>
    </div>`;
  }

  const amt = formatCents(Math.round(Number(d.invoiceAmount || 0) * 100), d.invoiceCurrency || 'usd');
  const num = str(d.invoiceNumber) ? ` · ${esc(str(d.invoiceNumber))}` : '';
  const dash = `https://dashboard.stripe.com/invoices/${str(d.invoiceId)}`;
  const link = (href, label) => href
    ? `<a href="${escAttr(href)}" target="_blank" rel="noopener" style="color:#2563eb;font-weight:600;text-decoration:none;font-size:12px">${label}</a>` : '';
  const act = (fn, label, color) =>
    `<button onclick="${fn}" style="background:none;border:none;color:${color};font-weight:600;font-size:12px;cursor:pointer;padding:0">${label}</button>`;

  const theme = {
    draft: ['#fffbeb', '#fde68a', '#92400e', `🟡 Draft · ${esc(amt)}${num}`],
    open: ['#eff6ff', '#bfdbfe', '#1e40af', `🔵 Sent · ${esc(amt)}${num}`],
    paid: ['#f0fdf4', '#bbf7d0', '#166534', `🟢 Paid · ${esc(amt)}${num}`],
  }[status];

  const controls = status === 'draft'
    ? [link(dash, 'Open in Stripe ↗'), act(`openDealInvoiceModal('${escAttr(d.id)}')`, 'Edit', '#2563eb'), act(`diDeleteDraft('${escAttr(d.id)}')`, 'Delete', '#b91c1c')]
    : status === 'open'
      ? [link(str(d.invoiceUrl), 'View invoice ↗'), link(dash, 'Open in Stripe ↗'), act(`diConfirmSend('${escAttr(d.id)}')`, 'Resend', '#2563eb'), act(`diVoid('${escAttr(d.id)}')`, 'Void', '#b91c1c')]
      : [link(str(d.invoiceUrl), 'View invoice ↗')];

  return `<div class="form-group form-span2" style="margin-bottom:16px">
    <div style="padding:10px 12px;background:${theme[0]};border:1px solid ${theme[1]};border-radius:8px;font-size:12px;color:${theme[2]}">
      <div style="font-weight:600">${theme[3]}</div>
      <div style="display:flex;gap:12px;margin-top:6px;flex-wrap:wrap">${controls.filter(Boolean).join('')}</div>
    </div></div>`;
}

// ─── Overlay ───

// The draft screen says "Draft created" and offers "Delete draft", which voids
// a live invoice. It may only ever be shown for something Stripe still calls a
// draft; anything else falls through to the sent screen.
const draftScreenIsSafe = () => _invoice && _invoice.status === 'draft';

function paint() {
  const body = _step === 'compose' ? renderComposeStep(_draft)
    : _step === 'review' ? renderReviewStep(_draft)
    : _step === 'confirm' ? renderConfirmSend(_invoice)
    : _step === 'draft' ? (draftScreenIsSafe() ? renderDraftStep(_invoice) : renderSentStep(_invoice, true, ''))
    : renderSentStep(_invoice, _invoice._emailed !== false, _invoice._sendError);

  const el = document.getElementById('di-panel');
  if (el) {
    // innerHTML destroys every descendant including document.activeElement, and
    // every field repaints on oninput — without this, one keystroke drops focus
    // and the next goes nowhere. Same approach as render-preserve.js.
    const active = document.activeElement;
    const keepId = active && el.contains(active) && active.id ? active.id : '';
    let selStart = null, selEnd = null;
    if (keepId) { try { selStart = active.selectionStart; selEnd = active.selectionEnd; } catch { /* not a text input */ } }
    el.innerHTML = body;
    if (keepId) {
      const restored = document.getElementById(keepId);
      if (restored) {
        restored.focus();
        if (selStart !== null && typeof restored.setSelectionRange === 'function') {
          try { restored.setSelectionRange(selStart, selEnd); } catch { /* unsupported input type */ }
        }
      }
    }
    return;
  }

  document.body.insertAdjacentHTML('beforeend',
    `<div id="di-overlay" style="position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.5);display:flex;justify-content:center;align-items:flex-start;padding:40px 20px;overflow-y:auto" onclick="if(event.target===this)dealInvoiceDismiss()">
       <div id="di-panel" style="background:#fff;border-radius:12px;max-width:620px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.25)" onclick="event.stopPropagation()">${body}</div>
     </div>`);
}

export async function openDealInvoiceModal(dealId) {
  if (!isAdmin()) return;
  const d = state.deals.find((x) => String(x.id) === String(dealId));
  if (!d) return;
  _dealId = dealId;
  _draft = newDraft(d);
  _invoice = null;
  _step = 'compose';

  // Reopening an existing draft: rehydrate from Stripe rather than from what
  // the CRM cached, so the composer shows what actually exists.
  if (str(d.invoiceId) && str(d.invoiceStatus) === 'draft') {
    paint();
    try {
      const r = await api.getInvoice(str(d.invoiceId));
      _invoice = r.invoice;
      hydrateDraftFrom(_invoice);
      _step = 'draft';
    } catch (e) {
      showToast('Could not load the draft from Stripe: ' + (e?.message || e), 'error');
    }
  }
  paint();
}

function hydrateDraftFrom(inv) {
  _draft.customerId = inv.customer.id;
  _draft.customerLabel = inv.customer.name || inv.customer.email;
  _draft.newCustomer = null;
  _draft.currency = String(inv.currency || 'usd').toLowerCase();
  _draft.memo = inv.memo;
  _draft.footer = inv.footer;
  _draft.customFields = (inv.customFields || []).map((f) => ({ name: f.name, value: f.value }));
  _draft.lineItems = inv.lineItems.length
    ? inv.lineItems.map((l) => {
        const qty = Math.round(Number(l.quantity) || 1);
        const amt = Math.round(Number(l.amountCents) || 0);
        // Stripe gives the EXTENDED amount. Recovering a unit price by division
        // silently loses cents when it does not divide evenly (1000/3 → 333 → 999),
        // so in that case keep the amount whole on a single unit.
        return qty > 0 && amt % qty === 0
          ? { description: l.description, quantity: qty, unitAmountCents: amt / qty }
          : { description: l.description, quantity: 1, unitAmountCents: amt };
      })
    : _draft.lineItems;
  // Terms and payment methods have to come back too: without them, reopening a
  // Net 30 card-only draft and pressing Update Draft silently rewrites it to
  // the Net 7 / ACH-enabled defaults.
  const byDays = { 0: 'on_receipt', 7: 'net_7', 14: 'net_14', 30: 'net_30' };
  if (inv.dueDate) {
    _draft.terms = 'custom';
    _draft.customDueDate = inv.dueDate;
  } else if (byDays[inv.daysUntilDue]) {
    _draft.terms = byDays[inv.daysUntilDue];
    _draft.customDueDate = '';
  }
  if (Array.isArray(inv.paymentMethods) && inv.paymentMethods.length) {
    _draft.paymentMethods = inv.paymentMethods.slice();
  }
}

export function dealInvoiceDismiss() {
  document.getElementById('di-overlay')?.remove();
  _dealId = ''; _draft = null; _invoice = null; _step = 'compose';
  clearTimeout(_searchTimer);
}

// ─── Field handlers (every one writes into _draft, never reads the DOM later) ───

const H = {
  diGoto: (step) => { _step = step; paint(); },
  diSetField: (k, v) => { _draft[k] = v; paint(); },
  diSetLine: (n, k, v) => {
    if (k === 'unitAmountCents') {
      // Keep the raw text so the repaint gives back exactly what was typed;
      // reformatting mid-keystroke makes "1.50" impossible to enter.
      _draft.lineItems[n].priceText = v;
      _draft.lineItems[n].unitAmountCents = centsFromInput(v);
    } else {
      _draft.lineItems[n][k] = k === 'quantity' ? Math.max(1, parseInt(v, 10) || 1) : v;
    }
    paint();
  },
  diBlurLine: (n) => { normalizePriceText(_draft.lineItems[n]); paint(); },
  diAddLine: () => { addLineItem(_draft); paint(); },
  diRemoveLine: (n) => { removeLineItem(_draft, n); paint(); },
  diAddCustomField: () => { addCustomField(_draft); paint(); },
  diSetCustomField: (n, k, v) => { _draft.customFields[n][k] = v; paint(); },
  diTogglePm: (id) => {
    const i = _draft.paymentMethods.indexOf(id);
    if (i >= 0) _draft.paymentMethods.splice(i, 1); else _draft.paymentMethods.push(id);
    paint();
  },
  diStartNewCustomer: () => {
    const d = deal();
    _draft.newCustomer = {
      name: str(d?.company || d?.contact), email: str(d?.email),
      phone: str(d?.phone), addressLine1: str(d?.address),
    };
    _draft.customerResults = [];
    paint();
  },
  diSetNewCustomer: (k, v) => { if (_draft.newCustomer) _draft.newCustomer[k] = v; paint(); },
  diClearCustomer: () => { _draft.customerId = ''; _draft.customerLabel = ''; _draft.newCustomer = null; paint(); },
  diPickCustomer: (id, label) => {
    _draft.customerId = id; _draft.customerLabel = label; _draft.customerResults = []; paint();
  },
  diSearchCustomers: (q) => {
    _draft.customerQuery = q;
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(async () => {
      try {
        const r = await api.searchCustomers(q);
        _draft.customerResults = r.customers || [];
        if (_step === 'compose') paint();
      } catch { /* a failed lookup must not wipe what is being typed */ }
    }, 350);
  },
};

// ─── Actions ───

async function withButton(id, busyLabel, fn) {
  const btn = document.getElementById(id);
  const was = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = busyLabel; }
  try {
    await fn();
  } finally {
    // fn() handles its own errors and does not rethrow, so restore
    // unconditionally. On success the overlay has already been repainted and
    // this button is detached, which makes the restore a harmless no-op.
    if (btn) { btn.disabled = false; btn.textContent = was; }
  }
}

H.diCreateDraft = () => withButton('di-create', 'Creating…', async () => {
  try {
    // A brand-new customer is created first so the draft has a real id.
    if (!_draft.customerId && _draft.newCustomer) {
      const c = await api.createCustomer(_draft.newCustomer);
      _draft.customerId = c.customer.id;
      _draft.customerLabel = c.customer.name || c.customer.email;
    }
    const payload = toPayload(_draft, _dealId);
    const r = _invoice?.invoiceId && _invoice.status === 'draft'
      ? await api.updateDraft({ ...payload, invoiceId: _invoice.invoiceId })
      : await api.createDraft(payload);
    _invoice = r.invoice;
    _step = 'draft';
    paint();
  } catch (e) {
    showToast('Could not create the draft: ' + (e?.message || e), 'error');
    return;
  }
  // The draft now exists in Stripe. A failed persist is a separate, milder
  // problem — reporting it as "could not create the draft" invites a retry that
  // creates a second Stripe draft the card never learns about.
  try {
    await api.persistInvoiceFields(deal(), api.fieldsFromInvoice(_invoice, deal()));
    render();
    showToast('Draft created — nothing sent yet', 'success');
  } catch (e) {
    showToast('Draft created in Stripe, but the deal could not be updated — reload before retrying. '
      + (e?.message || e), 'error');
  }
});

H.diConfirmSend = async (dealId) => {
  if (dealId) _dealId = String(dealId);
  // Reopened from the card rather than mid-flow: load the invoice first.
  if (!_invoice) {
    const d = deal();
    if (!d) return;
    try { _invoice = (await api.getInvoice(str(d.invoiceId))).invoice; } catch (e) {
      showToast('Could not load the invoice: ' + (e?.message || e), 'error');
      return;
    }
  }
  _step = 'confirm';
  paint();
};

H.diDoSend = () => withButton('di-send', 'Sending…', async () => {
  try {
    // An already-open invoice is a resend: finalizing it again is a 409, so the
    // only thing left to do is re-email the invoice that already exists.
    const r = _invoice.status === 'open'
      ? await api.resendInvoice(_invoice.invoiceId, _invoice.totalCents)
      : await api.finalizeSend(_invoice.invoiceId, _invoice.totalCents);
    _invoice = { ...r.invoice, _emailed: r.emailed, _sendError: r.sendError };
    _step = 'sent';
    paint();
    await api.persistInvoiceFields(deal(), api.fieldsFromInvoice(_invoice, deal()));
    render();
  } catch (e) {
    // 409 means Stripe no longer matches what was reviewed. Nothing was sent.
    if (e?.status === 409) {
      showToast(e.message, 'error');
      try { _invoice = (await api.getInvoice(_invoice.invoiceId)).invoice; } catch { /* keep what we have */ }
      _step = 'draft';
      paint();
      return;
    }
    showToast('Send failed: ' + (e?.message || e), 'error');
  }
});

async function discard(invoiceId, verb, expect) {
  try {
    await api.voidInvoice(invoiceId, expect);
    await api.clearInvoiceFields(deal());
    dealInvoiceDismiss();
    render();
    showToast(`Invoice ${verb}`, 'success');
  } catch (e) {
    // 409: the cached status was stale and Stripe has already sent this invoice.
    // Nothing was changed, and the server's message says exactly that.
    if (e?.status === 409) { showToast(e.message, 'error'); return; }
    showToast(`Could not ${verb === 'deleted' ? 'delete' : 'void'} it: ` + (e?.message || e), 'error');
  }
}

H.diDeleteDraft = (dealId) => {
  if (dealId) _dealId = String(dealId);
  const id = _invoice?.invoiceId || str(deal()?.invoiceId);
  if (!id) return;
  if (!confirm('Delete this draft invoice? Nothing has been sent, so this cannot affect the customer.')) return;
  // The status behind this button is cached, so the server has to be the one
  // that decides it is still a draft.
  discard(id, 'deleted', 'draft');
};

H.diVoid = (dealId) => {
  if (dealId) _dealId = String(dealId);
  const id = _invoice?.invoiceId || str(deal()?.invoiceId);
  if (id && confirm('Void this invoice? The customer keeps the email but the invoice is cancelled.')) {
    discard(id, 'voided');
  }
};

// ─── Bindings (inline onclick is the only thing that fires in the deal modal) ───

Object.assign(window, H, {
  openDealInvoiceModal,
  dealInvoiceDismiss,
});
