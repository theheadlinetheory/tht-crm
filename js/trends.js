// ═══════════════════════════════════════════════════════════
// TRENDS — Client lead trends summary grid + chart (weekly, Mon–Sun)
// ═══════════════════════════════════════════════════════════
import { state } from './app.js?v=20261005135410';
import { esc, str } from './utils.js?v=20261005135410';
import { currentWeekKey, shiftWeeks, trackerWeekKey, weekLabel, weekLabelShort } from './dashboard.js?v=20261005135410';
import { isAdmin } from './auth.js?v=20261005135410';
import { monthOf } from './lead-tracker-monthly.js?v=20261005135410';
import { computeSetupFeeMap } from './lead-tracker.js?v=20261005135410';

// How many weeks the grid and chart cover.
const WEEKS_SHOWN = 13;

// ─── Build aggregated data from tracker entries, bucketed by week ───
function buildTrendsData() {
  const clientMap = {};

  const thisWeek = currentWeekKey();
  const weeks = [];
  for (let i = WEEKS_SHOWN - 1; i >= 0; i--) weeks.push(shiftWeeks(thisWeek, -i));
  const inWindow = new Set(weeks);

  for (const e of state.trackerEntries) {
    const client = str(e.clientName).trim();
    const week = trackerWeekKey(e.dateAdded);
    if (!client || !week || !inWindow.has(week)) continue;

    const isCalledBack = str(e.callbackStatus).toLowerCase() === 'called back';

    if (!clientMap[client]) clientMap[client] = {};
    if (!clientMap[client][week]) clientMap[client][week] = { total: 0, calledBack: 0, invoiced: 0, paid: 0 };

    clientMap[client][week].total++;
    if (isCalledBack) clientMap[client][week].calledBack++;
    const ps = str(e.paidStatus).toLowerCase();
    if (ps === 'paid') clientMap[client][week].paid++;
    else if (ps === 'invoiced') clientMap[client][week].invoiced++;
  }

  const clients = Object.keys(clientMap).sort();

  return { weeks, clients, clientMap };
}

// ─── Get client lead cost ───
function getClientLeadCost(clientName) {
  const client = state.clients.find(c => c.name === clientName);
  if (!client) return 0;
  const n = parseFloat(str(client.leadCost).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}

// ─── All time: every month, per client, by appointment month (the billing rule) ───
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const monthKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
const monthLabel = (y, m) => `${MONTH_ABBR[m - 1]} '${String(y).slice(-2)}`;
const fmtUsd = cents => '$' + Math.round(cents / 100).toLocaleString();

function entryCents(entry, feeMap) {
  const base = Math.round((parseFloat(str(entry.leadCost).replace(/[^0-9.]/g, '')) || 0) * 100);
  return base + (feeMap[entry.id]?.surcharge || 0);
}

/** Months run from the first tracker month to this month (or a later booked appointment). */
function buildAllTimeData(withRevenue) {
  const feeMap = withRevenue ? computeSetupFeeMap() : {};
  const clientMap = {};
  let first = null, last = null;
  for (const e of state.trackerEntries) {
    const client = str(e.clientName).trim();
    const when = monthOf(e, 'appt');
    if (!client || !when) continue;
    if (str(e.callbackStatus).toLowerCase() === 'called back') continue; // not billable
    const k = monthKey(when.y, when.m);
    if (!first || k < first) first = k;
    if (!last || k > last) last = k;
    const row = clientMap[client] || (clientMap[client] = { months: {}, meetings: 0, cents: 0 });
    const cell = row.months[k] || (row.months[k] = { meetings: 0, cents: 0 });
    const cents = entryCents(e, feeMap);
    cell.meetings++; cell.cents += cents;
    row.meetings++; row.cents += cents;
  }
  if (!first) return { months: [], clients: [], clientMap };

  const now = new Date();
  const thisMonth = monthKey(now.getFullYear(), now.getMonth() + 1);
  if (thisMonth > last) last = thisMonth;
  const months = [];
  let [y, m] = first.split('-').map(Number);
  while (monthKey(y, m) <= last) {
    months.push({ key: monthKey(y, m), y, m });
    if (++m > 12) { m = 1; y++; }
  }
  const sortBy = withRevenue ? 'cents' : 'meetings';
  const clients = Object.keys(clientMap).sort((a, b) => clientMap[b][sortBy] - clientMap[a][sortBy] || a.localeCompare(b));
  return { months, clients, clientMap };
}

function trendsToggle(stateKey, options) {
  return `<div style="display:inline-flex;border:1px solid var(--border);border-radius:6px;overflow:hidden">
    ${options.map(([value, label]) => `<button onclick="state.${stateKey}='${value}';render()" style="padding:4px 12px;font-size:11px;font-weight:600;font-family:var(--font);cursor:pointer;border:none;background:${state[stateKey] === value ? 'var(--purple)' : '#fff'};color:${state[stateKey] === value ? '#fff' : 'var(--text-muted)'}">${label}</button>`).join('')}
  </div>`;
}

function renderAllTime() {
  const admin = isAdmin();
  const showRevenue = admin && state.trendsMetric === 'revenue';
  const { months, clients, clientMap } = buildAllTimeData(admin);
  if (!clients.length) return `<div style="color:var(--text-muted);font-size:14px;padding:40px;text-align:center">No tracker data yet.</div>`;

  // A thicker rule before each January keeps one year's March apart from the next.
  const yearEdge = mo => mo.m === 1 && mo.key !== months[0].key ? 'border-left:2px solid #94a3b8;' : '';
  const cellText = c => !c ? '0' : showRevenue ? fmtUsd(c.cents) : String(c.meetings);
  const totals = months.map(mo => clients.reduce((t, cl) => {
    const c = clientMap[cl].months[mo.key];
    if (c) { t.meetings += c.meetings; t.cents += c.cents; }
    return t;
  }, { meetings: 0, cents: 0 }));

  let html = `<div style="padding:0 0 8px">
    <div style="font-size:13px;font-weight:700">All time — billable meetings${admin ? ' and revenue' : ''} by client, per month</div>
    <div style="font-size:11px;color:var(--text-muted)">Counted by appointment month (the month it's invoiced; booked date when there's no appointment date). Called-back meetings excluded.${admin ? ' Revenue = each lead\'s cost plus any setup-fee surcharge.' : ''}</div>
  </div>`;
  if (admin) html += `<div style="margin-bottom:8px">${trendsToggle('trendsMetric', [['meetings', 'Meetings'], ['revenue', 'Revenue']])}</div>`;

  html += `<div class="tracker-table-wrap" style="flex:1"><table class="tracker-table">`;
  html += `<thead><tr><th>Client</th>`;
  for (const mo of months) html += `<th style="text-align:center;white-space:nowrap;${yearEdge(mo)}">${monthLabel(mo.y, mo.m)}</th>`;
  html += `<th style="text-align:center;font-weight:700">All-time meetings</th>`;
  if (admin) html += `<th style="text-align:center;font-weight:700">All-time revenue</th>`;
  html += `</tr></thead><tbody>`;

  for (const client of clients) {
    const row = clientMap[client];
    html += `<tr><td style="font-weight:600;white-space:nowrap">${esc(client)}</td>`;
    for (const mo of months) {
      const c = row.months[mo.key];
      const tip = c && admin ? ` title="${c.meetings} meeting${c.meetings !== 1 ? 's' : ''} · ${fmtUsd(c.cents)}"` : '';
      html += `<td style="text-align:center;${yearEdge(mo)}color:${c ? '#1f2937' : '#d1d5db'};font-weight:${c ? 600 : 400}"${tip}>${cellText(c)}</td>`;
    }
    html += `<td style="text-align:center;font-weight:700">${row.meetings}</td>`;
    if (admin) html += `<td style="text-align:center;font-weight:700">${fmtUsd(row.cents)}</td>`;
    html += `</tr>`;
  }

  const allMeetings = totals.reduce((s, t) => s + t.meetings, 0);
  const allCents = totals.reduce((s, t) => s + t.cents, 0);
  const footRow = (label, pick, grand) => `<tr style="border-top:2px solid var(--border);background:#f9fafb;font-weight:700">
    <td>${label}</td>${totals.map((t, i) => `<td style="text-align:center;${yearEdge(months[i])}">${pick(t)}</td>`).join('')}
    <td style="text-align:center">${label === 'Total meetings' ? grand : ''}</td>${admin ? `<td style="text-align:center">${label === 'Total revenue' ? grand : ''}</td>` : ''}
  </tr>`;
  html += footRow('Total meetings', t => t.meetings, allMeetings);
  if (admin) html += footRow('Total revenue', t => fmtUsd(t.cents), fmtUsd(allCents));
  html += `</tbody></table></div>`;
  return html;
}

// ─── Render trends grid ───
export function renderTrends() {
  const rangeToggle = `<div style="margin-bottom:10px">${trendsToggle('trendsRange', [['weeks', `Last ${WEEKS_SHOWN} weeks`], ['alltime', 'All time (monthly)']])}</div>`;
  if (state.trendsRange === 'alltime') return `<div class="tracker-container">${rangeToggle}${renderAllTime()}</div>`;

  const { weeks, clients, clientMap } = buildTrendsData();
  const admin = isAdmin();

  if (clients.length === 0) {
    return `<div class="tracker-container">${rangeToggle}
      <div style="color:var(--text-muted);font-size:14px;padding:40px;text-align:center">No tracker data in the last ${WEEKS_SHOWN} weeks.</div>
    </div>`;
  }

  let html = `<div class="tracker-container">${rangeToggle}`;

  html += `<div style="padding:0 0 8px">
    <div style="font-size:13px;font-weight:700">Week-over-week billable meetings — last ${WEEKS_SHOWN} weeks</div>
    <div style="font-size:11px;color:var(--text-muted)">Each cell = billable booked meetings (booked minus called back) for that client in that week. Weeks run Mon–Sun and are labelled by their Monday. Green = paid, amber = invoiced.</div>
  </div>`;

  // Summary grid
  html += `<div class="tracker-table-wrap" style="flex:none;max-height:50vh"><table class="tracker-table">`;
  html += `<thead><tr><th>Client</th>`;
  for (const w of weeks) html += `<th style="text-align:center" title="Week of ${esc(weekLabel(w))}">${esc(weekLabelShort(w))}</th>`;
  html += `<th style="text-align:center;font-weight:700">Total (${WEEKS_SHOWN} wks)</th>`;
  if (admin) html += `<th style="text-align:center;font-weight:700">Revenue (${WEEKS_SHOWN} wks)</th>`;
  html += `</tr></thead><tbody>`;

  for (const client of clients) {
    const data = clientMap[client];
    let totalLeads = 0;
    html += `<tr><td style="font-weight:600;white-space:nowrap">${esc(client)}</td>`;

    for (const w of weeks) {
      const cell = data[w];
      if (!cell) {
        html += `<td style="text-align:center;color:#d1d5db">0</td>`;
      } else {
        const billable = cell.total - cell.calledBack;
        totalLeads += billable;

        // Color based on invoice status
        let bg = '';
        let color = '';
        if (billable === 0) {
          bg = ''; color = '#d1d5db';
        } else if (cell.paid >= billable) {
          bg = 'background:#dcfce7;'; color = '#166534';
        } else if (cell.invoiced > 0) {
          bg = 'background:#fef3c7;'; color = '#92400e';
        } else {
          bg = ''; color = '#1f2937';
        }
        html += `<td style="text-align:center;${bg}color:${color};font-weight:${billable > 0 ? '600' : '400'}">${billable}</td>`;
      }
    }

    html += `<td style="text-align:center;font-weight:700">${totalLeads}</td>`;
    if (admin) {
      const revenue = totalLeads * getClientLeadCost(client);
      html += `<td style="text-align:center;font-weight:700">${revenue > 0 ? '$' + revenue.toLocaleString() : '$0'}</td>`;
    }
    html += `</tr>`;
  }

  html += `</tbody></table></div>`;

  // Chart canvas
  html += `<div style="margin-top:12px;flex:1;min-height:200px;position:relative">
    <canvas id="trends-chart" style="width:100%;height:100%"></canvas>
  </div>`;

  html += `</div>`;
  return html;
}

// ─── Draw chart on canvas ───
const COLORS = ['#6366f1','#f59e0b','#10b981','#ef4444','#8b5cf6','#ec4899','#06b6d4','#84cc16','#f97316','#14b8a6','#a855f7','#e11d48','#0ea5e9','#65a30d','#d946ef'];

export function drawTrendsChart() {
  const canvas = document.getElementById('trends-chart');
  if (!canvas) return;

  const { weeks, clients, clientMap } = buildTrendsData();
  if (weeks.length === 0 || clients.length === 0) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const W = rect.width;
  const H = rect.height;
  const pad = { top: 20, right: 140, bottom: 40, left: 56 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  // Find max value
  let maxVal = 1;
  for (const client of clients) {
    for (const w of weeks) {
      const cell = clientMap[client]?.[w];
      if (cell) {
        const billable = cell.total - cell.calledBack;
        if (billable > maxVal) maxVal = billable;
      }
    }
  }
  maxVal = Math.ceil(maxVal * 1.1);

  // Background
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  const ySteps = Math.min(maxVal, 5);
  for (let i = 0; i <= ySteps; i++) {
    const y = pad.top + plotH - (i / ySteps) * plotH;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + plotW, y); ctx.stroke();
    ctx.fillStyle = '#9ca3af'; ctx.font = '11px Inter, system-ui, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(String(Math.round((i / ySteps) * maxVal)), pad.left - 8, y + 4);
  }

  // Y-axis title — say what the axis measures
  ctx.save();
  ctx.translate(14, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#6b7280'; ctx.font = '600 10px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('Billable meetings booked', 0, 0);
  ctx.restore();

  // X-axis labels — week start (Monday). Thinned out when space is tight.
  ctx.fillStyle = '#6b7280'; ctx.font = '10px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
  const xStep = weeks.length > 1 ? plotW / (weeks.length - 1) : plotW / 2;
  const labelEvery = xStep < 34 ? 2 : 1;
  for (let i = 0; i < weeks.length; i++) {
    if (i % labelEvery !== 0 && i !== weeks.length - 1) continue;
    const x = pad.left + (weeks.length > 1 ? i * xStep : plotW / 2);
    ctx.fillText(weekLabelShort(weeks[i]), x, H - pad.bottom + 20);
  }
  ctx.fillText('Week starting (Mon)', pad.left + plotW / 2, H - pad.bottom + 34);

  // Draw lines per client
  for (let ci = 0; ci < clients.length; ci++) {
    const client = clients[ci];
    const color = COLORS[ci % COLORS.length];
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    let started = false;
    for (let wi = 0; wi < weeks.length; wi++) {
      const cell = clientMap[client]?.[weeks[wi]];
      const val = cell ? cell.total - cell.calledBack : 0;
      const x = pad.left + (weeks.length > 1 ? wi * xStep : plotW / 2);
      const y = pad.top + plotH - (val / maxVal) * plotH;
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Legend
    const ly = pad.top + ci * 18;
    ctx.fillStyle = color;
    ctx.fillRect(W - pad.right + 12, ly, 12, 3);
    ctx.fillStyle = '#374151'; ctx.font = '10px Inter, system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(client.length > 16 ? client.slice(0, 14) + '...' : client, W - pad.right + 28, ly + 5);
  }
}
