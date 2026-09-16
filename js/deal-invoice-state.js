// ═══════════════════════════════════════════════════════════
// DEAL-INVOICE-STATE — the draft model. Pure: no DOM, no fetch,
// and deliberately NO IMPORTS so `node --test` can run it directly
// (the rest of js/ uses ?v= cache-token specifiers Node cannot resolve).
// ═══════════════════════════════════════════════════════════

export const TERMS = [
  { id: 'on_receipt', label: 'Due on receipt', days: 0 },
  { id: 'net_7', label: 'Net 7', days: 7 },
  { id: 'net_14', label: 'Net 14', days: 14 },
  { id: 'net_30', label: 'Net 30', days: 30 },
  { id: 'custom', label: 'Custom date', days: null },
];

export const CURRENCIES = ['USD', 'AUD', 'CAD', 'GBP'];

export const PAYMENT_METHODS = [
  { id: 'card', label: 'Card' },
  { id: 'us_bank_account', label: 'ACH bank transfer' },
  { id: 'link', label: 'Link' },
];

const emptyLineItem = () => ({ description: '', quantity: 1, unitAmountCents: 0, priceText: '' });

// The raw string the user is typing. Reformatting a money field on every
// keystroke makes decimals impossible to enter, so the input shows exactly
// what was typed until it loses focus.
export function priceInputValue(item) {
  if (item.priceText !== undefined && item.priceText !== null) return item.priceText;
  return item.unitAmountCents ? (item.unitAmountCents / 100).toFixed(2) : '';
}

export function normalizePriceText(item) {
  item.priceText = item.unitAmountCents ? (item.unitAmountCents / 100).toFixed(2) : '';
  return item;
}

export function newDraft(deal) {
  return {
    customerId: '',
    customerLabel: '',
    customerQuery: String(deal?.company || deal?.contact || ''),
    customerResults: [],
    newCustomer: null,
    currency: 'usd',
    lineItems: [emptyLineItem()],
    memo: '',
    footer: 'The Headline Theory · aidan@theheadlinetheory.com',
    customFields: [],
    terms: 'net_7',
    customDueDate: '',
    paymentMethods: ['card', 'us_bank_account'],
  };
}

export function addLineItem(draft) {
  draft.lineItems.push(emptyLineItem());
  return draft;
}

export function removeLineItem(draft, index) {
  draft.lineItems.splice(index, 1);
  if (!draft.lineItems.length) draft.lineItems.push(emptyLineItem());
  return draft;
}

export function addCustomField(draft) {
  if (draft.customFields.length < 4) draft.customFields.push({ name: '', value: '' });
  return draft;
}

// Money is integer cents from here on. Strip anything that is not a digit or a
// decimal point, then round — never truncate, or 10.005 silently becomes 10.00.
export function centsFromInput(value) {
  const cleaned = String(value ?? '').replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function formatCents(cents, currency) {
  const n = (Math.round(Number(cents) || 0) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return `${String(currency || 'usd').toUpperCase()} ${n}`;
}

// One definition, used by both the total the user reviews and the payload that
// gets billed. If these two ever disagree, the invoice created is not the
// invoice reviewed — so there is exactly one of them.
function normalizedQuantity(item) {
  return Math.round(Number(item.quantity) || 0);
}

// The extension for a single line — unit price × quantity, in integer cents.
// Everything that shows or bills a line amount goes through this: the compose
// table, the review preview and the total below them.
export function lineAmountCents(item) {
  return Math.round(Number(item.unitAmountCents) || 0) * normalizedQuantity(item);
}

export function draftTotalCents(draft) {
  return draft.lineItems.reduce((sum, i) => sum + lineAmountCents(i), 0);
}

export function dueDateLabel(draft, nowMs = Date.now()) {
  const fmt = (ms) => new Date(ms).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
  if (draft.terms === 'on_receipt') return 'Due on receipt';
  if (draft.terms === 'custom') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(draft.customDueDate || ''));
    if (!m) return 'Pick a date';
    return `due ${fmt(Date.UTC(+m[1], +m[2] - 1, +m[3], 12))}`;
  }
  const days = TERMS.find((t) => t.id === draft.terms)?.days ?? 7;
  return `due ${fmt(nowMs + days * 86400000)}`;
}

export function validateDraft(draft, nowMs = Date.now()) {
  const errs = [];
  const hasNew = draft.newCustomer && draft.newCustomer.name?.trim() && draft.newCustomer.email?.trim();
  if (!draft.customerId && !hasNew) errs.push('Select a Stripe customer or fill in a new one');
  if (draft.newCustomer && !draft.customerId) {
    if (!draft.newCustomer.name?.trim()) errs.push('New customer needs a name');
    if (!draft.newCustomer.email?.trim()) errs.push('New customer needs an email');
  }
  draft.lineItems.forEach((i, n) => {
    if (!String(i.description || '').trim()) errs.push(`Line ${n + 1} needs a description`);
    else if (!(normalizedQuantity(i) > 0)) errs.push(`"${i.description}" needs a quantity of at least 1`);
    else if (!(Number(i.unitAmountCents) > 0)) errs.push(`"${i.description}" needs a price greater than zero`);
  });
  if (draft.terms === 'custom') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(draft.customDueDate || ''))) {
      errs.push('Pick a due date');
    } else {
      // The date picker yields a LOCAL calendar day, so compare against the
      // local day. Comparing against the UTC day rejects "today" every evening
      // in any timezone behind UTC.
      const n = new Date(nowMs);
      const todayLocal = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
      if (String(draft.customDueDate) < todayLocal) errs.push('Due date cannot be in the past');
    }
  }
  if (!draft.paymentMethods.length) errs.push('Choose at least one payment method');
  if (!errs.length && draftTotalCents(draft) <= 0) errs.push('Invoice total must be greater than zero');
  return errs;
}

// Only the fields the edge function consumes. UI-only state (search query,
// results, labels) must not travel.
export function toPayload(draft, dealId) {
  return {
    dealId: String(dealId),
    customerId: draft.customerId,
    currency: draft.currency,
    lineItems: draft.lineItems.map((i) => ({
      description: String(i.description || '').trim(),
      quantity: normalizedQuantity(i),
      unitAmountCents: Math.round(Number(i.unitAmountCents) || 0),
    })),
    memo: draft.memo,
    footer: draft.footer,
    customFields: draft.customFields.filter((f) => f.name.trim() && f.value.trim()),
    terms: draft.terms,
    customDueDate: draft.customDueDate,
    paymentMethods: draft.paymentMethods,
  };
}
