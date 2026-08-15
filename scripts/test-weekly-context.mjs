#!/usr/bin/env node
// Unit tests for js/weekly-context.js — the only pure module in this repo, and
// the only one node can import (it has no ?v= imports and touches no browser
// globals). Run: node scripts/test-weekly-context.mjs
import assert from 'node:assert/strict';
import { crmWeekContext, mdyToIso, normName, resolveClientName } from '../js/weekly-context.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1; }
};

test('normName squashes punctuation and case', () => {
  assert.equal(normName("Woody's Landcare LLC"), 'woodyslandcarellc');
});

test('mdyToIso expands a 2-digit year and pads', () => {
  assert.equal(mdyToIso('8/6/26'), '2026-08-06');
  assert.equal(mdyToIso('12/11/2026'), '2026-12-11');
});

test('mdyToIso returns empty string on junk', () => {
  assert.equal(mdyToIso(''), '');
  assert.equal(mdyToIso('not a date'), '');
});

const NAMES = ['Denair Hvac, Inc.', 'Northstar Hvac & Refrigeration', 'Timesavers Landscaping Inc.'];

test('resolveClientName matches exactly, case-insensitively, and by prefix', () => {
  assert.equal(resolveClientName('Denair Hvac, Inc.', NAMES), 'Denair Hvac, Inc.');
  assert.equal(resolveClientName('denair hvac, inc.', NAMES), 'Denair Hvac, Inc.');
  assert.equal(resolveClientName('Northstar Hvac', NAMES), 'Northstar Hvac & Refrigeration');
  assert.equal(resolveClientName('Timesavers', NAMES), 'Timesavers Landscaping Inc.');
});

test('resolveClientName returns the raw name when nothing matches', () => {
  assert.equal(resolveClientName('Someone Else', NAMES), 'Someone Else');
});

const RANGE = { start: '2026-08-08', end: '2026-08-14' };

test('crmWeekContext keeps only this week and this client', () => {
  const ctx = crmWeekContext({
    clientName: 'Denair Hvac, Inc.',
    range: RANGE,
    clientNames: NAMES,
    trackerEntries: [
      { clientName: 'Denair Hvac, Inc.', leadName: 'In Range', dateAdded: '8/11/26', apptTime: 'Tue, Aug 18, 9:00 AM' },
      { clientName: 'Denair Hvac, Inc.', leadName: 'Too Early', dateAdded: '8/7/26', apptTime: '' },
      { clientName: 'Denair Hvac, Inc.', leadName: 'Too Late', dateAdded: '8/15/26', apptTime: '' },
      { clientName: 'Timesavers', leadName: 'Other Client', dateAdded: '8/11/26', apptTime: '' },
    ],
    passOffs: [],
  });
  assert.deepEqual(ctx.meetings.map(m => m.leadName), ['In Range']);
});

test('crmWeekContext includes both boundary days', () => {
  const ctx = crmWeekContext({
    clientName: 'Denair Hvac, Inc.', range: RANGE, clientNames: NAMES,
    trackerEntries: [
      { clientName: 'Denair Hvac, Inc.', leadName: 'Saturday', dateAdded: '8/8/26', apptTime: '' },
      { clientName: 'Denair Hvac, Inc.', leadName: 'Friday', dateAdded: '8/14/26', apptTime: '' },
    ],
    passOffs: [],
  });
  assert.deepEqual(ctx.meetings.map(m => m.leadName), ['Saturday', 'Friday']);
});

test('crmWeekContext reads pass-offs and sorts by date', () => {
  const ctx = crmWeekContext({
    clientName: 'Denair Hvac, Inc.', range: RANGE, clientNames: NAMES,
    trackerEntries: [],
    passOffs: [
      { clientName: 'Denair Hvac, Inc.', company: 'Later Co', contact: 'B', datePassed: '2026-08-13T10:00:00' },
      { clientName: 'Denair Hvac, Inc.', company: 'Earlier Co', contact: 'A', datePassed: '2026-08-10T10:00:00' },
      { clientName: 'Denair Hvac, Inc.', company: 'Next Week', contact: 'C', datePassed: '2026-08-16T10:00:00' },
    ],
  });
  assert.deepEqual(ctx.passed.map(p => p.company), ['Earlier Co', 'Later Co']);
});

test('crmWeekContext returns empty arrays for a quiet client', () => {
  const ctx = crmWeekContext({
    clientName: 'Denair Hvac, Inc.', range: RANGE, clientNames: NAMES,
    trackerEntries: [], passOffs: [],
  });
  assert.deepEqual(ctx, { meetings: [], passed: [] });
});

console.log(`\n${passed} passed`);
