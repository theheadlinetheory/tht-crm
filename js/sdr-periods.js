// ═══════════════════════════════════════════════════════════
// SDR PERIODS — the SDR Scorecard's calendar (day / week / month ranges, the 8-week
// trend window) and when to (re)load dialer data. Pure and import-free; days are ET
// calendar days as 'YYYY-MM-DD'. Tested by scripts/test-sdr-periods.mjs.
// ═══════════════════════════════════════════════════════════

export const TREND_WEEKS = 8;
export const STALE_MS = 15 * 6e4; // the sync runs every 15 min
export const RETRY_MS = 6e4;      // after a failed load

const DAY_MS = 864e5;
const utc = (iso) => Date.parse(iso + 'T00:00:00Z');
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso, n) => isoOf(utc(iso) + n * DAY_MS);
export const mondayOf = (iso) => addDays(iso, -((new Date(utc(iso)).getUTCDay() + 6) % 7));
export const weekdayOf = (iso) => new Date(utc(iso)).getUTCDay(); // Sun = 0

export function rangeOf(iso, p) {
  if (p === 'day') return { from: iso, to: iso };
  if (p === 'week') { const m = mondayOf(iso); return { from: m, to: addDays(m, 6) }; }
  const first = iso.slice(0, 8) + '01';
  const next = new Date(utc(first)); next.setUTCMonth(next.getUTCMonth() + 1);
  return { from: first, to: addDays(isoOf(next.getTime()), -1) };
}

export function shiftAnchor(iso, p, dir) {
  if (p === 'day') return addDays(iso, dir);
  if (p === 'week') return addDays(iso, 7 * dir);
  const d = new Date(utc(iso.slice(0, 8) + '01')); d.setUTCMonth(d.getUTCMonth() + dir);
  return isoOf(d.getTime());
}

// The trend's last day: the end of the period on screen, never past today.
export const trendEnd = (iso, p, today) => [rangeOf(iso, p).to, today].sort()[0];

// Mondays of the TREND_WEEKS weeks ending with the week that holds trendEnd.
export function trendMondays(iso, p, today) {
  const last = mondayOf(trendEnd(iso, p, today));
  return Array.from({ length: TREND_WEEKS }, (_, k) => addDays(last, -7 * (TREND_WEEKS - 1 - k)));
}

// The earliest day the view needs: its own range or the first trend week, whichever is earlier.
export const neededFrom = (iso, p, today) => [rangeOf(iso, p).from, trendMondays(iso, p, today)[0]].sort()[0];

// What to do with the loaded data `d` before drawing a view that needs `fromDay` onward:
//   'load'    — nothing usable (none, too short, or an error old enough to retry): fetch, show a loader
//   'refresh' — usable but older than the sync interval: draw it, fetch fresh in the background
//   'wait'    — a fetch is already running
//   'error'   — a recent failure: show it, retry after RETRY_MS
//   'ok'      — draw it
export function loadAction(d, fromDay, now) {
  if (!d) return 'load';
  if (d.loading) return 'wait';
  if (d.error) return now - d.at > RETRY_MS ? 'load' : 'error';
  if (fromDay < d.from) return 'load';
  return now - d.at > STALE_MS ? 'refresh' : 'ok';
}
