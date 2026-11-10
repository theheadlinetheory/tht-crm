// ═══════════════════════════════════════════════════════════
// FUNNEL DAILY — the pipeline by day, week or month (Lars, 2026-11-10)
// ═══════════════════════════════════════════════════════════
//
// The level cards say how many; this says how many ON EACH DAY, so the trend
// is visible without clicking through days. Start simple: one series, qualified
// positive responses, the Funnel's headline number. The pipeline-daily function
// answers from the ledger with level 02's rules, so a range here adds up to the
// level 02 card for the same range. Weeks and months are the same day rows
// grouped in the browser (funnel-trend-group.js, tested).
//
// The offer and channel chips on the Funnel tab apply here too (the function
// takes them). The panel keeps its own stretch of time — the period chips above
// are for the cards, a trend needs weeks.

import { esc } from './utils.js?v=20261110102054';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=20261110102054';
import { todayYmdLA, addDays } from './funnel-period.js?v=20261110102054';
import { groupDays, avgComplete, dowOf, shortDay } from './funnel-trend-group.js?v=20261110102054';

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

const rerenderNow = () => import('./render.js?v=20261110102054').then(m => m.render());
window.setFunnelDailyRange = (key) => { _range = key; lsSet(RANGE_KEY, key); rerenderNow(); };
window.setFunnelDailyGran = (key) => { if (GRANS.some(g => g.key === key)) { _gran = key; lsSet(GRAN_KEY, key); rerenderNow(); } };
window.toggleFunnelDailyTable = () => { _table = !_table; rerenderNow(); };

// ── Charts ──
const LINE = '#4f46e5', LIGHT = '#a5b4fc'; // the CRM's one series colour (Trends bars, setter charts); lighter = partial
const W = 1400, H = 260, L = 34, R = 12, T = 18, B = 26; // viewBox units; the svg scales to the panel's width, so the hover maths divide by these
let _points = []; // what the chart on screen shows, for the hover layer: { x, y, label, sub, qualified, positives }

function yScale(groups) {
  const max = Math.max(1, ...groups.map(g => g.qualified));
  const step = max <= 6 ? 1 : max <= 12 ? 2 : max <= 30 ? 5 : max <= 60 ? 10 : max <= 150 ? 25 : 50;
  const top = Math.ceil(max / step) * step;
  return { step, top, y: (v) => T + (1 - v / top) * (H - T - B) };
}
function gridlines({ step, top, y }) {
  let s = '';
  for (let v = 0; v <= top; v += step) {
    s += `<line x1="${L}" y1="${y(v).toFixed(1)}" x2="${W - R}" y2="${y(v).toFixed(1)}" stroke="${v === 0 ? '#d1d5db' : '#eef0f3'}"/>`;
    s += `<text x="${L - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="#9ca3af">${v}</text>`;
  }
  return s;
}
const hoverLayer = () => `<g id="funnel-daily-hover" style="display:none"><line id="funnel-daily-xh" x1="0" y1="${T}" x2="0" y2="${H - B}" stroke="#9ca3af" stroke-dasharray="3 3"/><circle id="funnel-daily-dot" r="5.5" fill="${LINE}" stroke="#fff" stroke-width="2"/></g>`;
const svgWrap = (inner) => `<svg id="funnel-daily-svg" viewBox="0 0 ${W} ${H}" style="display:block;width:100%;height:auto" onmousemove="funnelDailyHover(event)" onmouseleave="funnelDailyLeave()">${inner}</svg>`;
const sub = (g) => { const removed = g.positives - g.qualified; return removed ? `${g.positives} positive${g.positives === 1 ? '' : 's'}, ${removed} removed by reps` : ''; };

/** Days: a line with markers, weekends shaded. */
function lineSvg(days) {
  const n = days.length, sc = yScale(days);
  const x = (i) => n === 1 ? (L + W - R) / 2 : L + (i / (n - 1)) * (W - L - R);
  const slot = n > 1 ? (W - L - R) / (n - 1) : W - L - R;
  _points = days.map((d, i) => ({ x: x(i), y: sc.y(d.qualified), label: `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dowOf(d.key)]} ${d.label}`, sub: sub(d), qualified: d.qualified, positives: d.positives }));
  let s = '';
  // Weekends as faint bands: the line sits at zero there, which is the weekend, not a bad day.
  for (let i = 0; i < n; i++) {
    const w = dowOf(days[i].key);
    if (w === 6 && i + 1 < n) s += `<rect x="${(x(i) - slot / 2).toFixed(1)}" y="${T}" width="${(slot * 2).toFixed(1)}" height="${H - T - B}" fill="#f3f4f6"/>`;
    else if (w === 6 || (w === 0 && (i === 0 || dowOf(days[i - 1].key) !== 6))) s += `<rect x="${(x(i) - slot / 2).toFixed(1)}" y="${T}" width="${slot.toFixed(1)}" height="${H - T - B}" fill="#f3f4f6"/>`;
  }
  s += gridlines(sc);
  // The x axis: every Monday, or every other Monday when the range is long.
  let lastLabelX = -Infinity;
  days.forEach((d, i) => {
    if (dowOf(d.key) !== 1 || x(i) - lastLabelX < 50) return;
    if (n > 70 && Math.round((Date.parse(d.key) - Date.parse(days[0].key)) / 864e5 / 7) % 2 === 1 && n - i > 7) return;
    lastLabelX = x(i);
    s += `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#6b7280">${esc(d.label)}</text>`;
  });
  s += `<polyline fill="none" stroke="${LINE}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${_points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}"/>`;
  if (n <= 90) s += _points.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="${LINE}" stroke="#fff" stroke-width="2"/>`).join('');
  return svgWrap(s + hoverLayer());
}

/** Weeks and months: one bar each, the value on top, partial groups lighter. */
function barsSvg(groups) {
  const n = groups.length, sc = yScale(groups);
  const slot = (W - L - R) / n, bw = Math.min(slot * 0.62, 70);
  const x = (i) => L + slot * (i + 0.5);
  _points = groups.map((g, i) => ({ x: x(i), y: sc.y(g.qualified), label: g.label, sub: [g.partial ? `partial · ${g.days} of ${g.expected} days` : '', sub(g)].filter(Boolean).join(' · '), qualified: g.qualified, positives: g.positives }));
  let s = gridlines(sc);
  groups.forEach((g, i) => {
    const y = sc.y(g.qualified), h = Math.max(0, sc.y(0) - y);
    s += `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${g.partial ? LIGHT : LINE}"/>`;
    s += `<text x="${x(i).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="${g.partial ? '#6b7280' : '#1f2937'}">${g.qualified}</text>`;
    if (n <= 14 || i % 2 === 0) s += `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#6b7280">${esc(g.label)}</text>`;
  });
  return svgWrap(s + hoverLayer());
}

window.funnelDailyHover = (ev) => {
  const svg = document.getElementById('funnel-daily-svg'); if (!svg || !_points.length) return;
  const box = svg.getBoundingClientRect();
  const px = (ev.clientX - box.left) / box.width * W;
  let best = _points[0];
  for (const p of _points) if (Math.abs(p.x - px) < Math.abs(best.x - px)) best = p;
  const g = document.getElementById('funnel-daily-hover'), xh = document.getElementById('funnel-daily-xh'), dot = document.getElementById('funnel-daily-dot');
  if (g) g.style.display = '';
  if (xh) { xh.setAttribute('x1', best.x); xh.setAttribute('x2', best.x); }
  if (dot) { dot.setAttribute('cx', best.x); dot.setAttribute('cy', best.y); dot.style.display = _gran === 'day' ? '' : 'none'; }
  const tip = document.getElementById('funnel-daily-tip'); if (!tip) return;
  tip.innerHTML = `<div style="font-weight:700;color:#1f2937">${esc(best.label)}</div>
    <div style="display:flex;align-items:center;gap:6px;margin-top:3px"><span style="width:8px;height:8px;border-radius:50%;background:${LINE};display:inline-block"></span><span style="color:#374151">Qualified positives</span><strong style="margin-left:auto;font-variant-numeric:tabular-nums;color:#1f2937">${best.qualified}</strong></div>
    ${best.sub ? `<div style="color:#9ca3af;margin-top:2px">${esc(best.sub)}</div>` : ''}`;
  const left = best.x / W * box.width;
  tip.style.display = '';
  tip.style.left = `${Math.min(Math.max(left + 12, 0), box.width - 200)}px`;
  tip.style.top = `${best.y / H * box.height - 8}px`;
};
window.funnelDailyLeave = () => {
  const g = document.getElementById('funnel-daily-hover'); if (g) g.style.display = 'none';
  const tip = document.getElementById('funnel-daily-tip'); if (tip) tip.style.display = 'none';
};

function tableHtml(groups) {
  const unit = _gran === 'day' ? 'Day' : _gran === 'week' ? 'Week' : 'Month';
  const rows = [...groups].reverse().map(g => `<tr style="color:${g.partial ? '#9ca3af' : '#1f2937'}"><td style="padding:3px 8px;white-space:nowrap">${esc(g.label)}${g.partial && _gran !== 'day' ? ` <span style="font-size:10px">(${g.days} of ${g.expected} days)</span>` : ''}</td>
    <td style="padding:3px 8px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600">${g.qualified}</td>
    <td style="padding:3px 8px;text-align:right;font-variant-numeric:tabular-nums">${g.positives}</td></tr>`).join('');
  return `<div style="max-height:260px;overflow:auto;margin-top:10px;border:1px solid var(--border);border-radius:8px"><table style="border-collapse:collapse;font-size:12px;width:100%">
    <thead><tr style="position:sticky;top:0;background:#f9fafb;color:#6b7280;font-size:11px"><th style="padding:4px 8px;text-align:left">${unit}</th><th style="padding:4px 8px;text-align:right">Qualified positives</th><th style="padding:4px 8px;text-align:right">All positives</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

const chip = (on, onclick, label) => `<button onclick="${onclick}" style="padding:4px 11px;border:1px solid ${on ? '#1e1b4b' : 'var(--border)'};border-radius:999px;background:${on ? '#1e1b4b' : 'var(--card)'};color:${on ? '#fff' : 'var(--text)'};font-size:11px;font-weight:600;cursor:pointer">${label}</button>`;

/** The headline under the title: the total, the stretch, and the average per complete unit. */
function headline(data, groups) {
  const total = data.totals ? data.totals.qualified : groups.reduce((s, g) => s + g.qualified, 0);
  const removed = data.totals ? data.totals.positives - total : 0;
  let avg;
  if (_gran === 'day') { const wd = groups.filter(g => dowOf(g.key) % 6 !== 0); avg = wd.length ? `${(wd.reduce((s, g) => s + g.qualified, 0) / wd.length).toFixed(1)} per weekday` : ''; }
  else { const a = avgComplete(groups); avg = a === null ? '' : `${a.toFixed(1)} per full ${_gran}`; }
  return `<div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin:6px 0 4px">
    <span style="font-size:22px;font-weight:800;color:#1e1b4b;font-variant-numeric:tabular-nums">${total.toLocaleString('en-US')}</span>
    <span style="font-size:12px;color:#6b7280">qualified positive responses, ${esc(shortDay(data.from))} → ${esc(shortDay(data.to))}${avg ? ` · ${avg}` : ''}${removed ? ` · ${removed} more removed by reps` : ''}</span>
  </div>`;
}

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
    body = headline(c.data, groups)
      + `<div style="position:relative">${_gran === 'day' ? lineSvg(groups) : barsSvg(groups)}<div id="funnel-daily-tip" style="display:none;position:absolute;pointer-events:none;background:#fff;border:1px solid var(--border);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.12);padding:8px 10px;font-size:11px;min-width:180px;z-index:5"></div></div>`
      + (_table ? tableHtml(groups) : '');
  }
  const unit = _gran === 'day' ? 'day' : _gran === 'week' ? 'week (Mon–Sun)' : 'month';
  const note = _gran === 'day' ? 'weekends shaded' : 'a lighter bar is a partial ' + (_gran === 'week' ? 'week' : 'month') + ' (the range or today cuts it short)';
  return `<div style="border:1px solid var(--border);border-radius:10px;padding:14px 16px;background:var(--card);margin-top:12px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div>
        <div style="font-size:14px;font-weight:700;color:#1e1b4b">Qualified positive responses per ${unit}</div>
        <div style="font-size:11px;color:#9ca3af">Positives that came in, less the ones the reps removed · Los Angeles days · ${note}${filterLabel ? ` · ${esc(filterLabel)}` : ''}</div>
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
