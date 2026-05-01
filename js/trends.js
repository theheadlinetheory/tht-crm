// ═══════════════════════════════════════════════════════════
// TRENDS — Client lead trends summary grid + chart
// ═══════════════════════════════════════════════════════════
import { state } from './app.js';
import { esc, str } from './utils.js';

const MONTHS_ORDER = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function parseMonthKey(m) {
  const parts = m.split('/');
  if (parts.length !== 2) return 0;
  const mi = MONTHS_ORDER.indexOf(parts[0]);
  let y = parseInt(parts[1], 10);
  if (y < 100) y += 2000;
  return y * 100 + (mi >= 0 ? mi : 0);
}

function shortMonth(m) {
  const parts = m.split('/');
  if (parts.length !== 2) return m;
  return `${parts[0].slice(0, 3)} '${parts[1]}`;
}

// ─── Build aggregated data from tracker entries ───
function buildTrendsData() {
  const monthSet = new Set();
  const clientMap = {};

  for (const e of state.trackerEntries) {
    const client = str(e.clientName).trim();
    const month = str(e.month).trim();
    if (!client || !month) continue;

    const isCalledBack = str(e.callbackStatus).toLowerCase() === 'called back';

    monthSet.add(month);
    if (!clientMap[client]) clientMap[client] = {};
    if (!clientMap[client][month]) clientMap[client][month] = { total: 0, calledBack: 0, invoiced: 0, paid: 0 };

    clientMap[client][month].total++;
    if (isCalledBack) clientMap[client][month].calledBack++;
    const ps = str(e.paidStatus).toLowerCase();
    if (ps === 'paid') clientMap[client][month].paid++;
    else if (ps === 'invoiced') clientMap[client][month].invoiced++;
  }

  const months = [...monthSet].sort((a, b) => parseMonthKey(a) - parseMonthKey(b));
  const clients = Object.keys(clientMap).sort();

  return { months, clients, clientMap };
}

// ─── Get client lead cost ───
function getClientLeadCost(clientName) {
  const client = state.clients.find(c => c.name === clientName);
  if (!client) return 0;
  const n = parseFloat(str(client.leadCost).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}

// ─── Render trends grid ───
export function renderTrends() {
  const { months, clients, clientMap } = buildTrendsData();

  if (clients.length === 0) {
    return `<div class="tracker-container" style="justify-content:center;align-items:center">
      <div style="color:var(--text-muted);font-size:14px">No tracker data to display.</div>
    </div>`;
  }

  let html = `<div class="tracker-container">`;

  // Summary grid
  html += `<div class="tracker-table-wrap" style="flex:none;max-height:50vh"><table class="tracker-table">`;
  html += `<thead><tr><th>Client</th>`;
  for (const m of months) html += `<th style="text-align:center">${esc(shortMonth(m))}</th>`;
  html += `<th style="text-align:center;font-weight:700">Total</th>`;
  html += `<th style="text-align:center;font-weight:700">Revenue</th>`;
  html += `</tr></thead><tbody>`;

  for (const client of clients) {
    const data = clientMap[client];
    let totalLeads = 0;
    html += `<tr><td style="font-weight:600;white-space:nowrap">${esc(client)}</td>`;

    for (const m of months) {
      const cell = data[m];
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

    const leadCost = getClientLeadCost(client);
    const revenue = totalLeads * leadCost;
    html += `<td style="text-align:center;font-weight:700">${totalLeads}</td>`;
    html += `<td style="text-align:center;font-weight:700">${revenue > 0 ? '$' + revenue.toLocaleString() : '$0'}</td>`;
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

  const { months, clients, clientMap } = buildTrendsData();
  if (months.length === 0 || clients.length === 0) return;

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
  const pad = { top: 20, right: 140, bottom: 40, left: 40 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  // Find max value
  let maxVal = 1;
  for (const client of clients) {
    for (const m of months) {
      const cell = clientMap[client]?.[m];
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

  // X-axis labels
  ctx.fillStyle = '#6b7280'; ctx.font = '10px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
  const xStep = months.length > 1 ? plotW / (months.length - 1) : plotW / 2;
  for (let i = 0; i < months.length; i++) {
    const x = pad.left + (months.length > 1 ? i * xStep : plotW / 2);
    ctx.fillText(shortMonth(months[i]), x, H - pad.bottom + 20);
  }

  // Draw lines per client
  for (let ci = 0; ci < clients.length; ci++) {
    const client = clients[ci];
    const color = COLORS[ci % COLORS.length];
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    let started = false;
    for (let mi = 0; mi < months.length; mi++) {
      const cell = clientMap[client]?.[months[mi]];
      const val = cell ? cell.total - cell.calledBack : 0;
      const x = pad.left + (months.length > 1 ? mi * xStep : plotW / 2);
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
