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

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=20260910114335';

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
  { key: 'lastweek',  label: 'Last week' },
  // Temporary, for reviewing the backfill one week at a time (Lars, 2026-09-10) — not a permanent history UI.
  // Older weeks are labelled by their dates; only last week and forward keep names (Lars).
  { key: 'week2',     label: null },
  { key: 'week3',     label: null },
];

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
  switch (key) {
    case 'today':     return { from: ymd, to: ymd };
    case 'yesterday': return { from: addDays(ymd, -1), to: addDays(ymd, -1) };
    case 'week':      return { from: monday, to: ymd };
    case 'lastweek':  return { from: addDays(monday, -7), to: addDays(monday, -1) };
    case 'week2':     return { from: addDays(monday, -14), to: addDays(monday, -8) };
    case 'week3':     return { from: addDays(monday, -21), to: addDays(monday, -15) };
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
  const ask = (n) => fetch(`${SUPABASE_URL}/functions/v1/pipeline-level0${n}`, { method: 'POST', headers, body: JSON.stringify(range) })
    .then(r => r.json()).catch(e => ({ ok: false, error: String(e) }));
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
