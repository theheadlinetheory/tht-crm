// ═══════════════════════════════════════════════════════════
// FUNNEL TREND GROUP — days → weeks or months, pure (Lars, 2026-11-10)
// ═══════════════════════════════════════════════════════════
//
// pipeline-daily answers one row per Los Angeles day. The Funnel's trend panel
// shows those as days, as weeks (Monday → Sunday, the Funnel's week) or as
// calendar months. The grouping is pure and imports nothing, so
// funnel-trend-group.test.mjs can pin it with node:test.
//
// A group is `partial` when the range does not cover all of it — the first
// week of an "8 weeks" range that starts mid-week, or the week/month that
// holds today. A partial bar is drawn lighter and its tooltip says so, so a
// short last bar never reads as a bad week.

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const dayMs = 864e5;
const parse = (ymd) => Date.parse(ymd + 'T00:00:00Z');
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);

/** 0 = Sunday … 6 = Saturday, for a plain date (no zone shift). */
export const dowOf = (day) => new Date(day + 'T00:00:00Z').getUTCDay();
/** The Monday of the week a day falls in. */
export const mondayOf = (day) => ymd(parse(day) - ((dowOf(day) + 6) % 7) * dayMs);
/** 'YYYY-MM' of a day. */
export const monthOf = (day) => day.slice(0, 7);
/** Days in a calendar month. */
export const daysInMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

/** 'Nov 3' */
export const shortDay = (day) => { const [, m, d] = day.split('-').map(Number); return `${MONTHS[m - 1]} ${d}`; };
/** "Nov '26" */
export const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} '${String(y).slice(-2)}`; };
/** 'Nov 3–9' or 'Oct 27–Nov 2' for a Monday. */
export function weekLabel(monday) {
  const sunday = ymd(parse(monday) + 6 * dayMs);
  const [, m1, d1] = monday.split('-').map(Number), [, m2, d2] = sunday.split('-').map(Number);
  return m1 === m2 ? `${MONTHS[m1 - 1]} ${d1}–${d2}` : `${MONTHS[m1 - 1]} ${d1}–${MONTHS[m2 - 1]} ${d2}`;
}

/**
 * Group day rows ({ day, positives, qualified }, consecutive, ascending) into
 * weeks or months. Returns [{ key, label, days, expected, partial, positives, qualified }]:
 *   days      how many day rows fell in the group
 *   expected  how many days the whole week/month has (7, or the month's length)
 *   partial   days < expected, or the group holds `today` (still being written)
 */
export function groupDays(rows, gran, today) {
  if (gran !== 'week' && gran !== 'month') return rows.map(r => ({ key: r.day, label: shortDay(r.day), days: 1, expected: 1, partial: r.day === today, positives: r.positives, qualified: r.qualified }));
  const keyOf = gran === 'week' ? mondayOf : monthOf;
  const out = [];
  const byKey = new Map();
  for (const r of rows) {
    const key = keyOf(r.day);
    let g = byKey.get(key);
    if (!g) {
      g = { key, label: gran === 'week' ? weekLabel(key) : monthLabel(key), days: 0, expected: gran === 'week' ? 7 : daysInMonth(key), partial: false, positives: 0, qualified: 0 };
      byKey.set(key, g); out.push(g);
    }
    g.days++; g.positives += r.positives; g.qualified += r.qualified;
    if (r.day === today) g.partial = true;
  }
  for (const g of out) if (g.days < g.expected) g.partial = true;
  return out;
}

/** Average qualified per complete group (partial groups left out); null when there is none. */
export function avgComplete(groups) {
  const full = groups.filter(g => !g.partial);
  return full.length ? full.reduce((s, g) => s + g.qualified, 0) / full.length : null;
}
