#!/usr/bin/env node
// Unit tests for js/settings-diff.js. Settings autosave used to rewrite ~45
// columns on every client row + every crm_settings key on each save, undoing
// other admins' edits (Tim, 2026-11-12). Only changed rows/fields may go out now.
// Run: node scripts/test-settings-diff.mjs
import assert from 'node:assert/strict';
import { snapshotRows, diffRows, commitRows, snapshotSettings, diffSettings, commitSettings } from '../js/settings-diff.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1; }
};

// Shaped like buildClientUpdate() output (camelCase, strings/booleans/null).
const row = (id, o = {}) => ({ id, notifyEmails: 'a@x.com', notifyEmail: 'a@x.com', leadCost: '50', enableForward: 'TRUE',
  checkinConfirmEmail: true, onboardingParsedAt: null, clientNotes: '', ...o });

test('nothing edited → no client payload at all', () => {
  const rows = [row(1), row(2), row(3)];
  const snap = snapshotRows(rows);
  assert.deepEqual(diffRows(rows.map(r => ({ ...r })), snap), []);
});

test('one field on one client → exactly that field on that client', () => {
  const rows = [row(1), row(2), row(3)];
  const snap = snapshotRows(rows);
  const now = rows.map(r => ({ ...r }));
  now[1].leadCost = '65';
  assert.deepEqual(diffRows(now, snap), [{ id: 2, leadCost: '65' }]);
});

test('derived pair (notifyEmails → notifyEmail) both go, nothing else', () => {
  const snap = snapshotRows([row(7)]);
  const now = [row(7, { notifyEmails: "o'brien@x.com", notifyEmail: "o'brien@x.com" })];
  assert.deepEqual(diffRows(now, snap), [{ id: 7, notifyEmails: "o'brien@x.com", notifyEmail: "o'brien@x.com" }]);
});

test('boolean and null fields compare by value, not identity', () => {
  const snap = snapshotRows([row(1)]);
  assert.deepEqual(diffRows([row(1, { checkinConfirmEmail: false })], snap), [{ id: 1, checkinConfirmEmail: false }]);
  assert.deepEqual(diffRows([row(1, { onboardingParsedAt: null })], snap), []);
});

test("another admin's edit that a sync brought in is not reverted", () => {
  // Admin A opens Settings (snapshot), admin B changes client 2's leadCost to 80
  // and realtime updates A's state; A edits client 1 only.
  const snap = snapshotRows([row(1), row(2)]);
  const now = [row(1, { clientNotes: 'mine' }), row(2, { leadCost: '80' })];
  const out = diffRows(now, snap);
  // client 2 may only carry B's value (= DB), never the stale '50'
  for (const u of out) if (u.id === 2) assert.equal(u.leadCost, '80');
  assert.deepEqual(out.find(u => u.id === 1), { id: 1, clientNotes: 'mine' });
  assert.ok(!out.some(u => 'leadCost' in u && u.leadCost === '50'));
});

test('commit after success: the same edit is not sent twice', () => {
  const snap = snapshotRows([row(1)]);
  const now = [row(1, { leadCost: '99' })];
  const sent = diffRows(now, snap);
  commitRows(sent, snap);
  assert.deepEqual(diffRows(now, snap), []);
});

test('failed save (no commit) → edit is still pending next time', () => {
  const snap = snapshotRows([row(1)]);
  const now = [row(1, { leadCost: '99' })];
  diffRows(now, snap); // write failed, commitRows not called
  assert.deepEqual(diffRows(now, snap), [{ id: 1, leadCost: '99' }]);
});

test('client with no snapshot is never written; lazy snapshot keeps existing entries', () => {
  const snap = snapshotRows([row(1)]);
  assert.deepEqual(diffRows([row(1), row(9)], snap), []);
  snapshotRows([row(1, { leadCost: 'X' }), row(9)], snap, false); // ensureClientSnap
  assert.equal(snap.get('1').leadCost, '50', 'existing snapshot must not be overwritten');
  assert.deepEqual(diffRows([row(9, { leadCost: '1' })], snap), [{ id: 9, leadCost: '1' }]);
});

test('snapshot is a deep copy (mutating state does not move the baseline)', () => {
  const r = row(1);
  const snap = snapshotRows([r]);
  r.leadCost = '1';
  assert.deepEqual(diffRows([r], snap), [{ id: 1, leadCost: '1' }]);
});

test('crm_settings: only changed keys, nested arrays compared deeply', () => {
  const draft = { acquisition_stages: [{ id: 'A', label: 'A' }], activity_types: [{ name: 'Call' }], delivery_template: 'hi' };
  const snap = snapshotSettings(draft);
  assert.deepEqual(diffSettings(draft, snap), {});
  draft.acquisition_stages[0].label = 'A2';
  assert.deepEqual(Object.keys(diffSettings(draft, snap)), ['acquisition_stages']);
  commitSettings(diffSettings(draft, snap), snap);
  assert.deepEqual(diffSettings(draft, snap), {});
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
