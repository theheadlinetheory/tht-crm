// ═══════════════════════════════════════════════════════════
// ANALYSIS — MONTHLY PASS (4 weeks vs the previous 4 weeks)
//
// The weekly Analysis pass, replicated month over month. Run on the last
// Friday of the month: every client campaign's sending diagnostics for the
// last 4 weeks next to the 4 weeks before, so the trend in client results is
// visible — the same metrics as the weekly grid (sent, new leads vs
// follow-ups, days sending, replies, positives, bounces, reply categories,
// copy), each with the previous 4 weeks' number and the change under it.
//
// 4-week windows, not calendar months: equal length, same weekday mix, no
// scaled targets — see analysis-month-window.js. Same Smartlead source as the
// weekly pass (smartlead-proxy `client_week_breakdown`, any range up to 62
// days) and the same CRM delivery data (trailingWeeklyDelivery: Lead Tracker
// cold-email meetings for PPM, pass-offs for retainer).
// ═══════════════════════════════════════════════════════════
import { state } from './app.js?v=20261114163106';
import { render } from './render.js?v=20261114163106';
import { esc, escAttr, jsArg, str } from './utils.js?v=20261114163106';
import { showToast } from './api.js?v=20261114163106';
import {
  getPpmClients, getRetainerClients, trailingWeeklyDelivery, onboardedOnDate,
  currentWeekKey, shiftWeeks, weekLabel, weekLabelShort,
  PPM_TRAILING_TARGET, RETAINER_TRAILING_TARGET,
} from './dashboard.js?v=20261114163106';
import {
  proxyCall, pullBreakdowns, ownedCampaigns, parseCampaignName,
  renderPeriodToggle, renderCopyModal, categoryChips, dayStrip, agoLabel,
  SMARTLEAD_CAMPAIGN_URL,
} from './analysis.js?v=20261114163106';
import {
  rangeLabel, fourWeekWindows, trendOf, WINDOW_WEEKS,
} from './analysis-month-window.js?v=20261114163106';

// Monthly bars = the weekly bars sustained over 4 weeks, the same numbers the
// 4-week trailing check uses: 4 booked meetings (PPM), 20 positive replies
// (retainer). Both windows are exactly 4 weeks, so nothing is scaled.
const PPM_MONTHLY_TARGET = PPM_TRAILING_TARGET;
const RETAINER_MONTHLY_TARGET = RETAINER_TRAILING_TARGET;

function getM() {
  if (!state.analysisMonthly) {
    state.analysisMonthly = { step: 'idle', week: null, rows: [], errors: [], progress: '', scope: 'all', showDormant: false, hydratedKey: null, pulledAt: null };
  }
  return state.analysisMonthly;
}

// The window is the 4 weeks ENDING with this week (a Monday key).
const selectedWeek = () => getM().week || currentWeekKey();

// ─── Run cache (localStorage) ────────────────────────────────
// A monthly pull is several minutes of live Smartlead calls; keep finished
// runs per window + scope, like the weekly cache.
const RUNS_KEY = 'tht_analysis_monthly_runs';
const MAX_CACHED_RUNS = 4;
const runKey = (win, scope) => `${win.cur.start}|${win.cur.end}|${scope}`;

function readRuns() {
  try { return JSON.parse(localStorage.getItem(RUNS_KEY) || '{}') || {}; }
  catch { return {}; }
}

const num = v => Number(v) || 0;
function normStats(b) {
  b = (b && typeof b === 'object') ? b : {};
  return {
    sent: num(b.sent), firstTouch: num(b.firstTouch), followUp: num(b.followUp),
    replies: num(b.replies), positives: num(b.positives), bounces: num(b.bounces),
    daily: (Array.isArray(b.daily) ? b.daily : []).filter(d => d && typeof d === 'object')
      .map(d => ({ date: str(d.date), sent: num(d.sent), replies: num(d.replies), bounces: num(d.bounces) })),
    sendingDays: num(b.sendingDays), daysInRange: num(b.daysInRange),
    categories: (b.categories && typeof b.categories === 'object') ? b.categories : {},
  };
}
function normalizeRow(r) {
  r = r || {};
  return {
    clientName: str(r.clientName), isRetainer: !!r.isRetainer,
    campaignId: r.campaignId, campaignName: str(r.campaignName), status: str(r.status),
    industry: str(r.industry) || '—', dataSource: str(r.dataSource) || '—', dmType: str(r.dmType) || '—',
    cur: normStats(r.cur), prev: normStats(r.prev), error: str(r.error),
  };
}

function saveRun(key, rows, errors) {
  try {
    const runs = readRuns();
    runs[key] = { at: new Date().toISOString(), rows, errors };
    const keys = Object.keys(runs).sort((a, b) => new Date(runs[b].at) - new Date(runs[a].at));
    const trimmed = {};
    for (const k of keys.slice(0, MAX_CACHED_RUNS)) trimmed[k] = runs[k];
    localStorage.setItem(RUNS_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn('Could not cache the monthly analysis run:', e);
  }
}

function hydrate(m, win) {
  const key = runKey(win, m.scope);
  if (m.hydratedKey === key) return;
  m.hydratedKey = key;
  if (m.step === 'loading') return;
  const cached = readRuns()[key];
  if (cached && Array.isArray(cached.rows) && cached.rows.length) {
    m.rows = cached.rows.map(normalizeRow);
    m.errors = Array.isArray(cached.errors) ? cached.errors : [];
    m.pulledAt = cached.at;
    m.step = 'done';
  } else {
    m.rows = []; m.errors = []; m.pulledAt = null; m.step = 'idle';
  }
}

// ─── Client delivery: last 4 weeks vs the 4 before (CRM data, live) ─────
// Computed at render time, never cached, so a restored Smartlead run still
// shows today's meeting / pass-off counts. One trailingWeeklyDelivery call
// over all 8 weeks — the same counting the weekly pass uses — so every
// client's 8 weekly cells add up to the two totals.
function clientStatus(win) {
  const delivery = trailingWeeklyDelivery(win.weeks[win.weeks.length - 1], 2 * WINDOW_WEEKS);
  const prevStart = new Date(win.prev.start + 'T00:00:00');
  const build = (c, isRetainer) => {
    const byWeek = (isRetainer ? delivery.positives : delivery.meetings)[c.name] || {};
    const perWeek = win.weeks.map(w => ({ week: w, n: byWeek[w] || 0 }));
    const sum = arr => arr.reduce((t, x) => t + x.n, 0);
    const count = sum(perWeek.slice(WINDOW_WEEKS));
    const prevCount = sum(perWeek.slice(0, WINDOW_WEEKS));
    const target = isRetainer ? RETAINER_MONTHLY_TARGET : PPM_MONTHLY_TARGET;
    const from = onboardedOnDate(c, c.name);
    return {
      name: c.name, isRetainer, count, prevCount, target, perWeek,
      hit: count >= target,
      trend: trendOf(count, prevCount),
      // Launched after the previous window opened: it is not a fair
      // baseline, so the trend is shown but labelled.
      newClient: !!(from && from > prevStart),
      launched: from,
    };
  };
  return [
    ...getPpmClients().map(c => build(c, false)),
    ...getRetainerClients().map(c => build(c, true)),
  ].sort((a, b) => a.trend.diff - b.trend.diff || a.name.localeCompare(b.name));
}

function scopeFilter(scope) {
  if (scope === 'missed') return s => !s.hit;
  if (scope === 'down') return s => s.trend.dir === 'down';
  return () => true;
}

// ─── Run ─────────────────────────────────────────────────────
export async function runMonthlyAnalysis() {
  const m = getM();
  const week = selectedWeek();
  const win = fourWeekWindows(week);
  const runId = (m.runId || 0) + 1;
  m.runId = runId;
  m.step = 'loading'; m.rows = []; m.errors = []; m.week = week;
  m.progress = 'Finding campaigns…';
  render();
  const stale = () => state.analysisMonthly !== m || m.runId !== runId;
  const onProgress = msg => { if (!stale()) { m.progress = msg; render(); } };

  try {
    const statuses = clientStatus(win).filter(scopeFilter(m.scope));
    const clients = statuses.map(s => state.clients.find(c => c.name === s.name)).filter(Boolean);
    if (!clients.length) { m.step = 'done'; m.progress = ''; render(); return; }

    const campPayload = await proxyCall({ action: 'list_campaigns' }, 'Campaign list',
      () => onProgress('Smartlead rate-limit collision — retrying in 20s…'));
    if (stale()) return;
    const campaigns = campPayload.data;
    if (!Array.isArray(campaigns)) throw new Error('Could not load the campaign list from Smartlead.');

    const { owned, considered } = ownedCampaigns(campaigns, clients);
    if (!owned.length) {
      m.step = 'done';
      m.errors.push(`None of the ${considered} client campaigns in Smartlead (${campaigns.length} total) matched ${clients.length} client${clients.length === 1 ? '' : 's'}: ${clients.map(c => c.name).join(', ')}. Check Settings → Clients → campaign keywords.`);
      render();
      return;
    }

    // 4-week windows page ~4x the sends of one week, so smaller batches.
    const ids = owned.map(c => Number(c.id));
    const opts = { stale, onProgress, batchSize: 2, inFlight: 3 };
    const curById = await pullBreakdowns(ids, win.cur.start, win.cur.end, { ...opts, label: ` for ${rangeLabel(win.cur)}` });
    if (stale()) return;
    const prevById = await pullBreakdowns(ids, win.prev.start, win.prev.end, { ...opts, label: ` for ${rangeLabel(win.prev)}` });
    if (stale()) return;

    const retainerNames = new Set(getRetainerClients().map(c => c.name));
    const toStats = b => normStats({
      sent: b.sent, firstTouch: b.first_touch_sent, followUp: b.follow_up_sent,
      replies: b.replies, positives: b.positives, bounces: b.bounces,
      daily: b.daily, sendingDays: b.sending_days, daysInRange: b.days_in_range,
      categories: b.categories,
    });
    m.rows = owned.map(c => {
      const b = curById[String(c.id)] || {};
      const p = prevById[String(c.id)] || {};
      if (b.error) m.errors.push(`${c.name} (${rangeLabel(win.cur)}): ${b.error}`);
      if (p.error) m.errors.push(`${c.name} (${rangeLabel(win.prev)}): ${p.error}`);
      return normalizeRow({
        clientName: c.clientName, isRetainer: retainerNames.has(c.clientName),
        campaignId: c.id, campaignName: c.name, status: c.status,
        ...parseCampaignName(c.name),
        cur: toStats(b), prev: toStats(p),
        error: b.error || p.error || '',
      });
    }).sort((x, y) => x.clientName.localeCompare(y.clientName) || y.cur.sent - x.cur.sent || x.campaignName.localeCompare(y.campaignName));

    m.step = 'done';
    m.progress = '';
    m.pulledAt = new Date().toISOString();
    m.hydratedKey = runKey(win, m.scope);
    saveRun(m.hydratedKey, m.rows, m.errors);
  } catch (e) {
    if (stale()) return;
    m.step = 'idle';
    showToast('Monthly analysis failed: ' + e.message, 'error');
  }
  render();
}

// ─── Formatting ──────────────────────────────────────────────
const pct = (n, d) => (d > 0 ? n / d * 100 : 0);
const fmtPct = (n, d, digits = 2) => (d > 0 ? `${(n / d * 100).toFixed(digits)}%` : '—');
const GOOD = '#166534', BAD = '#b91c1c', MUTED = 'var(--text-muted)';

// Change line under a number: "Oct 412 · ▲ +38 (+9%)". `higherIsBetter`
// false flips the colour for bounces.
function deltaCount(cur, prev, higherIsBetter = true) {
  const t = trendOf(cur, prev);
  const color = t.dir === 'flat' ? MUTED : (t.dir === 'up') === higherIsBetter ? GOOD : BAD;
  const arrow = t.dir === 'up' ? '▲' : t.dir === 'down' ? '▼' : '=';
  const pctTxt = t.pct === null ? '' : ` (${t.pct > 0 ? '+' : ''}${t.pct.toFixed(0)}%)`;
  return `<div style="font-size:10px;font-weight:400;color:${MUTED}">${Number(prev).toLocaleString()} · <span style="color:${color};font-weight:700">${arrow} ${t.diff > 0 ? '+' : ''}${t.diff.toLocaleString()}${t.dir === 'flat' ? '' : pctTxt}</span></div>`;
}

// Rates change in percentage points, not percent of a percent.
function deltaRate(n, d, pn, pd, higherIsBetter = true) {
  if (!(d > 0) || !(pd > 0)) return `<div style="font-size:10px;font-weight:400;color:${MUTED}">${fmtPct(pn, pd)}</div>`;
  const diff = pct(n, d) - pct(pn, pd);
  const flat = Math.abs(diff) < 0.005;
  const color = flat ? MUTED : (diff > 0) === higherIsBetter ? GOOD : BAD;
  return `<div style="font-size:10px;font-weight:400;color:${MUTED}">${fmtPct(pn, pd)} · <span style="color:${color};font-weight:700">${flat ? '=' : diff > 0 ? '▲ +' : '▼ '}${flat ? '' : diff.toFixed(2) + 'pt'}</span></div>`;
}

function trendChip(s) {
  const t = s.trend;
  const bg = t.dir === 'up' ? '#dcfce7' : t.dir === 'down' ? '#fee2e2' : '#f3f4f6';
  const fg = t.dir === 'up' ? GOOD : t.dir === 'down' ? '#991b1b' : '#4b5563';
  const arrow = t.dir === 'up' ? '▲' : t.dir === 'down' ? '▼' : '=';
  return `<span style="display:inline-block;background:${bg};color:${fg};font-size:10px;font-weight:700;padding:1px 7px;border-radius:999px;white-space:nowrap">${arrow} ${s.prevCount} → ${s.count}${t.pct !== null && t.dir !== 'flat' ? ` (${t.pct > 0 ? '+' : ''}${t.pct.toFixed(0)}%)` : ''}</span>`;
}

function deliveryCell(s, win, stacked) {
  if (!s) return '<span style="color:var(--text-muted)">—</span>';
  const unit = s.isRetainer ? 'positive replies' : 'booked meetings';
  const title = escAttr(`${s.name} — ${unit}: ${rangeLabel(win.prev)} ${s.prevCount}, ${rangeLabel(win.cur)} ${s.count}`);
  const newTag = s.newClient ? `<span title="Launched ${escAttr(s.launched ? s.launched.toDateString() : '')} — the previous 4 weeks are not a full baseline" style="font-size:9.5px;font-weight:700;color:#b45309;margin-left:4px">NEW</span>` : '';
  if (!stacked) return `<span title="${title}">${trendChip(s)}${newTag}</span>`;
  // Week by week, oldest first: the previous 4 weeks, a rule, then the last
  // 4 — so a drop reads as one bad week or a steady slide.
  const line = (label, n, bold) => `<div style="display:flex;justify-content:space-between;gap:8px${bold ? ';font-weight:700' : ''}"><span style="color:var(--text-muted)">${esc(label)}</span><span style="font-weight:700;color:${n ? GOOD : BAD}">${n}</span></div>`;
  const weekLine = c => line(`wk of ${weekLabelShort(c.week)}`, c.n, false);
  const total = (label, n) => `<div style="display:flex;justify-content:space-between;gap:8px;border-top:1px dashed var(--border);margin:1px 0 3px;padding-top:1px;font-weight:700"><span style="color:var(--text-muted)">${esc(label)}</span><span>${n}</span></div>`;
  return `<div title="${title}" style="font-size:10px;line-height:1.45;min-width:140px;font-weight:400">
    ${s.perWeek.slice(0, WINDOW_WEEKS).map(weekLine).join('')}
    ${total(rangeLabel(win.prev), s.prevCount)}
    ${s.perWeek.slice(WINDOW_WEEKS).map(weekLine).join('')}
    ${total(rangeLabel(win.cur), s.count)}
    <div>${trendChip(s)}${newTag}</div>
  </div>`;
}

// Free (CRM-only) trend banner, shown before and after the Smartlead run.
function renderTrendBanner(statuses, win) {
  const down = statuses.filter(s => s.trend.dir === 'down');
  const up = statuses.filter(s => s.trend.dir === 'up');
  const flat = statuses.length - down.length - up.length;
  const below = statuses.filter(s => !s.hit);
  const chip = s => `<span style="display:inline-block;background:#fff;border:1px solid var(--border);border-radius:6px;padding:3px 9px;margin:2px 4px 2px 0;font-size:11px"><b>${esc(s.name)}</b> ${trendChip(s)}${s.newClient ? ' <span style="font-size:9.5px;font-weight:700;color:#b45309">NEW</span>' : ''}</span>`;
  let h = `<div style="background:#f8fafc;border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:10px">
    <div style="font-size:11px;font-weight:700;color:var(--text);text-transform:uppercase;letter-spacing:.4px">Client results — ${esc(rangeLabel(win.cur))} vs ${esc(rangeLabel(win.prev))}</div>
    <div style="font-size:11.5px;margin-top:4px">
      <b style="color:${GOOD}">${up.length} up</b> · <b style="color:${BAD}">${down.length} down</b> · <b style="color:#4b5563">${flat} flat</b>
      · <b style="color:${below.length ? BAD : GOOD}">${below.length} below the monthly bar</b>
    </div>`;
  if (down.length) h += `<div style="font-size:10.5px;font-weight:700;color:#991b1b;margin-top:8px">Trending down</div><div>${down.map(chip).join('')}</div>`;
  if (up.length) h += `<div style="font-size:10.5px;font-weight:700;color:${GOOD};margin-top:6px">Trending up</div><div>${up.map(chip).join('')}</div>`;
  h += `</div>`;
  return h;
}

const TH = 'padding:6px 8px;font-size:10px;font-weight:700;color:#495057;background:#e9ecef;border:1px solid #d0d5dd;white-space:nowrap;position:sticky;top:0;z-index:2';
const TD = 'padding:4px 8px;font-size:12px;border:1px solid #e2e5e9;white-space:nowrap;vertical-align:top';

function visibleRows(m) {
  if (m.showDormant) return m.rows;
  const sentByClient = {};
  for (const r of m.rows) sentByClient[r.clientName] = (sentByClient[r.clientName] || 0) + r.cur.sent + r.prev.sent;
  return m.rows.filter(r => r.cur.sent > 0 || r.prev.sent > 0 || !sentByClient[r.clientName]);
}

function sumStats(rows, key) {
  const t = { sent: 0, firstTouch: 0, followUp: 0, replies: 0, positives: 0, bounces: 0 };
  const days = new Set();
  let daysInRange = 0;
  for (const r of rows) {
    const s = r[key];
    for (const k of Object.keys(t)) t[k] += s[k];
    s.daily.forEach(d => { if (d.sent > 0) days.add(d.date); });
    daysInRange = Math.max(daysInRange, s.daysInRange);
  }
  return { ...t, sendingDays: days.size, daysInRange };
}

// One row of metric cells (sent → bounce rate) for a current/previous pair.
function metricCells(c, p, bold, strip = '') {
  const w = bold ? 'font-weight:800' : 'font-weight:600';
  const posRate = pct(c.positives, c.sent), bRate = pct(c.bounces, c.sent);
  return `
    <td style="${TD};text-align:right;${w}">${c.sent.toLocaleString()}${deltaCount(c.sent, p.sent)}</td>
    <td style="${TD};text-align:right">${c.firstTouch.toLocaleString()}<span style="color:var(--text-muted);font-size:10px"> ${fmtPct(c.firstTouch, c.sent, 0)}</span>${deltaCount(c.firstTouch, p.firstTouch)}</td>
    <td style="${TD};text-align:right">${c.followUp.toLocaleString()}<span style="color:var(--text-muted);font-size:10px"> ${fmtPct(c.followUp, c.sent, 0)}</span>${deltaCount(c.followUp, p.followUp)}</td>
    <td style="${TD}">${c.sendingDays}/${c.daysInRange || '—'}${strip}<div style="font-size:10px;color:var(--text-muted)">${p.sendingDays}/${p.daysInRange || '—'}</div></td>
    <td style="${TD};text-align:right;${w}">${c.replies}${deltaCount(c.replies, p.replies)}</td>
    <td style="${TD};text-align:right">${fmtPct(c.replies, c.sent)}${deltaRate(c.replies, c.sent, p.replies, p.sent)}</td>
    <td style="${TD};text-align:right;${w};color:${c.positives ? GOOD : BAD}">${c.positives}${deltaCount(c.positives, p.positives)}</td>
    <td style="${TD};text-align:right;font-weight:700;color:${c.sent === 0 ? MUTED : posRate < 0.5 ? BAD : GOOD}">${fmtPct(c.positives, c.sent)}${deltaRate(c.positives, c.sent, p.positives, p.sent)}</td>
    <td style="${TD};text-align:right">${c.bounces}${deltaCount(c.bounces, p.bounces, false)}</td>
    <td style="${TD};text-align:right;font-weight:700;color:${c.sent === 0 ? MUTED : bRate >= 5 ? BAD : bRate >= 3 ? '#b45309' : GOOD}">${fmtPct(c.bounces, c.sent)}${deltaRate(c.bounces, c.sent, p.bounces, p.sent, false)}</td>`;
}

// ─── Render ──────────────────────────────────────────────────
export function renderMonthlyAnalysis() {
  const m = getM();
  const week = selectedWeek();
  const win = fourWeekWindows(week);
  hydrate(m, win);
  const thisWeek = currentWeekKey();
  const weeks = [];
  for (let i = 0; i < 12; i++) weeks.push(shiftWeeks(thisWeek, -i));
  if (!weeks.includes(week)) weeks.unshift(week);

  const statuses = clientStatus(win);
  const statusByName = Object.fromEntries(statuses.map(s => [s.name, s]));
  const inScope = statuses.filter(scopeFilter(m.scope));
  const missedN = statuses.filter(scopeFilter('missed')).length;
  const downN = statuses.filter(scopeFilter('down')).length;

  let h = `<div class="tracker-container">`;
  h += `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:0 0 10px">
    <div>
      <div style="font-size:15px;font-weight:800">Analysis — month over month</div>
      <div style="font-size:11.5px;color:var(--text-muted);margin-top:3px;max-width:760px">
        The weekly review, run month over month on the <b>last Friday of the month</b>: every client campaign's sending diagnostics for the
        4 weeks <b>${esc(rangeLabel(win.cur))}</b> next to the 4 weeks before, <b>${esc(rangeLabel(win.prev))}</b>, with the earlier number and the change under each one.
        Both windows are whole Monday–Sunday weeks, so they are the same length with the same weekdays; the selected week is the last of the four.
        The monthly bar is ≥ ${RETAINER_MONTHLY_TARGET} positive replies over 4 weeks for retainer clients and ≥ ${PPM_MONTHLY_TARGET} booked meetings for pay-per-meeting.
        Meetings come from the CRM Lead Tracker, cold email only; positives from pass-offs. Rate changes are in percentage points.
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
      ${renderPeriodToggle('month')}
      <select onchange="analysisSetMonthlyWeek(this.value)" title="The 4-week window ends with this week" style="padding:5px 10px;border:1px solid var(--border);border-radius:6px;font-size:11px;font-family:var(--font);background:#fff;cursor:pointer">
        ${weeks.map(k => `<option value="${k}" ${k === week ? 'selected' : ''}>4 weeks: ${esc(rangeLabel(fourWeekWindows(k).cur))}${k === thisWeek ? ' (to this week)' : ''}</option>`).join('')}
      </select>
      <select onchange="analysisSetMonthScope(this.value)" style="padding:5px 10px;border:1px solid var(--border);border-radius:6px;font-size:11px;font-family:var(--font);background:#fff;cursor:pointer">
        <option value="all" ${m.scope === 'all' ? 'selected' : ''}>All active clients (${statuses.length})</option>
        <option value="down" ${m.scope === 'down' ? 'selected' : ''}>Trending down (${downN})</option>
        <option value="missed" ${m.scope === 'missed' ? 'selected' : ''}>Below monthly bar (${missedN})</option>
      </select>
      <button class="btn btn-primary" style="font-size:11px;padding:5px 14px" onclick="analysisRunMonthly()" ${m.step === 'loading' ? 'disabled' : ''}>${m.step === 'loading' ? 'Pulling…' : m.rows.length ? 'Refresh' : 'Run monthly analysis'}</button>
      ${m.rows.length ? `<button class="btn btn-ghost" style="font-size:11px;padding:5px 12px" onclick="analysisExportMonthlyCsv()">Export CSV (${m.rows.length})</button>` : ''}
    </div>
  </div>`;

  h += renderTrendBanner(statuses, win);

  if (m.step === 'loading') {
    return h + `<div style="padding:50px;text-align:center;color:var(--text-muted)">
      <div class="loading-spinner"></div>
      <div style="margin-top:12px;font-size:12.5px">${esc(m.progress || 'Working…')}</div>
    </div></div>`;
  }
  if (m.step === 'idle') {
    return h + `<div style="padding:30px;text-align:center;color:var(--text-muted);font-size:13px">
      <button class="btn btn-primary" style="font-size:12px;padding:7px 18px" onclick="analysisRunMonthly()" ${inScope.length ? '' : 'disabled'}>Run monthly analysis</button>
      <div style="font-size:11px;margin-top:10px">${inScope.length
        ? `Pulls live Smartlead stats for ${inScope.length} client${inScope.length === 1 ? '' : 's'}' campaigns over both 4-week windows — about 5 to 10 minutes for every client. Keep the tab open.`
        : 'No clients in this scope.'}</div>
    </div></div>`;
  }

  if (m.errors.length) {
    h += `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px 12px;margin-bottom:8px;font-size:11px;color:#991b1b">${m.errors.map(e => esc(e)).join('<br>')}</div>`;
  }
  if (!m.rows.length) return h + `<div style="padding:40px;text-align:center;color:var(--text-muted);font-size:13px">Nothing to analyse for ${esc(rangeLabel(win.cur))}.</div></div>`;

  const rows = visibleRows(m);
  const hidden = m.rows.length - rows.length;
  const clientCount = new Set(rows.map(r => r.clientName)).size;
  h += `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--text-muted);padding:0 0 6px">
    <span>${rows.length} campaign${rows.length === 1 ? '' : 's'} across ${clientCount} client${clientCount === 1 ? '' : 's'} · ${esc(win.cur.start)} → ${esc(win.cur.end)} vs ${esc(win.prev.start)} → ${esc(win.prev.end)} (America/New_York)</span>
    ${m.pulledAt ? `<span style="background:#f3f4f6;padding:1px 8px;border-radius:999px;font-weight:600" title="Saved in this browser. Hit Refresh for live numbers.">Pulled ${esc(agoLabel(m.pulledAt))}</span>` : ''}
    ${hidden ? `<button class="btn btn-ghost" style="font-size:10px;padding:2px 8px" onclick="analysisToggleMonthlyDormant()">Show ${hidden} campaign${hidden === 1 ? '' : 's'} that sent nothing in either window</button>`
      : m.showDormant ? `<button class="btn btn-ghost" style="font-size:10px;padding:2px 8px" onclick="analysisToggleMonthlyDormant()">Hide campaigns that sent nothing</button>` : ''}
    <span>Under each number: previous 4 weeks · change.</span>
  </div>`;

  h += `<div class="tracker-table-wrap"><table class="tracker-table" style="min-width:2300px">
    <thead><tr>
      <th style="${TH}">Client</th>
      <th style="${TH}">Type</th>
      <th style="${TH}" title="Last 4 weeks vs the monthly bar">4-week KPI</th>
      <th style="${TH}" title="Booked meetings (PPM) or positive replies passed off (retainer), week by week: the previous 4 weeks, then the last 4">Previous 4 wks → last 4 wks</th>
      <th style="${TH}">Campaign</th>
      <th style="${TH}">Status</th>
      <th style="${TH}">Industry</th>
      <th style="${TH}">Data source</th>
      <th style="${TH}">DM type</th>
      <th style="${TH};text-align:right">Emails sent</th>
      <th style="${TH};text-align:right" title="Sequence step 1 — the first email to a lead">New leads</th>
      <th style="${TH};text-align:right" title="Sequence steps 2+">Follow-ups</th>
      <th style="${TH}" title="Last 4 weeks / previous 4 weeks">Days sending</th>
      <th style="${TH};text-align:right">Total replies</th>
      <th style="${TH};text-align:right">Reply rate</th>
      <th style="${TH};text-align:right">Positive replies</th>
      <th style="${TH};text-align:right">Positive / send</th>
      <th style="${TH};text-align:right">Bounces</th>
      <th style="${TH};text-align:right">Bounce rate</th>
      <th style="${TH}">Reply categories (last 4 wks / previous 4 wks)</th>
      <th style="${TH}">Copy</th>
    </tr></thead><tbody>`;

  let prevClient = null;
  for (const r of rows) {
    const s = statusByName[r.clientName];
    if (r.clientName !== prevClient) {
      const clientRows = m.rows.filter(x => x.clientName === r.clientName);
      const c = sumStats(clientRows, 'cur'), p = sumStats(clientRows, 'prev');
      const client = state.clients.find(x => x.name === r.clientName);
      h += `<tr style="background:#f5f3ff">
        <td style="${TD};font-weight:800" colspan="3">
          ${client ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${client.color || '#818cf8'};margin-right:6px"></span>` : ''}${esc(r.clientName)}
          <span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:999px;margin-left:6px;background:${r.isRetainer ? '#ede9fe' : '#dbeafe'};color:${r.isRetainer ? '#6d28d9' : '#1d4ed8'}">${r.isRetainer ? 'RETAINER' : 'PPM'}</span>
          ${s ? `<span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:999px;margin-left:4px;background:${s.hit ? '#dcfce7' : '#fee2e2'};color:${s.hit ? GOOD : '#991b1b'}">${s.count}/${s.target} ${r.isRetainer ? 'positive replies' : 'booked meetings'}</span>` : ''}
          <span style="font-size:11px;color:var(--text-muted);margin-left:8px">${clientRows.length} campaign${clientRows.length === 1 ? '' : 's'}</span>
        </td>
        <td style="${TD}">${deliveryCell(s, win, true)}</td>
        <td style="${TD}" colspan="5"></td>
        ${metricCells(c, p, true)}
        <td style="${TD}" colspan="2"></td>
      </tr>`;
      prevClient = r.clientName;
    }
    h += `<tr>
      <td style="${TD};color:var(--text-muted)">${esc(r.clientName)}</td>
      <td style="${TD};color:var(--text-muted)">${r.isRetainer ? 'Retainer' : 'PPM'}</td>
      <td style="${TD};color:var(--text-muted)">${s ? `${s.count}/${s.target}` : '—'}</td>
      <td style="${TD}">${deliveryCell(s, win, false)}</td>
      <td style="${TD};max-width:340px;overflow:hidden;text-overflow:ellipsis">
        <a href="${SMARTLEAD_CAMPAIGN_URL(r.campaignId)}" target="_blank" rel="noopener" title="${esc(r.campaignName)} — open in Smartlead" style="color:var(--purple);text-decoration:none;font-weight:600">${esc(r.campaignName)}</a>
      </td>
      <td style="${TD};font-size:10px;color:var(--text-muted)">${esc(r.status)}</td>
      <td style="${TD};max-width:220px;overflow:hidden;text-overflow:ellipsis" title="${esc(r.industry)}">${esc(r.industry)}</td>
      <td style="${TD}">${esc(r.dataSource)}</td>
      <td style="${TD};font-size:11px;color:var(--text-muted)">${esc(r.dmType)}</td>
      ${metricCells(r.cur, r.prev, false, dayStrip(r.cur))}
      <td style="${TD};white-space:normal;max-width:300px">${categoryChips(r.cur.categories)}<div style="opacity:.6;margin-top:2px">${categoryChips(r.prev.categories)}</div></td>
      <td style="${TD}"><button class="tracker-action-btn" onclick="analysisShowCopy(${jsArg(str(r.campaignId))},${jsArg(r.campaignName)})">View copy</button></td>
    </tr>`;
  }
  h += `</tbody></table></div>`;
  h += renderCopyModal();
  h += `</div>`;
  return h;
}

// ─── CSV export ──────────────────────────────────────────────
const METRICS = [
  ['Emails sent', 'sent'], ['New leads (step 1)', 'firstTouch'], ['Follow-ups (step 2+)', 'followUp'],
  ['Days sending', 'sendingDays'], ['Total replies', 'replies'], ['Positive replies', 'positives'], ['Bounces', 'bounces'],
];
const RATES = [['Reply rate %', 'replies'], ['Positive per send %', 'positives'], ['Bounce rate %', 'bounces']];

export function buildMonthlyCsv(rows, statusByName, win) {
  const cell = v => { const s = str(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const cl = rangeLabel(win.cur), pl = rangeLabel(win.prev);
  const headers = ['Client', 'Type', '4-week KPI actual', '4-week KPI target', `Delivery ${pl}`, `Delivery ${cl}`, 'Delivery change',
    'Campaign', 'Smartlead URL', 'Status', 'Industry', 'Data source', 'DM type'];
  for (const [label] of METRICS) headers.push(`${label} ${cl}`, `${label} ${pl}`, `${label} change`);
  for (const [label] of RATES) headers.push(`${label} ${cl}`, `${label} ${pl}`, `${label} change (pt)`);
  headers.push(`Reply categories ${cl}`, `Reply categories ${pl}`);
  const rate = (s, k) => (s.sent ? (s[k] / s.sent * 100) : null);
  const lines = [headers.join(',')];
  for (const r of rows) {
    const s = statusByName[r.clientName];
    const out = [r.clientName, r.isRetainer ? 'Retainer' : 'PPM', s ? s.count : '', s ? s.target : '',
      s ? s.prevCount : '', s ? s.count : '', s ? s.trend.diff : '',
      r.campaignName, SMARTLEAD_CAMPAIGN_URL(r.campaignId), r.status, r.industry, r.dataSource, r.dmType];
    for (const [, k] of METRICS) out.push(r.cur[k], r.prev[k], r.cur[k] - r.prev[k]);
    for (const [, k] of RATES) {
      const a = rate(r.cur, k), b = rate(r.prev, k);
      out.push(a === null ? '' : a.toFixed(2), b === null ? '' : b.toFixed(2), a === null || b === null ? '' : (a - b).toFixed(2));
    }
    const cats = c => Object.entries(c).map(([k, v]) => `${k}: ${v}`).join('; ');
    out.push(cats(r.cur.categories), cats(r.prev.categories));
    lines.push(out.map(cell).join(','));
  }
  return lines.join('\n');
}

// ─── Window handlers ─────────────────────────────────────────
window.analysisRunMonthly = () => runMonthlyAnalysis();
window.analysisSetMonthlyWeek = (k) => { const m = getM(); m.week = k; m.hydratedKey = null; render(); };
window.analysisSetMonthScope = (s) => { const m = getM(); m.scope = s; m.hydratedKey = null; render(); };
window.analysisToggleMonthlyDormant = () => { const m = getM(); m.showDormant = !m.showDormant; render(); };
window.analysisExportMonthlyCsv = () => {
  const m = getM();
  if (!m.rows.length) return;
  const win = fourWeekWindows(selectedWeek());
  const statusByName = Object.fromEntries(clientStatus(win).map(s => [s.name, s]));
  const csv = buildMonthlyCsv(m.rows, statusByName, win);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `client-analysis-4wk-${win.cur.start}-to-${win.cur.end}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
