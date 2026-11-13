// ═══════════════════════════════════════════════════════════
// Windows for the Analysis tab's monthly pass.
// Pure date math, no imports, so it is unit-tested on node
// (analysis-month-window.test.mjs).
//
// "Monthly" = 4 weeks vs the 4 weeks before, not calendar months. Two
// calendar months differ in length and in weekday count (Oct 2026 has 22
// weekdays, Nov 21) and campaigns send on weekdays, so a calendar comparison
// skews every raw count. Two 28-day windows of whole Monday–Sunday weeks have
// exactly four of each weekday, line up with the weekly pass and the 4-week
// trailing check, and keep the bars unscaled (4 meetings / 20 positives).
// The window ends with the selected week, so on the last Friday of the month
// it includes the week in progress — as the weekly pass does.
// ═══════════════════════════════════════════════════════════

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = n => String(n).padStart(2, '0');
const ymdOf = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parse = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymdOf(d); };

export const WINDOW_WEEKS = 4;

// Monday of the week containing `date`, as YYYY-MM-DD.
export function mondayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return ymdOf(d);
}

// 'Nov 2 – 29' / 'Oct 5 – Nov 1'
export function rangeLabel(win) {
  const s = parse(win.start), e = parse(win.end);
  const endPart = s.getMonth() === e.getMonth() ? `${e.getDate()}` : `${MONTH_ABBR[e.getMonth()]} ${e.getDate()}`;
  return `${MONTH_ABBR[s.getMonth()]} ${s.getDate()} – ${endPart}`;
}

// The two windows the monthly pass compares, for the 4 weeks ending with the
// week that starts on `weekKey` (a Monday):
//   cur  — weekKey − 3 weeks (Mon)  →  weekKey + 6 days (Sun)
//   prev — the 4 weeks immediately before
// `weeks` lists all 8 week keys oldest → newest; the first 4 are prev.
export function fourWeekWindows(weekKey) {
  const curStart = addDays(weekKey, -7 * (WINDOW_WEEKS - 1));
  const prevStart = addDays(curStart, -7 * WINDOW_WEEKS);
  const weeks = [];
  for (let i = 0; i < 2 * WINDOW_WEEKS; i++) weeks.push(addDays(prevStart, 7 * i));
  return {
    weeks,
    cur: { start: curStart, end: addDays(weekKey, 6), days: 7 * WINDOW_WEEKS, weeks: weeks.slice(WINDOW_WEEKS) },
    prev: { start: prevStart, end: addDays(curStart, -1), days: 7 * WINDOW_WEEKS, weeks: weeks.slice(0, WINDOW_WEEKS) },
  };
}

// Is `today` the last Friday of its month? Drives the reminder on the weekly
// view that the monthly pass is due.
export function isLastFridayOfMonth(today = new Date()) {
  if (today.getDay() !== 5) return false;
  const nextWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
  return nextWeek.getMonth() !== today.getMonth();
}

// up / down / flat, plus the signed change and the % change (null from 0).
export function trendOf(cur, prev) {
  const diff = cur - prev;
  return {
    dir: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat',
    diff,
    pct: prev > 0 ? diff / prev * 100 : null,
  };
}
