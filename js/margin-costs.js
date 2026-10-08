// ═══════════════════════════════════════════════════════════
// MARGIN COSTS — the per-client cost drill-down inside Client Margins.
// Vanilla-JS port of the client dashboard's Cost Tracking modal table
// (dashboard/src/lib/cost-summary.ts + components/client/CostEventsTable.tsx),
// kept behavior-identical on purpose (Aidan, 2026-10-04: "exactly like that"):
// headline buckets, then every event filterable All / One-off / Labor /
// Recurring, plus a By-industry view that rolls pipeline + custom-list spend
// up per batch industry with an expandable vendor split per group.
// Data: margin-report { client_id } → { costs, revenue, industry_of }.
// ═══════════════════════════════════════════════════════════
import { supabase } from './supabase-client.js?v=20261008074628';
import { state } from './app.js?v=20261008074628';
import { render } from './render.js?v=20261008074628';
import { esc } from './utils.js?v=20261008074628';

const MARGIN_FN_URL = 'https://zrmobsgcfcloufajemxj.supabase.co/functions/v1/margin-report';

// ─── Vendor taxonomy (mirrors dashboard lib/cost-summary.ts — keep in sync) ───
const LABOR_VENDORS = new Set(['tim', 'ioannis', 'gtme1']);
const RECURRING_VENDORS = new Set(['zapmail']);
const PIPELINE_VENDORS = new Set(['outscraper', 'localpipe', 'trykitt', 'bounceban']);
const CUSTOM_LIST_VENDORS = new Set(['aiark', 'serper', 'apify']);
const CATEGORY_LABELS = { one_off: 'One-off', labor: 'Labor', recurring: 'Recurring' };
const VENDOR_LABELS = {
  outscraper: 'Outscraper', localpipe: 'LocalPipe', trykitt: 'TryKitt',
  bounceban: 'BounceBan', serper: 'Serper', aiark: 'AI Ark', apify: 'Apify',
  spaceship: 'Spaceship', zapmail: 'Zapmail', highlevel: 'HighLevel',
  tim: 'Tim', ioannis: 'Ioannis', gtme1: 'GTM Engineer #1',
  'custom-list': 'Custom list', 'domain-reuse': 'Reused domains',
};
const COST_TYPE_LABELS = {
  gmaps_data: 'Maps data', emails_contacts: 'Emails & contacts',
  owner_name: 'Owner names', owner_email: 'Owner emails', verify: 'Verification',
  credit: 'Credits', domain: 'Domain', query: 'Search queries',
  mailbox: 'Inboxes (monthly)', subscription: 'Subscription',
  labor_allocation: 'Monthly allocation', lead_setting: 'Appointment setting',
  unrecorded: 'Unrecorded build', reused_domains: 'Reused domains',
};

// Labor wins over recurring on purpose: a monthly-shaped charge from a person
// is labor (same ruling as the dashboard's costCategoryOf).
const costCategoryOf = r =>
  LABOR_VENDORS.has(r.vendor) ? 'labor' : RECURRING_VENDORS.has(r.vendor) ? 'recurring' : 'one_off';

const fmtUsd = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQty = n => Number.isInteger(Number(n)) ? Number(n).toLocaleString('en-US') : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const fmtDate = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fmtDay = day => new Date(day + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const fmtDayRange = g => g.firstDay === g.lastDay ? fmtDay(g.firstDay) : fmtDay(g.firstDay) + ' – ' + fmtDay(g.lastDay);

// Slot-key list names (aiark_local_dm) read badly raw; everything else is a
// plain word (industrial, housing, chains) that just needs capitalizing.
const listLabel = list => list === 'aiark_local_dm'
  ? 'Custom — AI Ark Local DMs'
  : 'Custom — ' + list.charAt(0).toUpperCase() + list.slice(1).replace(/_/g, ' ');

// One-off pipeline + custom-list spend grouped for the by-industry view.
// Straight port of the dashboard's groupPipelineEvents: custom-list tees
// group by metadata.list, GMaps rows by their batch's industry; batches
// sharing a label (same industry under two offers) merge into one group.
function groupPipelineEvents(rows, labelOf){
  const groups = new Map();
  for (const r of rows) {
    const isCustom = CUSTOM_LIST_VENDORS.has(r.vendor);
    if (!PIPELINE_VENDORS.has(r.vendor) && !isCustom) continue;
    const list = r.metadata && r.metadata.list;
    const label = list ? listLabel(list) : labelOf(r.batch_id || null);
    const day = String(r.occurred_at || '').slice(0, 10);
    const g = groups.get(label) || { vendors: new Map(), firstDay: day, lastDay: day };
    const v = g.vendors.get(r.vendor) || { vendor: r.vendor, amount: 0, isActual: true, events: 0 };
    v.amount += Number(r.amount_usd) || 0;
    v.isActual = v.isActual && !!r.is_actual;
    v.events += 1;
    g.vendors.set(r.vendor, v);
    if (day && day < g.firstDay) g.firstDay = day;
    if (day > g.lastDay) g.lastDay = day;
    groups.set(label, g);
  }
  return [...groups.entries()]
    .map(([label, g]) => {
      const byVendor = [...g.vendors.values()]
        .map(v => ({ ...v, amount: Math.round(v.amount * 100) / 100 }))
        .sort((a, b) => b.amount - a.amount);
      const total = Math.round(byVendor.reduce((s, v) => s + v.amount, 0) * 100) / 100;
      return { label, byVendor, total, firstDay: g.firstDay, lastDay: g.lastDay };
    })
    .sort((a, b) => b.total - a.total);
}

// ─── Fetch + toggle (state.marginDetails[id] = {loading|data|error}) ───
async function fetchClientDetail(clientId){
  const { data: { session } } = await supabase.auth.getSession();
  const resp = await fetch(MARGIN_FN_URL, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
    body: JSON.stringify({ client_id: clientId }) });
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error || 'detail failed');
  return data.client_detail;
}
window.marginDetail = (id) => {
  const s = state.marginDetails || (state.marginDetails = {});
  if (s[id]) { delete s[id]; render(); return; }
  s[id] = { loading: true };
  render();
  fetchClientDetail(id)
    .then(d => { s[id] = { data: d }; render(); })
    .catch(e => { s[id] = { error: String(e.message || e) }; render(); });
};
window.marginDetailView = (id, v) => {
  const s = state.marginDetailView || (state.marginDetailView = {});
  s[id] = v;
  render();
};
// Industry groups toggle by index — order is total-desc and stable for one
// loaded detail payload, so the index addresses the same group every render.
window.marginIndustryToggle = (id, idx) => {
  const s = state.marginIndustryOpen || (state.marginIndustryOpen = {});
  const open = s[id] || (s[id] = {});
  open[idx] = !open[idx];
  render();
};

// ─── Render pieces ───
const TH = 'padding:6px 10px;font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;text-align:left;background:#f9fafb;position:sticky;top:0';
const TD = 'padding:5px 10px;font-size:12px;border-top:1px solid #f3f4f6';
const NUM = ';text-align:right;font-variant-numeric:tabular-nums';
const STAR = '<span style="opacity:.5" title="Computed from usage × rate card, not a vendor invoice"> *</span>';

function bucketSummary(rows){
  const buckets = { 'One-off': new Map(), 'Labor': new Map(), 'Monthly inboxes': new Map() };
  let est = 0;
  for (const r of rows) {
    if (r.vendor === 'custom-list' || r.vendor === 'domain-reuse') continue;
    const cat = costCategoryOf(r);
    const b = cat === 'labor' ? 'Labor' : cat === 'recurring' ? 'Monthly inboxes' : 'One-off';
    const k = (VENDOR_LABELS[r.vendor] || r.vendor) + ' · ' + (COST_TYPE_LABELS[r.cost_type] || String(r.cost_type || '').replace(/_/g, ' '));
    const prev = buckets[b].get(k) || { amt: 0, qty: 0, actual: true };
    prev.amt += Number(r.amount_usd) || 0;
    prev.qty += Number(r.quantity) || 0;
    prev.actual = prev.actual && !!r.is_actual;
    buckets[b].set(k, prev);
    if (r.metadata && r.metadata.estimate) est++;
  }
  let html = '<div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:10px;padding-top:8px;border-top:1px solid #e5e7eb">';
  for (const [title, map] of Object.entries(buckets)) {
    if (!map.size) continue;
    const tot = [...map.values()].reduce((a, v) => a + v.amt, 0);
    html += `<div style="min-width:220px;flex:1"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted)">${title} — ${fmtUsd(tot)}</div>`;
    for (const [k, v] of [...map.entries()].sort((a, b) => b[1].amt - a[1].amt)) {
      html += `<div style="display:flex;gap:8px;font-size:12px;padding:2px 0">
        <span style="color:#374151">${esc(k)}${v.actual ? '' : STAR}</span>
        <span style="color:var(--text-muted);font-size:11px">${v.qty > 1 ? Math.round(v.qty).toLocaleString() : ''}</span>
        <span style="flex:1"></span><span style="font-variant-numeric:tabular-nums">${fmtUsd(v.amt)}</span></div>`;
    }
    html += '</div>';
  }
  html += `</div><div style="font-size:10.5px;color:var(--text-muted);margin-top:6px">* computed or estimated, not vendor-billed${est ? ` · ${est} estimated row(s) in this client's ledger` : ''}</div>`;
  return html;
}

function eventsTable(visible, filter){
  if (!visible.length) {
    const what = filter === 'all' ? '' : CATEGORY_LABELS[filter].toLowerCase() + ' ';
    return `<div style="padding:16px;text-align:center;font-size:12px;color:var(--text-muted)">No ${what}events recorded.</div>`;
  }
  let html = `<table style="width:100%;border-collapse:collapse"><thead><tr>
    <th style="${TH}">Date</th><th style="${TH}">Vendor</th><th style="${TH}">Type</th>
    <th style="${TH};text-align:right">Qty</th><th style="${TH};text-align:right">Amount</th></tr></thead><tbody>`;
  for (const e of visible) {
    html += `<tr>
      <td style="${TD};color:var(--text-muted);white-space:nowrap">${esc(fmtDate(e.occurred_at))}</td>
      <td style="${TD}">${esc(VENDOR_LABELS[e.vendor] || e.vendor)}</td>
      <td style="${TD};color:var(--text-muted)">${esc(COST_TYPE_LABELS[e.cost_type] || e.cost_type)}${e.is_actual ? '' : STAR}</td>
      <td style="${TD}${NUM};color:var(--text-muted)">${fmtQty(e.quantity)}</td>
      <td style="${TD}${NUM}">${fmtUsd(e.amount_usd)}</td></tr>`;
  }
  return html + '</tbody></table>';
}

function industryTable(id, groups){
  if (!groups.length) {
    return `<div style="padding:16px;text-align:center;font-size:12px;color:var(--text-muted)">No pipeline runs recorded.</div>`;
  }
  const open = (state.marginIndustryOpen || {})[id] || {};
  let html = `<table style="width:100%;border-collapse:collapse"><thead><tr>
    <th style="${TH}">Industry</th><th style="${TH}">Dates</th>
    <th style="${TH};text-align:right">Events</th><th style="${TH};text-align:right">Amount</th></tr></thead><tbody>`;
  groups.forEach((g, i) => {
    const isOpen = !!open[i];
    const events = g.byVendor.reduce((s, v) => s + v.events, 0);
    html += `<tr onclick="event.stopPropagation();marginIndustryToggle('${esc(id)}',${i})" style="cursor:pointer">
      <td style="${TD}"><span style="color:var(--text-muted)">${isOpen ? '▾' : '▸'}</span> ${esc(g.label)}</td>
      <td style="${TD};color:var(--text-muted);white-space:nowrap">${esc(fmtDayRange(g))}</td>
      <td style="${TD}${NUM};color:var(--text-muted)">${events}</td>
      <td style="${TD}${NUM};font-weight:600">${fmtUsd(g.total)}</td></tr>`;
    if (isOpen) {
      for (const v of g.byVendor) {
        html += `<tr style="background:#fafafa">
          <td style="${TD};padding-left:34px;color:var(--text-muted)">${esc(VENDOR_LABELS[v.vendor] || v.vendor)}${v.isActual ? '' : STAR}</td>
          <td style="${TD}"></td>
          <td style="${TD}${NUM};color:var(--text-muted)">${v.events}</td>
          <td style="${TD}${NUM}">${fmtUsd(v.amount)}</td></tr>`;
      }
    }
  });
  return html + '</tbody></table>';
}

// The whole drill-down block rendered under a client's monthly split.
export function costBreakdown(id){
  const st = (state.marginDetails || {})[id];
  if (!st) return '';
  if (st.loading) return '<div style="padding:8px 0;color:var(--text-muted);font-size:12px">Loading cost breakdown…</div>';
  if (st.error) return `<div style="padding:8px 0;color:#b91c1c;font-size:12px">${esc(st.error)}</div>`;
  const rows = st.data.costs || [];
  const industryOf = st.data.industry_of || {};

  const filter = (state.marginDetailView || {})[id] || 'all';
  const visible = filter === 'all' || filter === 'industry'
    ? rows
    : rows.filter(e => costCategoryOf(e) === filter);
  const groups = groupPipelineEvents(rows, batchId =>
    batchId && industryOf[batchId] ? 'GMaps — ' + industryOf[batchId] : 'Other pipeline runs');

  const pill = (v, label) => `<button onclick="event.stopPropagation();marginDetailView('${esc(id)}','${v}')"
    style="font-size:11px;font-weight:600;padding:4px 10px;border-radius:999px;border:1px solid var(--border);cursor:pointer;
    background:${filter === v ? '#111827' : '#fff'};color:${filter === v ? '#fff' : '#374151'}">${label}</button>`;

  const title = filter === 'industry'
    ? `Pipeline spend by industry (${groups.length} ${groups.length === 1 ? 'group' : 'groups'})`
    : `All events (${visible.length}${filter !== 'all' ? ' of ' + rows.length : ''})`;

  let html = bucketSummary(rows);
  html += `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:14px;margin-bottom:6px">
    <span style="font-size:12px;font-weight:600;color:#374151">${title}</span>
    <span style="flex:1"></span>
    ${pill('all', 'All')}${pill('one_off', 'One-off')}${pill('labor', 'Labor')}${pill('recurring', 'Recurring')}${pill('industry', 'By industry')}</div>`;
  html += `<div style="border:1px solid var(--border);border-radius:8px;max-height:280px;overflow-y:auto;background:#fff">`;
  html += filter === 'industry' ? industryTable(id, groups) : eventsTable(visible, filter);
  html += `</div>`;
  if (filter === 'industry') {
    html += `<div style="font-size:10.5px;color:var(--text-muted);margin-top:4px">Pipeline + custom-list vendors only (Outscraper, LocalPipe, TryKitt, BounceBan, AI Ark, Serper, Apify) — domains, labor and inboxes are in the other views. Click a group for its vendor split.</div>`;
  }
  return html;
}
