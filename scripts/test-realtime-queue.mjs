#!/usr/bin/env node
// Unit tests for createRealtimeQueue (js/realtime-merge.js): ordering, holding events while a
// card is open or a request runs, and dropping events a full sync already covered (Tim, 2026-11-12).
// Run: node scripts/test-realtime-queue.mjs
import assert from 'node:assert/strict';
import { createRealtimeQueue } from '../js/realtime-merge.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1; }
};

function setup() {
  const guard = { deals: false, activities: false };
  const applied = [];
  const q = createRealtimeQueue({ isGuarded: t => !!guard[t], apply: (t, p) => applied.push(`${t}:${p.v}`) });
  return { guard, applied, q };
}

test('unguarded event applies at once', () => {
  const { q, applied } = setup();
  assert.equal(q.receive('deals', { v: 1 }, 1), 1);
  assert.deepEqual(applied, ['deals:1']);
});

test('while a card is open, deal events wait and flush() keeps them waiting', () => {
  const { q, applied, guard } = setup();
  guard.deals = true;
  q.receive('deals', { v: 1 }, 1);
  q.receive('deals', { v: 2 }, 2);
  assert.equal(q.flush(), 0);
  assert.deepEqual(applied, []);
  assert.equal(q.length, 2);
  guard.deals = false;
  assert.equal(q.flush(), 2);
  assert.deepEqual(applied, ['deals:1', 'deals:2']);
});

test('a new event never jumps ahead of older queued ones for its table', () => {
  const { q, applied, guard } = setup();
  guard.deals = true;
  q.receive('deals', { v: 1 }, 1);
  guard.deals = false;              // guard drops, but nothing has flushed yet
  q.receive('deals', { v: 2 }, 2);  // old code applied v2 now, then v1 on top later
  assert.deepEqual(applied, ['deals:1', 'deals:2']);
  assert.equal(q.length, 0);
});

test('a guarded table does not hold up other tables', () => {
  const { q, applied, guard } = setup();
  guard.deals = true;
  q.receive('deals', { v: 1 }, 1);
  q.receive('activities', { v: 'a' }, 2);
  assert.deepEqual(applied, ['activities:a']);
  assert.equal(q.length, 1);
});

test('flush keeps a guarded table queued but applies the others in order', () => {
  const { q, applied, guard } = setup();
  guard.deals = true; guard.activities = true;
  q.receive('activities', { v: 'a1' }, 1);
  q.receive('deals', { v: 1 }, 2);
  q.receive('activities', { v: 'a2' }, 3);
  guard.activities = false;
  assert.equal(q.flush(), 2);
  assert.deepEqual(applied, ['activities:a1', 'activities:a2']);
  assert.equal(q.length, 1);
});

test('events received before a full sync started are dropped, newer ones kept', () => {
  const { q, applied, guard } = setup();
  guard.deals = true;
  q.receive('deals', { v: 'old' }, 100);
  q.receive('deals', { v: 'new' }, 300);
  q.markSynced(200);
  guard.deals = false;
  q.flush();
  assert.deepEqual(applied, ['deals:new']);
});

test('a late-arriving stale event is dropped at flush too', () => {
  const { q, applied, guard } = setup();
  q.markSynced(500);
  guard.deals = true;
  q.receive('deals', { v: 'stale' }, 400);
  guard.deals = false;
  q.flush();
  assert.deepEqual(applied, []);
});

console.log(`\n${passed} passed`);
