// ─── Default Routing Rules ───
// Keyword → person rules for auto-assigning acquisition campaigns that have no
// explicit per-campaign assignment. First matching rule wins (ordered list).
// Rules are a fallback: an explicit campaign_assignment always overrides them.
// Stored in crm_settings key 'routing_rules' as a JSON array [{keyword, owner}].

import { state } from './app.js?v=20260717f';
import { supabase } from './supabase-client.js?v=20260717f';
import { esc, svgIcon } from './utils.js?v=20260717f';

// ── Resolution (used by getOwnerForDeal / getOwnerNameForDeal in auth.js) ──
export function resolveRoutingOwner(campaignName){
  if(!campaignName) return '';
  const name = String(campaignName).toLowerCase();
  for(const rule of (state.routingRules || [])){
    const kw = String(rule.keyword || '').toLowerCase().trim();
    if(kw && name.includes(kw)) return rule.owner || '';
  }
  return '';
}

// ── Persistence (mirrors auth.js campaign_assignments pattern) ──
export async function loadRoutingRules(){
  try {
    const { data } = await supabase.from('crm_settings').select('value').eq('key','routing_rules').single();
    if(data && data.value) state.routingRules = JSON.parse(data.value);
  } catch(e){ /* no rules yet */ }
}
async function persistRoutingRules(){
  try {
    await supabase.from('crm_settings').upsert(
      { key:'routing_rules', value: JSON.stringify(state.routingRules||[]), updated_at: new Date().toISOString() },
      { onConflict: 'key' });
  } catch(e){ console.warn('Failed to save routing rules:', e); }
}
export function listenRoutingRules(){
  try {
    supabase.channel('crm_settings-routing')
      .on('postgres_changes', { event:'*', schema:'public', table:'crm_settings', filter:'key=eq.routing_rules' },
        payload => { if(payload.new && payload.new.value){ try { state.routingRules = JSON.parse(payload.new.value); window.render&&window.render(); } catch(_){} } })
      .subscribe();
  } catch(e){ /* best effort */ }
}

// ── UI ──
// Inner list markup only — so structural changes can redraw JUST #routing-rules-list
// (targeted DOM update) without rebuilding the whole settings body. Rebuilding the
// body re-renders the campaigns section through a short "Loading…" placeholder,
// which collapses the panel height and loses scroll — that was the X-scrolls bug.
function rulesListHtml(assignableNames){
  const rules = state.routingRules || [];
  if(rules.length === 0){
    return `<div style="font-size:11px;color:var(--text-muted);padding:8px 0">No rules yet. Add one below.</div>`;
  }
  const opts = (sel) => `<option value=""${!sel?' selected':''}>— person —</option>` +
    (assignableNames||[]).map(n => `<option value="${esc(n)}"${sel===n?' selected':''}>${esc(n)}</option>`).join('');
  return rules.map((r, i) => `<div style="display:flex;align-items:center;gap:8px;padding:8px;margin-bottom:6px;background:#f9fafb;border:1px solid var(--border);border-radius:8px">
      <span style="font-size:10px;color:var(--text-muted);width:44px">Rule ${i+1}</span>
      <input type="text" value="${esc(r.keyword||'')}" placeholder="keyword (e.g. HVAC)" oninput="routingRuleEdit(${i},'keyword',this.value)"
        style="flex:1;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:11px;font-family:var(--font)">
      <span style="font-size:11px;color:var(--text-muted)">→</span>
      <select onchange="routingRuleEdit(${i},'owner',this.value)" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:11px;font-family:var(--font);min-width:130px">${opts(r.owner)}</select>
      <button onclick="routingRuleMove(${i},-1)" title="Move up" style="background:none;border:none;cursor:pointer;color:#9ca3af;font-size:13px"${i===0?' disabled':''}>▲</button>
      <button onclick="routingRuleMove(${i},1)" title="Move down" style="background:none;border:none;cursor:pointer;color:#9ca3af;font-size:13px"${i===rules.length-1?' disabled':''}>▼</button>
      <button onclick="routingRuleDelete(${i})" title="Delete" style="background:none;border:none;cursor:pointer;color:#dc2626;font-size:14px">&times;</button>
    </div>`).join('');
}

export function renderRoutingRules(assignableNames){
  return `<div class="settings-section">
    <h4>${svgIcon('bar-chart',14)} Default Routing Rules</h4>
    <p style="font-size:11px;color:var(--text-muted);margin-bottom:12px">Auto-assign campaigns by keyword when they have no explicit assignment above. First matching rule wins — drag order matters. An explicit assignment always overrides a rule.</p>
    <div id="routing-rules-list">${rulesListHtml(assignableNames)}</div>
    <button class="btn btn-ghost" style="margin-top:8px;font-size:11px;padding:4px 12px;border:1px solid var(--border)" onclick="routingRuleAdd()">+ Add Rule</button>
  </div>`;
}

// ── Handlers ──
let _saveTimer = null;
function scheduleSave(){ clearTimeout(_saveTimer); _saveTimer = setTimeout(persistRoutingRules, 800); }

// Redraw ONLY the rules list in place — no settings-body rebuild, so scroll is preserved.
function redrawRulesList(){
  const el = document.getElementById('routing-rules-list');
  if(!el) return;
  el.innerHTML = rulesListHtml((state.assignableUsers||[]).map(u=>u.name).filter(Boolean));
}

window.routingRuleAdd = () => { (state.routingRules ||= []).push({ keyword:'', owner:'' }); redrawRulesList(); persistRoutingRules(); };
window.routingRuleDelete = (i) => { (state.routingRules||[]).splice(i,1); redrawRulesList(); persistRoutingRules(); };
window.routingRuleMove = (i, dir) => {
  const r = state.routingRules||[]; const j = i+dir;
  if(j<0||j>=r.length) return;
  [r[i], r[j]] = [r[j], r[i]]; redrawRulesList(); persistRoutingRules();
};
window.routingRuleEdit = (i, field, val) => {
  const r = state.routingRules||[]; if(!r[i]) return;
  r[i][field] = val;
  if(field === 'owner'){ redrawRulesList(); persistRoutingRules(); }
  else scheduleSave(); // keyword typing — debounce, don't redraw mid-type (keeps focus)
};
