// ═══════════════════════════════════════════════════════════
// DASHBOARD — Dashboard rendering (client fulfillment + acquisition)
// ═══════════════════════════════════════════════════════════
import { state } from './app.js';
import { ACQUISITION_STAGES, NURTURE_STAGES, DEFAULT_CLIENT_STAGES, ALL_PIPELINES } from './config.js';
import { render } from './render.js';
import { esc, fmt$ } from './utils.js';
import { isAdmin, isEmployee } from './auth.js';
import { getOverdueActivities } from './activities.js';
import { sbGetArchivedDeals } from './api.js';

function dateAddedToYM(dateAdded) {
  if (!dateAdded) return '';
  const parts = String(dateAdded).split('/');
  if (parts.length !== 3) return '';
  const m = parseInt(parts[0], 10);
  let y = parseInt(parts[2], 10);
  if (y < 100) y += 2000;
  return `${y}-${String(m).padStart(2, '0')}`;
}

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
    ensureArchiveLoaded().then(() => render());
    h += `<div style="padding:60px;text-align:center;color:var(--text-muted)">
      <div class="loading-spinner"></div>
      <div style="margin-top:12px;font-size:13px">Loading dashboard data...</div>
    </div>`;
    return h;
  }

  const archived = _dashboardArchiveCache;

  if (tab === 'client_leads') {
    h += renderClientDashboard(thisMonth, archived);
  } else if (isAdmin()||isEmployee()) {
    h += renderAcquisitionDashboard(thisMonth, archived);
  }
  return h;
}

export function renderClientDashboard(thisMonth, archived){
  const selMonth = state.dashboardMonth || thisMonth;
  const clientDeals = state.deals.filter(d => d.pipeline === 'Client');
  const clientArchived = archived.filter(d => d.pipeline === 'Client');

  // Build month set from active + archived
  const monthSet = new Set();
  clientDeals.forEach(d => {
    const cm = (d.createdDate || '').slice(0,7);
    if (cm) monthSet.add(cm);
  });
  clientArchived.forEach(d => {
    const cm = (d.createdDate || '').slice(0,7);
    if (cm) monthSet.add(cm);
    const am = (d.archivedAt || '').slice(0,7);
    if (am) monthSet.add(am);
  });
  state.trackerEntries.forEach(e => {
    const ym = dateAddedToYM(e.dateAdded);
    if (ym) monthSet.add(ym);
  });
  monthSet.add(thisMonth);
  const allMonths = [...monthSet].sort().reverse();

  const [sy, sm] = selMonth.split('-').map(Number);
  const prevDate = new Date(sy, sm - 2, 1);
  const prevMonth = prevDate.toISOString().slice(0,7);

  // KPI 1: Booked Leads — from Lead Tracker dateAdded (source of truth)
  const monthEntries = state.trackerEntries.filter(e => dateAddedToYM(e.dateAdded) === selMonth);
  const prevMonthEntries = state.trackerEntries.filter(e => dateAddedToYM(e.dateAdded) === prevMonth);
  const bookedMonth = monthEntries.length;
  const prevBooked = prevMonthEntries.length;

  // KPI 2: Called Back (from tracker callbackStatus)
  const calledBackMonth = monthEntries.filter(e => String(e.callbackStatus || '').toLowerCase() === 'called back').length;
  const prevCalledBack = prevMonthEntries.filter(e => String(e.callbackStatus || '').toLowerCase() === 'called back').length;

  // KPI 3: Good Leads (booked minus called back)
  const goodMonth = bookedMonth - calledBackMonth;
  const prevGood = prevBooked - prevCalledBack;

  // KPI 4: Active Leads (active only, all time)
  const activeLeads = clientDeals.length;

  // KPI 4: Undistributed (active only)
  const undistributed = clientDeals.filter(d => d.stage === 'Client Not Distributed').length;

  // KPI 5: Overdue Tasks
  const overdueActs = getOverdueActivities().filter(a => {
    const deal = state.deals.find(d => d.id === a.dealId);
    return deal && deal.pipeline === 'Client';
  });

  const trend = (cur, prev) => {
    if (prev === 0 && cur === 0) return '';
    if (cur > prev) return `<span style="font-size:10px;color:#22c55e;margin-left:4px">+${cur - prev} vs last mo</span>`;
    if (cur < prev) return `<span style="font-size:10px;color:#ef4444;margin-left:4px">${cur - prev} vs last mo</span>`;
    return `<span style="font-size:10px;color:var(--text-muted);margin-left:4px">same as last mo</span>`;
  };

  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthLabel = monthNames[sm - 1] + ' ' + sy;
  const cardStyle = 'background:#fff;border-radius:10px;padding:16px;border:1px solid var(--border)';
  const labelStyle = 'font-size:10px;color:var(--text-muted);text-transform:uppercase;font-weight:600';
  const numStyle = 'font-size:28px;font-weight:800';

  let h = `<div style="padding:24px;max-width:960px;margin:0 auto">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div>
        <h2 style="font-size:18px;font-weight:800;margin:0 0 4px">Client Fulfillment</h2>
        <p style="font-size:12px;color:var(--text-muted);margin:0">Lead delivery and fulfillment tracking</p>
      </div>
      <select onchange="state.dashboardMonth=this.value;render()" style="padding:6px 12px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-weight:600;font-family:var(--font);background:#fff;cursor:pointer">
        ${allMonths.map(m => {
          const [y2, m2] = m.split('-').map(Number);
          return `<option value="${m}" ${m === selMonth ? 'selected' : ''}>${monthNames[m2 - 1]} ${y2}</option>`;
        }).join('')}
      </select>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px">
      <div style="${cardStyle}"><div style="${labelStyle}">Booked (${monthLabel})</div><div style="${numStyle};color:#2563eb">${bookedMonth}</div>${trend(bookedMonth, prevBooked)}</div>
      <div style="${cardStyle}"><div style="${labelStyle}">Called Back</div><div style="${numStyle};color:#ef4444">${calledBackMonth}</div>${trend(calledBackMonth, prevCalledBack)}</div>
      <div style="${cardStyle}"><div style="${labelStyle}">Good Leads</div><div style="${numStyle};color:#22c55e">${goodMonth}</div>${trend(goodMonth, prevGood)}</div>
      <div style="${cardStyle}"><div style="${labelStyle}">Active Leads</div><div style="${numStyle};color:var(--purple)">${activeLeads}</div></div>
      <div style="${cardStyle}"><div style="${labelStyle}">Undistributed</div><div style="${numStyle};color:${undistributed ? '#f59e0b' : '#22c55e'}">${undistributed}</div></div>
      <div style="${cardStyle}"><div style="${labelStyle}">Overdue Tasks</div><div style="${numStyle};color:${overdueActs.length ? '#ef4444' : '#22c55e'}">${overdueActs.length}</div></div>
    </div>`;

  // ─── Per-Client Table ───
  h += renderClientTable(selMonth, monthLabel, clientDeals);

  // ─── Monthly Intake Chart ───
  h += renderIntakeChart();

  h += `</div>`;
  return h;
}

function renderClientTable(selMonth, monthLabel, clientDeals) {
  const today = new Date();
  const clientCounts = {};

  state.clients.forEach(c => {
    clientCounts[c.name] = { active: 0, booked: 0, calledBack: 0, lastLead: null };
  });

  clientDeals.forEach(d => {
    const cn = getClientForDeal(d);
    if (!cn) return;
    if (!clientCounts[cn]) clientCounts[cn] = { active: 0, booked: 0, calledBack: 0, lastLead: null };
    clientCounts[cn].active++;
  });

  state.trackerEntries.forEach(e => {
    const cn = resolveClientName(e.clientName);
    if (!cn) return;
    if (!clientCounts[cn]) clientCounts[cn] = { active: 0, booked: 0, calledBack: 0, lastLead: null };
    if (dateAddedToYM(e.dateAdded) === selMonth) {
      clientCounts[cn].booked++;
      if (String(e.callbackStatus || '').toLowerCase() === 'called back') clientCounts[cn].calledBack++;
    }
    const dt = dateAddedToDate(e.dateAdded);
    if (dt && (!clientCounts[cn].lastLead || dt > clientCounts[cn].lastLead)) {
      clientCounts[cn].lastLead = dt;
    }
  });

  const visibleClients = Object.entries(clientCounts)
    .filter(([, c]) => c.active > 0 || c.booked > 0)
    .sort((a, b) => b[1].booked - a[1].booked || b[1].active - a[1].active);

  let h = `<h3 style="font-size:14px;font-weight:700;margin-bottom:10px">Leads by Client \u2014 ${monthLabel}</h3>
    <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;border:1px solid var(--border)">
      <thead><tr style="background:#f9fafb">
        <th style="text-align:left;padding:8px 12px;font-size:11px;font-weight:700;color:var(--text-muted)">Client</th>
        <th style="text-align:center;padding:8px 12px;font-size:11px;font-weight:700;color:var(--text-muted)">Active</th>
        <th style="text-align:center;padding:8px 12px;font-size:11px;font-weight:700;color:var(--text-muted)">Booked (${monthLabel})</th>
        <th style="text-align:center;padding:8px 12px;font-size:11px;font-weight:700;color:var(--text-muted)">Called Back</th>
        <th style="text-align:center;padding:8px 12px;font-size:11px;font-weight:700;color:var(--text-muted)">Good</th>
        <th style="text-align:center;padding:8px 12px;font-size:11px;font-weight:700;color:var(--text-muted)">Last Lead</th>
        <th style="text-align:center;padding:8px 12px;font-size:11px;font-weight:700;color:var(--text-muted)">Status</th>
      </tr></thead>
      <tbody>`;

  for (const [name, c] of visibleClients) {
    const client = state.clients.find(x => x.name === name);
    const dot = client ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${client.color || '#818cf8'};margin-right:6px"></span>` : '';
    const good = c.booked - c.calledBack;

    let statusHtml = '';
    if (c.lastLead) {
      const daysSince = Math.floor((today - c.lastLead) / (1000 * 60 * 60 * 24));
      if (daysSince >= 30) {
        statusHtml = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ef4444;margin-right:4px"></span><span style="color:#ef4444;font-weight:600">30+ days</span>`;
      } else {
        statusHtml = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#22c55e"></span>`;
      }
    }

    const lastLeadDisplay = c.lastLead ? c.lastLead.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '\u2014';

    h += `<tr style="border-top:1px solid #f3f4f6">
      <td style="padding:8px 12px;font-size:12px;font-weight:600">${dot}${esc(name)}</td>
      <td style="text-align:center;padding:8px 12px;font-size:12px">${c.active}</td>
      <td style="text-align:center;padding:8px 12px;font-size:12px">${c.booked}</td>
      <td style="text-align:center;padding:8px 12px;font-size:12px;color:${c.calledBack ? '#ef4444' : 'var(--text-muted)'};font-weight:${c.calledBack ? '600' : '400'}">${c.calledBack}</td>
      <td style="text-align:center;padding:8px 12px;font-size:12px;color:#22c55e;font-weight:600">${good}</td>
      <td style="text-align:center;padding:8px 12px;font-size:11px;color:var(--text-muted)">${lastLeadDisplay}</td>
      <td style="text-align:center;padding:8px 12px;font-size:11px">${statusHtml}</td>
    </tr>`;
  }

  h += `</tbody></table>`;
  return h;
}

function renderIntakeChart() {
  const entries = state.trackerEntries;
  const now = new Date();

  // Build last 12 months
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.toISOString().slice(0,7));
  }
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Get unique clients for filter (resolve short names)
  const clientNames = [...new Set(entries.map(e => resolveClientName(e.clientName)).filter(Boolean))].sort();
  const filterClient = state.dashboardChartClient || '';

  const counts = months.map(m => {
    return entries.filter(e => {
      if (dateAddedToYM(e.dateAdded) !== m) return false;
      if (filterClient) return resolveClientName(e.clientName) === filterClient;
      return true;
    }).length;
  });

  const maxCount = Math.max(...counts, 1);
  const chartW = 720;
  const chartH = 200;
  const barW = 48;
  const gap = 12;
  const leftPad = 30;
  const bottomPad = 24;

  let bars = '';
  months.forEach((m, i) => {
    const [, mo] = m.split('-').map(Number);
    const label = monthNames[mo - 1];
    const count = counts[i];
    const barH = maxCount > 0 ? (count / maxCount) * (chartH - bottomPad - 20) : 0;
    const x = leftPad + i * (barW + gap);
    const y = chartH - bottomPad - barH;

    bars += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="#818cf8"/>`;
    // Count label on top
    if (count > 0) {
      bars += `<text x="${x + barW / 2}" y="${y - 4}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--text)">${count}</text>`;
    }
    // Month label on bottom
    bars += `<text x="${x + barW / 2}" y="${chartH - 6}" text-anchor="middle" font-size="10" fill="var(--text-muted)">${label}</text>`;
  });

  // Y-axis labels
  const ySteps = 4;
  let yAxis = '';
  for (let i = 0; i <= ySteps; i++) {
    const val = Math.round((maxCount / ySteps) * i);
    const y = chartH - bottomPad - ((chartH - bottomPad - 20) / ySteps) * i;
    yAxis += `<text x="${leftPad - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="var(--text-muted)">${val}</text>`;
    yAxis += `<line x1="${leftPad}" y1="${y}" x2="${leftPad + 12 * (barW + gap) - gap}" y2="${y}" stroke="#f3f4f6" stroke-width="1"/>`;
  }

  return `<div style="margin-top:24px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <h3 style="font-size:14px;font-weight:700;margin:0">Monthly Intake \u2014 Last 12 Months</h3>
      <select onchange="state.dashboardChartClient=this.value;render()" style="padding:4px 10px;border:1px solid var(--border);border-radius:6px;font-size:11px;font-family:var(--font);background:#fff;cursor:pointer">
        <option value="">All Clients</option>
        ${clientNames.map(n => `<option value="${esc(n)}" ${filterClient === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}
      </select>
    </div>
    <div style="background:#fff;border-radius:10px;padding:16px;border:1px solid var(--border);overflow-x:auto">
      <svg width="${leftPad + 12 * (barW + gap)}" height="${chartH}" style="display:block;margin:0 auto">
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

  // Demo-based metrics (all time)
  const DEMO_STAGES = ['Discovery Scheduled', 'Demo Scheduled', 'Under Review', 'No Show', 'Waiting for Payment/Contract'];
  const activeDemos = acqDeals.filter(d => DEMO_STAGES.includes(d.stage)).length;
  const archivedDemos = acqArchived.filter(d => d.archiveStatus === 'Closed Won' || d.archiveStatus === 'Passed Off' || DEMO_STAGES.includes(d.stage)).length;
  const demosBooked = activeDemos + archivedDemos;
  const allWon = acqArchived.filter(d => d.archiveStatus === 'Closed Won').length;
  const noShows = acqDeals.filter(d => d.stage === 'No Show').length + acqArchived.filter(d => d.stage === 'No Show').length;
  const showRate = demosBooked ? (((demosBooked - noShows) / demosBooked) * 100).toFixed(0) : '0';
  const closeRate = demosBooked ? ((allWon / demosBooked) * 100).toFixed(0) : '0';

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
      <div style="${cardStyle}"><div style="${labelStyle}">Demos Booked</div><div style="${numStyle};color:#818cf8">${demosBooked}</div><div style="font-size:10px;color:var(--text-muted);margin-top:2px">All time</div></div>
      <div style="${cardStyle}"><div style="${labelStyle}">Show Rate</div><div style="${numStyle};color:#0891b2">${showRate}%</div><div style="font-size:10px;color:var(--text-muted);margin-top:2px">${demosBooked - noShows}/${demosBooked} showed</div></div>
      <div style="${cardStyle}"><div style="${labelStyle}">Demo Close Rate</div><div style="${numStyle};color:#22c55e">${closeRate}%</div><div style="font-size:10px;color:var(--text-muted);margin-top:2px">${allWon}/${demosBooked} won</div></div>
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
