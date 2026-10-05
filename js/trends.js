// ═══════════════════════════════════════════════════════════
// TRENDS — All-time billable meetings + revenue per client, per month
// ═══════════════════════════════════════════════════════════
import { state } from './app.js?v=20261005144300';
import { esc, str } from './utils.js?v=20261005144300';
import { isAdmin } from './auth.js?v=20261005144300';
import { monthOf } from './lead-tracker-monthly.js?v=20261005144300';
import { computeSetupFeeMap } from './lead-tracker.js?v=20261005144300';

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

// ─── Render trends tab ───
export function renderTrends() {
  return `<div class="tracker-container">${renderAllTime()}</div>`;
}
