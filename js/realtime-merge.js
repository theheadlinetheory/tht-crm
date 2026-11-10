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
