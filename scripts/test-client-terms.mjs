#!/usr/bin/env node
// Unit tests for js/client-terms.js — payment cadence and term-end math.
// Import-free so node can load it. Run: node scripts/test-client-terms.mjs
import assert from 'node:assert/strict';
import { cadenceOf, termEnd, daysLeft, monthlyEquivalent } from '../js/client-terms.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1; }
};

// ── cadenceOf ─────────────────────────────────────────────
test('known cadences normalize, whatever the spelling', () => {
  assert.equal(cadenceOf('Monthly'), 'Monthly');
  assert.equal(cadenceOf('bi-weekly'), 'Biweekly');
  assert.equal(cadenceOf(' WEEKLY '), 'Weekly');
  assert.equal(cadenceOf('Paid in full'), 'Paid in full');
});
test('legacy free text is not guessed at', () => {
  assert.equal(cadenceOf('Prepaid'), '');
  assert.equal(cadenceOf('Net 1'), '');
  assert.equal(cadenceOf(''), '');
});

// ── termEnd ───────────────────────────────────────────────
test('no launch date or no initial term → no end date', () => {
  assert.equal(termEnd('', 6, 'months', []), '');
  assert.equal(termEnd('2026-03-01', '', 'months', []), '');
});
test('months are counted from the launch date', () => {
  assert.equal(termEnd('2026-03-01', 6, 'months', []), '2026-09-01');
});
test('days are counted from the launch date', () => {
  assert.equal(termEnd('2026-03-01', 90, 'days', []), '2026-05-30');
});
test('extensions add on, months before days', () => {
  const ext = [{ length: 3, unit: 'months' }, { length: 14, unit: 'days' }];
  assert.equal(termEnd('2026-03-01', 6, 'months', ext), '2026-12-15');
});
test('month-end launch does not drift across stacked extensions', () => {
  // Jan 31 + 1 + 1 month must be Mar 31, not Mar 28 (no chained clamping).
  assert.equal(termEnd('2026-01-31', 1, 'months', [{ length: 1, unit: 'months' }]), '2026-03-31');
});
test('string inputs from normalizeRow work', () => {
  assert.equal(termEnd('2026-03-01', '6', 'months', [{ length: '2', unit: 'months' }]), '2026-11-01');
});

// ── daysLeft ──────────────────────────────────────────────
test('days left is signed', () => {
  assert.equal(daysLeft('2026-09-20', '2026-09-16'), 4);
  assert.equal(daysLeft('2026-09-10', '2026-09-16'), -6);
  assert.equal(daysLeft('', '2026-09-16'), null);
});

// ── monthlyEquivalent ─────────────────────────────────────
test('per-payment amounts convert to a monthly figure', () => {
  assert.equal(monthlyEquivalent(1200, 'Monthly'), 1200);
  assert.equal(monthlyEquivalent(600, 'Biweekly'), 1300);
  assert.equal(monthlyEquivalent(300, 'Weekly'), 1300);
  assert.equal(monthlyEquivalent(1000, ''), 1000); // unknown cadence is treated as monthly
});

console.log(`\n${passed} passed`);
