// ═══════════════════════════════════════════════════════════
// DASHBOARD FUNNEL — the Dashboard's acquisition numbers, read from the Funnel
// ═══════════════════════════════════════════════════════════
//
// Aidan, 2026-10-08: the Funnel is the source of truth and the Dashboard did
// not match it. The Dashboard used to count deals, archive statuses and the
// demo tracker itself (UTC months, only the old 'Deleted/Lost' status, archived
// leads dropped from New Responses), so it never could. Now it asks the same
// pipeline-level0N functions the Funnel's calendar view asks, for the picked
// month in Los Angeles days — the numbers are the Funnel's by construction.
//
// The Client Fulfillment tab keeps its delivery numbers (the Funnel does not
// track them) and adds level 07, retention past 90 days, from pipeline_latest.

import { supabase } from './supabase-client.js?v=20261008155335';
import { periodRange, fetchPeriod, todayYmdLA } from './funnel-period.js?v=20261008155335';

export const FUNNEL_FIRST_MONTH = '2026-05'; // the level functions' window opens 2026-05-04
const CACHE_MS = 15 * 60 * 1000;             // the level functions cache 15 minutes themselves

let _levels = null;          // pipeline_latest rows: level labels + the all-time level 07 card
let _levelsLoading = false;
const _months = {};          // 'YYYY-MM' → { rows, at } | { loading: true }

/** Months the Funnel covers, newest first. */
export function funnelMonths() {
  const now = todayYmdLA().slice(0, 7), out = [];
  for (let m = now; m >= FUNNEL_FIRST_MONTH; ) {
    out.push(m);
    const [y, mo] = m.split('-').map(Number);
    m = mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
  }
  return out;
}

function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return periodRange(`range:${month}-01:${month}-${String(last).padStart(2, '0')}`); // capped at today
}

function loadLevels(rerender) {
  if (_levels || _levelsLoading) return;
  _levelsLoading = true;
  supabase.from('pipeline_latest').select('*').then(({ data, error }) => {
    _levelsLoading = false;
    _levels = error ? [] : (data || []);
    if (error) console.warn('Dashboard: pipeline_latest failed', error.message);
    rerender();
  });
}

/** The Funnel's rows for a month, or null while they load (a re-render follows). */
export function funnelMonth(month, rerender) {
  loadLevels(rerender);
  if (!_levels) return null;
  const c = _months[month];
  if (c && (c.loading || Date.now() - c.at < CACHE_MS)) return c.rows || null;
  _months[month] = { loading: true, rows: c && c.rows };
  fetchPeriod(monthRange(month), _levels).then(rows => {
    _months[month] = { rows, at: Date.now() };
    rerender();
  });
  return (c && c.rows) || null;
}

/** Level 07 — onboarded → retained past 90 days, all time — or null while it loads. */
export function retentionLevel(rerender) {
  loadLevels(rerender);
  return _levels ? (_levels.find(l => l.level === '07') || {}) : null;
}

const level = (rows, n) => rows.find(r => r.level === n) || {};
const metric = (row, key) => ((row.detail && row.detail.metrics) || []).find(m => m.key === key) || {};

/** The month's headline counts, each taken from the level that owns it. */
export function acquisitionCounts(rows) {
  const l2 = level(rows, '02'), l5 = level(rows, '05'), l6 = level(rows, '06');
  return {
    positives: level(rows, '01').numerator,
    discosScheduled: l2.numerator,
    discosConducted: level(rows, '03').numerator,
    demosBooked: l5.denominator,
    demosConducted: l5.numerator,
    won: metric(l6, 'won_in_period').numerator,
    removed: l2.detail && l2.detail.removals ? l2.detail.removals.total : null,
  };
}

/** Levels 02–06 as the Funnel shows them: label, rate, numerator / denominator. */
export function conversionLevels(rows) {
  return ['02', '03', '04', '05', '06'].map(n => level(rows, n));
}
