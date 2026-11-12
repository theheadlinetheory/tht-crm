// ═══════════════════════════════════════════════════════════
// PAGING — read every row past PostgREST's 1000-row cap
// ═══════════════════════════════════════════════════════════
// Import-free so node can test it (scripts/test-pager.mjs).
//
// The backend caps every select at max_rows = 1000. A list read in one call just stops there,
// with no error: the lead tracker is read newest first, so its OLDEST rows silently fell off,
// and pass_offs (885 rows on 2026-11-12) was a few weeks from the same (Tim, 2026-11-12).
//
// makeQuery() must build a FRESH query each call (a PostgREST builder runs once) and must
// order by a unique key, or rows shift between pages and get skipped or repeated.
// Rows are also de-duplicated by id in case one moves across a page boundary mid-read.
export const PAGE_SIZE = 1000;

export async function selectAllPages(makeQuery, pageSize = PAGE_SIZE) {
  const all = [];
  const seen = new Set();
  for (let off = 0; ; off += pageSize) {
    const { data, error } = await makeQuery().range(off, off + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    for (const row of rows) {
      const key = row && row.id != null ? String(row.id) : null;
      if (key !== null) { if (seen.has(key)) continue; seen.add(key); }
      all.push(row);
    }
    if (rows.length < pageSize) break;
  }
  return all;
}
