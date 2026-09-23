// ═══════════════════════════════════════════════════════════
// MARGINS — founder-only per-client margin view (Lars + Aidan)
// Data: fulfillment `margin-report` edge fn (same session-token contract and
//   server-side founder allowlist as cac.js — the UI gate is cosmetic).
// Margin = service-month Stripe revenue minus client-scoped costs, from the
// 2026-07 cost-tracking floor. Click a client for the monthly split.
// Net-30 clients read low in the latest month until their payment lands —
// that is the service-month attribution being honest, footnoted below.
// ═══════════════════════════════════════════════════════════
import { supabase } from './supabase-client.js?v=20260923121951';
import { state } from './app.js?v=20260923121951';
import { render } from './render.js?v=20260923121951';
import { esc } from './utils.js?v=20260923121951';

const MARGIN_FN_URL = 'https://zrmobsgcfcloufajemxj.supabase.co/functions/v1/margin-report';

async function fetchMarginReport(){
  const { data: { session } } = await supabase.auth.getSession();
  if(!session) throw new Error('Your session expired. Reload the page and sign in again.');
  const resp = await fetch(MARGIN_FN_URL,{
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+session.access_token },
    body: '{}' });
  const data = await resp.json().catch(()=>({ error:'margin-report returned a non-JSON response ('+resp.status+')' }));
  if(!resp.ok || data.error) throw new Error(data.error || ('margin-report failed ('+resp.status+')'));
  return data;
}

export function loadMarginReport(force){
  if(state.marginLoading) return;
  if(state.marginReport && !force) return;
  state.marginLoading = true;
  state.marginError = null;
  fetchMarginReport()
    .then(data => { state.marginReport = data; state.marginLoading = false; render(); })
    .catch(err => { state.marginError = err.message || String(err); state.marginLoading = false; render(); });
}

const fmtUsd = n => '$' + Number(n||0).toLocaleString('en-US',{ minimumFractionDigits:2, maximumFractionDigits:2 });
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const monthLabel = m => MONTHS_SHORT[Number(m.slice(5,7))-1]+' '+m.slice(0,4);
const marginColor = n => n >= 0 ? '#047857' : '#b91c1c';

function statCard(label, value, sub){
  return `<div style="flex:1;min-width:160px;background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 16px">
    <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">${esc(label)}</div>
    <div style="font-size:22px;font-weight:700;margin-top:4px">${esc(value)}</div>
    ${sub?`<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(sub)}</div>`:''}
  </div>`;
}

function monthRows(c, colspan){
  const rows = (c.months||[]).map(m => `
    <div style="display:grid;grid-template-columns:1fr 100px 100px 100px;gap:12px;padding:3px 0;border-bottom:1px dashed #f3f4f6">
      <span class="text-muted" style="color:var(--text-muted)">${esc(monthLabel(m.month))}</span>
      <span style="text-align:right;font-variant-numeric:tabular-nums">${fmtUsd(m.revenue)}</span>
      <span style="text-align:right;font-variant-numeric:tabular-nums">${fmtUsd(m.cost)}</span>
      <span style="text-align:right;font-variant-numeric:tabular-nums;color:${marginColor(m.margin)}">${fmtUsd(m.margin)}</span>
    </div>`).join('');
  return `<tr><td colspan="${colspan}" style="padding:8px 24px 12px;background:#fafafa;border-bottom:1px solid var(--border)">
    <div style="max-width:560px;font-size:12px;color:#374151">
      <div style="display:grid;grid-template-columns:1fr 100px 100px 100px;gap:12px;padding:0 0 4px;border-bottom:1px solid #e5e7eb;font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">
        <span>Month</span><span style="text-align:right">Revenue</span><span style="text-align:right">Cost</span><span style="text-align:right">Margin</span>
      </div>${rows}
    </div>
  </td></tr>`;
}

export function renderMarginsTab(){
  loadMarginReport();

  let html = `<div style="padding:8px 20px 40px;max-width:960px">`;
  const gen = state.marginReport && state.marginReport.generated_at ? new Date(state.marginReport.generated_at) : null;
  html += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
    <h2 style="font-size:16px;font-weight:700;margin:0">Client Margins</h2>
    <span style="flex:1"></span>
    ${gen?`<span style="font-size:11px;color:var(--text-muted)">Updated ${esc(gen.toLocaleString())}</span>`:''}
    <button class="btn btn-ghost" style="font-size:12px;padding:6px 14px" onclick="marginRefresh()" ${state.marginLoading?'disabled':''}>${state.marginLoading?'Refreshing…':'↻ Refresh'}</button>
  </div>`;

  if(state.marginError){
    html += `<div style="padding:12px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#b91c1c;font-size:12px;margin-bottom:14px">${esc(state.marginError)}</div>`;
  }
  if(!state.marginReport){
    if(!state.marginError) html += `<div style="padding:40px;text-align:center;color:var(--text-muted);font-size:13px">Loading live margins…</div>`;
    html += `</div>`;
    return html;
  }

  const r = state.marginReport;
  const sinceLabel = monthLabel(r.from);
  html += `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
    ${statCard('Revenue · since '+sinceLabel, fmtUsd(r.totals.revenue), 'service-month attributed')}
    ${statCard('Client costs · since '+sinceLabel, fmtUsd(r.totals.cost), 'client-scoped only — CAC and overhead excluded')}
    ${statCard('Margin · since '+sinceLabel, fmtUsd(r.totals.margin),
      r.totals.revenue>0 ? (100*r.totals.margin/r.totals.revenue).toFixed(1)+'% of revenue' : '')}
  </div>`;

  const th = 'padding:8px 10px;text-align:right;font-weight:600;white-space:nowrap';
  html += `<div style="overflow-x:auto;background:#fff;border:1px solid var(--border);border-radius:10px">
    <table style="width:100%;border-collapse:collapse;font-size:12px">
    <thead><tr style="background:#f9fafb;border-bottom:2px solid var(--border)">
      <th style="${th};text-align:left">Client</th>
      <th style="${th}">Revenue</th>
      <th style="${th}">Cost</th>
      <th style="${th}">Margin</th>
      <th style="${th}">Margin %</th>
      <th style="width:36px"></th>
    </tr></thead><tbody>`;

  const td = 'padding:8px 10px;text-align:right;font-variant-numeric:tabular-nums;border-bottom:1px solid #f3f4f6';
  const expanded = state.marginExpanded || {};
  for(const c of r.clients){
    const open = !!expanded[c.client_id];
    const badges = [
      c.verified ? ' <span title="QC\u2019d: every cost row verified against its source" style="color:#047857;font-weight:600">\u2713 checked</span>' : '',
      c.status !== 'active' ? '<span style="color:var(--text-muted);font-weight:500"> (churned)</span>' : '',
      c.unrecorded_lists > 0 ? ` <span title="${c.unrecorded_lists} custom list(s) built before cost capture — cost understated" style="color:#b45309;font-weight:600">⚠ ${c.unrecorded_lists}</span>` : '',
    ].join('');
    html += `<tr onclick="marginToggle('${esc(c.client_id)}')" style="cursor:pointer">
      <td style="${td};text-align:left;font-weight:600">${esc(c.name)}${badges}</td>
      <td style="${td}">${fmtUsd(c.revenue)}</td>
      <td style="${td}">${fmtUsd(c.cost)}</td>
      <td style="${td};font-weight:700;color:${marginColor(c.margin)}">${fmtUsd(c.margin)}</td>
      <td style="${td}">${c.margin_pct === null ? '—' : c.margin_pct.toFixed(1)+'%'}</td>
      <td style="${td};color:var(--text-muted)">${open?'▾':'▸'}</td>
    </tr>`;
    if(open) html += monthRows(c, 6);
  }
  html += `</tbody></table></div>`;

  html += `<div style="font-size:11px;color:var(--text-muted);margin-top:8px;line-height:1.6">
    Window starts ${esc(sinceLabel)} — when cost tracking became trustworthy; earlier revenue is excluded on purpose.
    Revenue is attributed to the SERVICE month, so net-30 clients (Lightning, Timesavers) read low in the latest
    month until their payment lands. Costs are client-scoped only (inboxes, domains, pipeline runs, labor,
    tools) — acquisition CAC and general overhead live in their own views. \u2713 checked = founder-QC\u2019d, every cost row verified against its source (they sort to the bottom as the done pile). \u26a0 marks clients whose custom-list
    build costs predate capture: their real margin is lower than shown.
    ${r.excluded_legacy_revenue > 0 ? esc(fmtUsd(r.excluded_legacy_revenue)+' of window revenue belongs to pre-dashboard clients and is excluded from the table.') : ''}
  </div></div>`;
  return html;
}

// ─── Window exposures for inline onclick handlers ───
window.marginRefresh = () => loadMarginReport(true);
window.marginToggle = (id) => {
  const s = state.marginExpanded || (state.marginExpanded = {});
  s[id] = !s[id];
  render();
};
