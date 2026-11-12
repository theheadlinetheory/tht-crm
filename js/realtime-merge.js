// ═══════════════════════════════════════════════════════════
// REALTIME MERGE — how a realtime UPDATE lands on the row we already hold
// ═══════════════════════════════════════════════════════════
// Import-free so node can test it (scripts/test-realtime-merge.mjs).
//
// A realtime UPDATE payload is not always the whole row. Postgres stores a large text column
// out of line (TOAST) and leaves it out of the replication record of any UPDATE that did not
// change it, so the payload has no such key at all. Replacing our row with the payload blanked
// those columns: a deal's passoff_instructions disappeared from state.deals as soon as anything
// else on the card was saved, and "Send pass-off to client" then did nothing.
//
// So: every key the payload carries wins (an emptied column arrives as '' and is emptied);
// a key it does not carry keeps the value we had. Returns `incoming`, filled in.
export function mergeRealtimeUpdate(have, incoming) {
  if (!have || !incoming) return incoming;
  for (const key of Object.keys(have)) {
    if (!(key in incoming)) incoming[key] = have[key];
  }
  return incoming;
}

// ─── Realtime event queue ───
// An event that arrives while its table is guarded (a write in flight, a card open, a pass-off
// request running) waits here. Three rules, all from the 2026-11-12 audit (Tim):
//   1. Order holds per table. While older events for a table are still waiting, a new one waits
//      behind them — before, the new one was applied at once and the older ones landed on top of
//      it later, putting a stale row back.
//   2. flush() leaves a guarded table's events queued instead of applying them under an open card.
//   3. An event received before the last full sync STARTED is already in that snapshot; it is
//      dropped instead of being replayed over newer data.
// isGuarded(table) and apply(table, payload) are supplied by api.js; `ts` is the receive time.
export function createRealtimeQueue({ isGuarded, apply }) {
  const queue = [];
  let syncedAt = 0;
  function flush() {
    const keep = [];
    const held = new Set();
    let applied = 0;
    for (const ev of queue) {
      if (ev.ts < syncedAt) continue;
      if (held.has(ev.table) || isGuarded(ev.table)) { held.add(ev.table); keep.push(ev); continue; }
      apply(ev.table, ev.payload);
      applied++;
    }
    queue.length = 0;
    queue.push(...keep);
    return applied;
  }
  return {
    get length() { return queue.length; },
    // Returns how many events were applied (0 = it was queued).
    receive(table, payload, ts) {
      if (isGuarded(table)) { queue.push({ table, payload, ts }); return 0; }
      if (queue.some(ev => ev.table === table)) { queue.push({ table, payload, ts }); return flush(); }
      apply(table, payload);
      return 1;
    },
    flush,
    // A full sync whose reads started at `startedAt` has just replaced state.
    markSynced(startedAt) {
      syncedAt = Math.max(syncedAt, startedAt);
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].ts < syncedAt) queue.splice(i, 1);
    },
  };
}
