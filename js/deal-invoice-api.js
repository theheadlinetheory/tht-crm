// ═══════════════════════════════════════════════════════════
// DEAL-INVOICE-API — the only place this feature talks to the network.
// Calls go through invokeEdgeFunctionAsUser so the edge function sees the
// caller's own session and can enforce admin-only (the anon key cannot).
// ═══════════════════════════════════════════════════════════
import { invokeEdgeFunctionAsUser } from './edge-auth.js?v=20260918092957';
import { sbUpdateDeal, camelToSnake } from './api.js?v=20260918092957';

const call = (action, body = {}) => invokeEdgeFunctionAsUser('deal-invoice', { action, ...body });

export const searchCustomers = (q) => call('search_customers', { q });
export const createCustomer = (c) => call('create_customer', c);
export const createDraft = (payload) => call('create_draft', payload);
export const updateDraft = (payload) => call('update_draft', payload);
export const getInvoice = (invoiceId) => call('get_invoice', { invoiceId });
// `expect` is the caller's belief about the invoice's status. Pass 'draft' when
// the UI has promised the customer cannot be affected: the server 409s rather
// than voiding an invoice Stripe has since finalized and emailed.
export const voidInvoice = (invoiceId, expect) => call('void_invoice', { invoiceId, ...(expect ? { expect } : {}) });

// The confirmed pair is what the server checks before it will send anything:
// if the invoice no longer matches what was on screen it 409s and sends nothing.
export const finalizeSend = (confirmedInvoiceId, confirmedTotalCents) =>
  call('finalize_send', { confirmedInvoiceId, confirmedTotalCents });

// Re-emails an invoice that is already finalized. Same confirmed pair, same
// 409 on a mismatch — finalizeSend would only ever 409 on an open invoice.
export const resendInvoice = (confirmedInvoiceId, confirmedTotalCents) =>
  call('resend_invoice', { confirmedInvoiceId, confirmedTotalCents });

// Writes through to the in-memory deal BEFORE awaiting the DB, so the card
// repaints immediately. If the write rejects, the promise rejects too and
// sbCall surfaces a toast — the caller owns reconciling the optimistic change.
export async function persistInvoiceFields(deal, fields) {
  Object.assign(deal, fields);
  await sbUpdateDeal(deal.id, camelToSnake(fields));
}

export function clearInvoiceFields(deal) {
  return persistInvoiceFields(deal, {
    invoiceId: null, invoiceStatus: null, invoiceNumber: null,
    invoiceUrl: null, invoicePdfUrl: null,
    invoiceAmount: null, invoiceCurrency: null, invoicedAt: null,
  });
}

// Map an edge-function invoice view onto the deal's columns. `current` is the
// deal as it stands, so a status refresh preserves the original send time
// instead of stamping "now" every time it runs.
export const fieldsFromInvoice = (inv, current) => ({
  invoiceId: inv.invoiceId,
  invoiceStatus: inv.status,
  invoiceNumber: inv.number || '',
  invoiceAmount: inv.totalCents / 100,
  invoiceCurrency: String(inv.currency || 'USD').toLowerCase(),
  invoiceUrl: inv.hostedInvoiceUrl || '',
  invoicePdfUrl: inv.invoicePdf || '',
  invoicedAt: inv.status === 'draft' ? null : ((current && current.invoicedAt) || new Date().toISOString()),
});
