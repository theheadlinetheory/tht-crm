// ═══════════════════════════════════════════════════════════
// FUNNEL DAILY — the pipeline by day, week or month (Lars, 2026-11-10)
// ═══════════════════════════════════════════════════════════
//
// The level cards say how many; this says how many ON EACH DAY, so the trend
// is visible without clicking through days. One chart, one stage at a time by
// default — Lars: "mostly we'll be looking at each metric individually" — with
// a dropdown to pick stages; several at once draw on one chart with a legend,
// or, with Stacked on, as one small chart per stage on a shared time axis.
//
// The pipeline-daily function answers from the ledger with the levels' own
// rules, so a range here adds up to the cards for the same range. Weeks and
// months are the same day rows grouped in the browser (funnel-trend-group.js,
// tested). The offer and channel chips on the Funnel tab apply here too.

import { esc } from './utils.js?v=20261114043221';
import { state } from './app.js?v=20261114043221';
import { multiFilterDropdown } from './html-helpers.js?v=20261114043221';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=20261114043221';
import { todayYmdLA, addDays } from './funnel-period.js?v=20261114043221';
import { groupDays, avgComplete, dowOf, shortDay } from './funnel-trend-group.js?v=20261114043221';
import { authedFetch } from './edge-auth.js?v=20261114043221'; // session token, not the anon key (A2#2, S1, 2026-11-13)

// The stages, in funnel order, each with its own colour for good (a stage keeps its colour whatever else is picked —
// palette validated with the dataviz checks, 2026-11-10). `hint` is the counting rule in one line.
const METRICS = [
  { key: 'qualified',       label: 'Qualified positive responses', color: '#4f46e5', hint: 'Positives that came in that day, less the ones the reps removed (desk DQ, phone DQ with no disco) — level 02\'s denominator' },
  { key: 'disco_scheduled', label: 'Discovery calls scheduled',    color: '#059669', hint: 'Discovery calls put on the calendar that day (a warm call that went straight into a disco counts on the call day), whichever day the lead came in' },
  { key: 'disco_conducted', label: 'Discovery calls conducted',    color: '#d97706', hint: 'Discovery calls that happened that day' },
  { key: 'demo_scheduled',  label: 'Demos scheduled',              color: '#db2777', hint: 'Demos booked that day' },
  { key: 'demo_conducted',  label: 'Demos conducted',              color: '#0284c7', hint: 'Demos that happened that day' },
  { key: 'closed',          label: 'Closed won',                   color: '#7c3aed', hint: 'Verbal yes on the demo, dated the day it was won' },
];
const LIGHT = '#c7d2fe'; // a partial week/month bar

const RANGE_KEY = 'funnelDailyRange', GRAN_KEY = 'funnelDailyGran', METRICS_KEY = 'funnelDailyMetrics', STACK_KEY = 'funnelDailyStacked';
const WINDOW_START = '2026-05-04';
// The same range chips whatever the granularity, so nothing on the row moves when a chip is clicked (Lars, 2026-11-10:
// "the button locations change every time you click something"). A short range by month is a couple of partial bars.
const RANGES = [{ key: '4w', label: '4 weeks', days: 28 }, { key: '8w', label: '8 weeks', days: 56 }, { key: '12w', label: '12 weeks', days: 84 }, { key: '26w', label: '26 weeks', days: 182 }, { key: 'all', label: 'Since May 4', days: 0 }];
const GRANS = [{ key: 'day', label: 'Day' }, { key: 'week', label: 'Week' }, { key: 'month', label: 'Month' }];
const lsGet = (k, d) => { try { return localStorage.getItem(k) || d; } catch (_) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } };
let _gran = GRANS.some(g => g.key === lsGet(GRAN_KEY, 'day')) ? lsGet(GRAN_KEY, 'day') : 'day';
let _range = lsGet(RANGE_KEY, '8w');
let _stacked = lsGet(STACK_KEY, '') === '1';
let _table = false;
// The picked stages live on the shared state so the CRM's own multi-select dropdown (html-helpers) can drive them.
state.funnelMetrics = (() => { try { const v = JSON.parse(lsGet(METRICS_KEY, '')); return Array.isArray(v) ? v.filter(l => METRICS.some(m => m.label === l)) : null; } catch (_) { return null; } })() || [METRICS[0].label];
state.showFunnelMetricsDropdown = false;
// A click anywhere else closes the stage dropdown (the global handler in auth.js only knows the acquisition filter).
document.addEventListener('click', (e) => {
  if (!state.showFunnelMetricsDropdown) return;
  if (e.target && e.target.closest && e.target.closest('.acq-filter-wrap')) return;
  state.showFunnelMetricsDropdown = false; rerenderNow();
}, true);
const picked = () => { const p = METRICS.filter(m => state.funnelMetrics.includes(m.label)); return p.length ? p : METRICS; }; // the dropdown's "All" = every stage

const _cache = {};   // key → { data, at } | { error, at }
let _loading = null;
const TTL_MS = 15 * 60e3;

/** The range chip in force. */
const rangeDef = () => RANGES.find(r => r.key === _range) || RANGES[1];
const rangeOf = () => { const r = rangeDef(), to = todayYmdLA(); return { from: r.days ? addDays(to, -(r.days - 1)) : WINDOW_START, to }; };
const cacheKey = (offer, channel) => `${rangeDef().days}@${offer || ''}@${channel || ''}`;

function fetchDaily(offer, channel, rerender) {
  const key = cacheKey(offer, channel);
  if (_loading === key) return;
  _loading = key;
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY };
  const payload = { ...rangeOf(), ...(offer ? { offer } : {}), ...(channel ? { channel } : {}) };
  authedFetch(`${SUPABASE_URL}/functions/v1/pipeline-daily`, { method: 'POST', headers, body: JSON.stringify(payload) })
    .then(async r => { const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (_) { /* not JSON */ }
      if (!r.ok || !j || j.ok === false) throw new Error((j && (j.error || j.message)) || ('HTTP ' + r.status));
      _cache[key] = { data: j, at: Date.now() }; })
    .catch(e => { _cache[key] = { error: String(e && e.message || e), at: Date.now() }; })
    .finally(() => { if (_loading === key) _loading = null; if (rerender) rerender(); });
}

/** Forget every cached answer (the Refresh button). */
export function clearFunnelDaily() { for (const k of Object.keys(_cache)) delete _cache[k]; }

const rerenderNow = () => import('./render.js?v=20261114043221').then(m => m.render());
window.setFunnelDailyRange = (key) => { _range = key; lsSet(RANGE_KEY, key); rerenderNow(); };
window.setFunnelDailyGran = (key) => { if (GRANS.some(g => g.key === key)) { _gran = key; lsSet(GRAN_KEY, key); rerenderNow(); } };
window.toggleFunnelDailyStacked = () => { _stacked = !_stacked; lsSet(STACK_KEY, _stacked ? '1' : ''); rerenderNow(); };
window.toggleFunnelDailyTable = () => { _table = !_table; rerenderNow(); };

// ── Charts ──
const W = 1400, L = 34, R = 14, T = 16; // viewBox units; the svg scales to its column, so the hover maths divide by W
const XB = 26, NB = 6;                   // bottom margin with / without the date labels
let _groups = [], _xs = [], _ys = {};    // what is on screen, for the shared hover layer
const colorOf = (key) => (METRICS.find(m => m.key === key) || METRICS[0]).color;

function yScale(groups, keys, H, bottom, maxLines) {
  const max = Math.max(1, ...groups.map(g => Math.max(...keys.map(k => g[k] || 0))));
  const step = [1, 2, 5, 10, 25, 50, 100, 250].find(s => Math.ceil(max / s) <= maxLines) || 500;
  const top = Math.ceil(max / step) * step;
  return { step, top, y: (v) => T + (1 - v / top) * (H - T - bottom) };
}
function gridlines(sc, endsOnly) {
  let s = '';
  for (let v = 0; v <= sc.top; v += sc.step) {
    s += `<line x1="${L}" y1="${sc.y(v).toFixed(1)}" x2="${W - R}" y2="${sc.y(v).toFixed(1)}" stroke="${v === 0 ? '#d1d5db' : '#eef0f3'}"/>`;
    if (!endsOnly || v === 0 || v === sc.top) s += `<text x="${L - 5}" y="${(sc.y(v) + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="#9ca3af">${v}</text>`;
  }
  return s;
}
/** Date labels along the bottom: every Monday for days (every other on long ranges), each bar for weeks/months. */
function xLabels(groups, H) {
  const n = groups.length;
  let s = '', lastX = -Infinity;
  groups.forEach((g, i) => {
    if (_gran === 'day') {
      if (dowOf(g.key) !== 1 || _xs[i] - lastX < 50) return;
      if (n > 70 && Math.round((Date.parse(g.key) - Date.parse(groups[0].key)) / 864e5 / 7) % 2 === 1 && n - i > 7) return;
    } else if (n > 14 && i % 2 === 1) return;
    lastX = _xs[i];
    s += `<text x="${_xs[i].toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="#6b7280">${esc(g.label)}</text>`;
  });
  return s;
}
function weekendBands(groups, H, bottom) {
  const n = groups.length, slot = n > 1 ? (W - L - R) / (n - 1) : W - L - R;
  let s = '';
  for (let i = 0; i < n; i++) { // weekends as faint bands: a zero there is the weekend, not a bad day
    const w = dowOf(groups[i].key);
    if (w === 6 && i + 1 < n) s += `<rect x="${(_xs[i] - slot / 2).toFixed(1)}" y="${T}" width="${(slot * 2).toFixed(1)}" height="${H - T - bottom}" fill="#f3f4f6"/>`;
    else if (w === 6 || (w === 0 && (i === 0 || dowOf(groups[i - 1].key) !== 6))) s += `<rect x="${(_xs[i] - slot / 2).toFixed(1)}" y="${T}" width="${slot.toFixed(1)}" height="${H - T - bottom}" fill="#f3f4f6"/>`;
  }
  return s;
}

/** One svg: the given stages on one y scale. Bars for a single stage by week/month, lines otherwise.
 *  `small` = a row of the stacked view (shorter, fewer gridlines); `last` = carries the date labels. */
function chartSvg(groups, keys, { small, last }) {
  const H = small ? 110 : 260, bottom = last ? XB : NB, n = groups.length;
  const sc = yScale(groups, keys, H, bottom, small ? 4 : 6);
  for (const k of keys) _ys[k] = groups.map(g => sc.y(g[k] || 0));
  const bars = _gran !== 'day' && keys.length === 1;
  let s = (_gran === 'day' ? weekendBands(groups, H, bottom) : '') + gridlines(sc, small) + (last ? xLabels(groups, H) : '');
  if (bars) {
    const k = keys[0], slot = (W - L - R) / n, bw = Math.min(slot * 0.62, 70);
    groups.forEach((g, i) => {
      const v = g[k] || 0, y = _ys[k][i], h = Math.max(0, sc.y(0) - y);
      s += `<rect x="${(_xs[i] - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${g.partial ? LIGHT : colorOf(k)}"/>`;
      s += `<text x="${_xs[i].toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="${g.partial ? '#6b7280' : '#1f2937'}">${v}</text>`;
    });
  } else {
    for (const k of keys) {
      s += `<polyline fill="none" stroke="${colorOf(k)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${_xs.map((x, i) => `${x.toFixed(1)},${_ys[k][i].toFixed(1)}`).join(' ')}"/>`;
      if (n <= 90) s += _xs.map((x, i) => `<circle cx="${x.toFixed(1)}" cy="${_ys[k][i].toFixed(1)}" r="${small ? 3 : 3.5}" fill="${colorOf(k)}" stroke="#fff" stroke-width="1.5"/>`).join('');
    }
  }
  return `<svg class="funnel-daily-svg" viewBox="0 0 ${W} ${H}" style="display:block;width:100%;height:auto" onmousemove="funnelDailyHover(event)" onmouseleave="funnelDailyLeave()">${s}
    <g class="funnel-daily-hover" style="display:none"><line class="funnel-daily-xh" x1="0" y1="${T}" x2="0" y2="${H - bottom}" stroke="#9ca3af" stroke-dasharray="3 3"/>${bars ? '' : keys.map(k => `<circle class="funnel-daily-dot" data-key="${k}" r="5" fill="${colorOf(k)}" stroke="#fff" stroke-width="2"/>`).join('')}</g></svg>`;
}

// ── The shared hover: one crosshair through every chart on screen, one tooltip with the picked stages ──
window.funnelDailyHover = (ev) => {
  const svg = ev.currentTarget, wrap = document.getElementById('funnel-daily-charts');
  if (!svg || !wrap || !_xs.length) return;
  const box = svg.getBoundingClientRect();
  const px = (ev.clientX - box.left) / box.width * W;
  let i = 0;
  for (let k = 1; k < _xs.length; k++) if (Math.abs(_xs[k] - px) < Math.abs(_xs[i] - px)) i = k;
  const g = _groups[i], x = _xs[i];
  wrap.querySelectorAll('.funnel-daily-svg').forEach(el => {
    const hov = el.querySelector('.funnel-daily-hover'), xh = el.querySelector('.funnel-daily-xh');
    if (hov) hov.style.display = '';
    if (xh) { xh.setAttribute('x1', x); xh.setAttribute('x2', x); }
    el.querySelectorAll('.funnel-daily-dot').forEach(dot => { dot.setAttribute('cx', x); dot.setAttribute('cy', (_ys[dot.dataset.key] || [])[i] ?? 0); });
  });
  const tip = document.getElementById('funnel-daily-tip'); if (!tip) return;
  const title = _gran === 'day' ? `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dowOf(g.key)]} ${g.label}` : g.label;
  const partial = g.partial && _gran !== 'day' ? `<div style="color:#9ca3af;margin-top:1px">partial · ${g.days} of ${g.expected} days</div>` : '';
  const sel = picked(), removed = (g.positives || 0) - (g.qualified || 0);
  tip.innerHTML = `<div style="font-weight:700;color:#1f2937">${esc(title)}</div>${partial}
    <table style="border-collapse:collapse;margin-top:4px">${sel.map(m => `<tr style="color:#374151"><td style="padding:1px 6px 1px 0"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${m.color}"></span></td><td style="padding:1px 10px 1px 0">${esc(m.label)}</td><td style="text-align:right;font-variant-numeric:tabular-nums;font-weight:700;color:#1f2937">${g[m.key] || 0}</td></tr>`).join('')}</table>
    ${sel.some(m => m.key === 'qualified') && removed ? `<div style="color:#9ca3af;margin-top:3px">${g.positives} positives in all, ${removed} removed by reps</div>` : ''}`;
  const wb = wrap.getBoundingClientRect();
  tip.style.display = '';
  tip.style.left = `${Math.min(ev.clientX - wb.left + 14, wb.width - 250)}px`;
  tip.style.top = `${Math.min(ev.clientY - wb.top + 14, Math.max(0, wb.height - 120))}px`;
};
window.funnelDailyLeave = () => {
  document.querySelectorAll('#funnel-daily-charts .funnel-daily-hover').forEach(el => { el.style.display = 'none'; });
  const tip = document.getElementById('funnel-daily-tip'); if (tip) tip.style.display = 'none';
};

/** A stage's total and average for the range, as 'NNN · 2.7 per weekday'. */
function stat(groups, m) {
  const total = groups.reduce((s, g) => s + (g[m.key] || 0), 0);
  let avg = '';
  if (_gran === 'day') { const wd = groups.filter(g => dowOf(g.key) % 6 !== 0); if (wd.length) avg = `${(wd.reduce((s, g) => s + (g[m.key] || 0), 0) / wd.length).toFixed(1)} per weekday`; }
  else { const a = avgComplete(groups, m.key); if (a !== null) avg = `${a.toFixed(1)} per full ${_gran}`; }
  return { total, avg };
}

/** Stacked: one short chart per picked stage, its name, total and average on the left. */
function stackedRows(groups, sel) {
  return sel.map((m, idx) => {
    const { total, avg } = stat(groups, m), last = idx === sel.length - 1;
    return `<div style="display:grid;grid-template-columns:200px 1fr;gap:12px;align-items:end;${idx ? 'border-top:1px solid #f3f4f6;' : ''}padding:${idx ? 6 : 0}px 0 0">
      <div style="padding-bottom:${last ? XB / 2 : NB}px" title="${esc(m.hint)}">
        <div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#1e1b4b;line-height:1.25"><span style="width:8px;height:8px;border-radius:50%;background:${m.color};flex-shrink:0"></span>${esc(m.label)}</div>
        <div style="display:flex;align-items:baseline;gap:8px;margin-top:2px"><span style="font-size:18px;font-weight:800;color:#1e1b4b;font-variant-numeric:tabular-nums">${total.toLocaleString('en-US')}</span><span style="font-size:11px;color:#9ca3af">${avg}</span></div>
      </div>
      <div style="min-width:0">${chartSvg(groups, [m.key], { small: true, last })}</div>
    </div>`;
  }).join('');
}

/** One chart: the picked stages together, a legend with each one's total above it. */
function oneChart(groups, sel) {
  const legend = sel.map(m => { const { total, avg } = stat(groups, m); return `<span style="display:inline-flex;align-items:baseline;gap:6px;margin-right:18px" title="${esc(m.hint)}">
      <span style="width:9px;height:9px;border-radius:50%;background:${m.color};align-self:center"></span>
      <span style="font-size:${sel.length === 1 ? 22 : 16}px;font-weight:800;color:#1e1b4b;font-variant-numeric:tabular-nums">${total.toLocaleString('en-US')}</span>
      <span style="font-size:12px;color:#6b7280">${sel.length === 1 ? '' : esc(m.label) + (avg ? ' · ' : '')}${avg}</span></span>`; }).join('');
  return `<div style="display:flex;align-items:baseline;flex-wrap:wrap;margin:6px 0 4px;min-height:30px">${legend}</div>`
    + chartSvg(groups, sel.map(m => m.key), { small: false, last: true });
}

function tableHtml(groups, sel) {
  const unit = _gran === 'day' ? 'Day' : _gran === 'week' ? 'Week' : 'Month';
  const th = (t, right) => `<th style="padding:4px 8px;text-align:${right ? 'right' : 'left'};white-space:nowrap">${t}</th>`;
  const rows = [...groups].reverse().map(g => `<tr style="color:${g.partial ? '#9ca3af' : '#1f2937'}"><td style="padding:3px 8px;white-space:nowrap">${esc(g.label)}${g.partial && _gran !== 'day' ? ` <span style="font-size:10px">(${g.days} of ${g.expected} days)</span>` : ''}</td>
    ${sel.map(m => `<td style="padding:3px 8px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600">${g[m.key] || 0}</td>`).join('')}</tr>`).join('');
  return `<div style="max-height:300px;overflow:auto;margin-top:10px;border:1px solid var(--border);border-radius:8px"><table style="border-collapse:collapse;font-size:12px;width:100%">
    <thead><tr style="position:sticky;top:0;background:#f9fafb;color:#6b7280;font-size:11px">${th(unit)}${sel.map(m => th(esc(m.label), true)).join('')}</tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

const chip = (on, onclick, label) => `<button onclick="${onclick}" style="padding:4px 11px;border:1px solid ${on ? '#1e1b4b' : 'var(--border)'};border-radius:999px;background:${on ? '#1e1b4b' : 'var(--card)'};color:${on ? '#fff' : 'var(--text)'};font-size:11px;font-weight:600;cursor:pointer">${label}</button>`;

/** The panel. `filterLabel` names the active offer/channel chips for the subtitle. */
export function renderFunnelDaily(offer, channel, filterLabel) {
  const key = cacheKey(offer, channel);
  const c = _cache[key];
  const fresh = c && Date.now() - c.at < TTL_MS && (!c.data || c.data.to === todayYmdLA());
  if (!fresh) fetchDaily(offer, channel, rerenderNow);
  lsSet(METRICS_KEY, JSON.stringify(state.funnelMetrics)); // the dropdown writes state; remember it here
  const sel = picked(), several = sel.length > 1;

  let body;
  if (c && c.error) body = `<div style="padding:14px 0;color:#b91c1c;font-size:12px">Could not load the trend: ${esc(c.error)}</div>`;
  else if (!c || !c.data) body = `<div style="padding:14px 0;color:#9ca3af;font-size:12px">Counting each day…</div>`;
  else {
    const groups = groupDays(c.data.days || [], _gran, todayYmdLA()), n = groups.length;
    _groups = groups; _ys = {};
    _xs = groups.map((_, i) => _gran === 'day' ? (n === 1 ? (L + W - R) / 2 : L + (i / (n - 1)) * (W - L - R)) : L + ((W - L - R) / n) * (i + 0.5));
    body = `<div id="funnel-daily-charts" style="position:relative">${several && _stacked ? stackedRows(groups, sel) : oneChart(groups, sel)}
      <div id="funnel-daily-tip" style="display:none;position:absolute;pointer-events:none;background:#fff;border:1px solid var(--border);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.12);padding:8px 10px;font-size:11px;min-width:220px;z-index:5"></div></div>`
      + (_table ? tableHtml(groups, sel) : '');
  }
  const unit = _gran === 'day' ? 'day' : _gran === 'week' ? 'week' : 'month';
  const title = (several ? 'Pipeline' : esc(sel[0].label)) + ` per ${unit}` + (filterLabel ? ` · ${esc(filterLabel)}` : '');
  // Every control is always on the row, in the same place: the dropdown has a fixed width, Stacked is greyed rather
  // than hidden with one stage, the range chips are the same set for day, week and month.
  const stackChip = `<button onclick="${several ? 'toggleFunnelDailyStacked()' : ''}" ${several ? '' : 'disabled'} style="padding:4px 11px;border:1px solid ${several && _stacked ? '#1e1b4b' : 'var(--border)'};border-radius:999px;background:${several && _stacked ? '#1e1b4b' : 'var(--card)'};color:${several && _stacked ? '#fff' : several ? 'var(--text)' : '#c4c8d0'};font-size:11px;font-weight:600;cursor:${several ? 'pointer' : 'default'}">Stacked</button>`;
  return `<div style="border:1px solid var(--border);border-radius:10px;padding:14px 16px;background:var(--card);margin-top:12px">
    <style>#funnel-daily-controls .acq-filter-wrap{width:220px}#funnel-daily-controls .acq-filter-toggle{width:100%;justify-content:space-between;white-space:nowrap;overflow:hidden}</style>
    <div style="font-size:14px;font-weight:700;color:#1e1b4b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${title}</div>
    <div id="funnel-daily-controls" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px">
      ${multiFilterDropdown(state, 'funnelMetrics', 'showFunnelMetricsDropdown', 'All stages', 'stages', METRICS.map(m => m.label))}
      ${stackChip}
      <span style="width:6px"></span>
      ${GRANS.map(g => chip(_gran === g.key, `setFunnelDailyGran('${g.key}')`, g.label)).join('')}
      <span style="width:6px"></span>
      ${RANGES.map(r => chip(rangeDef().key === r.key, `setFunnelDailyRange('${r.key}')`, esc(r.label))).join('')}
      <span style="margin-left:auto"></span>
      ${chip(_table, 'toggleFunnelDailyTable()', _table ? 'Hide table' : 'Table')}
    </div>
    ${body}
  </div>`;
}
