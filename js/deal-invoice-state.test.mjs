import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newDraft, addLineItem, removeLineItem, draftTotalCents, lineAmountCents,
  centsFromInput, formatCents, dueDateLabel, validateDraft, toPayload,
  priceInputValue, normalizePriceText,
} from './deal-invoice-state.js';

const deal = { id: 'd1', company: 'Pioneer Landscaping', contact: 'Mike', email: 'mike@pioneer.com' };

test('a new draft starts with one empty line item and sane defaults', () => {
  const d = newDraft(deal);
  assert.equal(d.lineItems.length, 1);
  assert.equal(d.currency, 'usd');
  assert.equal(d.terms, 'net_7');
  assert.deepEqual(d.paymentMethods, ['card', 'us_bank_account']);
  assert.equal(d.customerQuery, 'Pioneer Landscaping');
});

test('centsFromInput survives the ways people actually type money', () => {
  assert.equal(centsFromInput('1500'), 150000);
  assert.equal(centsFromInput('1,500.00'), 150000);
  assert.equal(centsFromInput('$1,500.50'), 150050);
  assert.equal(centsFromInput('0.07'), 7);
  assert.equal(centsFromInput(''), 0);
  assert.equal(centsFromInput('abc'), 0);
});

test('centsFromInput rounds rather than truncating a third cent', () => {
  assert.equal(centsFromInput('10.005'), 1001);
  assert.equal(centsFromInput('10.004'), 1000);
});

test('totals multiply quantity and stay in integer cents', () => {
  const d = newDraft(deal);
  d.lineItems[0] = { description: 'Setup', quantity: 1, unitAmountCents: 150000 };
  addLineItem(d);
  d.lineItems[1] = { description: 'Retainer', quantity: 3, unitAmountCents: 100000 };
  assert.equal(draftTotalCents(d), 450000);
});

test('lineAmountCents is the one extension every display and total uses', () => {
  assert.equal(lineAmountCents({ quantity: 3, unitAmountCents: 100000 }), 300000);
  assert.equal(lineAmountCents({ quantity: 1, unitAmountCents: 7 }), 7);
  // A bad quantity must read as zero, never be clamped up to one: a clamp is
  // what lets a line review at $0 and bill at full price.
  assert.equal(lineAmountCents({ quantity: 0, unitAmountCents: 150000 }), 0);
  assert.equal(lineAmountCents({ quantity: '', unitAmountCents: 150000 }), 0);
  assert.equal(lineAmountCents({ quantity: 'abc', unitAmountCents: 150000 }), 0);
  assert.equal(lineAmountCents({ quantity: -2, unitAmountCents: 100 }), -200);
  // Non-integer input rounds the same way on both sides.
  assert.equal(lineAmountCents({ quantity: 2.4, unitAmountCents: 100.6 }), 202);

  // draftTotalCents is nothing but the sum of these.
  const d = newDraft(deal);
  d.lineItems[0] = { description: 'Setup', quantity: 2, unitAmountCents: 150000 };
  addLineItem(d);
  d.lineItems[1] = { description: 'Retainer', quantity: 3, unitAmountCents: 100000 };
  assert.equal(draftTotalCents(d), d.lineItems.reduce((s, i) => s + lineAmountCents(i), 0));
  assert.equal(draftTotalCents(d), 600000);
});

test('removing the last line item leaves one empty row, never zero', () => {
  const d = newDraft(deal);
  removeLineItem(d, 0);
  assert.equal(d.lineItems.length, 1);
  assert.equal(d.lineItems[0].description, '');
});

test('formatCents renders whole and fractional amounts with the currency', () => {
  assert.equal(formatCents(350000, 'usd'), 'USD 3,500.00');
  assert.equal(formatCents(7, 'usd'), 'USD 0.07');
  assert.equal(formatCents(0, 'gbp'), 'GBP 0.00');
});

test('due date label follows the selected terms', () => {
  const d = newDraft(deal);
  const now = Date.UTC(2026, 8, 15);
  assert.match(dueDateLabel({ ...d, terms: 'net_7' }, now), /Sep 22, 2026/);
  assert.match(dueDateLabel({ ...d, terms: 'on_receipt' }, now), /on receipt/i);
  assert.match(dueDateLabel({ ...d, terms: 'custom', customDueDate: '2026-10-01' }, now), /Oct 1, 2026/);
});

test('validation names every specific thing that is wrong', () => {
  const d = newDraft(deal);
  let errs = validateDraft(d);
  assert.ok(errs.some((e) => /customer/i.test(e)));
  assert.ok(errs.some((e) => /description/i.test(e)));

  d.customerId = 'cus_1';
  d.lineItems[0] = { description: 'Setup', quantity: 1, unitAmountCents: 0 };
  errs = validateDraft(d);
  assert.ok(errs.some((e) => /price greater than zero/i.test(e)));

  d.lineItems[0].unitAmountCents = 150000;
  assert.deepEqual(validateDraft(d), []);
});

test('a new customer with name and email validates without a customer id', () => {
  const d = newDraft(deal);
  d.newCustomer = { name: 'Pioneer', email: 'mike@pioneer.com', phone: '', addressLine1: '' };
  d.lineItems[0] = { description: 'Setup', quantity: 1, unitAmountCents: 150000 };
  assert.deepEqual(validateDraft(d), []);
});

test('toPayload emits exactly what the edge function expects', () => {
  const d = newDraft(deal);
  d.customerId = 'cus_1';
  d.lineItems[0] = { description: 'Setup', quantity: 1, unitAmountCents: 150000 };
  d.customFields = [{ name: 'PO number', value: '4471' }];
  const p = toPayload(d, 'd1');
  assert.equal(p.dealId, 'd1');
  assert.equal(p.customerId, 'cus_1');
  assert.equal(p.lineItems[0].unitAmountCents, 150000);
  assert.deepEqual(p.customFields, [{ name: 'PO number', value: '4471' }]);
  assert.equal(p.customerQuery, undefined, 'UI-only fields must not be sent');
  assert.equal(p.customerResults, undefined);
  assert.equal(p.customerLabel, undefined);
  assert.equal(p.newCustomer, undefined);
  // priceText is the raw string being typed — UI-only, never billed.
  const withText = newDraft(deal);
  withText.customerId = 'cus_1';
  withText.lineItems[0] = { description: 'Setup', quantity: 1, unitAmountCents: 150, priceText: '1.5' };
  const p2 = toPayload(withText, 'd1');
  assert.equal(p2.lineItems[0].priceText, undefined, 'priceText must not be sent');
  assert.equal(p2.lineItems[0].unitAmountCents, 150);
});

test('a half-typed decimal price survives the repaint', () => {
  const d = newDraft(deal);
  assert.equal(priceInputValue(d.lineItems[0]), '', 'an empty line shows an empty price box');
  // What diSetLine does on each keystroke of "1.50".
  for (const keyed of ['1', '1.', '1.5', '1.50']) {
    d.lineItems[0].priceText = keyed;
    d.lineItems[0].unitAmountCents = centsFromInput(keyed);
    assert.equal(priceInputValue(d.lineItems[0]), keyed, `typing "${keyed}" must not be reformatted`);
  }
  assert.equal(d.lineItems[0].unitAmountCents, 150);
});

test('priceInputValue formats from cents when nothing has been typed', () => {
  assert.equal(priceInputValue({ unitAmountCents: 150000 }), '1500.00');
  assert.equal(priceInputValue({ unitAmountCents: 0 }), '');
  // An explicit empty string is a deliberate clear, not "fall back to cents".
  assert.equal(priceInputValue({ unitAmountCents: 150000, priceText: '' }), '');
});

test('normalizePriceText tidies to two decimals on blur', () => {
  assert.equal(normalizePriceText({ unitAmountCents: 150, priceText: '1.5' }).priceText, '1.50');
  assert.equal(normalizePriceText({ unitAmountCents: 0, priceText: 'abc' }).priceText, '');
});

test('a custom due date in the past is refused, not silently rewritten', () => {
  const now = new Date(2026, 8, 15).getTime();   // local midnight, not Date.UTC
  const d = newDraft(deal);
  d.customerId = 'cus_1';
  d.lineItems[0] = { description: 'Setup', quantity: 1, unitAmountCents: 150000 };
  d.terms = 'custom';

  d.customDueDate = '2026-09-14';
  assert.ok(validateDraft(d, now).some((e) => /past/i.test(e)));

  d.customDueDate = '2026-09-15';           // today is allowed
  assert.deepEqual(validateDraft(d, now), []);

  d.customDueDate = '2026-10-01';
  assert.deepEqual(validateDraft(d, now), []);
});

test('the total the user reviews always equals the total that gets billed', () => {
  const d = newDraft(deal);
  d.customerId = 'cus_1';
  d.lineItems[0] = { description: 'Setup', quantity: 0, unitAmountCents: 150000 };
  assert.ok(validateDraft(d).some((e) => /quantity/i.test(e)), 'quantity 0 must be refused');

  d.lineItems[0].quantity = -1;
  assert.ok(validateDraft(d).some((e) => /quantity/i.test(e)), 'negative quantity must be refused');

  d.lineItems[0].quantity = 2;
  assert.deepEqual(validateDraft(d), []);
  const billed = toPayload(d, 'd1').lineItems.reduce((s, i) => s + i.quantity * i.unitAmountCents, 0);
  assert.equal(billed, draftTotalCents(d), 'reviewed total and billed total must agree');
});
