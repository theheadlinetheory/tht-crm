// ═══════════════════════════════════════════════════════════
// OVERHEAD — founder-only monthly overhead ledger (Lars + Aidan)
// Data: fulfillment `overhead-report` edge fn (same session-token contract
//   and server-side founder allowlist as cac.js / margins.js).
// Every scope='overhead' cost row — subscriptions, coaching, Ioannis base,
// fees — grouped per month with a vendor breakdown, so a subscription that
// quietly doubles is visible the month it happens. * = computed/estimated,
// no star = vendor-billed actual.
// ═══════════════════════════════════════════════════════════
import { supabase } from './supabase-client.js?v=20260930094615';
import { state } from './app.js?v=20260930094615';
import { render } from './render.js?v=20260930094615';
import { esc } from './utils.js?v=20260930094615';

const FN_URL = 'https://zrmobsgcfcloufajemxj.supabase.co/functions/v1/overhead-report';

async function fetchOverheadReport(){
  const { data: { session } } = await supabase.auth.getSession();
  if(!session) throw new Error('Your session expired. Reload the page and sign in again.');
  const resp = await fetch(FN_URL,{
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+session.access_token },
    body: '{}' });
  const data = await resp.json().catch(()=>({ error:'overhead-report returned a non-JSON response ('+resp.status+')' }));
  if(!resp.ok || data.error) throw new Error(data.error || ('overhead-report failed ('+resp.status+')'));
  return data;
}

export function loadOverheadReport(force){
  if(state.overheadLoading) return;
  if(state.overheadReport && !force) return;
  state.overheadLoading = true;
  state.overheadError = null;
  fetchOverheadReport()
    .then(data => { state.overheadReport = data; state.overheadLoading = false; render(); })
    .catch(err => { state.overheadError = err.message || String(err); state.overheadLoading = false; render(); });
}

const fmtUsd = n => '$' + Number(n||0).toLocaleString('en-US',{ minimumFractionDigits:2, maximumFractionDigits:2 });
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const monthLabel = m => MONTHS_SHORT[Number(m.slice(5,7))-1]+' '+m.slice(0,4);
const vendorLabel = v => v.split('-').map(w => w.charAt(0).toUpperCase()+w.slice(1)).join(' ');

function statCard(label, value, sub){
  return `<div style="flex:1;min-width:160px;background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 16px">
    <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">${esc(label)}</div>
    <div style="font-size:22px;font-weight:700;margin-top:4px">${esc(value)}</div>
    ${sub?`<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(sub)}</div>`:''}
  </div>`;
}

export function renderOverheadTab(){
  loadOverheadReport();

  let html = `<div style="padding:8px 20px 40px;max-width:820px">`;
  const gen = state.overheadReport && state.overheadReport.generated_at ? new Date(state.overheadReport.generated_at) : null;
  html += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
    <h2 style="font-size:16px;font-weight:700;margin:0">Overhead</h2>
    <span style="flex:1"></span>
    ${gen?`<span style="font-size:11px;color:var(--text-muted)">Updated ${esc(gen.toLocaleString())}</span>`:''}
    <button class="btn btn-ghost" style="font-size:12px;padding:6px 14px" onclick="overheadRefresh()" ${state.overheadLoading?'disabled':''}>${state.overheadLoading?'Refreshing…':'↻ Refresh'}</button>
  </div>`;

  if(state.overheadError){
    html += `<div style="padding:12px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#b91c1c;font-size:12px;margin-bottom:14px">${esc(state.overheadError)}</div>`;
  }
  if(!state.overheadReport){
    if(!state.overheadError) html += `<div style="padding:40px;text-align:center;color:var(--text-muted);font-size:13px">Loading overhead…</div>`;
    html += `</div>`;
    return html;
  }

  const r = state.overheadReport;
  const cur = (r.months||[]).find(m => m.month === r.current_month);
  html += `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">
    ${statCard('Run rate', fmtUsd(r.run_rate)+'/mo', 'average of the last 3 complete months')}
    ${statCard('This month so far', fmtUsd(cur?cur.total:0), monthLabel(r.current_month))}
    ${statCard('All-time recorded', fmtUsd(r.total), (r.months||[]).length+' months')}
  </div>`;

  const expanded = state.overheadExpanded || (state.overheadExpanded = {});
  for(const m of r.months||[]){
    const open = expanded[m.month] !== false;   // months start open
    html += `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;margin-bottom:10px;overflow:hidden">
      <div onclick="overheadToggle('${m.month}')" style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;background:#f9fafb;border-bottom:${open?'1px solid var(--border)':'none'}">
        <span style="font-size:13.5px;font-weight:700">${esc(monthLabel(m.month))}</span>
        <span style="flex:1"></span>
        <span style="font-size:13.5px;font-weight:700;font-variant-numeric:tabular-nums">${fmtUsd(m.total)}</span>
        <span style="color:var(--text-muted)">${open?'▾':'▸'}</span>
      </div>`;
    if(open){
      html += `<div style="padding:8px 14px 10px">`;
      for(const v of m.vendors){
        html += `<div style="display:flex;gap:10px;padding:4px 0;border-bottom:1px dashed #f3f4f6;font-size:13px">
          <span style="font-weight:600">${esc(vendorLabel(v.vendor))}${v.is_actual?'':' <span style="opacity:.5" title="computed or estimated, not vendor-billed">*</span>'}</span>
          <span style="color:var(--text-muted);font-size:12px">${esc(v.cost_type.replace(/_/g,' '))}${v.events>1?' × '+v.events:''}</span>
          <span style="flex:1"></span>
          <span style="font-variant-numeric:tabular-nums">${fmtUsd(v.amount)}</span>
        </div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
  }

  html += `<div style="font-size:11px;color:var(--text-muted);margin-top:8px;line-height:1.6">
    Company-level costs only — client work, acquisition CAC and infrastructure pools live in their own views.
    Rows without * are vendor-billed actuals (Mercury / card charges); * marks computed or estimated figures.
    Months before Jul 2026 come from the legacy accounting sheet and the Apr–Jun Mercury backfill.
  </div></div>`;
  return html;
}

// ─── Window exposures for inline onclick handlers ───
window.overheadRefresh = () => loadOverheadReport(true);
window.overheadToggle = (m) => {
  const s = state.overheadExpanded || (state.overheadExpanded = {});
  s[m] = s[m] === false ? true : false;
  render();
};
