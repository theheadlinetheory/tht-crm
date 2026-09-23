// ═══════════════════════════════════════════════════════════
// FUNNEL — the seven sales-pipeline levels, live (six until 2026-09-07, when
// discovery split into scheduled and conducted)
// ═══════════════════════════════════════════════════════════
//
// One page for the whole acquisition funnel: emails sent through to retained
// clients. Reads `pipeline_latest` in this CRM's own database, which joins the
// seven level definitions to the most recent figure recorded for each.
//
// Every level is rendered, including the ones with no tracking yet. A row that
// says "not tracked" is information; a level silently missing from the page
// just looks like a bug, and this project has already lost weeks to numbers
// that looked finished and were not.
//
// Two things travel with every figure and must not be dropped:
//   source  'verified' means a hand-audited number that must NOT be recomputed
//           from thinner evidence — the baseline's 61 discos were settled by
//           reading 364 call recordings, and a live count cannot reproduce it.
//   detail  the scope and caveats, stored beside the number rather than in a
//           doc, so a rate can never be read without the conditions on it.

import { esc, svgIcon } from './utils.js?v=20260923144404';
import { supabase } from './supabase-client.js?v=20260923144404';
import { PERIODS, periods, pinKey, periodRange, fetchPeriod, rangeLabel, rangeDays, todayYmdLA, requestExactSends } from './funnel-period.js?v=20260923144404';
import { leadsTable } from './funnel-leads.js?v=20260923144404';

let _levels = null;      // null = not loaded, [] = loaded and empty
const _open = new Set(); // levels whose Details section is expanded (survives re-renders)
const _openLeads = new Set(); // lead dropdowns that are expanded ('<level>-cohort' / '<level>-activity')
let _loading = false;
let _error = null;
// Day / week views (funnel-period.js): 'all' reads pipeline_latest; anything
// else asks the level functions for the period and caches the answer here.
// The chosen period survives a reload: index.html reloads the page once per
// deploy (version.json check on every tab focus), which threw the view back to
// All each time Lars clicked a period during a deploy (2026-09-08).
const PERIOD_KEY = 'funnelPeriod';
/** The earliest Monday the levels cover — from the level 01 card when loaded, else the constant in funnel-period.js. */
function backfillStart() {
  const l1 = (_levels || []).find(l => l.level === '01');
  const ws = l1 && l1.detail && l1.detail.window_start;
  return /^\d{4}-\d{2}-\d{2}$/.test(ws || '') ? ws : undefined;
}
let _period = pinKey((() => { try { return localStorage.getItem(PERIOD_KEY) || 'all'; } catch (_) { return 'all'; } })());
if (_period !== 'all' && !periodRange(_period)) _period = 'all'; // a stale or invalid saved key never sticks
const _periodData = {};   // key → rows shaped like pipeline_latest (with _from/_to/_at, see periodRows)
let _periodLoading = null; // key being fetched
const _gen = {};           // key → fetch generation: only the latest fetch for a key may store its rows
const PERIOD_TTL_MS = 15 * 60e3;
/** The cached rows for a key, or null when there are none, they are for other dates (Today rolled over) or too old. */
function periodRows(key) {
  const c = _periodData[key]; if (!c) return null;
  if (c.error) return c;
  const r = periodRange(key);
  if (!r || c._from !== r.from || c._to !== r.to || Date.now() - (c._at || 0) > PERIOD_TTL_MS) return null;
  return c;
}
function storePeriod(key, rows, g) {
  if (g !== undefined && g !== _gen[key]) return; // a slower, older fetch never overwrites a newer one
  const r = periodRange(key) || {};
  if (Array.isArray(rows)) { rows._from = r.from; rows._to = r.to; rows._at = Date.now(); }
  _periodData[key] = rows;
}

let _failedAt = 0;              // when the last card load failed
const RETRY_COOLDOWN_MS = 30e3;  // no automatic refetch sooner than this; "Try again" ignores it
export function loadFunnel(rerender) {
  // The period views borrow the level labels from the cards: ask for a period only once the cards are here
  // (a pinned period on first paint used to title every card with its metric label — hardening review, 2026-09-15).
  if (_period !== 'all' && _levels !== null) loadPeriod(_period, rerender);
  // render.js calls this on every paint of the Funnel screen. After a failure the cards stay null so a later load
  // can try again — but not on the very next paint, or a failing database gets a request per render (the 2026-09-16
  // outage was made worse by exactly that kind of client retry storm). One try per 30 s unless the user asks.
  if (_levels !== null || _loading || Date.now() - _failedAt < RETRY_COOLDOWN_MS) return;
  _loading = true;
  supabase.from('pipeline_latest').select('*')
    .then(({ data, error }) => {
      _loading = false;
      if (error) { _error = error.message; _levels = null; _failedAt = Date.now(); }
      else { _levels = data || []; _error = null; _failedAt = 0; if (_period !== 'all') loadPeriod(_period, rerender); }
      if (rerender) rerender();
    })
    .catch((e) => { _loading = false; _error = String(e && e.message || e); _failedAt = Date.now(); if (rerender) rerender(); });
}

/** Refetch everything WITHOUT blanking the page: the cards and lists on screen stay until the fresh ones arrive,
 *  then one re-render at the same scroll position, open lists still open. Used by the Refresh button and after a
 *  rep records an answer from a list (Ioannis, 2026-09-11: "every time I update the outcome the whole page
 *  refreshes and it closes the dropdown menu" — the old version showed "Loading the funnel…" in between, which
 *  threw the scroll to the top and the list out of view). */
export function reloadFunnel(rerender) {
  const y = window.scrollY, key = _period;
  _failedAt = 0; // the user asked: no cooldown
  const cards = supabase.from('pipeline_latest').select('*')
    .then(({ data, error }) => { if (error) _error = error.message; else { _levels = data || []; _error = null; } });
  const g = (_gen[key] = (_gen[key] || 0) + 1);
  const period = key !== 'all'
    ? fetchPeriod(periodRange(key), _levels || []).then(rows => { storePeriod(key, rows, g); }).catch(() => {})
    : Promise.resolve();
  Promise.all([cards, period]).finally(() => {
    if (rerender) rerender();
    requestAnimationFrame(() => window.scrollTo(0, y));
  });
}

function loadPeriod(key, rerender) {
  if (periodRows(key) || _periodLoading === key) return;
  if (!rerender) rerender = () => import('./render.js?v=20260923144404').then(m => m.render());
  _periodLoading = key;
  const g = (_gen[key] = (_gen[key] || 0) + 1);
  fetchPeriod(periodRange(key), _levels || []).then(rows => {
    storePeriod(key, rows, g);
  }).catch(e => {
    storePeriod(key, { error: String(e && e.message || e) }, g);
  }).finally(() => { if (_periodLoading === key) _periodLoading = null; if (rerender) rerender(); });
}

window.setFunnelPeriod = (key) => {
  _period = key;
  try { localStorage.setItem(PERIOD_KEY, key); } catch (_) { /* private mode */ }
  if (key.startsWith('range:')) {
    // Unique leads for a range: the send ledger answers any range up to yesterday on our side (2026-09-18). Only when
    // the first answer comes back without it (a range that reaches today, or past the ledger's coverage) is Smartlead
    // asked — in the background, waiting out its rate-limit bursts — and the cards re-ask level 01 until it lands.
    const hasUnique = () => { const rows = _periodData[key]; return Array.isArray(rows) && rows.some(r => r.level === '01' && r.detail && r.detail.metrics && r.detail.metrics.some(m => m.key === 'unique_leads' && m.denominator != null)); };
    const loaded = () => Array.isArray(_periodData[key]) || (_periodData[key] && _periodData[key].error);
    let waited = 0;
    const whenLoaded = () => {
      if (_period !== key) return;
      if (!loaded()) { if ((waited += 500) < 60000) setTimeout(whenLoaded, 500); return; }
      if (hasUnique()) return;
      requestExactSends(periodRange(key)).catch(() => {});
      let tries = 0;
      const poll = () => {
        if (_period !== key || hasUnique() || tries++ >= 20) return;   // up to ~10 minutes: the hourly run fulfils what a rate-limited first try left
        delete _periodData[key]; loadPeriod(key, null);
        setTimeout(poll, 30000);
      };
      setTimeout(poll, 20000);
    };
    setTimeout(whenLoaded, 500);
  }
  import('./render.js?v=20260923144404').then(m => { if (key !== 'all') loadPeriod(key, m.render); m.render(); });
};

// ── The calendar: pick any stretch of days (Lars, 2026-09-18) ──
const _pick = { open: false, month: null, start: null, end: null }; // month 'YYYY-MM'; start/end 'YYYY-MM-DD' while choosing
const rerenderNow = () => import('./render.js?v=20260923144404').then(m => m.render());
window.funnelPickToggle = () => {
  _pick.open = !_pick.open;
  if (_pick.open) { const r = periodRange(_period); _pick.month = (r ? r.to : todayYmdLA()).slice(0, 7); _pick.start = null; _pick.end = null; }
  rerenderNow();
};
window.funnelPickNav = (months) => {
  const [y, m] = _pick.month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + months, 1));
  const next = d.toISOString().slice(0, 7);
  if (next <= todayYmdLA().slice(0, 7)) { _pick.month = next; rerenderNow(); }
};
window.funnelPickDay = (ymd) => {
  if (ymd > todayYmdLA()) return;
  if (!_pick.start || _pick.end) { _pick.start = ymd; _pick.end = null; rerenderNow(); return; } // first click: the start
  const from = ymd < _pick.start ? ymd : _pick.start, to = ymd < _pick.start ? _pick.start : ymd;    // second: the end (either order)
  _pick.open = false; _pick.start = null; _pick.end = null;
  window.setFunnelPeriod(`range:${from}:${to}`);
};
document.addEventListener('click', (e) => { // a click outside closes it
  if (!_pick.open) return;
  const el = e.target; if (el && el.closest && (el.closest('#funnel-pick') || el.closest('#funnel-pick-chip'))) return;
  _pick.open = false; rerenderNow();
}, true);

function calendarPopover() {
  const today = todayYmdLA();
  const cur = _period && _period.startsWith('range:') ? periodRange(_period) : null;
  const selFrom = _pick.start || (cur && cur.from) || null, selTo = _pick.end || (_pick.start ? null : (cur && cur.to)) || null;
  const [y, m] = _pick.month.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const M = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const nDays = selFrom && selTo ? rangeDays({ from: selFrom, to: selTo }) : selFrom ? 1 : 0;
  const nav = (fn, dis, glyph) => `<button onclick="${fn}" ${dis ? 'disabled' : ''} style="width:28px;height:28px;border:none;border-radius:50%;background:${dis ? 'transparent' : '#f3f4f6'};color:#6b7280;font-size:16px;cursor:${dis ? 'default' : 'pointer'};opacity:${dis ? .3 : 1}">${glyph}</button>`;
  const monthKey = `${y}-${String(m).padStart(2, '0')}`;
  let cells = '';
  for (let i = 0; i < dow; i++) cells += '<div></div>';
  for (let d = 1; d <= days; d++) {
    const ymd = `${monthKey}-${String(d).padStart(2, '0')}`;
    const future = ymd > today, isStart = ymd === selFrom, isEnd = ymd === selTo;
    const span = selFrom && selTo && selFrom !== selTo, inRange = span && ymd > selFrom && ymd < selTo;
    const band = inRange || (span && (isStart || isEnd));
    const radius = !span ? '0' : (isStart ? '18px 0 0 18px' : isEnd ? '0 18px 18px 0' : '0');
    cells += `<div style="height:36px;display:flex;align-items:center;justify-content:center;background:${band ? '#e0dcff' : 'transparent'};border-radius:${radius}">
      <button onclick="funnelPickDay('${ymd}')" ${future ? 'disabled' : ''} style="width:34px;height:34px;border:none;border-radius:50%;cursor:${future ? 'default' : 'pointer'};font-size:13px;font-family:var(--font);background:${(isStart || isEnd) ? '#6b5cf6' : 'transparent'};color:${(isStart || isEnd) ? '#fff' : future ? '#d1d5db' : '#1f2937'};font-weight:${(isStart || isEnd) ? 700 : 400}">${d}</button></div>`;
  }
  return `<div id="funnel-pick" style="position:absolute;top:calc(100% + 6px);left:0;z-index:50;width:330px;background:#fff;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.18);overflow:hidden;border:1px solid var(--border)">
    <div style="background:#6b5cf6;color:#fff;padding:14px 18px">
      <div style="font-size:12px;opacity:.85">${selFrom ? esc(rangeLabel({ from: selFrom, to: selTo || selFrom })) : 'Pick a start day'}</div>
      <div style="font-size:22px;font-weight:700;margin-top:2px">${nDays ? nDays + (nDays === 1 ? ' day' : ' days') : (selFrom ? 'now the end day' : 'Any stretch of days')}</div>
    </div>
    <div style="padding:10px 12px 12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:4px">${nav('funnelPickNav(-1)', false, '‹')}<span style="font-size:14px;font-weight:600;min-width:96px;text-align:center">${M[m - 1]}</span>${nav('funnelPickNav(1)', monthKey >= today.slice(0, 7), '›')}</div>
        <div style="display:flex;align-items:center;gap:4px">${nav('funnelPickNav(-12)', false, '‹')}<span style="font-size:14px;font-weight:600">${y}</span>${nav('funnelPickNav(12)', String(y + 1) > today.slice(0, 4), '›')}</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);font-size:11px;color:#9ca3af;text-align:center;margin-bottom:2px">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => `<div>${d}</div>`).join('')}</div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr)">${cells}</div>
      <div style="display:flex;justify-content:flex-end;margin-top:6px"><button onclick="funnelPickToggle()" style="padding:5px 10px;border:1px solid var(--border);border-radius:6px;background:var(--card);font-size:11px;cursor:pointer">Close</button></div>
    </div></div>`;
}

const STATUS_STYLE = {
  live:          { bg: '#dcfce7', fg: '#166534', label: 'Live' },
  partial:       { bg: '#fef3c7', fg: '#92400e', label: 'Partial' },
  'not tracked': { bg: '#f3f4f6', fg: '#6b7280', label: 'Not tracked' },
};

function fmtRate(r) {
  if (r === null || r === undefined) return '—';
  const n = Number(r);
  // Level 01 lives below 1% (0.41% is a good day); one decimal would print
  // 0.4% for every value it will ever show.
  return `${n.toFixed(n < 1 ? 2 : 1)}%`;
}

const fmtCount = (n) => (n === null || n === undefined) ? '—' : Number(n).toLocaleString('en-US');

function ago(iso) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 48) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

/** Where a level's number comes from, and whether each feed is actually
 *  flowing. A source that quietly stopped is the failure this project exists to
 *  prevent — the Calendly refresh claimed "auto, every 30 min" in a level file
 *  and had never run once. */
function sourcesTable(sources) {
  if (!sources || !sources.length) return '';
  let h = `<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px">
    <div style="font-size:11px;font-weight:700;color:#6b7280;margin-bottom:6px">WHERE THIS NUMBER COMES FROM</div>`;
  sources.forEach(s => {
    const ok = s.live;
    const dot = ok ? '#059669' : '#f59e0b';
    h += `<div style="display:flex;gap:8px;align-items:flex-start;padding:5px 0">
      <span style="width:7px;height:7px;border-radius:50%;background:${dot};flex-shrink:0;margin-top:5px"></span>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap">
          <span style="font-size:12px;font-weight:600;color:#1f2937">${esc(s.name)}</span>
          <span style="font-size:10px;color:#9ca3af">${esc(s.feeds)}</span>
          ${s.contributes !== undefined ? `<span style="font-size:11px;color:#374151;font-variant-numeric:tabular-nums">+${s.contributes}</span>` : ''}
          ${s.awaiting ? `<span style="font-size:10px;font-weight:700;color:#92400e;background:#fef3c7;padding:1px 6px;border-radius:4px">${s.awaiting} awaiting</span>` : ''}
          ${s.last_activity ? `<span style="font-size:10px;color:#9ca3af">last ${esc(ago(s.last_activity))}</span>` : ''}
        </div>
        <div style="font-size:11px;color:#9ca3af;line-height:1.4">${esc(s.how || '')}</div>
      </div>
    </div>`;
  });
  h += `</div>`;
  return h;
}

/** Level 01's unique-leads count for a picked range is one Smartlead query per campaign, stored once it lands: say so
 *  instead of a bare dash (Lars, 2026-09-18: "a different range is not showing up now"). */
function uniqueHint(l, m) {
  if (l.level !== '01' || m.key !== 'unique_leads' || m.denominator != null || !_period.startsWith('range:')) return '';
  const r = periodRange(_period), n = r ? rangeDays(r) : 0;
  return n > 31
    ? ` <span style="color:#9ca3af">· a range that reaches today: exact unique leads from Smartlead only up to 31 days — pick a range ending yesterday for any length</span>`
    : ` <span style="color:#9ca3af">· being fetched from Smartlead, one query per campaign — a few minutes when it is busy; fills in by itself</span>`;
}

/** A stage as a flow of counts, from the level function's detail.flow: [{ n, label, hint?, strong? }]. */
function flowStrip(steps) {
  const tile = (s) => `<div style="display:flex;flex-direction:column;gap:2px;padding:8px 12px;border:1px solid ${s.strong ? '#1e1b4b' : 'var(--border)'};border-radius:8px;background:${s.strong ? '#f5f3ff' : 'var(--card)'};min-width:150px" ${s.hint ? `title="${esc(s.hint)}"` : ''}>
      <span style="font-size:17px;font-weight:800;color:#1e1b4b;font-variant-numeric:tabular-nums">${fmtCount(s.n)}</span>
      <span style="font-size:11px;color:#6b7280">${esc(s.label)}</span></div>`;
  const arrow = `<span style="color:#9ca3af;font-size:16px;padding:0 2px">→</span>`;
  return `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:10px 0 6px">${steps.map(tile).join(arrow)}</div>`;
}

/** Stage 1 as a flow: emails sent → unique leads contacted → positive responses → qualified positive responses.
 *  The rate lines above stay the headline; this shows where the numbers come from (Lars, 2026-09-23). */
function stageFlow01(l, metrics, d) {
  const m1 = metrics[0] || {}, m2 = metrics[1] || {};
  const positives = d.positives_raw != null ? Number(d.positives_raw) : (Array.isArray(d.leads) ? d.leads.length : null);
  const steps = [
    { n: m1.denominator, label: 'Emails sent' },
    { n: m2.denominator, label: 'Unique leads contacted' },
    { n: positives, label: 'Positive responses', hint: 'replies the AI tagged positive, less the ones corrected within 48h' },
    { n: m1.numerator, label: 'Qualified positive responses', hint: 'after the reps removed desk DQs, miscategorised replies and duplicates', strong: true },
  ];
  const tile = (s) => `<div style="display:flex;flex-direction:column;gap:2px;padding:8px 12px;border:1px solid ${s.strong ? '#1e1b4b' : 'var(--border)'};border-radius:8px;background:${s.strong ? '#f5f3ff' : 'var(--card)'};min-width:150px" ${s.hint ? `title="${esc(s.hint)}"` : ''}>
      <span style="font-size:17px;font-weight:800;color:#1e1b4b;font-variant-numeric:tabular-nums">${fmtCount(s.n)}</span>
      <span style="font-size:11px;color:#6b7280">${esc(s.label)}</span></div>`;
  const arrow = `<span style="color:#9ca3af;font-size:16px;padding:0 2px">→</span>`;
  return `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:10px 0 6px">${steps.map(tile).join(arrow)}</div>`;
}

function levelCard(l) {
  const st = STATUS_STYLE[l.status] || STATUS_STYLE['not tracked'];
  const hasNumbers = l.numerator !== null && l.denominator !== null;
  const verified = l.source === 'verified';

  let h = `<div style="border:1px solid var(--border);border-radius:10px;padding:14px 16px;background:var(--card);display:flex;gap:16px;align-items:flex-start">`;

  // Level number
  h += `<div style="flex-shrink:0;width:34px;height:34px;border-radius:8px;background:#1e1b4b;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px">${esc(l.level)}</div>`;

  h += `<div style="flex:1;min-width:0">`;
  h += `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:14px;font-weight:700;color:#1e1b4b">${esc(l.label)}</span>
          <span style="padding:1px 7px;border-radius:4px;font-size:10px;font-weight:700;background:${st.bg};color:${st.fg}">${st.label}</span>
        </div>`;
  if (l.enters) {
    h += `<div style="font-size:11px;color:#9ca3af;margin-top:2px">Enters when ${esc(l.enters)} · exits when ${esc(l.exits || '')}</div>`;
  }

  if (hasNumbers) {
    // A level can carry more than one metric on the same numerator — level 01
    // reports positives per email sent AND per unique lead contacted. The
    // tracker puts them in detail.metrics; the top-level figure is the first.
    const metrics = (l.detail && Array.isArray(l.detail.metrics) && l.detail.metrics.length)
      ? l.detail.metrics
      : [{ label: '', numerator: l.numerator, denominator: l.denominator, rate: l.rate }];
    metrics.forEach((m, i) => {
      // A count-only metric (no denominator): the events of the period, e.g. "closed won in this period" on level 06.
      if (m.count_only) {
        h += `<div style="margin-top:${i ? 4 : 10}px;display:flex;align-items:baseline;gap:10px">
              <span style="font-size:24px;font-weight:800;color:#1e1b4b;font-variant-numeric:tabular-nums">${fmtCount(m.numerator)}</span>
              <span style="font-size:12px;color:#6b7280">${esc(m.label || '')}</span>
            </div>`;
        return;
      }
      h += `<div style="margin-top:${i ? 4 : 10}px;display:flex;align-items:baseline;gap:10px">
              <span style="font-size:24px;font-weight:800;color:#1e1b4b;font-variant-numeric:tabular-nums">${fmtRate(m.rate)}</span>
              <span style="font-size:12px;color:#6b7280;font-variant-numeric:tabular-nums">${fmtCount(m.numerator)} of ${fmtCount(m.denominator)}${m.label ? ` · ${esc(m.label)}` : ''}${uniqueHint(l, m)}</span>
              ${(!i && verified) ? `<span style="font-size:10px;font-weight:700;color:#166534;background:#dcfce7;padding:1px 6px;border-radius:4px">verified baseline</span>` : ''}
            </div>`;
    });
    if (l.snapshot_date) {
      h += `<div style="font-size:10px;color:#9ca3af;margin-top:2px">as of ${esc(String(l.snapshot_date))}</div>`;
    } else if (l.fetched_at) {
      h += `<div style="font-size:10px;color:#9ca3af;margin-top:2px">as of ${esc(ago(l.fetched_at))}</div>`;
    }
    const d = l.detail || {};
    // One short line stays with the number: the window and the counting rule.
    if (d.note) h += `<div style="font-size:11px;color:#6b7280;margin-top:4px">${esc(String(d.note))}</div>`;
    // In a day / week view: the conversions that happened in the period for
    // leads from ANY cohort — what the main number (this period's cohort, and
    // where it stands now) cannot show, and the line a rep checks against
    // their day. Levels whose main number already counts the period's own
    // events (01) send none (Lars, 2026-09-08).
    if (d.activity && d.activity.some(a => !a.hidden)) h += activityLine(d.activity);
    // Day / week views: the actual leads, for the setter's QC (funnel-leads.js) — each list
    // behind its own dropdown, closed by default (Lars, 2026-09-09: "not such a huge scroll").
    if (Array.isArray(d.flow) && d.flow.length) h += flowStrip(d.flow);      // every stage: what happens inside it, as a flow of counts (Lars, 2026-09-23)
    else if (l.level === '01') h += stageFlow01(l, metrics, d);             // older cards, until the next hourly run
    if (d.leads && d.leads.length) h += leadsDropdown(l.level + '-cohort', d.leads, d.leads_label || 'leads in this period');
    if (d.activity_leads && d.activity_leads.length) h += leadsDropdown(l.level + '-activity', d.activity_leads, d.activity_leads_label || 'happened in this period');
    // Rep removals are the most common reason a level shrinks and a signal in
    // their own right (a high desk-DQ share = list targeting), so they get their
    // own always-visible block with one tile per reason (Lars, 2026-09-04).
    if (d.removals && d.removals.items && d.removals.items.length && Number(d.removals.total) > 0) h += removalsBlock(d.removals);
    // Everything that explains the number — what came in, what we removed and
    // why, what is left, where the rest went, and which feed each part comes
    // from — sits behind one toggle (Lars, 2026-09-04: "the main number like it
    // is now and then a drop down with the details").
    const hasDetails = (d.breakdown && d.breakdown.length) || d.denominator_caveat || (d.sources && d.sources.length);
    if (hasDetails) {
      const open = _open.has(l.level);
      h += `<button id="funnel-toggle-${esc(l.level)}" onclick="toggleFunnelDetails('${esc(l.level)}')" style="margin-top:8px;padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:var(--card);font-size:11px;font-weight:600;color:#374151;cursor:pointer">${open ? '▾' : '▸'} Details</button>`;
      h += `<div id="funnel-details-${esc(l.level)}" ${open ? '' : 'hidden'}>`;
      if (d.breakdown && d.breakdown.length) h += breakdownTable(d.breakdown);
      if (d.denominator_caveat) {
        const warn = !/^complete/i.test(String(d.denominator_caveat));
        h += `<div style="margin-top:10px;font-size:11px;${warn ? 'color:#92400e;background:#fffbeb;border:1px solid #fde68a;' : 'color:#6b7280;background:#f9fafb;border:1px solid var(--border);'}border-radius:6px;padding:6px 8px">${esc(String(d.denominator_caveat))}</div>`;
      }
      if (d.sources && d.sources.length) h += sourcesTable(d.sources);
      h += `</div>`;
    }
  } else {
    h += `<div style="margin-top:10px;font-size:12px;color:#9ca3af">No tracking yet — this level is still measured by hand.</div>`;
  }
  h += `</div></div>`;
  return h;
}

/** A lead list behind its own dropdown. */
function leadsDropdown(key, rows, label) {
  const open = _openLeads.has(key);
  const missing = rows.filter(r => r.needs_info).length;
  const stale = rows.filter(r => !r.needs_info && r.stale).length;
  return `<div style="margin-top:6px">
    <button id="funnel-leads-toggle-${esc(key)}" onclick="toggleFunnelLeads('${esc(key)}')" style="padding:4px 10px;border:1px solid #c7d2fe;border-radius:6px;background:#eef2ff;font-size:11px;font-weight:600;color:#3730a3;cursor:pointer">${open ? '▾' : '▸'} ${esc(label)} · ${rows.length}${missing ? ` <span style="margin-left:4px;padding:0 6px;border-radius:4px;background:#fde68a;color:#92400e">${missing} no record</span>` : ''}${stale ? ` <span style="margin-left:4px;padding:0 6px;border-radius:4px;background:#fed7aa;color:#9a3412">${stale} stale</span>` : ''}</button>
    <div id="funnel-leads-${esc(key)}" ${open ? '' : 'hidden'}>${leadsTable(rows, label, key.slice(0, 2))}</div></div>`;
}

window.toggleFunnelLeads = (key) => {
  if (_openLeads.has(key)) _openLeads.delete(key); else _openLeads.add(key);
  const el = document.getElementById('funnel-leads-' + key);
  if (el) el.hidden = !_openLeads.has(key);
  const btn = document.getElementById('funnel-leads-toggle-' + key);
  if (btn) btn.innerHTML = (_openLeads.has(key) ? '▾' : '▸') + btn.innerHTML.slice(1);
};

/** The events of the period, for the reps to check against what they did. */
function activityLine(items) {
  const bits = items.filter(a => !a.hidden).map(a => `<span style="white-space:nowrap"><strong style="color:#1e1b4b;font-variant-numeric:tabular-nums">${fmtCount(a.value)}</strong> ${esc(String(a.label))}</span>`).join('<span style="color:#d1d5db"> · </span>');
  return `<div style="margin-top:8px;padding:6px 10px;border:1px solid #c7d2fe;background:#eef2ff;border-radius:8px;font-size:12px;color:#374151;display:flex;gap:6px;flex-wrap:wrap;align-items:baseline"><span style="font-size:10px;font-weight:700;color:#4338ca;letter-spacing:.03em" title="Conversions recorded in the period for leads from any cohort — the main number only follows the leads that entered this level in the period">ALSO IN THIS PERIOD</span>${bits}</div>`;
}

/** What the reps removed from a level, per reason, shown big. Not losses —
 *  a lead we removed leaves the level — but the share is a targeting signal. */
function removalsBlock(r) {
  const share = r.of ? ` · ${Math.round((r.total / r.of) * 100)}% of ${fmtCount(r.of)} ${esc(r.of_label || '')}` : '';
  // Deliberately quieter than the rate above it (Lars, 2026-09-04): neutral
  // ground, small tiles, muted text — supporting data, not the headline.
  let h = `<div style="margin-top:10px;padding:8px 10px;border:1px solid var(--border);background:#f9fafb;border-radius:8px">
    <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
      <span style="font-size:10px;font-weight:700;color:#6b7280;letter-spacing:.03em">${esc(r.title || 'REMOVED BY REPS')}</span>
      <span style="font-size:11px;color:#6b7280;font-variant-numeric:tabular-nums">${fmtCount(r.total)}${share} · not losses</span>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">`;
  r.items.forEach(it => {
    h += `<div style="min-width:110px;padding:5px 10px;background:var(--card);border:1px solid var(--border);border-radius:6px">
      <div style="font-size:15px;font-weight:700;color:#92400e;font-variant-numeric:tabular-nums;line-height:1.1">${fmtCount(it.value)}</div>
      <div style="font-size:10px;color:#6b7280;margin-top:2px;line-height:1.3">${esc(String(it.label))}</div>
    </div>`;
  });
  h += `</div>`;
  if (r.note) h += `<div style="font-size:10px;color:#9ca3af;margin-top:6px;line-height:1.4">${esc(String(r.note))}</div>`;
  return h + `</div>`;
}

/** The arithmetic behind a level, as rows the tracker emits:
 *  { label, value, indent (0–2), style: 'total' | 'out' | 'loss' | 'muted' }.
 *  'out' is something WE removed from the level (shown with a minus);
 *  'loss' is something that stayed in and did not convert. */
function breakdownTable(rows) {
  let h = `<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px">
    <div style="font-size:11px;font-weight:700;color:#6b7280;margin-bottom:6px">HOW THE NUMBER BREAKS DOWN</div>
    <table style="border-collapse:collapse;width:100%;max-width:560px;font-size:12px">`;
  rows.forEach(r => {
    const indent = 8 + 18 * (r.indent || 0);
    const style = r.style || '';
    const color = style === 'out' ? '#b45309' : style === 'loss' ? '#b91c1c' : style === 'muted' ? '#9ca3af' : '#1f2937';
    const weight = style === 'total' ? 700 : (r.indent ? 400 : 600);
    const border = style === 'total' ? 'border-top:1px solid var(--border);' : '';
    const val = style === 'out' ? `−${fmtCount(r.value)}` : fmtCount(r.value);
    h += `<tr><td style="padding:3px 8px 3px ${indent}px;color:${color};font-weight:${weight};${border}">${esc(String(r.label))}</td>
          <td style="padding:3px 8px;text-align:right;font-variant-numeric:tabular-nums;color:${color};font-weight:${weight};white-space:nowrap;${border}">${val}</td></tr>`;
  });
  return h + `</table></div>`;
}

function periodLabel(key) {
  const r = periodRange(key);
  const p = periods(backfillStart()).find(x => x.key === key);
  if (!r) return 'all time';
  const name = p && p.label ? p.label.toLowerCase() : rangeLabel(r);
  return `${name} (${r.from === r.to ? r.from : r.from + ' → ' + r.to})`;
}

/** Today · Yesterday · This week · Last week · All — days in Los Angeles time. */
function periodBar() {
  let h = `<div style="position:relative;display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:12px">`;
  const chip = (on, onclick, label, id) => `<button ${id ? `id="${id}"` : ''} onclick="${onclick}" style="padding:5px 12px;border:1px solid ${on ? '#1e1b4b' : 'var(--border)'};border-radius:999px;background:${on ? '#1e1b4b' : 'var(--card)'};color:${on ? '#fff' : 'var(--text)'};font-size:12px;font-weight:600;cursor:pointer">${label}</button>`;
  periods(backfillStart()).forEach(p => { h += chip(_period === p.key, `setFunnelPeriod('${p.key}')`, esc(p.label)); });
  const custom = _period.startsWith('range:') ? periodRange(_period) : null;
  const nd = custom ? rangeDays(custom) : 0;
  h += chip(!!custom, 'funnelPickToggle()', '📅 ' + (custom ? esc(rangeLabel(custom)) + ` <span style="font-weight:400;opacity:.8">· ${nd} ${nd === 1 ? 'day' : 'days'}</span>` : 'Pick dates'), 'funnel-pick-chip');
  const r = periodRange(_period);
  h += `<span style="font-size:11px;color:#9ca3af;margin-left:4px">${r ? esc(r.from === r.to ? r.from : r.from + ' → ' + r.to) + ' · Los Angeles days · each level shows the leads that entered it in this period' : 'everything since the window opened, refreshed hourly'}</span>`;
  if (_pick.open) h += calendarPopover();
  return h + `</div>`;
}

function levelError(l) {
  return `<div style="border:1px solid var(--border);border-radius:10px;padding:14px 16px;background:var(--card);display:flex;gap:16px;align-items:center">
    <div style="flex-shrink:0;width:34px;height:34px;border-radius:8px;background:#1e1b4b;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px">${esc(l.level)}</div>
    <div><div style="font-size:14px;font-weight:700;color:#1e1b4b">${esc(l.label)}</div><div style="font-size:12px;color:#b91c1c">No answer for this period: ${esc(String(l.error))}</div></div></div>`;
}

window.toggleFunnelDetails = (level) => {
  if (_open.has(level)) _open.delete(level); else _open.add(level);
  const el = document.getElementById('funnel-details-' + level);
  if (el) el.hidden = !_open.has(level);
  const btn = document.getElementById('funnel-toggle-' + level);
  if (btn) btn.textContent = (_open.has(level) ? '▾' : '▸') + ' Details';
};

export function renderFunnel() {
  if (_error) {
    return `<div style="padding:24px"><div style="color:#b91c1c;font-size:13px">Could not load the funnel: ${esc(_error)}</div>
      <button onclick="refreshFunnel()" style="margin-top:10px;padding:6px 12px;border:1px solid var(--border);border-radius:7px;background:var(--card);font-size:12px;cursor:pointer">Try again</button></div>`;
  }
  if (_levels === null) {
    return `<div style="padding:24px;color:#9ca3af;font-size:13px">Loading the funnel…</div>`;
  }

  let h = `<div style="padding:16px 28px;max-width:1700px;margin:0 auto">`; // full width: the lead lists need the room (Lars, 2026-09-11: "there's a ton of blank space")
  h += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <div>
            <div style="font-size:18px;font-weight:800;color:#1e1b4b">Sales pipeline</div>
            <div style="font-size:12px;color:#6b7280">Every level of the acquisition funnel, from emails sent to clients retained.</div>
          </div>
          <button onclick="refreshFunnel()" style="display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border:1px solid var(--border);border-radius:7px;background:var(--card);font-size:12px;cursor:pointer">${svgIcon('refresh-cw', 12)} Refresh</button>
        </div>`;
  h += periodBar();
  h += `<div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">`;
  // One level's bad answer must not take the screen down: a card that throws renders as its own error card.
  const safeCard = (r) => { try { return r.error ? levelError(r) : levelCard(r); } catch (e) { return levelError({ ...r, error: 'could not render: ' + (e && e.message || e) }); } };
  if (_period === 'all') {
    // The All cards come from the hourly run; their lead dropdowns come from the period views over the whole window
    // (Lars, 2026-09-18: "the all tab is the only one that does not include the blue lead dropdowns"). Same rows, same
    // yellow/orange rules; only the numbers stay the card's.
    const ws = backfillStart(), allKey = ws ? `range:${ws}:${todayYmdLA()}` : null;
    const pr = allKey ? periodRows(allKey) : null;
    if (allKey && !pr) loadPeriod(allKey, null);
    const merged = _levels.map(l => {
      const x = Array.isArray(pr) ? pr.find(q => q.level === l.level) : null;
      return x && x.detail && x.detail.leads ? { ...l, detail: { ...(l.detail || {}), leads: x.detail.leads, leads_label: `all leads since ${ws}`, activity_leads: x.detail.activity_leads, activity_leads_label: x.detail.activity_leads_label } } : l;
    });
    h += merged.map(safeCard).join('');
  } else {
    const rows = periodRows(_period);
    if (!rows) { loadPeriod(_period, null); h += `<div style="padding:16px;color:#9ca3af;font-size:13px">Asking every level for ${esc(periodLabel(_period))}…</div>`; }
    else if (rows.error) h += `<div style="padding:16px;color:#b91c1c;font-size:13px">Could not load ${esc(periodLabel(_period))}: ${esc(rows.error)} <button onclick="refreshFunnel()" style="margin-left:8px;padding:3px 8px;border:1px solid var(--border);border-radius:6px;background:var(--card);font-size:11px;cursor:pointer">Try again</button></div>`;
    else h += rows.map(safeCard).join('');
  }
  h += `</div>`;
  h += `<div style="margin-top:16px;font-size:11px;color:#9ca3af;line-height:1.5">
          A <strong>verified baseline</strong> was settled by hand against source evidence and is never recomputed from a live count — the baseline's discovery calls were established by reading the call recordings one by one, which no automated count can reproduce. Live tracking adds to that baseline rather than replacing it.
        </div>`;
  h += `</div>`;
  return h;
}

window.refreshFunnel = () => {
  import('./render.js?v=20260923144404').then(m => reloadFunnel(m.render));
};
