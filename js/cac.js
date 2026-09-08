// ═══════════════════════════════════════════════════════════
// CAC — founder-only live acquisition-cost view (Lars + Aidan)
// Data: fulfillment `cac-report` edge fn. Its URL sits in this public repo,
//   so the function verifies the caller's CRM session AND enforces its own
//   lars@/aidan@ allowlist server-side — not rendering this tab for anyone
//   else (see isFounder() gates in render.js) is cosmetic on top of that.
// The ALL-TIME numbers are the headline (monthly CAC is noisy — closes and
// onboardings straddle month boundaries); the current month and the monthly
// table sit beneath them.
// Definitions (Lars's, fixed): loaded spend = ALL scope='acquisition'
//   cost_events in the month; cash spend = loaded minus Ioannis's demo
//   payouts (selling labor); signed = clients created that month (any
//   status); CAC = spend ÷ signed, shown as an em-dash when 0 signed.
// ═══════════════════════════════════════════════════════════
import { supabase } from './supabase-client.js?v=20260909035149';
import { state } from './app.js?v=20260909035149';
import { render } from './render.js?v=20260909035149';
import { esc } from './utils.js?v=20260909035149';

// Fulfillment-dashboard Supabase project (verify_jwt=false; same
// session-token contract as weekly-update-send — see js/weekly-updates.js).
const CAC_FN_URL = 'https://zrmobsgcfcloufajemxj.supabase.co/functions/v1/cac-report';

async function fetchCacReport(){
  const { data: { session } } = await supabase.auth.getSession();
  if(!session) throw new Error('Your session expired. Reload the page and sign in again.');
  const resp = await fetch(CAC_FN_URL,{
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+session.access_token },
    body: '{}' });
  const data = await resp.json().catch(()=>({ error:'cac-report returned a non-JSON response ('+resp.status+')' }));
  if(!resp.ok || data.error) throw new Error(data.error || ('cac-report failed ('+resp.status+')'));
  return data;
}

// Safe to call from inside render(): it only mutates state synchronously and
// re-renders when the fetch settles — no recursive render pass.
export function loadCacReport(force){
  if(state.cacLoading) return;
  if(state.cacReport && !force) return;
  state.cacLoading = true;
  state.cacError = null;
  fetchCacReport()
    .then(data => { state.cacReport = data; state.cacLoading = false; render(); })
    .catch(err => { state.cacError = err.message || String(err); state.cacLoading = false; render(); });
}

const fmtUsd = n => '$' + Number(n||0).toLocaleString('en-US',{ minimumFractionDigits:2, maximumFractionDigits:2 });
const fmtCac = n => (n === null || n === undefined) ? '—' : fmtUsd(n);

// vendor slugs -> readable component names (fall back to the raw slug)
const COMPONENT_LABELS = {
  'ioannis demo_qualified':'SDR commission — qualified demo', 'ioannis demo_close_bonus':'SDR commission — close bonus',
  'zapmail mailbox':'Zapmail mailboxes', 'spaceship domain':'Spaceship domains',
  'outscraper gmaps_data':'Outscraper scraping', 'outscraper emails_contacts':'Outscraper enrichment',
  'localpipe owner_name':'LocalPipe owner names', 'localpipe owner_email':'LocalPipe owner emails',
  'trykitt verify':'TryKitt verification', 'bounceban credit':'BounceBan verification',
  'aiark credit':'AI Ark credits', 'blooio-imessage subscription':'Blooio iMessage',
  'calendly subscription':'Calendly', 'signnow subscription':'SignNow'
};
const componentLabel = c => COMPONENT_LABELS[c.vendor+' '+c.cost_type] || (c.vendor+' · '+c.cost_type);

function renderStatCard(label, value, sub){
  return `<div style="flex:1;min-width:160px;background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 16px">
    <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">${esc(label)}</div>
    <div style="font-size:22px;font-weight:700;margin-top:4px">${esc(value)}</div>
    ${sub?`<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(sub)}</div>`:''}
  </div>`;
}

function renderComponentRows(m, colspan){
  const rows = (m.components||[]).map(c => `
    <div style="display:flex;justify-content:space-between;gap:12px;padding:3px 0;border-bottom:1px dashed #f3f4f6">
      <span>${esc(componentLabel(c))}${c.selling_labor?' <span style="color:#7c3aed;font-weight:600">(selling labor — excluded from cash)</span>':''}</span>
      <span style="font-variant-numeric:tabular-nums">${fmtUsd(c.amount)}</span>
    </div>`).join('');
  return `<tr><td colspan="${colspan}" style="padding:8px 24px 12px;background:#fafafa;border-bottom:1px solid var(--border)">
    <div style="max-width:520px;font-size:12px;color:#374151">${rows || '<span style="color:var(--text-muted)">No spend recorded.</span>'}</div>
  </td></tr>`;
}

export function renderCacTab(){
  loadCacReport();

  let html = `<div style="padding:8px 20px 40px;max-width:960px">`;

  // Header row: title + refresh
  const gen = state.cacReport && state.cacReport.generated_at ? new Date(state.cacReport.generated_at) : null;
  html += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
    <h2 style="font-size:16px;font-weight:700;margin:0">Customer Acquisition Cost</h2>
    <span style="flex:1"></span>
    ${gen?`<span style="font-size:11px;color:var(--text-muted)">Updated ${esc(gen.toLocaleString())}</span>`:''}
    <button class="btn btn-ghost" style="font-size:12px;padding:6px 14px" onclick="cacRefresh()" ${state.cacLoading?'disabled':''}>${state.cacLoading?'Refreshing…':'↻ Refresh'}</button>
  </div>`;

  if(state.cacError){
    html += `<div style="padding:12px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#b91c1c;font-size:12px;margin-bottom:14px">${esc(state.cacError)}</div>`;
  }

  if(!state.cacReport){
    if(!state.cacError) html += `<div style="padding:40px;text-align:center;color:var(--text-muted);font-size:13px">Loading live CAC…</div>`;
    html += `</div>`;
    return html;
  }

  const months = (state.cacReport.months||[]).slice().reverse(); // newest first
  const allTime = state.cacReport.all_time;
  const sinceLabel = months.length ? months[months.length-1].label : 'Aug 2026';

  // Headline cards: ALL-TIME is the star — monthly is noisy (see footnote).
  if(allTime){
    html += `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
      ${renderStatCard('Cash CAC — All-time · since '+sinceLabel, fmtCac(allTime.cash_cac), fmtUsd(allTime.cash_spend)+' spend / '+allTime.signed+' signed')}
      ${renderStatCard('Loaded CAC — All-time · since '+sinceLabel, fmtCac(allTime.loaded_cac), fmtUsd(allTime.loaded_spend)+' spend / '+allTime.signed+' signed')}
    </div>`;
  }

  // Monthly table
  const th = 'padding:8px 10px;text-align:right;font-weight:600;white-space:nowrap';
  html += `<div style="overflow-x:auto;background:#fff;border:1px solid var(--border);border-radius:10px">
    <table style="width:100%;border-collapse:collapse;font-size:12px">
    <thead><tr style="background:#f9fafb;border-bottom:2px solid var(--border)">
      <th style="${th};text-align:left">Month</th>
      <th style="${th}">Spend (cash)</th>
      <th style="${th}">Spend (loaded)</th>
      <th style="${th}">Signed</th>
      <th style="${th}">Cash CAC</th>
      <th style="${th}">Loaded CAC</th>
      <th style="width:36px"></th>
    </tr></thead><tbody>`;

  const td = 'padding:8px 10px;text-align:right;font-variant-numeric:tabular-nums;border-bottom:1px solid #f3f4f6';
  const expanded = state.cacExpanded || {};
  for(const m of months){
    const open = !!expanded[m.month];
    html += `<tr onclick="cacToggleMonth('${esc(m.month)}')" style="cursor:pointer">
      <td style="${td};text-align:left;font-weight:600">${esc(m.label)}${m.to_date?' <span style="font-weight:500;color:var(--text-muted)">(to date)</span>':''}</td>
      <td style="${td}">${fmtUsd(m.cash_spend)}</td>
      <td style="${td}">${fmtUsd(m.loaded_spend)}</td>
      <td style="${td}">${m.signed}</td>
      <td style="${td};font-weight:700">${fmtCac(m.cash_cac)}</td>
      <td style="${td};font-weight:700">${fmtCac(m.loaded_cac)}</td>
      <td style="${td};color:var(--text-muted)">${open?'▾':'▸'}</td>
    </tr>`;
    if(open) html += renderComponentRows(m, 7);
  }
  html += `</tbody></table></div>`;

  html += `<div style="font-size:11px;color:var(--text-muted);margin-top:8px;font-style:italic">Monthly figures are noisy: clients often onboard the month after they close. All-time is the reliable number.</div>`;

  html += `<div style="font-size:11px;color:var(--text-muted);margin-top:8px;line-height:1.6">
    Loaded = every acquisition cost (tools, data, mailboxes, selling labor). Cash = loaded minus selling labor
    (SDR commissions). Signed = clients created in the CRM that month, any status. Numbers refresh from
    the daily cost jobs — tracked from Aug 2026. Click a month for the component breakdown.
  </div></div>`;
  return html;
}

// ─── Window exposures for inline onclick handlers ───
window.cacRefresh = () => loadCacReport(true);
window.cacToggleMonth = (month) => {
  const s = state.cacExpanded || (state.cacExpanded = {});
  s[month] = !s[month];
  render();
};
