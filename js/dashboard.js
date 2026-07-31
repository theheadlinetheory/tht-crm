// ═══════════════════════════════════════════════════════════
// DASHBOARD — Dashboard rendering (client fulfillment + acquisition)
// ═══════════════════════════════════════════════════════════
import { state } from './app.js?v=20260801034132';
import { ACQUISITION_STAGES, NURTURE_STAGES, DEFAULT_CLIENT_STAGES, ALL_PIPELINES } from './config.js?v=20260801034132';
import { render } from './render.js?v=20260801034132';
import { esc, fmt$ } from './utils.js?v=20260801034132';
import { isAdmin, isEmployee } from './auth.js?v=20260801034132';
import { getOverdueActivities } from './activities.js?v=20260801034132';
import { sbGetArchivedDeals } from './api.js?v=20260801034132';

function dateAddedToDate(dateAdded) {
  if (!dateAdded) return null;
  const parts = String(dateAdded).split('/');
  if (parts.length !== 3) return null;
  const m = parseInt(parts[0], 10);
  const d = parseInt(parts[1], 10);
  let y = parseInt(parts[2], 10);
  if (y < 100) y += 2000;
  return new Date(y, m - 1, d);
}

// ─── Week helpers (weeks run Monday → Sunday, keyed by the Monday) ───
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function pad2(n) { return String(n).padStart(2, '0'); }

export function ymd(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Monday 00:00 of the week containing `date`
export function weekStartOf(date) {
  if (!date || isNaN(date.getTime())) return null;
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Sun(0) → 6, Mon(1) → 0
  return d;
}

export function currentWeekKey() { return ymd(weekStartOf(new Date())); }

export function shiftWeeks(weekKey, n) {
  const d = parseYmd(weekKey);
  d.setDate(d.getDate() + n * 7);
  return ymd(d);
}

// 'Jul 27 – Aug 2, 2026'
export function weekLabel(weekKey) {
  const s = parseYmd(weekKey);
  const e = new Date(s); e.setDate(e.getDate() + 6);
  const endPart = s.getMonth() === e.getMonth() ? `${e.getDate()}` : `${MONTH_ABBR[e.getMonth()]} ${e.getDate()}`;
  return `${MONTH_ABBR[s.getMonth()]} ${s.getDate()} – ${endPart}, ${e.getFullYear()}`;
}

// 'Jul 27' — for compact chart axes
export function weekLabelShort(weekKey) {
  const s = parseYmd(weekKey);
  return `${MONTH_ABBR[s.getMonth()]} ${s.getDate()}`;
}

// Lead Tracker dateAdded ('M/D/YY') → week key
export function trackerWeekKey(dateAdded) {
  const ws = weekStartOf(dateAddedToDate(dateAdded));
  return ws ? ymd(ws) : '';
}

// Pass-off datePassed (ISO / timestamp) → week key
function passOffWeekKey(datePassed) {
  if (!datePassed) return '';
  const ws = weekStartOf(new Date(datePassed));
  return ws ? ymd(ws) : '';
}

export function getStagesForPipeline(pip){
  if(pip==='Acquisition') return ACQUISITION_STAGES;
  if(pip==='Nurture') return NURTURE_STAGES;
  if(pip==='Client'){
    const clientCols=state.clients.map(c=>({id:c.name,label:c.name,color:c.color||'#6b7280'}));
    return [{id:'Client Not Distributed',label:'Not Distributed',color:'#6b7280'},...clientCols];
  }
  return DEFAULT_CLIENT_STAGES;
}

// ─── Dashboard Archive Cache ───
let _dashboardArchiveCache = null;
let _dashboardArchiveLoading = false;

async function ensureArchiveLoaded() {
  if (_dashboardArchiveCache) return _dashboardArchiveCache;
  if (_dashboardArchiveLoading) return [];
  _dashboardArchiveLoading = true;
  try {
    _dashboardArchiveCache = await sbGetArchivedDeals();
  } catch(e) {
    console.warn('Failed to load archive for dashboard:', e);
    _dashboardArchiveCache = [];
  }
  _dashboardArchiveLoading = false;
  return _dashboardArchiveCache;
}

export function clearDashboardArchiveCache() {
  _dashboardArchiveCache = null;
}

function resolveClientName(rawName) {
  if (!rawName) return rawName;
  const exact = state.clients.find(c => c.name === rawName);
  if (exact) return exact.name;
  const lower = rawName.toLowerCase();
  const ci = state.clients.find(c => c.name.toLowerCase() === lower);
  if (ci) return ci.name;
  const partial = state.clients.find(c => c.name.toLowerCase().startsWith(lower) || lower.startsWith(c.name.toLowerCase()));
  if (partial) return partial.name;
  return rawName;
}

function getClientForDeal(deal) {
  // Priority: bookedFor → clientName (archive) → stage
  if (deal.bookedFor) {
    const client = state.clients.find(c => c.name === deal.bookedFor);
    if (client) return client.name;
  }
  if (deal.clientName) {
    const client = state.clients.find(c => c.name === deal.clientName);
    if (client) return client.name;
  }
  if (deal.stage && deal.stage !== 'Client Not Distributed') {
    const client = state.clients.find(c => c.name === deal.stage);
    if (client) return client.name;
  }
  return null;
}

export function renderDashboard(){
  const tab = state.dashboardTab || 'client_leads';
  const now = new Date();
  const thisMonth = now.toISOString().slice(0,7);
  const cs = `padding:10px 20px;font-size:13px;font-weight:600;font-family:var(--font);cursor:pointer;border:none;background:none;margin-bottom:-2px`;

  let h = `<div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin:0 20px">
    <button onclick="state.dashboardTab='client_leads';render()" style="${cs};color:${tab==='client_leads'?'var(--purple)':'var(--text-muted)'};border-bottom:2px solid ${tab==='client_leads'?'var(--purple)':'transparent'}">Client Fulfillment</button>
    ${isAdmin()||isEmployee()?`<button onclick="state.dashboardTab='acquisition';render()" style="${cs};color:${tab==='acquisition'?'#2563eb':'var(--text-muted)'};border-bottom:2px solid ${tab==='acquisition'?'#2563eb':'transparent'}">Acquisition</button>`:''}
  </div>`;

  // Load archive data if not cached
  if (!_dashboardArchiveCache) {
    if (!_dashboardArchiveLoading) {
      ensureArchiveLoaded().then(() => { if (state.pipeline === 'dashboard') render(); });
    }
    h += `<div style="padding:60px;text-align:center;color:var(--text-muted)">
      <div class="loading-spinner"></div>
      <div style="margin-top:12px;font-size:13px">Loading dashboard data...</div>
    </div>`;
    return h;
  }

  const archived = _dashboardArchiveCache;

  if (tab === 'client_leads') {
    h += renderClientDashboard();
  } else if (isAdmin()||isEmployee()) {
    h += renderAcquisitionDashboard(thisMonth, archived);
  }
  return h;
}

function isActivePplClient(name) {
  const client = state.clients.find(c => c.name === name);
  return client && client.status !== 'inactive' && Number(client.leadCost) > 0;
}

function isPplTrackerEntry(e) {
  const cn = resolveClientName(e.clientName);
  return cn && isActivePplClient(cn);
}

function isPplDeal(deal) {
  const cn = getClientForDeal(deal);
  return cn ? isActivePplClient(cn) : deal.stage === 'Client Not Distributed';
}

// ═══════════════════════════════════════════════════════════
// WEEKLY KPI TARGETS
//   Pay-per-meeting clients: >= 1 booked meeting per week
//     (bare minimum; ~4/month keeps margins)
//   Retainer clients: >= 2 interested responses per week
//     (usually more; < 2 = something seriously wrong)
// ═══════════════════════════════════════════════════════════
export const PPM_WEEKLY_TARGET = 1;
export const RETAINER_WEEKLY_TARGET = 2;

function leadCostNum(c) {
  return parseFloat(String(c.leadCost ?? '').replace(/[^0-9.]/g, '')) || 0;
}

function isRetainerBilled(c) { return String(c.billingModel || '') === 'retainer'; }

function isActiveClient(c) { return c && c.status !== 'inactive'; }

// Pay-per-meeting (PPM / per-lead) clients — billed per booked meeting
export function getPpmClients() {
  return state.clients.filter(c => isActiveClient(c) && !isRetainerBilled(c) && leadCostNum(c) > 0);
}

// Retainer clients — billed monthly, measured on interested responses passed off
export function getRetainerClients() {
  return state.clients.filter(c => isActiveClient(c) && isRetainerBilled(c));
}

// clientName → booked meetings (Lead Tracker entries) in the given week
function bookedMeetingsByClient(weekKey) {
  const map = {};
  for (const e of state.trackerEntries) {
    if (trackerWeekKey(e.dateAdded) !== weekKey) continue;
    const cn = resolveClientName(e.clientName);
    if (!cn) continue;
    map[cn] = (map[cn] || 0) + 1;
  }
  return map;
}

// clientName → interested responses (retainer lead pass-offs) in the given week
function interestedResponsesByClient(weekKey) {
  const map = {};
  for (const p of (state.passOffs || [])) {
    if (passOffWeekKey(p.datePassed) !== weekKey) continue;
    const cn = resolveClientName(p.clientName);
    if (!cn) continue;
    map[cn] = (map[cn] || 0) + 1;
  }
  return map;
}

export function getWeeklyKpiStatus(weekKey) {
  const booked = bookedMeetingsByClient(weekKey);
  const interested = interestedResponsesByClient(weekKey);
  const ppm = getPpmClients().map(c => {
    const n = booked[c.name] || 0;
    return { name: c.name, count: n, target: PPM_WEEKLY_TARGET, hit: n >= PPM_WEEKLY_TARGET };
  }).sort((a, b) => a.count - b.count || a.name.localeCompare(b.name));
  const retainer = getRetainerClients().map(c => {
    const n = interested[c.name] || 0;
    return { name: c.name, count: n, target: RETAINER_WEEKLY_TARGET, hit: n >= RETAINER_WEEKLY_TARGET };
  }).sort((a, b) => a.count - b.count || a.name.localeCompare(b.name));
  return { ppm, retainer, booked, interested };
}

function kpiTargetCard(title, rule, note, rows, accent) {
  const hit = rows.filter(r => r.hit).length;
  const total = rows.length;
  const allGood = total > 0 && hit === total;
  const pillBg = total === 0 ? '#f3f4f6' : allGood ? '#dcfce7' : '#fee2e2';
  const pillFg = total === 0 ? '#6b7280' : allGood ? '#166534' : '#991b1b';
  const missing = rows.filter(r => !r.hit);
  return `<div style="flex:1;min-width:280px;background:#fff;border:1px solid var(--border);border-left:4px solid ${accent};border-radius:10px;padding:14px 16px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
      <div style="font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--text-muted)">${title}</div>
      <span style="background:${pillBg};color:${pillFg};font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px;white-space:nowrap">${hit}/${total} on target</span>
    </div>
    <div style="font-size:17px;font-weight:800;color:${accent};margin-top:6px">${rule}</div>
    <div style="font-size:11px;color:var(--text-muted);margin-top:3px">${note}</div>
    ${missing.length ? `<div style="font-size:11px;color:#b91c1c;margin-top:8px;line-height:1.5"><b>Below target:</b> ${missing.map(r => `${esc(r.name)} (${r.count})`).join(', ')}</div>`
      : total ? `<div style="font-size:11px;color:#15803d;margin-top:8px;font-weight:600">All clients hitting the bar this week.</div>` : ''}
  </div>`;
}

// One-line variant for the Lead Tracker sheets, whose container is a fixed
// height — see --tracker-top in css/styles.css if this ever grows taller.
function renderKpiTargetStrip(wk, ppm, retainer) {
  const ratio = (rows) => {
    const hit = rows.filter(r => r.hit).length;
    const ok = rows.length > 0 && hit === rows.length;
    return `<span style="background:${rows.length ? (ok ? '#dcfce7' : '#fee2e2') : '#f3f4f6'};color:${rows.length ? (ok ? '#166534' : '#991b1b') : '#6b7280'};font-size:10px;font-weight:700;padding:1px 7px;border-radius:999px">${hit}/${rows.length}</span>`;
  };
  const below = [...ppm, ...retainer].filter(r => !r.hit);
  return `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#f8fafc;border:1px solid var(--border);border-radius:8px;padding:6px 12px;margin:0 0 8px">
    <span style="font-size:10px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:var(--text-muted)">Weekly KPI · ${weekLabel(wk)}</span>
    <span style="font-size:11px;font-weight:600;color:#2563eb">PPM ≥ ${PPM_WEEKLY_TARGET} booked meeting/wk</span> ${ratio(ppm)}
    <span style="font-size:11px;font-weight:600;color:#7c3aed">Retainer ≥ ${RETAINER_WEEKLY_TARGET} interested responses/wk</span> ${ratio(retainer)}
    ${below.length ? `<span style="font-size:11px;color:#b91c1c;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b>Below:</b> ${below.map(r => `${esc(r.name)} (${r.count})`).join(', ')}</span>` : ''}
  </div>`;
}

// The two standing weekly KPIs, rendered as a banner. Shown at the top of the
// Client Fulfillment dashboard and above the Lead Tracker sheets (compact).
export function renderKpiTargetBar(weekKey, opts = {}) {
  const wk = weekKey || currentWeekKey();
  const { ppm, retainer } = getWeeklyKpiStatus(wk);
  const isCurrent = wk === currentWeekKey();
  if (opts.compact) return renderKpiTargetStrip(wk, ppm, retainer);
  return `<div style="background:#f8fafc;border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:20px">
    <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:10px">
      <div style="font-size:12px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:var(--text)">Weekly KPI targets</div>
      <div style="font-size:11px;color:var(--text-muted)">${isCurrent ? 'This week' : 'Week of'} · ${weekLabel(wk)}</div>
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      ${kpiTargetCard('Pay-per-meeting clients', `≥ ${PPM_WEEKLY_TARGET} booked meeting per week`, 'Bare minimum — ~4/month keeps margins. Counts Lead Tracker entries booked in the week.', ppm, '#2563eb')}
      ${kpiTargetCard('Retainer clients', `≥ ${RETAINER_WEEKLY_TARGET} interested responses per week`, 'Usually more — fewer than 2 means something is seriously wrong. Counts retainer leads passed off in the week.', retainer, '#7c3aed')}
    </div>
  </div>`;
}

export function renderClientDashboard(){
  const thisWeek = currentWeekKey();
  const selWeek = state.dashboardWeek || thisWeek;
  const clientDeals = state.deals.filter(d => d.pipeline === 'Client');

  // Week options: every week that has data, plus the last 12 weeks so empty
  // weeks are still selectable.
  const weekSet = new Set();
  state.trackerEntries.forEach(e => { const w = trackerWeekKey(e.dateAdded); if (w) weekSet.add(w); });
  (state.passOffs || []).forEach(p => { const w = passOffWeekKey(p.datePassed); if (w) weekSet.add(w); });
  for (let i = 0; i < 12; i++) weekSet.add(shiftWeeks(thisWeek, -i));
  weekSet.add(selWeek);
  const allWeeks = [...weekSet].sort().reverse();

  const prevWeek = shiftWeeks(selWeek, -1);

  // KPI 1: Booked meetings — from Lead Tracker dateAdded, pay-per-meeting clients only
  const weekEntries = state.trackerEntries.filter(e => trackerWeekKey(e.dateAdded) === selWeek && isPplTrackerEntry(e));
  const prevWeekEntries = state.trackerEntries.filter(e => trackerWeekKey(e.dateAdded) === prevWeek && isPplTrackerEntry(e));
  const bookedWeek = weekEntries.length;
  const prevBooked = prevWeekEntries.length;

  // KPI 2: Called Back (from tracker callbackStatus)
  const calledBackWeek = weekEntries.filter(e => String(e.callbackStatus || '').toLowerCase() === 'called back').length;
  const prevCalledBack = prevWeekEntries.filter(e => String(e.callbackStatus || '').toLowerCase() === 'called back').length;

  // KPI 3: Good Leads (booked minus called back)
  const goodWeek = bookedWeek - calledBackWeek;
  const prevGood = prevBooked - prevCalledBack;

  // KPI 4: Interested Responses — retainer lead pass-offs in the week
  const retainerNames = new Set(getRetainerClients().map(c => c.name));
  const passOffsIn = (wk) => (state.passOffs || []).filter(p => passOffWeekKey(p.datePassed) === wk && retainerNames.has(resolveClientName(p.clientName))).length;
  const interestedWeek = passOffsIn(selWeek);
  const prevInterested = passOffsIn(prevWeek);

  // KPI 5: Active Leads — PPL clients only
  const pplDeals = clientDeals.filter(d => isPplDeal(d));
  const activeLeads = pplDeals.length;

  // KPI 6: Undistributed (active only)
  const undistributed = clientDeals.filter(d => d.stage === 'Client Not Distributed').length;

  // KPI 7: Overdue Tasks
  const overdueActs = getOverdueActivities().filter(a => {
    const deal = state.deals.find(d => d.id === a.dealId);
    return deal && deal.pipeline === 'Client';
  });

  const trend = (cur, prev) => {
    if (prev === 0 && cur === 0) return '';
    if (cur > prev) return `<span style="font-size:10px;color:#22c55e;margin-left:4px">+${cur - prev} vs last wk</span>`;
    if (cur < prev) return `<span style="font-size:10px;color:#ef4444;margin-left:4px">${cur - prev} vs last wk</span>`;
    return `<span style="font-size:10px;color:var(--text-muted);margin-left:4px">same as last wk</span>`;
  };

  const wkLabel = weekLabel(selWeek);
  const cardStyle = 'background:#fff;border-radius:10px;padding:16px;border:1px solid var(--border)';
  const labelStyle = 'font-size:10px;color:var(--text-muted);text-transform:uppercase;font-weight:600';
  const numStyle = 'font-size:28px;font-weight:800';

  let h = `<div style="padding:24px;max-width:960px;margin:0 auto">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div>
        <h2 style="font-size:18px;font-weight:800;margin:0 0 4px">Client Fulfillment</h2>
        <p style="font-size:12px;color:var(--text-muted);margin:0">Lead delivery and fulfillment tracking — weekly (Mon–Sun)</p>
      </div>
      <select onchange="state.dashboardWeek=this.value;render()" style="padding:6px 12px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-weight:600;font-family:var(--font);background:#fff;cursor:pointer">
        ${allWeeks.map(w => `<option value="${w}" ${w === selWeek ? 'selected' : ''}>${weekLabel(w)}${w === thisWeek ? ' (this week)' : ''}</option>`).join('')}
      </select>
    </div>
    ${renderKpiTargetBar(selWeek)}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px">
      <div style="${cardStyle}"><div style="${labelStyle}">Meetings Booked (${wkLabel})</div><div style="${numStyle};color:#2563eb">${bookedWeek}</div>${trend(bookedWeek, prevBooked)}</div>
      <div style="${cardStyle}"><div style="${labelStyle}">Interested Responses</div><div style="${numStyle};color:#7c3aed">${interestedWeek}</div>${trend(interestedWeek, prevInterested)}</div>
      <div style="${cardStyle}"><div style="${labelStyle}">Called Back</div><div style="${numStyle};color:#ef4444">${calledBackWeek}</div>${trend(calledBackWeek, prevCalledBack)}</div>
      <div style="${cardStyle}"><div style="${labelStyle}">Good Leads</div><div style="${numStyle};color:#22c55e">${goodWeek}</div>${trend(goodWeek, prevGood)}</div>
      <div style="${cardStyle}"><div style="${labelStyle}">Active Leads</div><div style="${numStyle};color:var(--purple)">${activeLeads}</div></div>
      <div style="${cardStyle}"><div style="${labelStyle}">Undistributed</div><div style="${numStyle};color:${undistributed ? '#f59e0b' : '#22c55e'}">${undistributed}</div></div>
      <div style="${cardStyle}"><div style="${labelStyle}">Overdue Tasks</div><div style="${numStyle};color:${overdueActs.length ? '#ef4444' : '#22c55e'}">${overdueActs.length}</div></div>
    </div>`;

  // ─── Per-Client Table ───
  h += renderClientTable(selWeek, wkLabel, clientDeals);

  // ─── Weekly Intake Chart ───
  h += renderIntakeChart();

  h += `</div>`;
  return h;
}

function renderClientTable(selWeek, wkLabel, clientDeals) {
  const today = new Date();
  const clientCounts = {};
  const blank = () => ({ active: 0, booked: 0, calledBack: 0, interested: 0, lastLead: null });

  state.clients.forEach(c => { clientCounts[c.name] = blank(); });

  clientDeals.forEach(d => {
    const cn = getClientForDeal(d);
    if (!cn) return;
    if (!clientCounts[cn]) clientCounts[cn] = blank();
    clientCounts[cn].active++;
  });

  state.trackerEntries.forEach(e => {
    const cn = resolveClientName(e.clientName);
    if (!cn) return;
    if (!clientCounts[cn]) clientCounts[cn] = blank();
    if (trackerWeekKey(e.dateAdded) === selWeek) {
      clientCounts[cn].booked++;
      if (String(e.callbackStatus || '').toLowerCase() === 'called back') clientCounts[cn].calledBack++;
    }
    const dt = dateAddedToDate(e.dateAdded);
    if (dt && (!clientCounts[cn].lastLead || dt > clientCounts[cn].lastLead)) {
      clientCounts[cn].lastLead = dt;
    }
  });

  (state.passOffs || []).forEach(p => {
    const cn = resolveClientName(p.clientName);
    if (!cn) return;
    if (!clientCounts[cn]) clientCounts[cn] = blank();
    if (passOffWeekKey(p.datePassed) === selWeek) clientCounts[cn].interested++;
    const dt = p.datePassed ? new Date(p.datePassed) : null;
    if (dt && !isNaN(dt.getTime()) && (!clientCounts[cn].lastLead || dt > clientCounts[cn].lastLead)) {
      clientCounts[cn].lastLead = dt;
    }
  });

  const ppmNames = new Set(getPpmClients().map(c => c.name));
  const retainerNames = new Set(getRetainerClients().map(c => c.name));

  const visibleClients = Object.entries(clientCounts)
    .filter(([name]) => ppmNames.has(name) || retainerNames.has(name))
    .map(([name, c]) => {
      const isRet = retainerNames.has(name);
      const delivered = isRet ? c.interested : c.booked;
      const target = isRet ? RETAINER_WEEKLY_TARGET : PPM_WEEKLY_TARGET;
      return { name, c, isRet, delivered, target, hit: delivered >= target };
    })
    .sort((a, b) => (a.hit === b.hit ? 0 : a.hit ? 1 : -1) || b.delivered - a.delivered || a.name.localeCompare(b.name));

  const th = 'padding:8px 12px;font-size:11px;font-weight:700;color:var(--text-muted)';
  let h = `<h3 style="font-size:14px;font-weight:700;margin-bottom:4px">Leads by Client \u2014 week of ${wkLabel}</h3>
    <p style="font-size:11px;color:var(--text-muted);margin:0 0 10px">Delivered = booked meetings for pay-per-meeting clients, interested responses for retainer clients. Off-target clients are listed first.</p>
    <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;border:1px solid var(--border)">
      <thead><tr style="background:#f9fafb">
        <th style="text-align:left;${th}">Client</th>
        <th style="text-align:center;${th}">Type</th>
        <th style="text-align:center;${th}">Active</th>
        <th style="text-align:center;${th}">Delivered (this week)</th>
        <th style="text-align:center;${th}">Target</th>
        <th style="text-align:center;${th}">Called Back</th>
        <th style="text-align:center;${th}">Good</th>
        <th style="text-align:center;${th}">Last Lead</th>
        <th style="text-align:center;${th}">Status</th>
      </tr></thead>
      <tbody>`;

  for (const row of visibleClients) {
    const { name, c, isRet, delivered, target, hit } = row;
    const client = state.clients.find(x => x.name === name);
    const dot = client ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${client.color || '#818cf8'};margin-right:6px"></span>` : '';
    const good = isRet ? delivered : c.booked - c.calledBack;

    let statusHtml = '';
    if (c.lastLead) {
      const daysSince = Math.floor((today - c.lastLead) / (1000 * 60 * 60 * 24));
      if (daysSince >= 30) {
        statusHtml = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ef4444;margin-right:4px"></span><span style="color:#ef4444;font-weight:600">30+ days</span>`;
      } else {
        statusHtml = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#22c55e"></span>`;
      }
    }

    // Full date incl. year, so "Jul 26" can't be mistaken for another year
    const lastLeadDisplay = c.lastLead ? c.lastLead.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '\u2014';
    const typeBadge = isRet
      ? `<span style="background:#ede9fe;color:#6d28d9;font-size:9px;font-weight:700;padding:2px 7px;border-radius:999px">RETAINER</span>`
      : `<span style="background:#dbeafe;color:#1d4ed8;font-size:9px;font-weight:700;padding:2px 7px;border-radius:999px">PPM</span>`;
    const targetBadge = `<span style="background:${hit ? '#dcfce7' : '#fee2e2'};color:${hit ? '#166534' : '#991b1b'};font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap">${hit ? '\u2713' : '\u2717'} \u2265 ${target}</span>`;

    h += `<tr style="border-top:1px solid #f3f4f6;${hit ? '' : 'background:#fffbfb'}">
      <td style="padding:8px 12px;font-size:12px;font-weight:600">${dot}${esc(name)}</td>
      <td style="text-align:center;padding:8px 12px">${typeBadge}</td>
      <td style="text-align:center;padding:8px 12px;font-size:12px">${c.active}</td>
      <td style="text-align:center;padding:8px 12px;font-size:13px;font-weight:700;color:${hit ? '#111827' : '#b91c1c'}">${delivered}</td>
      <td style="text-align:center;padding:8px 12px">${targetBadge}</td>
      <td style="text-align:center;padding:8px 12px;font-size:12px;color:${c.calledBack ? '#ef4444' : 'var(--text-muted)'};font-weight:${c.calledBack ? '600' : '400'}">${isRet ? '\u2014' : c.calledBack}</td>
      <td style="text-align:center;padding:8px 12px;font-size:12px;color:#22c55e;font-weight:600">${good}</td>
      <td style="text-align:center;padding:8px 12px;font-size:11px;color:var(--text-muted)">${lastLeadDisplay}</td>
      <td style="text-align:center;padding:8px 12px;font-size:11px">${statusHtml}</td>
    </tr>`;
  }

  h += `</tbody></table>`;
  return h;
}

// Weekly intake bar chart.
// Y AXIS = number of booked meetings (Lead Tracker entries) whose Date falls in
// that week. X axis = the last 12 weeks, labelled by the Monday that starts them.
function renderIntakeChart() {
  const entries = state.trackerEntries;
  const thisWeek = currentWeekKey();
  const WEEKS = 12;

  // Build last 12 weeks, oldest \u2192 newest
  const weeks = [];
  for (let i = WEEKS - 1; i >= 0; i--) weeks.push(shiftWeeks(thisWeek, -i));

  // Get unique clients for filter (resolve short names)
  const clientNames = [...new Set(entries.map(e => resolveClientName(e.clientName)).filter(Boolean))].sort();
  const filterClient = state.dashboardChartClient || '';

  const counts = weeks.map(w => {
    return entries.filter(e => {
      if (trackerWeekKey(e.dateAdded) !== w) return false;
      if (filterClient) return resolveClientName(e.clientName) === filterClient;
      return true;
    }).length;
  });

  const maxCount = Math.max(...counts, 1);
  const chartH = 210;
  const barW = 48;
  const gap = 12;
  const leftPad = 52;   // room for the rotated y-axis title + tick labels
  const bottomPad = 26;
  const plotH = chartH - bottomPad - 20;
  const plotRight = leftPad + WEEKS * (barW + gap) - gap;

  let bars = '';
  weeks.forEach((w, i) => {
    const count = counts[i];
    const barH = (count / maxCount) * plotH;
    const x = leftPad + i * (barW + gap);
    const y = chartH - bottomPad - barH;

    bars += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="${w === thisWeek ? '#4f46e5' : '#818cf8'}"><title>Week of ${weekLabel(w)}: ${count} booked meeting${count === 1 ? '' : 's'}</title></rect>`;
    // Count label on top
    if (count > 0) {
      bars += `<text x="${x + barW / 2}" y="${y - 4}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--text)">${count}</text>`;
    }
    // Week label on bottom (Monday that starts the week)
    bars += `<text x="${x + barW / 2}" y="${chartH - 6}" text-anchor="middle" font-size="10" fill="var(--text-muted)">${weekLabelShort(w)}</text>`;
  });

  // Y-axis: tick labels, gridlines and an explicit axis title
  const ySteps = 4;
  let yAxis = `<text x="14" y="${chartH / 2}" text-anchor="middle" font-size="10" font-weight="600" fill="var(--text-muted)" transform="rotate(-90 14 ${chartH / 2})">Booked meetings</text>`;
  for (let i = 0; i <= ySteps; i++) {
    const val = Math.round((maxCount / ySteps) * i);
    const y = chartH - bottomPad - (plotH / ySteps) * i;
    yAxis += `<text x="${leftPad - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="var(--text-muted)">${val}</text>`;
    yAxis += `<line x1="${leftPad}" y1="${y}" x2="${plotRight}" y2="${y}" stroke="#f3f4f6" stroke-width="1"/>`;
  }

  return `<div style="margin-top:24px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
      <h3 style="font-size:14px;font-weight:700;margin:0">Weekly Intake \u2014 Last 12 Weeks</h3>
      <select onchange="state.dashboardChartClient=this.value;render()" style="padding:4px 10px;border:1px solid var(--border);border-radius:6px;font-size:11px;font-family:var(--font);background:#fff;cursor:pointer">
        <option value="">All Clients</option>
        ${clientNames.map(n => `<option value="${esc(n)}" ${filterClient === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}
      </select>
    </div>
    <p style="font-size:11px;color:var(--text-muted);margin:0 0 10px">
      <b>Y axis = number of booked meetings</b> (Lead Tracker entries) with a Date in that week${filterClient ? ` for ${esc(filterClient)}` : ', across all clients'}.
      <b>X axis = week</b>, labelled by the Monday it starts on (Mon\u2013Sun).
    </p>
    <div style="background:#fff;border-radius:10px;padding:16px;border:1px solid var(--border);overflow-x:auto">
      <svg width="${leftPad + WEEKS * (barW + gap)}" height="${chartH}" style="display:block;margin:0 auto">
        ${yAxis}
        ${bars}
      </svg>
    </div>
  </div>`;
}

export function renderAcquisitionDashboard(thisMonth, archived){
  const selMonth = state.dashboardAcqMonth || thisMonth;
  const acqDeals = state.deals.filter(d => d.pipeline === 'Acquisition');
  const acqArchived = archived.filter(d => d.pipeline === 'Acquisition');

  // Build month set
  const monthSet = new Set();
  acqDeals.forEach(d => { const cm = (d.createdDate || '').slice(0,7); if (cm) monthSet.add(cm); });
  acqArchived.forEach(d => {
    const cm = (d.createdDate || '').slice(0,7); if (cm) monthSet.add(cm);
    const am = (d.archivedAt || '').slice(0,7); if (am) monthSet.add(am);
  });
  monthSet.add(thisMonth);
  const allMonths = [...monthSet].sort().reverse();

  const [sy, sm] = selMonth.split('-').map(Number);
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthLabel = monthNames[sm - 1] + ' ' + sy;

  // KPI 1: New Responses (active + archived, createdDate in month)
  const newResponses = acqDeals.filter(d => (d.createdDate || '').slice(0,7) === selMonth).length
    + acqArchived.filter(d => (d.createdDate || '').slice(0,7) === selMonth).length;

  // KPI 2: Closed Won (archived, archived_at in month)
  const closedWon = acqArchived.filter(d => d.archiveStatus === 'Closed Won' && (d.archivedAt || '').slice(0,7) === selMonth).length;

  // KPI 3: Closed Lost (archived, archived_at in month)
  const closedLost = acqArchived.filter(d => d.archiveStatus === 'Deleted/Lost' && (d.archivedAt || '').slice(0,7) === selMonth).length;

  // KPI 4: Pipeline Value (active only)
  const totalValue = acqDeals.reduce((s, d) => s + (Number(d.value) || 0), 0);

  // Demo-based metrics from demo_tracker table
  const fullMonthNames = ['','January','February','March','April','May','June','July','August','September','October','November','December'];
  const demoMonthLabel = `${fullMonthNames[sm]}/${String(sy).slice(-2)}`;
  const monthDemos = state.demoEntries.filter(e => String(e.month || '') === demoMonthLabel);
  const allDemos = state.demoEntries;
  const demosBooked = allDemos.length;
  const noShows = allDemos.filter(e => String(e.showStatus || '') === 'No-Show').length;
  const allWon = allDemos.filter(e => String(e.outcome || '') === 'Qualified — Closed Won').length;
  const showRate = demosBooked ? (((demosBooked - noShows) / demosBooked) * 100).toFixed(0) : '0';
  const closeRate = demosBooked ? ((allWon / demosBooked) * 100).toFixed(0) : '0';
  const monthDemosBooked = monthDemos.length;
  const monthNoShows = monthDemos.filter(e => String(e.showStatus || '') === 'No-Show').length;
  const monthShowed = monthDemos.filter(e => String(e.showStatus || '') === 'Showed').length;
  const monthWon = monthDemos.filter(e => String(e.outcome || '') === 'Qualified — Closed Won').length;

  // KPI 7: Overdue Tasks
  const overdueActs = getOverdueActivities().filter(a => {
    const deal = state.deals.find(d => d.id === a.dealId);
    return deal && deal.pipeline === 'Acquisition';
  });

  const cardStyle = 'background:#fff;border-radius:10px;padding:16px;border:1px solid var(--border)';
  const labelStyle = 'font-size:10px;color:var(--text-muted);text-transform:uppercase;font-weight:600';
  const numStyle = 'font-size:28px;font-weight:800';

  // All-time Won/Lost counts for pipeline grid
  const totalWon = acqArchived.filter(d => d.archiveStatus === 'Closed Won').length;
  const totalLost = acqArchived.filter(d => d.archiveStatus === 'Deleted/Lost').length;
  const wonValue = acqArchived.filter(d => d.archiveStatus === 'Closed Won').reduce((s, d) => s + (Number(d.value) || 0), 0);

  return `<div style="padding:24px;max-width:960px;margin:0 auto">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
      <div>
        <h2 style="font-size:18px;font-weight:800;margin:0 0 4px">Acquisition</h2>
        <p style="font-size:12px;color:var(--text-muted);margin:0">Sales pipeline for signing new clients</p>
      </div>
      <select onchange="state.dashboardAcqMonth=this.value;render()" style="padding:6px 12px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-weight:600;font-family:var(--font);background:#fff;cursor:pointer">
        ${allMonths.map(m => {
          const [y2, m2] = m.split('-').map(Number);
          return `<option value="${m}" ${m === selMonth ? 'selected' : ''}>${monthNames[m2 - 1]} ${y2}</option>`;
        }).join('')}
      </select>
    </div>
    <div style="margin-top:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px">
      <div style="${cardStyle}"><div style="${labelStyle}">New Responses (${monthLabel})</div><div style="${numStyle};color:#2563eb">${newResponses}</div></div>
      <div style="${cardStyle}"><div style="${labelStyle}">Closed Won (${monthLabel})</div><div style="${numStyle};color:#22c55e">${closedWon}</div></div>
      <div style="${cardStyle}"><div style="${labelStyle}">Closed Lost (${monthLabel})</div><div style="${numStyle};color:#ef4444">${closedLost}</div></div>
      <div style="${cardStyle}"><div style="${labelStyle}">Pipeline Value</div><div style="${numStyle};color:var(--purple)">${fmt$(totalValue)}</div></div>
      <div style="${cardStyle}"><div style="${labelStyle}">Demos (${monthLabel})</div><div style="${numStyle};color:#818cf8">${monthDemosBooked}</div><div style="font-size:10px;color:var(--text-muted);margin-top:2px">${monthShowed} showed, ${monthNoShows} no-show</div></div>
      <div style="${cardStyle}"><div style="${labelStyle}">Won (${monthLabel})</div><div style="${numStyle};color:#22c55e">${monthWon}</div></div>
      <div style="${cardStyle}"><div style="${labelStyle}">Show Rate</div><div style="${numStyle};color:#0891b2">${showRate}%</div><div style="font-size:10px;color:var(--text-muted);margin-top:2px">${demosBooked - noShows}/${demosBooked} all time</div></div>
      <div style="${cardStyle}"><div style="${labelStyle}">Demo Close Rate</div><div style="${numStyle};color:#22c55e">${closeRate}%</div><div style="font-size:10px;color:var(--text-muted);margin-top:2px">${allWon}/${demosBooked} all time</div></div>
      <div style="${cardStyle}"><div style="${labelStyle}">Overdue Tasks</div><div style="${numStyle};color:${overdueActs.length ? '#ef4444' : '#22c55e'}">${overdueActs.length}</div></div>
    </div>
    <h3 style="font-size:14px;font-weight:700;margin-bottom:10px">Pipeline Stages</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px">
      ${getStagesForPipeline('Acquisition').map(s => {
        const count = acqDeals.filter(d => d.stage === s.id).length;
        const stageValue = acqDeals.filter(d => d.stage === s.id).reduce((sum, d) => sum + (Number(d.value) || 0), 0);
        return `<div style="background:#fff;border-radius:8px;padding:10px 12px;border:1px solid var(--border);border-top:3px solid ${s.color}">
          <div style="font-size:10px;color:var(--text-muted);font-weight:600">${esc(s.label)}</div>
          <div style="font-size:22px;font-weight:800;color:var(--text)">${count}</div>
          <div style="font-size:10px;color:var(--text-muted)">${fmt$(stageValue)}</div>
        </div>`;
      }).join('')}
      <div style="background:#fff;border-radius:8px;padding:10px 12px;border:1px solid var(--border);border-top:3px solid #22c55e">
        <div style="font-size:10px;color:var(--text-muted);font-weight:600">Won</div>
        <div style="font-size:22px;font-weight:800;color:#22c55e">${totalWon}</div>
        <div style="font-size:10px;color:#059669">${fmt$(wonValue)}</div>
      </div>
      <div style="background:#fff;border-radius:8px;padding:10px 12px;border:1px solid var(--border);border-top:3px solid #ef4444">
        <div style="font-size:10px;color:var(--text-muted);font-weight:600">Lost</div>
        <div style="font-size:22px;font-weight:800;color:#ef4444">${totalLost}</div>
      </div>
    </div>
  </div>`;
}
