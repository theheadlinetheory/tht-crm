// ═══════════════════════════════════════════════════════════
// TRENDS — All-time billable meetings + revenue per client, per month
// ═══════════════════════════════════════════════════════════
import { state } from './app.js?v=20261007131824';
import { esc, str } from './utils.js?v=20261007131824';
import { multiFilterDropdown } from './html-helpers.js?v=20261007131824';
import { isAdmin } from './auth.js?v=20261007131824';
import { computeSetupFeeMap } from './lead-tracker.js?v=20261007131824';

// ─── All time: every month, per client ───
// A lead counts in its appointment month by default — the billing rule, falling
// back to the booked date for rows with no appointment date. The Appt/Booked
// toggle (shared with the PPM Meetings date range) switches to booked month.
function parseMDY(s) {
  const p = str(s).split('/');
  if (p.length !== 3) return null;
  const m = parseInt(p[0], 10), d = parseInt(p[1], 10);
  let y = parseInt(p[2], 10);
  if (!Number.isFinite(m) || !Number.isFinite(d) || !Number.isFinite(y) || m < 1 || m > 12) return null;
  if (y < 100) y += 2000;
  return { y, m };
}
const bookedBasis = () => state.trackerFilters?.dateBasis === 'booked';
const monthOf = e => bookedBasis() ? parseMDY(e.dateAdded) : (parseMDY(e.apptDate) || parseMDY(e.dateAdded));

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
    const when = monthOf(e);
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

// One indigo series (same as the Monthly bars), so no legend is needed.
const BAR = '#4f46e5';
const CHART_H = 120;

/** Vertical bar per month for the clients in view; value is meetings or revenue. */
function renderChart(months, totals, showRevenue, yearEdge) {
  const val = t => showRevenue ? t.cents : t.meetings;
  const max = Math.max(1, ...totals.map(val));
  const bars = months.map((mo, i) => {
    const v = val(totals[i]);
    const h = v ? Math.max(2, Math.round(v / max * CHART_H)) : 0;
    return `<div style="flex:1;min-width:34px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;${yearEdge(mo)}">
      <div style="font-size:10px;font-weight:600;color:${v ? 'var(--text)' : '#d1d5db'};margin-bottom:2px">${showRevenue ? (v ? fmtUsd(v) : '') : v}</div>
      <div style="width:60%;height:${h}px;background:${BAR};border-radius:3px 3px 0 0"></div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:4px;white-space:nowrap">${monthLabel(mo.y, mo.m)}</div>
    </div>`;
  }).join('');
  return `<div style="display:flex;align-items:flex-end;gap:2px;height:${CHART_H + 36}px;margin:4px 0 14px;overflow-x:auto">${bars}</div>`;
}

function basisToggle() {
  const btn = (v, label) => {
    const on = bookedBasis() === (v === 'booked');
    return `<button onclick="trackerSetDateBasis('${v}')" style="padding:4px 12px;font-size:11px;font-weight:600;font-family:var(--font);cursor:pointer;border:none;background:${on ? 'var(--purple)' : '#fff'};color:${on ? '#fff' : 'var(--text-muted)'}">${label}</button>`;
  };
  return `<div style="display:inline-flex;border:1px solid var(--border);border-radius:6px;overflow:hidden">${btn('appt', 'Appt month')}${btn('booked', 'Booked month')}</div>`;
}

function renderAllTime() {
  const admin = isAdmin();
  const showRevenue = admin && state.trendsMetric === 'revenue';
  const data = buildAllTimeData(admin);
  const { months, clientMap } = data;
  if (!data.clients.length) return `<div style="color:var(--text-muted);font-size:14px;padding:40px;text-align:center">No tracker data yet.</div>`;

  // The client filter narrows the chart, the table and every total at once.
  const picked = state.trendsClients.filter(c => clientMap[c]);
  const clients = picked.length ? data.clients.filter(c => picked.includes(c)) : data.clients;

  // A thicker rule before each January keeps one year's March apart from the next.
  const yearEdge = mo => mo.m === 1 && mo.key !== months[0].key ? 'border-left:2px solid #94a3b8;' : '';
  const cellText = c => !c ? '0' : showRevenue ? fmtUsd(c.cents) : String(c.meetings);
  const totals = months.map(mo => clients.reduce((t, cl) => {
    const c = clientMap[cl].months[mo.key];
    if (c) { t.meetings += c.meetings; t.cents += c.cents; }
    return t;
  }, { meetings: 0, cents: 0 }));
  const allMeetings = totals.reduce((s, t) => s + t.meetings, 0);
  const allCents = totals.reduce((s, t) => s + t.cents, 0);

  let html = `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:4px">
    <div>
      <div style="font-size:13px;font-weight:700">${allMeetings} meetings${admin ? ` · ${fmtUsd(allCents)}` : ''} <span style="font-weight:400;color:var(--text-muted)">all time${picked.length ? ` · ${picked.length === 1 ? esc(picked[0]) : picked.length + ' clients'}` : ''}</span></div>
      <div style="font-size:11px;color:var(--text-muted)">${bookedBasis() ? 'By the month the lead was booked' : 'By appointment month (how it\'s invoiced)'}. Called-back meetings excluded.</div>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      ${multiFilterDropdown(state, 'trendsClients', 'showTrendsClientDropdown', 'All clients', 'clients', [...data.clients].sort())}
      ${admin ? trendsToggle('trendsMetric', [['meetings', 'Meetings'], ['revenue', 'Revenue']]) : ''}
      ${basisToggle()}
    </div>
  </div>`;
  html += renderChart(months, totals, showRevenue, yearEdge);

  html += `<div class="tracker-table-wrap" style="flex:1"><table class="tracker-table">`;
  html += `<thead><tr><th>Client</th>`;
  for (const mo of months) html += `<th style="text-align:center;white-space:nowrap;${yearEdge(mo)}">${monthLabel(mo.y, mo.m)}</th>`;
  html += `<th style="text-align:center;font-weight:700">Meetings</th>`;
  if (admin) html += `<th style="text-align:center;font-weight:700">Revenue</th>`;
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

  // One totals row, in whichever unit the cells show.
  if (clients.length > 1) {
    html += `<tr style="border-top:2px solid var(--border);background:#f9fafb;font-weight:700">
      <td>Total</td>${totals.map((t, i) => `<td style="text-align:center;${yearEdge(months[i])}">${showRevenue ? fmtUsd(t.cents) : t.meetings}</td>`).join('')}
      <td style="text-align:center">${allMeetings}</td>${admin ? `<td style="text-align:center">${fmtUsd(allCents)}</td>` : ''}
    </tr>`;
  }
  html += `</tbody></table></div>`;
  return html;
}

// ─── Render trends tab ───
export function renderTrends() {
  return `<div class="tracker-container">${renderAllTime()}</div>`;
}
