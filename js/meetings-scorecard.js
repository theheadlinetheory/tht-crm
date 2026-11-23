// ═══════════════════════════════════════════════════════════
// MEETINGS SCORECARD — per pay-per-meeting client, meetings this week and
// this month, split cold email vs cold call. Shown live on the Analysis tab
// (Meetings view): no Run step and no Smartlead stats, only meetings.
//
// Pure counting, no imports, so it is unit-tested on node
// (meetings-scorecard.test.mjs). The caller passes in how to classify a row
// (isEmail) and how to map a tracker client name onto a client (resolveName).
//
// The source is the CRM Lead Tracker (one row per billed meeting, dated by
// date_added 'M/D/YY') — the same rows the weekly KPI and billing count.
// Targets (Lars, 2026-11-23): 8 meetings per client per calendar month is the
// north star, about 2 a week across both channels.
// ═══════════════════════════════════════════════════════════

export const MONTH_TARGET = 8;
export const WEEK_TARGET = 2;

// 'M/D/YY' or 'M/D/YYYY' → local Date (null when unparseable)
export function parseTrackerDate(dateAdded) {
  const parts = String(dateAdded || '').split('/');
  if (parts.length !== 3) return null;
  const [m, d] = [parseInt(parts[0], 10), parseInt(parts[1], 10)];
  let y = parseInt(parts[2], 10);
  if (!m || !d || isNaN(y)) return null;
  if (y < 100) y += 2000;
  return new Date(y, m - 1, d);
}

function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

// Monday → Sunday week and calendar month containing `today`.
export function periodsFor(today) {
  const t = startOfDay(today);
  const weekStart = new Date(t); weekStart.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
  const monthStart = new Date(t.getFullYear(), t.getMonth(), 1);
  const monthEnd = new Date(t.getFullYear(), t.getMonth() + 1, 0);
  return { today: t, weekStart, weekEnd, monthStart, monthEnd, dayOfMonth: t.getDate(), daysInMonth: monthEnd.getDate() };
}

// Meetings a client should have by today to be on track for MONTH_TARGET.
export function expectedByToday(p, target = MONTH_TARGET) {
  return target * p.dayOfMonth / p.daysInMonth;
}

// 'ahead' at or above pace, 'close' within one meeting, 'behind' otherwise.
export function paceStatus(total, expected) {
  if (total >= expected) return 'ahead';
  if (total >= expected - 1) return 'close';
  return 'behind';
}

/**
 * @param {object}   o
 * @param {Array}    o.entries      tracker rows ({ clientName, dateAdded, ... })
 * @param {string[]} o.clientNames  the PPM clients to score (every one gets a row)
 * @param {Function} o.isEmail      row → true for a cold-email meeting, false for cold call
 * @param {Function} o.resolveName  tracker clientName → client name
 * @param {Date}     o.today
 */
export function buildMeetingsScorecard({ entries, clientNames, isEmail, resolveName = n => n, today = new Date() }) {
  const p = periodsFor(today);
  const blank = () => ({ emailWeek: 0, emailMonth: 0, callWeek: 0, callMonth: 0 });
  const byClient = new Map(clientNames.map(n => [n, blank()]));

  for (const e of entries || []) {
    const row = byClient.get(resolveName(e.clientName));
    if (!row) continue;
    const dt = parseTrackerDate(e.dateAdded);
    if (!dt || dt > p.today) continue;
    const inMonth = dt >= p.monthStart && dt <= p.monthEnd;
    const inWeek = dt >= p.weekStart && dt <= p.weekEnd;
    if (!inMonth && !inWeek) continue;
    const ch = isEmail(e) ? 'email' : 'call';
    if (inWeek) row[ch + 'Week']++;
    if (inMonth) row[ch + 'Month']++;
  }

  const expected = expectedByToday(p);
  const rows = [...byClient].map(([name, r]) => {
    const totalWeek = r.emailWeek + r.callWeek;
    const totalMonth = r.emailMonth + r.callMonth;
    return {
      name, ...r, totalWeek, totalMonth,
      needed: Math.max(0, MONTH_TARGET - totalMonth),
      gap: expected - totalMonth,               // > 0 = behind pace
      status: paceStatus(totalMonth, expected),
    };
  });
  // Most behind first: that is the cold-call priority order.
  rows.sort((a, b) => b.gap - a.gap || a.totalWeek - b.totalWeek || a.name.localeCompare(b.name));
  return { periods: p, expected, rows };
}
