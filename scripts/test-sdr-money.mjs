#!/usr/bin/env node
// Unit tests for js/sdr-money.js — what an SDR earns per dial (Manager tab).
// Run: node scripts/test-sdr-money.mjs
import assert from 'node:assert/strict';
import { setterForEmail, perDial, earnedFor } from '../js/sdr-money.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1; }
};

test('JustCall login → setter, case-insensitive', () => {
  assert.equal(setterForEmail('contact@theheadlinetheory.com'), 'Ioannis');
  assert.equal(setterForEmail('LEADS@theheadlinetheory.com'), 'Marcell');
  assert.equal(setterForEmail('aidan@theheadlinetheory.com'), 'Aidan');
  assert.equal(setterForEmail('someone@else.com'), null);
  assert.equal(setterForEmail(null), null);
});
test('$ per dial; no dials → null (never Infinity)', () => {
  assert.equal(perDial(50, 100), 0.5);
  assert.equal(perDial(25, 0), null);
  assert.equal(perDial(null, 10), null);
});
test('earned = meetings × rate; no rate on file → null', () => {
  assert.equal(earnedFor(3, 25), 75);
  assert.equal(earnedFor(0, 25), 0);
  assert.equal(earnedFor(3, null), null);
});
console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
