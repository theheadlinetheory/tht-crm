// ═══════════════════════════════════════════════════════════
// FUNNEL DAILY — the pipeline day by day, as a line (Lars, 2026-11-10)
// ═══════════════════════════════════════════════════════════
//
// The level cards say how many; this says how many ON EACH DAY, so the trend
// is visible without clicking through days. Start simple: one line, qualified
// positive responses per Los Angeles day, the Funnel's headline number. The
// pipeline-daily function answers from the ledger with level 02's rules, so a
// range here adds up to the level 02 card for the same range.
//
// The offer and channel chips on the Funnel tab apply here too (the function
// takes them). The chart keeps its own stretch of days — the period chips above
// are for the cards, a trend needs weeks.

import { esc } from './utils.js?v=20261110100615';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=20261110100615';
import { todayYmdLA, addDays } from './funnel-period.js?v=20261110100615';

const RANGE_KEY = 'funnelDailyRange';
const RANGES = [{ key: '4w', label: '4 weeks', days: 28 }, { key: '8w', label: '8 weeks', days: 56 }, { key: '12w', label: '12 weeks', days: 84 }, { key: 'all', label: 'Since May 4', days: 0 }];
const WINDOW_START = '2026-05-04';
let _range = (() => { try { const v = localStorage.getItem(RANGE_KEY) || '8w'; return RANGES.some(r => r.key === v) ? v : '8w'; } catch (_) { return '8w'; } })();
let _table = false;
const _cache = {};   // key → { data, at } | { error, at }
let _loading = null;
const TTL_MS = 15 * 60e3;

const rangeOf = (key) => {
  const r = RANGES.find(x => x.key === key) || RANGES[1];
  const to = todayYmdLA();
  return { from: r.days ? addDays(to, -(r.days - 1)) : WINDOW_START, to };
};
const cacheKey = (offer, channel) => `${_range}@${offer || ''}@${channel || ''}`;

function fetchDaily(offer, channel, rerender) {
  const key = cacheKey(offer, channel);
  if (_loading === key) return;
  _loading = key;
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY };
  const payload = { ...rangeOf(_range), ...(offer ? { offer } : {}), ...(channel ? { channel } : {}) };
  fetch(`${SUPABASE_URL}/functions/v1/pipeline-daily`, { method: 'POST', headers, body: JSON.stringify(payload) })
    .then(async r => { const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (_) { /* not JSON */ }
      if (!r.ok || !j || j.ok === false) throw new Error((j && (j.error || j.message)) || ('HTTP ' + r.status));
      _cache[key] = { data: j, at: Date.now() }; })
    .catch(e => { _cache[key] = { error: String(e && e.message || e), at: Date.now() }; })
    .finally(() => { if (_loading === key) _loading = null; if (rerender) rerender(); });
}

/** Forget every cached answer (the Refresh button). */
export function clearFunnelDaily() { for (const k of Object.keys(_cache)) delete _cache[k]; }

const rerenderNow = () => import('./render.js?v=20261110100615').then(m => m.render());
window.setFunnelDailyRange = (key) => {
  if (!RANGES.some(r => r.key === key)) return;
  _range = key;
  try { localStorage.setItem(RANGE_KEY, key); } catch (_) { /* private mode */ }
  rerenderNow();
};
window.toggleFunnelDailyTable = () => { _table = !_table; rerenderNow(); };

// ── Chart ──
const LINE = '#4f46e5';           // the CRM's one series colour (Trends bars, setter charts)
const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const dowOf = (ymd) => new Date(ymd + 'T00:00:00Z').getUTCDay(); // 0 = Sunday; a plain date, no zone shift
const shortDay = (ymd) => { const [, m, d] = ymd.split('-').map(Number); return `${M[m - 1]} ${d}`; };
const longDay = (ymd) => `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dowOf(ymd)]} ${shortDay(ymd)}`;

let _points = []; // what the chart on screen shows, for the hover layer
const W = 1400, H = 260; // viewBox units; the svg scales to the panel's width, so the hover maths divide by these
function chartSvg(days) {
  const L = 34, R = 12, T = 14, B = 26;
  const n = days.length;
  const max = Math.max(1, ...days.map(d => d.qualified));
  // Integer ticks only: 1 apart up to 6, then 2, 5, 10…
  const step = max <= 6 ? 1 : max <= 12 ? 2 : max <= 30 ? 5 : 10;
  const top = Math.ceil(max / step) * step;
  const x = (i) => n === 1 ? (L + W - R) / 2 : L + (i / (n - 1)) * (W - L - R);
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const slot = n > 1 ? (W - L - R) / (n - 1) : W - L - R;
  _points = days.map((d, i) => ({ ...d, x: x(i), y: y(d.qualified) }));

  let s = '';
  // Weekends as faint bands: the line sits at zero there, which is the weekend, not a bad day.
  for (let i = 0; i < n; i++) {
    const w = dowOf(days[i].day);
    if (w === 6 && i + 1 < n) s += `<rect x="${(x(i) - slot / 2).toFixed(1)}" y="${T}" width="${(slot * 2).toFixed(1)}" height="${H - T - B}" fill="#f3f4f6"/>`;
    else if (w === 6 || (w === 0 && (i === 0 || dowOf(days[i - 1].day) !== 6))) s += `<rect x="${(x(i) - slot / 2).toFixed(1)}" y="${T}" width="${slot.toFixed(1)}" height="${H - T - B}" fill="#f3f4f6"/>`;
  }
  // Gridlines and the y axis, recessive.
  for (let v = 0; v <= top; v += step) {
    s += `<line x1="${L}" y1="${y(v).toFixed(1)}" x2="${W - R}" y2="${y(v).toFixed(1)}" stroke="${v === 0 ? '#d1d5db' : '#eef0f3'}"/>`;
    s += `<text x="${L - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="#9ca3af">${v}</text>`;
  }
  // The x axis: every Monday, or every other Monday when the range is long.
  const every = n > 70 ? 14 : 7;
  let lastLabelX = -Infinity;
  days.forEach((d, i) => {
    if (dowOf(d.day) !== 1 || x(i) - lastLabelX < 50) return;
    if (every === 14 && Math.round((Date.parse(d.day) - Date.parse(days[0].day)) / 864e5 / 7) % 2 === 1 && n - i > 7) return;
    lastLabelX = x(i);
    s += `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#6b7280">${esc(shortDay(d.day))}</text>`;
  });
  // The line and its markers (a 2px ring of the surface so overlapping markers stay apart).
  s += `<polyline fill="none" stroke="${LINE}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${_points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}"/>`;
  if (n <= 90) s += _points.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="${LINE}" stroke="#fff" stroke-width="2"/>`).join('');
  // The hover layer: a crosshair and a dot that follow the pointer, filled by funnelDailyHover.
  s += `<g id="funnel-daily-hover" style="display:none"><line id="funnel-daily-xh" x1="0" y1="${T}" x2="0" y2="${H - B}" stroke="#9ca3af" stroke-dasharray="3 3"/><circle id="funnel-daily-dot" r="5.5" fill="${LINE}" stroke="#fff" stroke-width="2"/></g>`;
  return `<svg id="funnel-daily-svg" viewBox="0 0 ${W} ${H}" style="display:block;width:100%;height:auto" onmousemove="funnelDailyHover(event)" onmouseleave="funnelDailyLeave()">${s}</svg>`;
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
  if (dot) { dot.setAttribute('cx', best.x); dot.setAttribute('cy', best.y); }
  const tip = document.getElementById('funnel-daily-tip'); if (!tip) return;
  const removed = best.positives - best.qualified;
  tip.innerHTML = `<div style="font-weight:700;color:#1f2937">${esc(longDay(best.day))}</div>
    <div style="display:flex;align-items:center;gap:6px;margin-top:3px"><span style="width:8px;height:8px;border-radius:50%;background:${LINE};display:inline-block"></span><span style="color:#374151">Qualified positives</span><strong style="margin-left:auto;font-variant-numeric:tabular-nums;color:#1f2937">${best.qualified}</strong></div>
    ${removed ? `<div style="color:#9ca3af;margin-top:2px">${best.positives} positive${best.positives === 1 ? '' : 's'}, ${removed} removed by reps</div>` : ''}`;
  const left = best.x / W * box.width;
  tip.style.display = '';
  tip.style.left = `${Math.min(Math.max(left + 12, 0), box.width - 190)}px`;
  tip.style.top = `${best.y / H * box.height - 8}px`;
};
window.funnelDailyLeave = () => {
  const g = document.getElementById('funnel-daily-hover'); if (g) g.style.display = 'none';
  const tip = document.getElementById('funnel-daily-tip'); if (tip) tip.style.display = 'none';
};

function tableHtml(days) {
  const rows = [...days].reverse().map(d => `<tr style="color:${dowOf(d.day) % 6 === 0 ? '#9ca3af' : '#1f2937'}"><td style="padding:3px 8px;white-space:nowrap">${esc(longDay(d.day))}</td>
    <td style="padding:3px 8px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600">${d.qualified}</td>
    <td style="padding:3px 8px;text-align:right;font-variant-numeric:tabular-nums">${d.positives}</td></tr>`).join('');
  return `<div style="max-height:260px;overflow:auto;margin-top:10px;border:1px solid var(--border);border-radius:8px"><table style="border-collapse:collapse;font-size:12px;width:100%">
    <thead><tr style="position:sticky;top:0;background:#f9fafb;color:#6b7280;font-size:11px"><th style="padding:4px 8px;text-align:left">Day</th><th style="padding:4px 8px;text-align:right">Qualified positives</th><th style="padding:4px 8px;text-align:right">All positives</th></tr></thead>
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
  if (c && c.error) body = `<div style="padding:14px 0;color:#b91c1c;font-size:12px">Could not load the daily line: ${esc(c.error)}</div>`;
  else if (!c || !c.data) body = `<div style="padding:14px 0;color:#9ca3af;font-size:12px">Counting each day…</div>`;
  else {
    const days = c.data.days || [];
    const weekdays = days.filter(d => dowOf(d.day) % 6 !== 0);
    const total = c.data.totals ? c.data.totals.qualified : days.reduce((s, d) => s + d.qualified, 0);
    const avg = weekdays.length ? (weekdays.reduce((s, d) => s + d.qualified, 0) / weekdays.length) : 0;
    body = `<div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin:6px 0 4px">
        <span style="font-size:22px;font-weight:800;color:#1e1b4b;font-variant-numeric:tabular-nums">${total.toLocaleString('en-US')}</span>
        <span style="font-size:12px;color:#6b7280">qualified positive responses, ${esc(shortDay(c.data.from))} → ${esc(shortDay(c.data.to))} · ${avg.toFixed(1)} per weekday${c.data.totals && c.data.totals.positives !== total ? ` · ${c.data.totals.positives - total} more removed by reps` : ''}</span>
      </div>
      <div style="position:relative">${chartSvg(days)}<div id="funnel-daily-tip" style="display:none;position:absolute;pointer-events:none;background:#fff;border:1px solid var(--border);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.12);padding:8px 10px;font-size:11px;min-width:170px;z-index:5"></div></div>
      ${_table ? tableHtml(days) : ''}`;
  }

  return `<div style="border:1px solid var(--border);border-radius:10px;padding:14px 16px;background:var(--card);margin-top:12px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div>
        <div style="font-size:14px;font-weight:700;color:#1e1b4b">Qualified positive responses per day</div>
        <div style="font-size:11px;color:#9ca3af">Positives that came in that day, less the ones the reps removed · Los Angeles days · weekends shaded${filterLabel ? ` · ${esc(filterLabel)}` : ''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        ${RANGES.map(r => chip(_range === r.key, `setFunnelDailyRange('${r.key}')`, esc(r.label))).join('')}
        <span style="width:6px"></span>
        ${chip(_table, 'toggleFunnelDailyTable()', _table ? 'Hide table' : 'Table')}
      </div>
    </div>
    ${body}
  </div>`;
}
