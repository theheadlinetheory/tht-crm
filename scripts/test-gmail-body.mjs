#!/usr/bin/env node
// Unit tests for js/gmail-body.js — the two pure text helpers behind the Gmail
// history rows on the deal card. Import-free like the other tested modules
// (render-preserve.js), so node can load it without the browser's ?v= imports.
// Run: node scripts/test-gmail-body.mjs
import assert from 'node:assert/strict';
import { trimBody, formatThreadDate } from '../js/gmail-body.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1; }
};

// ── trimBody: quoted reply chains ─────────────────────────
test('cuts a Gmail "On … wrote:" quote chain', () => {
  const raw = [
    'Hi Jim — attached the revised quote.',
    '',
    'On Tue, Sep 7, 2025 at 9:02 AM Jim Reyes <jim@x.com> wrote:',
    '> Can you send pricing?',
    '> Thanks',
  ].join('\n');
  const r = trimBody(raw);
  assert.equal(r.text, 'Hi Jim — attached the revised quote.');
  assert.equal(r.cutLines, 3);
});

test('cuts a Gmail quote marker that wraps onto the next line', () => {
  // Gmail hard-wraps long attribution lines, so "wrote:" lands on its own line.
  const raw = [
    'Sounds good, talk then.',
    '',
    'On Tue, Sep 7, 2025 at 9:02 AM Jim Reyes <jim.reyes@canopyland.com>',
    'wrote:',
    '> Does Thursday work?',
  ].join('\n');
  const r = trimBody(raw);
  assert.equal(r.text, 'Sounds good, talk then.');
});

test('cuts an Outlook "-----Original Message-----" block', () => {
  const raw = 'Approved, go ahead.\n\n-----Original Message-----\nFrom: Jim\nSubject: Quote';
  assert.equal(trimBody(raw).text, 'Approved, go ahead.');
});

test('cuts an Outlook From:/Sent: header block', () => {
  const raw = 'See below.\n\nFrom: Jim Reyes\nSent: Tuesday, September 7, 2025 9:02 AM\nTo: Aidan\nSubject: Quote';
  assert.equal(trimBody(raw).text, 'See below.');
});

test('does not cut on a From: line that has no Sent:/Date: under it', () => {
  // Real sentence, not a header block — cutting here would eat the message.
  const raw = 'From what I can tell the scope is right.\nLet me know.';
  const r = trimBody(raw);
  assert.equal(r.text, raw);
  assert.equal(r.cutLines, 0);
});

// ── trimBody: signatures ──────────────────────────────────
test('cuts at the "-- " signature delimiter', () => {
  const raw = 'Revised quote attached.\n\n-- \nAidan Hutchinson\nThe Headline Theory\n(412) 555-0143';
  const r = trimBody(raw);
  assert.equal(r.text, 'Revised quote attached.');
  assert.equal(r.cutLines, 4);
});

test('cuts at "Sent from my iPhone"', () => {
  assert.equal(trimBody('Yes that works.\n\nSent from my iPhone').text, 'Yes that works.');
});

test('leaves a sign-off like "Best, Aidan" alone', () => {
  // Deliberately NOT trimmed — guessing at sign-offs eats real text.
  const raw = 'Revised quote attached.\n\nBest,\nAidan';
  const r = trimBody(raw);
  assert.equal(r.text, raw);
  assert.equal(r.cutLines, 0);
});

// ── trimBody: edge cases ──────────────────────────────────
test('returns the body untouched when there is nothing to cut', () => {
  const raw = 'Short note with no quote and no signature.';
  assert.deepEqual(trimBody(raw), { text: raw, cutLines: 0 });
});

test('keeps the whole body when trimming would leave nothing', () => {
  // A bare forward is all quote — showing an empty box would lose the message.
  const raw = 'On Tue, Sep 7, 2025 at 9:02 AM Jim Reyes <jim@x.com> wrote:\n> Can you send pricing?';
  const r = trimBody(raw);
  assert.equal(r.text, raw);
  assert.equal(r.cutLines, 0);
});

test('cuts at the EARLIEST marker when a body has several', () => {
  const raw = 'Done.\n\n-- \nAidan\n\nOn Tue Jim Reyes wrote:\n> thanks';
  assert.equal(trimBody(raw).text, 'Done.');
});

test('handles empty and non-string input', () => {
  assert.deepEqual(trimBody(''), { text: '', cutLines: 0 });
  assert.deepEqual(trimBody(null), { text: '', cutLines: 0 });
  assert.deepEqual(trimBody(undefined), { text: '', cutLines: 0 });
});

// ── formatThreadDate ──────────────────────────────────────
const NOW = new Date('2026-09-11T15:00:00');

test('shows the time for a message from today', () => {
  assert.equal(formatThreadDate(new Date('2026-09-11T14:14:00').getTime(), NOW), '2:14 PM');
});

test('shows month and day for an earlier date this year', () => {
  assert.equal(formatThreadDate(new Date('2026-09-08T14:14:00').getTime(), NOW), 'Sep 8');
});

test('shows a numeric date for a different year', () => {
  assert.equal(formatThreadDate(new Date('2025-09-08T14:14:00').getTime(), NOW), '9/8/25');
});

test('returns an empty string for a missing timestamp', () => {
  assert.equal(formatThreadDate(0, NOW), '');
  assert.equal(formatThreadDate(null, NOW), '');
});

console.log(`\n${passed} passed`);
if (process.exitCode) console.error('FAILURES');
