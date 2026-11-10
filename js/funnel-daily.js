// ═══════════════════════════════════════════════════════════
// FUNNEL DAILY — the pipeline by day, week or month (Lars, 2026-11-10)
// ═══════════════════════════════════════════════════════════
//
// The level cards say how many; this says how many ON EACH DAY, so the trend
// is visible without clicking through days. One small chart per stage, stacked
// on a shared time axis (small multiples: a closed deal a week and ten
// positives a day cannot share one y axis). The pipeline-daily function
// answers from the ledger with the levels' own rules, so a range here adds up
// to the cards for the same range. Weeks and months are the same day rows
// grouped in the browser (funnel-trend-group.js, tested).
//
// The offer and channel chips on the Funnel tab apply here too (the function
// takes them). The panel keeps its own stretch of time — the period chips above
// are for the cards, a trend needs weeks.

import { esc } from './utils.js?v=20261110103444';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=20261110103444';
import { todayYmdLA, addDays } from './funnel-period.js?v=20261110103444';
import { groupDays, avgComplete, dowOf, shortDay } from './funnel-trend-group.js?v=20261110103444';

// The stages, in funnel order. `hint` is the counting rule in one line (the tooltip of the row label).
const METRICS = [
  { key: 'qualified',       label: 'Qualified positive responses', hint: 'Positives that came in that day, less the ones the reps removed (desk DQ, phone DQ with no disco) — level 02\'s denominator' },
  { key: 'disco_scheduled', label: 'Discovery calls scheduled',    hint: 'Discovery calls put on the calendar that day (a warm call that went straight into a disco counts on the call day), whichever day the lead came in' },
  { key: 'disco_conducted', label: 'Discovery calls conducted',    hint: 'Discovery calls that happened that day' },
  { key: 'demo_scheduled',  label: 'Demos scheduled',              hint: 'Demos booked that day' },
  { key: 'demo_conducted',  label: 'Demos conducted',              hint: 'Demos that happened that day' },
  { key: 'closed',          label: 'Closed won',                   hint: 'Verbal yes on the demo, dated the day it was won' },
];

const RANGE_KEY = 'funnelDailyRange', GRAN_KEY = 'funnelDailyGran';
const WINDOW_START = '2026-05-04';
// Days and weeks pick a stretch; months always show the whole window (a 4-week month view would be two stubs).
const RANGES = {
  day:   [{ key: '4w', label: '4 weeks', days: 28 }, { key: '8w', label: '8 weeks', days: 56 }, { key: '12w', label: '12 weeks', days: 84 }, { key: 'all', label: 'Since May 4', days: 0 }],
  week:  [{ key: '8w', label: '8 weeks', days: 56 }, { key: '12w', label: '12 weeks', days: 84 }, { key: '26w', label: '26 weeks', days: 182 }, { key: 'all', label: 'Since May 4', days: 0 }],
  month: [{ key: 'all', label: 'Since May 4', days: 0 }],
};
const GRANS = [{ key: 'day', label: 'Day' }, { key: 'week', label: 'Week' }, { key: 'month', label: 'Month' }];
const lsGet = (k, d) => { try { return localStorage.getItem(k) || d; } catch (_) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } };
let _gran = GRANS.some(g => g.key === lsGet(GRAN_KEY, 'day')) ? lsGet(GRAN_KEY, 'day') : 'day';
let _range = lsGet(RANGE_KEY, '8w');
let _table = false;
const _cache = {};   // key → { data, at } | { error, at }
let _loading = null;
const TTL_MS = 15 * 60e3;

/** The range chip in force: the saved one if this granularity offers it, else the granularity's default. */
function rangeDef() {
  const list = RANGES[_gran];
  return list.find(r => r.key === _range) || list.find(r => r.key === '8w') || list[list.length - 1];
}
const rangeOf = () => { const r = rangeDef(), to = todayYmdLA(); return { from: r.days ? addDays(to, -(r.days - 1)) : WINDOW_START, to }; };
const cacheKey = (offer, channel) => `${rangeDef().days}@${offer || ''}@${channel || ''}`;

function fetchDaily(offer, channel, rerender) {
  const key = cacheKey(offer, channel);
  if (_loading === key) return;
  _loading = key;
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY };
  const payload = { ...rangeOf(), ...(offer ? { offer } : {}), ...(channel ? { channel } : {}) };
  fetch(`${SUPABASE_URL}/functions/v1/pipeline-daily`, { method: 'POST', headers, body: JSON.stringify(payload) })
    .then(async r => { const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (_) { /* not JSON */ }
      if (!r.ok || !j || j.ok === false) throw new Error((j && (j.error || j.message)) || ('HTTP ' + r.status));
      _cache[key] = { data: j, at: Date.now() }; })
    .catch(e => { _cache[key] = { error: String(e && e.message || e), at: Date.now() }; })
    .finally(() => { if (_loading === key) _loading = null; if (rerender) rerender(); });
}

/** Forget every cached answer (the Refresh button). */
export function clearFunnelDaily() { for (const k of Object.keys(_cache)) delete _cache[k]; }

const rerenderNow = () => import('./render.js?v=20261110103444').then(m => m.render());
window.setFunnelDailyRange = (key) => { _range = key; lsSet(RANGE_KEY, key); rerenderNow(); };
window.setFunnelDailyGran = (key) => { if (GRANS.some(g => g.key === key)) { _gran = key; lsSet(GRAN_KEY, key); rerenderNow(); } };
window.toggleFunnelDailyTable = () => { _table = !_table; rerenderNow(); };

// ── Charts: one per stage, the same x positions in every one ──
const LINE = '#4f46e5', LIGHT = '#a5b4fc'; // the CRM's one series colour (Trends bars, setter charts); lighter = partial
const W = 1400, H = 110, L = 30, R = 10, T = 16; // viewBox units; the svg scales to its column, so the hover maths divide by these
const XB = 24, NB = 6;                            // bottom margin: the last chart carries the date labels, the others do not
let _groups = [], _xs = [], _ys = {};             // what is on screen, for the shared hover layer

function yScale(groups, key, bottom) {
  const max = Math.max(1, ...groups.map(g => g[key] || 0));
  const step = [1, 2, 5, 10, 25, 50, 100, 250].find(s => Math.ceil(max / s) <= 4) || 500; // at most four gridlines a chart
  const top = Math.ceil(max / step) * step;
  return { step, top, y: (v) => T + (1 - v / top) * (H - T - bottom) };
}
function gridlines(sc) {
  let s = '';
  for (let v = 0; v <= sc.top; v += sc.step) {
    s += `<line x1="${L}" y1="${sc.y(v).toFixed(1)}" x2="${W - R}" y2="${sc.y(v).toFixed(1)}" stroke="${v === 0 ? '#d1d5db' : '#eef0f3'}"/>`;
    if (v === 0 || v === sc.top) s += `<text x="${L - 5}" y="${(sc.y(v) + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="#9ca3af">${v}</text>`;
  }
  return s;
}
/** Date labels along the bottom: every Monday for days (every other on long ranges), each bar for weeks/months. */
function xLabels(groups) {
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
const svgWrap = (key, inner) => `<svg class="funnel-daily-svg" data-key="${key}" viewBox="0 0 ${W} ${H}" style="display:block;width:100%;height:auto" onmousemove="funnelDailyHover(event)" onmouseleave="funnelDailyLeave()">${inner}
  <g class="funnel-daily-hover" style="display:none"><line class="funnel-daily-xh" x1="0" y1="${T}" x2="0" y2="${H - (key === METRICS[METRICS.length - 1].key ? XB : NB)}" stroke="#9ca3af" stroke-dasharray="3 3"/><circle class="funnel-daily-dot" r="5" fill="${LINE}" stroke="#fff" stroke-width="2"/></g></svg>`;

/** Days: a line with markers, weekends shaded. */
function lineSvg(groups, key, last) {
  const n = groups.length, bottom = last ? XB : NB, sc = yScale(groups, key, bottom);
  const slot = n > 1 ? (W - L - R) / (n - 1) : W - L - R;
  _ys[key] = groups.map(g => sc.y(g[key] || 0));
  let s = '';
  for (let i = 0; i < n; i++) { // weekends as faint bands: a zero there is the weekend, not a bad day
    const w = dowOf(groups[i].key);
    if (w === 6 && i + 1 < n) s += `<rect x="${(_xs[i] - slot / 2).toFixed(1)}" y="${T}" width="${(slot * 2).toFixed(1)}" height="${H - T - bottom}" fill="#f3f4f6"/>`;
    else if (w === 6 || (w === 0 && (i === 0 || dowOf(groups[i - 1].key) !== 6))) s += `<rect x="${(_xs[i] - slot / 2).toFixed(1)}" y="${T}" width="${slot.toFixed(1)}" height="${H - T - bottom}" fill="#f3f4f6"/>`;
  }
  s += gridlines(sc) + (last ? xLabels(groups) : '');
  s += `<polyline fill="none" stroke="${LINE}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${_xs.map((x, i) => `${x.toFixed(1)},${_ys[key][i].toFixed(1)}`).join(' ')}"/>`;
  if (n <= 90) s += _xs.map((x, i) => `<circle cx="${x.toFixed(1)}" cy="${_ys[key][i].toFixed(1)}" r="3" fill="${LINE}" stroke="#fff" stroke-width="1.5"/>`).join('');
  return svgWrap(key, s);
}

/** Weeks and months: one bar each, the value on top, partial groups lighter. */
function barsSvg(groups, key, last) {
  const n = groups.length, bottom = last ? XB : NB, sc = yScale(groups, key, bottom);
  const slot = (W - L - R) / n, bw = Math.min(slot * 0.62, 70);
  _ys[key] = groups.map(g => sc.y(g[key] || 0));
  let s = gridlines(sc) + (last ? xLabels(groups) : '');
  groups.forEach((g, i) => {
    const v = g[key] || 0, y = _ys[key][i], h = Math.max(0, sc.y(0) - y);
    s += `<rect x="${(_xs[i] - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${g.partial ? LIGHT : LINE}"/>`;
    s += `<text x="${_xs[i].toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="${g.partial ? '#6b7280' : '#1f2937'}">${v}</text>`;
  });
  return svgWrap(key, s);
}

// ── The shared hover: one crosshair through every chart, one tooltip with every stage for that day ──
window.funnelDailyHover = (ev) => {
  const svg = ev.currentTarget, wrap = document.getElementById('funnel-daily-charts');
  if (!svg || !wrap || !_xs.length) return;
  const box = svg.getBoundingClientRect();
  const px = (ev.clientX - box.left) / box.width * W;
  let i = 0;
  for (let k = 1; k < _xs.length; k++) if (Math.abs(_xs[k] - px) < Math.abs(_xs[i] - px)) i = k;
  const g = _groups[i], x = _xs[i];
  wrap.querySelectorAll('.funnel-daily-svg').forEach(el => {
    const key = el.dataset.key, hov = el.querySelector('.funnel-daily-hover'), xh = el.querySelector('.funnel-daily-xh'), dot = el.querySelector('.funnel-daily-dot');
    if (hov) hov.style.display = '';
    if (xh) { xh.setAttribute('x1', x); xh.setAttribute('x2', x); }
    if (dot) { dot.setAttribute('cx', x); dot.setAttribute('cy', (_ys[key] || [])[i] ?? 0); dot.style.display = _gran === 'day' ? '' : 'none'; }
  });
  const tip = document.getElementById('funnel-daily-tip'); if (!tip) return;
  const here = svg.dataset.key;
  const title = _gran === 'day' ? `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dowOf(g.key)]} ${g.label}` : g.label;
  const partial = g.partial && _gran !== 'day' ? `<div style="color:#9ca3af;margin-top:1px">partial · ${g.days} of ${g.expected} days</div>` : '';
  const removed = (g.positives || 0) - (g.qualified || 0);
  tip.innerHTML = `<div style="font-weight:700;color:#1f2937">${esc(title)}</div>${partial}
    <table style="border-collapse:collapse;margin-top:4px">${METRICS.map(m => `<tr style="color:${m.key === here ? '#1f2937' : '#6b7280'};font-weight:${m.key === here ? 700 : 400}"><td style="padding:1px 10px 1px 0">${esc(m.label)}</td><td style="text-align:right;font-variant-numeric:tabular-nums">${g[m.key] || 0}</td></tr>`).join('')}</table>
    ${removed ? `<div style="color:#9ca3af;margin-top:3px">${g.positives} positives in all, ${removed} removed by reps</div>` : ''}`;
  const wb = wrap.getBoundingClientRect();
  tip.style.display = '';
  const left = ev.clientX - wb.left + 14, top = ev.clientY - wb.top + 14;
  tip.style.left = `${Math.min(left, wb.width - 250)}px`;
  tip.style.top = `${Math.min(top, wb.height - 150)}px`;
};
window.funnelDailyLeave = () => {
  document.querySelectorAll('#funnel-daily-charts .funnel-daily-hover').forEach(el => { el.style.display = 'none'; });
  const tip = document.getElementById('funnel-daily-tip'); if (tip) tip.style.display = 'none';
};

/** One row per stage: the label, its total and average on the left, its chart on the right. */
function chartRows(groups) {
  _groups = groups; _ys = {};
  const n = groups.length;
  _xs = groups.map((_, i) => _gran === 'day' ? (n === 1 ? (L + W - R) / 2 : L + (i / (n - 1)) * (W - L - R)) : L + ((W - L - R) / n) * (i + 0.5));
  return METRICS.map((m, idx) => {
    const last = idx === METRICS.length - 1;
    const total = groups.reduce((s, g) => s + (g[m.key] || 0), 0);
    let avg = '';
    if (_gran === 'day') { const wd = groups.filter(g => dowOf(g.key) % 6 !== 0); if (wd.length) avg = `${(wd.reduce((s, g) => s + (g[m.key] || 0), 0) / wd.length).toFixed(1)} per weekday`; }
    else { const a = avgComplete(groups, m.key); if (a !== null) avg = `${a.toFixed(1)} per full ${_gran}`; }
    return `<div style="display:grid;grid-template-columns:200px 1fr;gap:12px;align-items:end;${idx ? 'border-top:1px solid #f3f4f6;' : ''}padding:${idx ? 6 : 0}px 0 0">
      <div style="padding-bottom:${last ? XB / 2 : NB}px" title="${esc(m.hint)}">
        <div style="font-size:12px;font-weight:700;color:#1e1b4b;line-height:1.25">${esc(m.label)}</div>
        <div style="display:flex;align-items:baseline;gap:8px;margin-top:2px"><span style="font-size:18px;font-weight:800;color:#1e1b4b;font-variant-numeric:tabular-nums">${total.toLocaleString('en-US')}</span><span style="font-size:11px;color:#9ca3af">${avg}</span></div>
      </div>
      <div style="min-width:0">${_gran === 'day' ? lineSvg(groups, m.key, last) : barsSvg(groups, m.key, last)}</div>
    </div>`;
  }).join('');
}

function tableHtml(groups) {
  const unit = _gran === 'day' ? 'Day' : _gran === 'week' ? 'Week' : 'Month';
  const th = (t, right) => `<th style="padding:4px 8px;text-align:${right ? 'right' : 'left'};white-space:nowrap">${t}</th>`;
  const rows = [...groups].reverse().map(g => `<tr style="color:${g.partial ? '#9ca3af' : '#1f2937'}"><td style="padding:3px 8px;white-space:nowrap">${esc(g.label)}${g.partial && _gran !== 'day' ? ` <span style="font-size:10px">(${g.days} of ${g.expected} days)</span>` : ''}</td>
    ${METRICS.map(m => `<td style="padding:3px 8px;text-align:right;font-variant-numeric:tabular-nums;${m.key === 'qualified' ? 'font-weight:600' : ''}">${g[m.key] || 0}</td>`).join('')}</tr>`).join('');
  return `<div style="max-height:300px;overflow:auto;margin-top:10px;border:1px solid var(--border);border-radius:8px"><table style="border-collapse:collapse;font-size:12px;width:100%">
    <thead><tr style="position:sticky;top:0;background:#f9fafb;color:#6b7280;font-size:11px">${th(unit)}${METRICS.map(m => th(esc(m.label), true)).join('')}</tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

const chip = (on, onclick, label) => `<button onclick="${onclick}" style="padding:4px 11px;border:1px solid ${on ? '#1e1b4b' : 'var(--border)'};border-radius:999px;background:${on ? '#1e1b4b' : 'var(--card)'};color:${on ? '#fff' : 'var(--text)'};font-size:11px;font-weight:600;cursor:pointer">${label}</button>`;

/** The panel. `filterLabel` names the active offer/channel chips for the subtitle. */
export function renderFunnelDaily(offer, channel, filterLabel) {
  const key = cacheKey(offer, channel);
  const c = _cache[key];
  const fresh = c && Date.now() - c.at < TTL_MS && (!c.data || c.data.to === todayYmdLA());
  if (!fresh) fetchDaily(offer, channel, rerenderNow);

  let body;
  if (c && c.error) body = `<div style="padding:14px 0;color:#b91c1c;font-size:12px">Could not load the trend: ${esc(c.error)}</div>`;
  else if (!c || !c.data) body = `<div style="padding:14px 0;color:#9ca3af;font-size:12px">Counting each day…</div>`;
  else {
    const groups = groupDays(c.data.days || [], _gran, todayYmdLA());
    body = `<div style="font-size:11px;color:#9ca3af;margin:8px 0 4px">${esc(shortDay(c.data.from))} → ${esc(shortDay(c.data.to))} · each stage on its own scale</div>
      <div id="funnel-daily-charts" style="position:relative">${chartRows(groups)}<div id="funnel-daily-tip" style="display:none;position:absolute;pointer-events:none;background:#fff;border:1px solid var(--border);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.12);padding:8px 10px;font-size:11px;min-width:230px;z-index:5"></div></div>`
      + (_table ? tableHtml(groups) : '');
  }
  const unit = _gran === 'day' ? 'day' : _gran === 'week' ? 'week (Mon–Sun)' : 'month';
  const note = _gran === 'day' ? 'weekends shaded' : 'a lighter bar is a partial ' + (_gran === 'week' ? 'week' : 'month') + ' (the range or today cuts it short)';
  return `<div style="border:1px solid var(--border);border-radius:10px;padding:14px 16px;background:var(--card);margin-top:12px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div>
        <div style="font-size:14px;font-weight:700;color:#1e1b4b">Pipeline per ${unit}</div>
        <div style="font-size:11px;color:#9ca3af">What happened each ${_gran}, whichever day the lead came in · Los Angeles days · ${note}${filterLabel ? ` · ${esc(filterLabel)}` : ''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        ${GRANS.map(g => chip(_gran === g.key, `setFunnelDailyGran('${g.key}')`, g.label)).join('')}
        <span style="width:6px"></span>
        ${RANGES[_gran].length > 1 ? RANGES[_gran].map(r => chip(rangeDef().key === r.key, `setFunnelDailyRange('${r.key}')`, esc(r.label))).join('') + '<span style="width:6px"></span>' : ''}
        ${chip(_table, 'toggleFunnelDailyTable()', _table ? 'Hide table' : 'Table')}
      </div>
    </div>
    ${body}
  </div>`;
}
