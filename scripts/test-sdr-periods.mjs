#!/usr/bin/env node
// Unit tests for js/sdr-periods.js — SDR Scorecard period ranges, trend window and
// when to (re)load dialer data. Run: node scripts/test-sdr-periods.mjs
import assert from 'node:assert/strict';
import { rangeOf, shiftAnchor, neededFrom, trendEnd, loadAction, RETRY_MS, STALE_MS } from '../js/sdr-periods.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1; }
};

test('week range is Mon–Sun', () => assert.deepEqual(rangeOf('2026-11-19', 'week'), { from: '2026-11-16', to: '2026-11-22' }));
test('month range is 1st–last', () => assert.deepEqual(rangeOf('2026-02-10', 'month'), { from: '2026-02-01', to: '2026-02-28' }));
test('stepping a month lands in the previous month', () => assert.equal(shiftAnchor('2026-11-22', 'month', -1).slice(0, 7), '2026-10'));

test('trend ends at the period end, capped at today', () => {
  assert.equal(trendEnd('2026-10-01', 'month', '2026-11-22'), '2026-10-31');
  assert.equal(trendEnd('2026-11-01', 'month', '2026-11-22'), '2026-11-22');
  assert.equal(trendEnd('2026-11-18', 'week', '2026-11-19'), '2026-11-19');
});

test('neededFrom reaches back 8 trend weeks from the trend end', () => {
  // trend end 2026-10-31 (Sat) → its Monday 10-26 → 7 weeks earlier 09-07
  assert.equal(neededFrom('2026-10-01', 'month', '2026-11-22'), '2026-09-07');
});

const NOW = 1_000_000_000;
test('no data → load', () => assert.equal(loadAction(null, '2026-10-01', NOW), 'load'));
test('loading → wait', () => assert.equal(loadAction({ loading: true }, '2026-10-01', NOW), 'wait'));
test('data does not reach back far enough → load, and the view must not use it', () =>
  assert.equal(loadAction({ from: '2026-10-05', at: NOW, calls: [] }, '2026-10-01', NOW), 'load'));
test('fresh data covering the range → ok', () => assert.equal(loadAction({ from: '2026-09-01', at: NOW, calls: [] }, '2026-10-01', NOW), 'ok'));
test('stale data → refresh in background', () => assert.equal(loadAction({ from: '2026-09-01', at: NOW - STALE_MS - 1, calls: [] }, '2026-10-01', NOW), 'refresh'));
test('a recent error waits; an old error retries', () => {
  assert.equal(loadAction({ error: 'x', at: NOW }, '2026-10-01', NOW), 'error');
  assert.equal(loadAction({ error: 'x', at: NOW - RETRY_MS - 1 }, '2026-10-01', NOW), 'load');
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
