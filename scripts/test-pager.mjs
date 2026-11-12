#!/usr/bin/env node
// Unit tests for js/paging.js — reading every row past PostgREST's 1000-row cap.
// The backend stops each select at max_rows = 1000 with no error, so the lead tracker lost its
// oldest rows and pass_offs (885 rows) was weeks from the same (Tim, 2026-11-12).
// Run: node scripts/test-pager.mjs
import assert from 'node:assert/strict';
import { selectAllPages, PAGE_SIZE } from '../js/paging.js';

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1; }
};

// A fake PostgREST table: range(from, to) returns at most `cap` rows, like the real backend.
function fakeTable(n, { cap = 1000, failAtOffset = null, mutate = null } = {}) {
  let rows = Array.from({ length: n }, (_, i) => ({ id: String(i + 1) }));
  const calls = [];
  const makeQuery = () => ({
    range(from, to) {
      calls.push([from, to]);
      if (mutate) rows = mutate(rows, from);
      if (failAtOffset === from) return Promise.resolve({ data: null, error: new Error('boom') });
      const end = Math.min(to + 1, from + cap);
      return Promise.resolve({ data: rows.slice(from, end), error: null });
    },
  });
  return { makeQuery, calls };
}

for (const n of [0, 1, 999, 1000, 1001, 2000, 2500, 3001]) {
  await test(`${n} rows → all ${n} returned`, async () => {
    const t = fakeTable(n);
    const got = await selectAllPages(t.makeQuery);
    assert.equal(got.length, n);
    assert.deepEqual(got.map(r => r.id), Array.from({ length: n }, (_, i) => String(i + 1)));
    assert.equal(t.calls.length, Math.floor(n / PAGE_SIZE) + 1);
  });
}

await test('a one-call read would have stopped at 1000 (the bug this replaces)', async () => {
  const t = fakeTable(1500);
  const { data } = await t.makeQuery().range(0, 99999);
  assert.equal(data.length, 1000);
  assert.equal((await selectAllPages(fakeTable(1500).makeQuery)).length, 1500);
});

await test('each page asks for a fresh query with the next range', async () => {
  const t = fakeTable(2100);
  await selectAllPages(t.makeQuery);
  assert.deepEqual(t.calls, [[0, 999], [1000, 1999], [2000, 2999]]);
});

await test('an error on any page throws (never a silent partial list)', async () => {
  const t = fakeTable(2500, { failAtOffset: 1000 });
  await assert.rejects(selectAllPages(t.makeQuery), /boom/);
});

await test('a row that shifts across a page boundary mid-read is not returned twice', async () => {
  // A new row lands at the top between page 1 and page 2: row 1000 slides onto page 2.
  const t = fakeTable(1500, { mutate: (rows, from) => from === 1000 && rows.length === 1500 ? [{ id: 'new' }, ...rows] : rows });
  const got = await selectAllPages(t.makeQuery);
  const ids = got.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 1500);
});

console.log(`\n${passed} passed`);
