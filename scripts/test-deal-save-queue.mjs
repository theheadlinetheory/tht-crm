#!/usr/bin/env node
// Unit tests for js/deal-save-queue.js — the per-deal debounced save behind the
// deal card's text fields. Before (Tim, 2026-11-12): closing the card inside
// 800ms dropped the edit, and switching cards read the NEW card's inputs.
// Run: node scripts/test-deal-save-queue.mjs
import assert from 'node:assert/strict';
import { createDealSaveQueue } from '../js/deal-save-queue.js';

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL  ${name}\n        ${e.stack}`); process.exitCode = 1; }
};

// Fake timers so "within 800ms" is exact.
function fakeTimers() {
  let now = 0, seq = 0; const timers = new Map();
  return {
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    advance(ms) { now += ms; for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); } },
    count: () => timers.size,
  };
}
function harness({ fail = false } = {}) {
  const t = fakeTimers();
  const saves = [], saved = [], failed = [];
  const q = createDealSaveQueue({
    save: (id, fields) => { saves.push({ id, fields: { ...fields } }); return fail ? Promise.reject(new Error('boom')) : Promise.resolve(); },
    onSaved: (id, fields) => saved.push({ id, fields }),
    onFailed: (id, fields, prev, err) => failed.push({ id, fields, prev, err }),
    delay: 800, setTimer: t.setTimer, clearTimer: t.clearTimer,
  });
  return { q, t, saves, saved, failed };
}

await test('debounce: one write after 800ms with the last value', async () => {
  const { q, t, saves } = harness();
  q.queue('d1', 'notes', 'a', ''); t.advance(300);
  q.queue('d1', 'notes', 'ab', ''); t.advance(799);
  assert.equal(saves.length, 0);
  t.advance(1);
  assert.deepEqual(saves, [{ id: 'd1', fields: { notes: 'ab' } }]);
});

await test('close within 800ms still saves (flush on close)', async () => {
  const { q, t, saves, saved } = harness();
  q.queue('d1', 'company', "O'Brien Co", 'Old Co');
  t.advance(200);
  await q.flush('d1');           // closeDealModal
  assert.deepEqual(saves, [{ id: 'd1', fields: { company: "O'Brien Co" } }]);
  assert.equal(saved.length, 1);
  t.advance(2000);               // the old timer must not fire a second write
  assert.equal(saves.length, 1);
  assert.equal(t.count(), 0);
});

await test('close within 800ms with NO flush still saves (value captured at edit time)', async () => {
  // e.g. a path that nulls state.selectedDeal without closeDealModal
  const { q, t, saves } = harness();
  q.queue('d1', 'notes', 'typed', '');
  t.advance(800);
  assert.deepEqual(saves, [{ id: 'd1', fields: { notes: 'typed' } }]);
});

await test("switching cards saves the old card's value to the OLD deal", async () => {
  const { q, t, saves } = harness();
  q.queue('d1', 'contact', 'Alice', 'A');
  t.advance(100);
  await q.flush('d1');           // openDeal('d2') flushes the previous card
  q.queue('d2', 'contact', 'Bob', 'B');
  t.advance(800);
  assert.deepEqual(saves, [
    { id: 'd1', fields: { contact: 'Alice' } },
    { id: 'd2', fields: { contact: 'Bob' } },
  ]);
});

await test('two deals pending at once keep separate timers and values', async () => {
  const { q, t, saves } = harness();
  q.queue('d1', 'notes', 'one', '');
  t.advance(500);
  q.queue('d2', 'notes', 'two', '');   // must not reset or absorb d1
  t.advance(300);
  assert.deepEqual(saves, [{ id: 'd1', fields: { notes: 'one' } }]);
  t.advance(500);
  assert.deepEqual(saves[1], { id: 'd2', fields: { notes: 'two' } });
});

await test('failure calls onFailed with the value from BEFORE the first unsaved edit', async () => {
  const { q, t, failed, saved } = harness({ fail: true });
  q.queue('d1', 'phone', '555-1', '555-0');
  q.queue('d1', 'phone', '555-12', '555-1');   // prev of 2nd keystroke ignored
  q.queue('d1', 'notes', 'x', 'orig');
  await q.flush('d1');
  assert.equal(saved.length, 0);
  assert.equal(failed.length, 1);
  assert.deepEqual(failed[0].fields, { phone: '555-12', notes: 'x' });
  assert.deepEqual(failed[0].prev, { phone: '555-0', notes: 'orig' });
  assert.equal(failed[0].err.message, 'boom');
  assert.equal(q.hasPending('d1'), false);
});

await test('rollback as wired in deal-modal: deal reverts and pending overlay is cleared', async () => {
  // Mirrors rollbackDealFields(): clear pendingDealFields, put prev back unless re-edited.
  const deal = { id: 'd1', phone: '555-0' };
  const pendingDealFields = {};
  const t = fakeTimers();
  const q = createDealSaveQueue({
    save: () => Promise.reject(new Error('RLS')),
    onFailed: (id, fields, prev) => {
      for (const k of Object.keys(fields)) {
        if (pendingDealFields[id]?.[k] === fields[k]) delete pendingDealFields[id][k];
        if (deal[k] === fields[k]) deal[k] = prev[k];
      }
      if (pendingDealFields[id] && !Object.keys(pendingDealFields[id]).length) delete pendingDealFields[id];
    },
    setTimer: t.setTimer, clearTimer: t.clearTimer,
  });
  // updateDealField('phone','555-9')
  const prev = deal.phone; deal.phone = '555-9';
  pendingDealFields.d1 = { phone: '555-9' };
  q.queue('d1', 'phone', '555-9', prev);
  await q.flush();
  assert.equal(deal.phone, '555-0');
  assert.equal(pendingDealFields.d1, undefined, 'failed value must stop being re-applied over syncs');
});

await test('flush() with no id flushes every deal', async () => {
  const { q, saves } = harness();
  q.queue('d1', 'a', 1, 0); q.queue('d2', 'b', 2, 0);
  await q.flush();
  assert.equal(saves.length, 2);
  assert.equal(q.hasPending(), false);
});

await test('a save that throws synchronously still reaches onFailed', async () => {
  const failed = [];
  const q = createDealSaveQueue({ save: () => { throw new Error('sync'); }, onFailed: (...a) => failed.push(a), setTimer: () => 0, clearTimer: () => {} });
  q.queue('d1', 'x', 'y', 'z');
  await q.flush('d1');
  assert.equal(failed.length, 1);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
