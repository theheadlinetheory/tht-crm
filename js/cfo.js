// ═══════════════════════════════════════════════════════════
// CFO HUB — founder-only finance home (Lars + Aidan)
// Overview: whole-business monthly P&L (all revenue vs every cost bucket)
//   + the board-standard unit-economics cards (LTV:CAC ≥3 good ~4 strong,
//   CAC payback ≤12mo strong, gross/net margin). Data: `cfo-report` edge fn.
// CAC / Margins / Overhead live here as views — same renderers as before,
//   one tab instead of three (Aidan, 2026-09-29: essential numbers only,
//   limited noise; add more later).
// ═══════════════════════════════════════════════════════════
import { supabase } from './supabase-client.js?v=20261005135410';
import { state } from './app.js?v=20261005135410';
import { render } from './render.js?v=20261005135410';
import { esc } from './utils.js?v=20261005135410';
import { renderCacTab } from './cac.js?v=20261005135410';
import { renderMarginsTab } from './margins.js?v=20261005135410';
import { renderOverheadTab } from './overhead.js?v=20261005135410';

const FN_URL = 'https://zrmobsgcfcloufajemxj.supabase.co/functions/v1/cfo-report';

async function fetchCfoReport(){
  const { data: { session } } = await supabase.auth.getSession();
  if(!session) throw new Error('Your session expired. Reload the page and sign in again.');
  const resp = await fetch(FN_URL,{
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+session.access_token },
    body: '{}' });
  const data = await resp.json().catch(()=>({ error:'cfo-report returned a non-JSON response ('+resp.status+')' }));
  if(!resp.ok || data.error) throw new Error(data.error || ('cfo-report failed ('+resp.status+')'));
  return data;
}

export function loadCfoReport(force){
  if(state.cfoLoading) return;
  if(state.cfoReport && !force) return;
  state.cfoLoading = true;
  state.cfoError = null;
  fetchCfoReport()
    .then(data => { state.cfoReport = data; state.cfoLoading = false; render(); })
    .catch(err => { state.cfoError = err.message || String(err); state.cfoLoading = false; render(); });
}

const fmtUsd = n => '$' + Number(n||0).toLocaleString('en-US',{ minimumFractionDigits:2, maximumFractionDigits:2 });
const fmtUsd0 = n => '$' + Math.round(Number(n||0)).toLocaleString('en-US');
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const monthLabel = m => MONTHS_SHORT[Number(m.slice(5,7))-1]+' '+m.slice(0,4);
const posNeg = n => n >= 0 ? '#047857' : '#b91c1c';

function metricCard(label, value, sub, color){
  return `<div style="flex:1;min-width:150px;background:#fff;border:1px solid var(--border);border-radius:10px;padding:13px 15px">
    <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">${esc(label)}</div>
    <div style="font-size:21px;font-weight:700;margin-top:3px;${color?`color:${color}`:''}">${esc(value)}</div>
    ${sub?`<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(sub)}</div>`:''}
  </div>`;
}

function overviewHtml(){
  loadCfoReport();
  if(state.cfoError)
    return `<div style="padding:12px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#b91c1c;font-size:12px">${esc(state.cfoError)}</div>`;
  if(!state.cfoReport)
    return `<div style="padding:40px;text-align:center;color:var(--text-muted);font-size:13px">Loading the numbers…</div>`;

  const r = state.cfoReport, k = r.metrics;
  const ratioColor = k.ltv_cac === null ? undefined : k.ltv_cac >= 3 ? '#047857' : k.ltv_cac >= 2 ? '#b45309' : '#b91c1c';
  const paybackColor = k.cac_payback_months === null ? undefined : k.cac_payback_months <= 12 ? '#047857' : '#b45309';
  let html = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">
    ${metricCard('Revenue run rate', fmtUsd0(k.revenue_run_rate)+'/mo', 'avg of last 3 complete months')}
    ${metricCard('Net margin', k.net_margin_pct===null?'—':k.net_margin_pct.toFixed(1)+'%', 'after every cost, last 3 months', posNeg(k.net_margin_pct||0))}
    ${metricCard('Gross margin', k.gross_margin_pct===null?'—':k.gross_margin_pct.toFixed(1)+'%', 'revenue minus delivery costs')}
  </div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
    ${metricCard('LTV : CAC', k.ltv_cac===null?'—':k.ltv_cac.toFixed(1)+'x', `realized lifetime LTV ${fmtUsd0(k.ltv)} vs loaded CAC ${k.blended_cac===null?'—':fmtUsd0(k.blended_cac)} (SDR labor incl.) · 3x+ good`, ratioColor)}
    ${metricCard('CAC payback', k.cac_payback_months===null?'—':k.cac_payback_months.toFixed(1)+' mo', 'months of gross profit to earn back a client · under 12 is strong', paybackColor)}
    ${metricCard('Avg lifetime revenue / client', fmtUsd0(k.avg_ltv_revenue), `every client ever (${k.clients_lifetime}) · × ${k.gross_margin_pct===null?'—':k.gross_margin_pct.toFixed(0)+'%'} gross margin = ${fmtUsd0(k.ltv)} LTV · ARPA ${fmtUsd0(k.arpa)}/mo`)}
  </div>`;

  const th = 'padding:8px 10px;text-align:right;font-weight:600;white-space:nowrap';
  const td = 'padding:9px 10px;text-align:right;font-variant-numeric:tabular-nums;border-bottom:1px solid #f3f4f6;white-space:nowrap';
  html += `<div style="overflow-x:auto;background:#fff;border:1px solid var(--border);border-radius:10px">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr style="background:#f9fafb;border-bottom:2px solid var(--border)">
      <th style="${th};text-align:left">Month</th><th style="${th}">Revenue</th>
      <th style="${th}">Delivery</th><th style="${th}">CAC</th>
      <th style="${th}">Overhead</th><th style="${th}">Reserve</th>
      <th style="${th}">Net</th><th style="${th}">Net %</th>
    </tr></thead><tbody>`;
  for(const m of r.months){
    const cur = m.month === r.current_month;
    html += `<tr${cur?' style="opacity:.65"':''}>
      <td style="${td};text-align:left;font-weight:600">${esc(monthLabel(m.month))}${cur?' <span style="font-size:10px;color:var(--text-muted)">(to date)</span>':''}</td>
      <td style="${td}">${fmtUsd(m.revenue)}</td>
      <td style="${td}">${fmtUsd(m.delivery)}</td>
      <td style="${td}">${fmtUsd(m.cac)}</td>
      <td style="${td}">${fmtUsd(m.overhead)}</td>
      <td style="${td}">${fmtUsd(m.reserve)}</td>
      <td style="${td};font-weight:700;color:${posNeg(m.net)}">${fmtUsd(m.net)}</td>
      <td style="${td}">${m.net_pct===null?'—':m.net_pct.toFixed(1)+'%'}</td>
    </tr>`;
  }
  html += `</tbody></table></div>
  <div style="font-size:11px;color:var(--text-muted);margin-top:8px;line-height:1.6">
    Revenue is service-month attributed; Delivery = client-scoped costs, CAC = acquisition (labor loaded),
    Reserve = idle infrastructure + unattributed. LTV is gross-margin adjusted lifetime revenue per client;
    CAC is the blended cash figure from the CAC view. Landy Rose Media excluded throughout.
  </div>`;
  return html;
}

export function renderCfoTab(){
  const view = state.cfoView || 'overview';
  const gen = state.cfoReport && state.cfoReport.generated_at ? new Date(state.cfoReport.generated_at) : null;
  const pill = (id, label) => `<button onclick="cfoView('${id}')"
    style="font-size:12px;font-weight:600;padding:6px 14px;border-radius:999px;border:1px solid var(--border);cursor:pointer;
    background:${view===id?'#111827':'#fff'};color:${view===id?'#fff':'#374151'}">${label}</button>`;
  let html = `<div style="padding:8px 20px 0;max-width:960px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <h2 style="font-size:16px;font-weight:700;margin:0 6px 0 0">CFO Hub</h2>
      ${pill('overview','Overview')}${pill('cac','CAC')}${pill('margins','Client Margins')}${pill('overhead','Overhead')}
      <span style="flex:1"></span>
      ${view==='overview'&&gen?`<span style="font-size:11px;color:var(--text-muted)">Updated ${esc(gen.toLocaleString())}</span>`:''}
      ${view==='overview'?`<button class="btn btn-ghost" style="font-size:12px;padding:6px 14px" onclick="cfoRefresh()" ${state.cfoLoading?'disabled':''}>${state.cfoLoading?'Refreshing…':'↻ Refresh'}</button>`:''}
    </div>`;
  if(view === 'overview') html += overviewHtml() + `</div>`;
  else html += `</div>` + (view === 'cac' ? renderCacTab() : view === 'margins' ? renderMarginsTab() : renderOverheadTab());
  return html;
}

// ─── Window exposures for inline onclick handlers ───
window.cfoView = (v) => { state.cfoView = v; render(); };
window.cfoRefresh = () => loadCfoReport(true);
