#!/usr/bin/env node
// Unit tests for js/weekly-context.js — the only pure module in this repo, and
// the only one node can import (it has no ?v= imports and touches no browser
// globals). Run: node scripts/test-weekly-context.mjs
import assert from 'node:assert/strict';
import { crmWeekContext, mdyToIso, normName, resolveClientName, localDay, ctxDay, ctxSummary, ctxSection } from '../js/weekly-context.js';

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

// ─── localDay: the timezone boundary itself ────────────────────────────────
// The pass-offs test above (and every fixture using bare 'YYYY-MM-DDTHH:mm:ss'
// timestamps) only proves localDay round-trips a wall-clock string back to
// its own date — `new Date('2026-08-13T10:00:00')` is parsed as LOCAL time by
// JS itself, so the UTC-vs-local branch inside localDay never actually runs.
// This test uses an explicit UTC offset so the instant's UTC calendar day and
// its local calendar day genuinely differ, and pins process.env.TZ so the
// result is deterministic on any machine/CI regardless of host timezone.
test('localDay reads the LOCAL day across a UTC boundary, not the UTC day', () => {
  const prevTz = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    // 2026-08-14T01:00:00-04:00 is 2026-08-14T05:00:00Z in UTC, but only
    // 2026-08-13T22:00 in Pacific time (UTC-7 in August) — a calendar day
    // earlier. localDay must return the LOCAL day (the 13th). This guards
    // against someone later "simplifying" it to `.toISOString().slice(0,10)`,
    // which would silently return the 14th instead.
    const ts = '2026-08-14T01:00:00-04:00';
    const utcDay = new Date(ts).toISOString().slice(0, 10);
    assert.equal(utcDay, '2026-08-14'); // sanity: the boundary really is crossed
    assert.equal(localDay(ts), '2026-08-13');
    assert.notEqual(localDay(ts), utcDay);
  } finally {
    if (prevTz === undefined) delete process.env.TZ; else process.env.TZ = prevTz;
  }
});

// ─── ctxDay ─────────────────────────────────────────────────────────────────
test('ctxDay renders a valid date using LOCAL date parts', () => {
  // Compared against a direct toLocaleDateString call (not a hardcoded
  // string) so the assertion doesn't depend on this Node/ICU version's exact
  // separator formatting — only on ctxDay building the date the same way.
  const expected = new Date(2026, 7, 13).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
  assert.equal(ctxDay('2026-08-13'), expected);
});

test('ctxDay parses locally, not via new Date(iso) (which reads UTC and can roll back a day)', () => {
  const prevTz = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    // Sanity: prove the naive-UTC bug this guards against is real in this TZ —
    // `new Date('2026-08-13')` parses as UTC midnight, which is still 8/12
    // in Pacific time.
    assert.notEqual(new Date('2026-08-13').getDate(), 13);
    const expected = new Date(2026, 7, 13).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
    assert.equal(ctxDay('2026-08-13'), expected);
  } finally {
    if (prevTz === undefined) delete process.env.TZ; else process.env.TZ = prevTz;
  }
});

test('ctxDay falls back to the raw string on unparseable input', () => {
  assert.equal(ctxDay('not-a-date'), 'not-a-date');
  assert.equal(ctxDay(''), '');
  assert.equal(ctxDay(null), '');
  assert.equal(ctxDay(undefined), '');
});

// ─── ctxSummary ─────────────────────────────────────────────────────────────
const FULL_CTX = {
  meetings: [{ date: '2026-08-11', leadName: 'Acme Co', apptTime: 'Tue, Aug 18, 9:00 AM' }],
  passed: [{ date: '2026-08-12', company: 'Beta LLC', contact: 'Jane Doe' }],
  work: [{ date: '2026-08-10', text: 'Launched tier 2 campaign' }],
  swcl: [{ date: '2026-08-13', text: 'Tim: fixed bounce rate on inbox 3' }],
  checkins: { had: [{ date: '2026-08-09', title: 'Monthly sync' }], upcoming: [{ date: '2026-08-18', title: 'Check-in call' }] },
  errors: [],
};

test('ctxSummary names every non-empty part, in order, for a fully-populated ctx', () => {
  // The check-in named is the UPCOMING one, not the one already had.
  const expectedNext = ctxDay(FULL_CTX.checkins.upcoming[0].date);
  assert.equal(
    ctxSummary(FULL_CTX),
    `1 meeting booked · 1 lead passed · 2 updates · check-in ${expectedNext}`
  );
});

test('ctxSummary pluralizes counts of 2+', () => {
  const ctx = {
    meetings: [{ date: '2026-08-10', leadName: 'A', apptTime: '' }, { date: '2026-08-11', leadName: 'B', apptTime: '' }],
    passed: [{ date: '2026-08-10', company: 'C', contact: '' }, { date: '2026-08-11', company: 'D', contact: '' }],
    work: [], swcl: [], checkins: { had: [], upcoming: [] }, errors: [],
  };
  assert.equal(ctxSummary(ctx), '2 meetings booked · 2 leads passed');
});

test('ctxSummary reads "nothing logged this week" for a completely empty ctx', () => {
  const empty = { meetings: [], passed: [], work: [], swcl: [], checkins: { had: [], upcoming: [] }, errors: [] };
  assert.equal(ctxSummary(empty), 'nothing logged this week');
});

test('ctxSummary never throws when a ctx is missing optional sub-objects', () => {
  const partials = [
    {},                                                            // completely bare
    { meetings: [{ date: '2026-08-11', leadName: 'X', apptTime: '' }] }, // no passed/work/swcl/checkins at all
    { checkins: {} },                                              // checkins present but empty
    { checkins: { upcoming: [{ date: '2026-08-18', title: 'Call' }] } }, // had missing
    null, undefined, 0, '', 'junk', 12345, true, [],
  ];
  for (const ctx of partials) {
    let result;
    assert.doesNotThrow(() => { result = ctxSummary(ctx); });
    assert.equal(typeof result, 'string');
  }
});

// ─── ctxSection ─────────────────────────────────────────────────────────────
test('ctxSection renders nothing for an empty section', () => {
  assert.equal(ctxSection('Meetings booked', []), '');
});

test('ctxSection escapes untrusted text and includes the title and day', () => {
  const html = ctxSection('What we did', [
    { day: 'Thu, 8/13', text: '<script>alert(1)</script> & "quoted"' },
  ]);
  assert.ok(html.includes('What we did'));
  assert.ok(html.includes('Thu, 8/13'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&amp;'));
  assert.ok(!html.includes('<script>'));
});

test('ctxSection never throws on malformed input', () => {
  const inputs = [null, undefined, 'junk', 12345, [{}], [{ day: null, text: undefined }]];
  for (const lines of inputs) {
    let result;
    assert.doesNotThrow(() => { result = ctxSection('Section', lines); });
    assert.equal(typeof result, 'string');
  }
});

console.log(`\n${passed} passed`);
