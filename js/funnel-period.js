// ═══════════════════════════════════════════════════════════
// FUNNEL PERIOD — day / week views of the sales pipeline (Lars, 2026-09-08)
// ═══════════════════════════════════════════════════════════
//
// The Funnel tab's hourly cards cover everything since the window opened. A
// period view asks each pipeline-level0N function for one stretch of days
// (`from` / `to`, days in Los Angeles time — the reps' clock) and shows the
// leads that ENTERED that level in the period, plus what happened in the
// period whatever cohort the lead belongs to. Lars: "they can filter to just
// today for example and compare to what they actually did."
//
// Nothing is written: the functions answer from the per-lead ledger and the
// daily send snapshots. The "All" view keeps reading pipeline_latest.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=20260918151912';

export const TZ = 'America/Los_Angeles';

/** Today's date in LA as YYYY-MM-DD, and its weekday (0 = Sunday). */
function laToday() {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date());
  return { ymd, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd) };
}
const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

export const PERIODS = [
  { key: 'all',       label: 'All' },
  { key: 'today',     label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week',      label: 'This week' },
];
export function todayYmdLA() { return laToday().ymd; }
// Every backfilled week as its own chip, pinned to the calendar (Lars, 2026-09-14: relative "two weeks ago" chips
// pushed Aug 3–9 off the bar when the week rolled over). Temporary, until the backfill is as far back as wanted and a
// different filter replaces it. Older weeks are labelled by their dates; only last week and forward keep names.
export const BACKFILL_START = '2026-08-03'; // the level functions' WINDOW_START; the level 01 card carries the live value
export function periods(_backfillStart = BACKFILL_START) {
  // The week-by-week chips were for the backfill; it is done (May–August, 2026-09-18). Any other stretch is picked
  // on the calendar (a 'range:FROM:TO' key) — Lars: "an all tab, today, yesterday, this week, and then a calendar".
  return [...PERIODS];
}
/** A saved 'week2'…'week5' key from the relative days → its calendar week, so the bar still shows it selected. */
export function pinKey(key) {
  // Old saved keys (last week, a backfill week) become the calendar range they meant, so the bar still shows them.
  if (!/^(week[2-5]|lastweek|week:\d{4}-\d{2}-\d{2})$/.test(key || '')) return key;
  const r = periodRange(key); return r ? `range:${r.from}:${r.to}` : key;
}
/** Days in a range, inclusive. */
export function rangeDays(r) { return r ? Math.round((Date.parse(r.to + 'T00:00:00Z') - Date.parse(r.from + 'T00:00:00Z')) / 864e5) + 1 : 0; }
/** Level 01's exact "unique leads contacted" for a picked range comes from Smartlead, one call per campaign; ask the
 *  pipeline-sends function for it in the background (it caches the answer in pipeline_sends_period) — only for ranges
 *  short enough for Smartlead's by-date analytics. Fire and forget: the card shows the number on the next refresh. */
export function requestExactSends(r) {
  if (!r || rangeDays(r) > 92) return Promise.resolve(false);
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY };
  // Resolves true once the row is stored, so the caller can re-ask level 01 and show the number (Lars, 2026-09-18:
  // "still not there" — the card had answered before the row existed and then sat in the 15-minute cache).
  return fetch(`${SUPABASE_URL}/functions/v1/pipeline-sends`, { method: 'POST', headers, body: JSON.stringify({ from: r.from, to: r.to }) })
    .then(async (res) => { const j = await res.json().catch(() => null); return !!(res.ok && j && j.ok !== false); })
    .catch(() => false);
}

/** 'Aug 24–30' for a range (LA dates). */
export function rangeLabel(r) {
  if (!r) return '';
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [fy, fm, fd] = r.from.split('-').map(Number), [ty, tm, td] = r.to.split('-').map(Number);
  return fm === tm ? `${M[fm - 1]} ${fd}–${td}` : `${M[fm - 1]} ${fd}–${M[tm - 1]} ${td}`;
}

/** { from, to } for a period key, weeks running Monday → Sunday in LA.
 *  'week:YYYY-MM-DD' is any past week by its Monday — the backfill is reviewed a
 *  week at a time (Lars, 2026-09-10), so the bar can step back week by week. */
export function periodRange(key) {
  const { ymd, dow } = laToday();
  const monday = addDays(ymd, -((dow + 6) % 7));
  if (key && key.startsWith('week:')) { const m = key.slice(5); const end = addDays(m, 6); return { from: m, to: end < ymd ? end : ymd }; }
  if (key && key.startsWith('range:')) { // 'range:YYYY-MM-DD:YYYY-MM-DD' from the calendar picker; never past today
    const [, a, b] = key.split(':'); if (!/^\d{4}-\d{2}-\d{2}$/.test(a || '') || !/^\d{4}-\d{2}-\d{2}$/.test(b || '')) return null;
    const from = a <= b ? a : b, to = (a <= b ? b : a) > ymd ? ymd : (a <= b ? b : a); return from <= to ? { from, to } : null;
  }
  switch (key) {
    case 'today':     return { from: ymd, to: ymd };
    case 'yesterday': return { from: addDays(ymd, -1), to: addDays(ymd, -1) };
    case 'week':      return { from: monday, to: ymd };
    case 'lastweek':  return { from: addDays(monday, -7), to: addDays(monday, -1) };
    case 'week2':     return { from: addDays(monday, -14), to: addDays(monday, -8) };
    case 'week3':     return { from: addDays(monday, -21), to: addDays(monday, -15) };
    case 'week4':     return { from: addDays(monday, -28), to: addDays(monday, -22) };
    case 'week5':     return { from: addDays(monday, -35), to: addDays(monday, -29) };
    default:          return null;
  }
}

/** The Monday of the week a period key refers to (or this week's), for stepping. */
export function mondayOf(key) {
  const { ymd, dow } = laToday();
  const thisMonday = addDays(ymd, -((dow + 6) % 7));
  if (key && key.startsWith('week:')) return key.slice(5);
  if (key === 'lastweek') return addDays(thisMonday, -7);
  return thisMonday;
}
export { addDays };

/** Ask every level for the period; returns rows shaped like pipeline_latest. */
export async function fetchPeriod(range, levelDefs) {
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY };
  // A gateway 504 is an HTML page and an auth failure is JSON without `ok`: read the text, then decide (hardening review, 2026-09-15).
  const ask = (n) => fetch(`${SUPABASE_URL}/functions/v1/pipeline-level0${n}`, { method: 'POST', headers, body: JSON.stringify(range) })
    .then(async r => { const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (_) { /* not JSON */ }
      if (!r.ok || !j || j.ok === false) return { ok: false, error: (j && (j.error || j.message)) || ('HTTP ' + r.status) };
      return j; })
    .catch(e => ({ ok: false, error: String(e && e.message || e) }));
  const results = await Promise.all([1, 2, 3, 4, 5, 6, 7].map(ask));
  const fetchedAt = new Date().toISOString();
  return results.map((r, i) => {
    const level = '0' + (i + 1);
    const def = (levelDefs || []).find(l => l.level === level) || {};
    if (!r || !r.ok) return { level, label: def.label || `Level ${level}`, enters: def.enters, exits: def.exits, status: def.status || 'live', numerator: null, denominator: null, rate: null, source: 'live', detail: null, error: (r && r.error) || 'no answer', fetched_at: fetchedAt };
    const m = (r.detail && r.detail.metrics && r.detail.metrics[0]) || {};
    return { level, label: def.label || m.label || `Level ${level}`, enters: def.enters, exits: def.exits, status: def.status || 'live',
             numerator: r.numerator ?? m.numerator ?? null, denominator: r.denominator ?? m.denominator ?? null, rate: r.rate ?? m.rate ?? null,
             source: 'live', detail: r.detail || {}, fetched_at: fetchedAt };
  });
}
