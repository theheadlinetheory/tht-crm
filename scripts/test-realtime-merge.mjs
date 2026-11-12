#!/usr/bin/env node
// Unit tests for js/realtime-merge.js — how a realtime UPDATE lands on the row we already hold.
// Postgres leaves a large (TOASTed) column out of an UPDATE's replication record when that
// UPDATE did not change it, so the realtime payload simply has no such key. Replacing the row
// with the payload blanked passoff_instructions on the board's copy of the deal, and "Send
// pass-off to client" did nothing (Ioannis, 2026-11-10).
// Run: node scripts/test-realtime-merge.mjs
import assert from 'node:assert/strict';
import { mergeRealtimeUpdate, applyRealtimeUpdate } from '../js/realtime-merge.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1; }
};

test('a column the payload left out keeps the value we had', () => {
  const have = { id: '1', passoffInstructions: 'Hey Jerry…', calNotes: 'old' };
  const got = mergeRealtimeUpdate(have, { id: '1', calNotes: 'new' });
  assert.equal(got.passoffInstructions, 'Hey Jerry…');
  assert.equal(got.calNotes, 'new');
});

test('a column the payload sends empty is emptied', () => {
  const got = mergeRealtimeUpdate({ id: '1', passoffInstructions: 'text' }, { id: '1', passoffInstructions: '' });
  assert.equal(got.passoffInstructions, '');
});

test('the result is the payload object itself, so callers can keep patching it', () => {
  const incoming = { id: '1', stage: 'B' };
  assert.equal(mergeRealtimeUpdate({ id: '1', stage: 'A', notes: 'n' }, incoming), incoming);
  assert.equal(incoming.notes, 'n');
});

test('no row held yet: the payload is used as it is', () => {
  const incoming = { id: '1' };
  assert.equal(mergeRealtimeUpdate(undefined, incoming), incoming);
});

// Finding 13 (F3 via coordinator, 2026-11-12): the pending-edit overlay must land on the STORED row.
test('a pending local edit survives a realtime echo of the older value, on the stored row', () => {
  const list = [{ id: '1', stage: 'Booked', notes: 'typed just now', company: 'Acme' }];
  const pending = { notes: 'typed just now' };
  applyRealtimeUpdate(list[0], { id: '1', stage: 'Booked', notes: 'old server value' }, pending);
  assert.equal(list[0].notes, 'typed just now');
  assert.equal(list[0].company, 'Acme');
});

test('the update lands in place: an open card holding the row sees it', () => {
  const row = { id: '1', stage: 'A', passoffInstructions: 'draft' };
  const list = [row];
  const selectedDeal = row;
  applyRealtimeUpdate(list[0], { id: '1', stage: 'B' }, null);
  assert.equal(list[0], selectedDeal);
  assert.equal(selectedDeal.stage, 'B');
  assert.equal(selectedDeal.passoffInstructions, 'draft');
});

test('no pending edits: the server value wins', () => {
  const row = { id: '1', notes: 'a' };
  applyRealtimeUpdate(row, { id: '1', notes: 'b' }, undefined);
  assert.equal(row.notes, 'b');
});

console.log(`\n${passed} passed`);
