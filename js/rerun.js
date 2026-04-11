// ═══════════════════════════════════════════════════════════
// RERUN — Re-run queue management, market settings
// ═══════════════════════════════════════════════════════════
import { state, pendingWrites } from './app.js';
import { render } from './render.js';
import { sbGetRerunQueue, sbGetMarketSettings, sbUpdateRerunStatus, sbAddToRerun, sbSaveMarketSetting, camelToSnake, normalizeRow } from './api.js';
import { esc, str, getToday, fmtDate, svgIcon } from './utils.js';
import { findClientForDeal } from './client-info.js';

export async function loadRerunData(){
  state.rerunLoading=true;
  render();
  try {
    const [queue, settings] = await Promise.all([
      sbGetRerunQueue(),
      sbGetMarketSettings()
    ]);
    if(Array.isArray(queue)) state.rerunQueue=queue.map(normalizeRow);
    if(Array.isArray(settings)) state.rerunMarketSettings=settings.map(normalizeRow);
  } catch(e){ console.warn('Failed to load rerun data:', e); }
  state.rerunLoading=false;
  render();
}

export function getFilteredRerunQueue(){
  let q=[...state.rerunQueue];
  if(state.rerunFilterState) q=q.filter(r=>r.state===state.rerunFilterState);
  if(state.rerunFilterCity) q=q.filter(r=>r.city===state.rerunFilterCity);
  if(state.rerunFilterStatus) q=q.filter(r=>r.status===state.rerunFilterStatus);
  return q;
}

export function getRerunStates(){
  const states=new Set();
  state.rerunQueue.forEach(r=>{if(r.state)states.add(r.state);});
  return [...states].sort();
}

export function getRerunCities(){
  const cities=new Set();
  let filtered=[...state.rerunQueue];
  if(state.rerunFilterState) filtered=filtered.filter(r=>r.state===state.rerunFilterState);
  filtered.forEach(r=>{if(r.city)cities.add(r.city);});
  return [...cities].sort();
}

export async function updateRerunStatus(id, newStatus){
  const item=state.rerunQueue.find(r=>r.id===id);
  if(item) item.status=newStatus;
  render();
  pendingWrites.value++;
  try { await sbUpdateRerunStatus(id, newStatus); }
  finally { pendingWrites.value--; }
}

export async function addToRerunQueue(dealId){
  const deal=state.deals.find(d=>d.id===dealId);
  if(!deal) return;
  const client=findClientForDeal(deal);
  const data={
    dealId:deal.id,
    dealName:deal.company||deal.contact||'Unknown',
    email:deal.email||'',
    location:deal.location||'',
    state:deal.state||'',
    city:deal.city||'',
    campaignName:deal.campaignName||'',
    stage:deal.stage||''
  };
  pendingWrites.value++;
  try {
    const resp=await sbAddToRerun(camelToSnake(data));
    if(resp && resp.id){
      state.rerunQueue.push({...data,id:resp.id,status:'queued',queuedAt:new Date().toISOString()});
    }
  } finally { pendingWrites.value--; }
}

export function exportRerunCSV(){
  const queue=getFilteredRerunQueue();
  if(!queue.length){alert('No items to export.');return;}
  const headers=['Deal Name','Email','Location','State','City','Campaign','Stage','Status','Queued At','Re-run After','Sent At'];
  const rows=queue.map(r=>[
    r.dealName||'',r.email||'',r.location||'',r.state||'',r.city||'',
    r.campaignName||'',r.stage||'',r.status||'',r.queuedAt||'',r.rerunAfter||'',r.sentAt||''
  ]);
  let csv=headers.join(',')+'\n';
  for(const row of rows){
    csv+=row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')+'\n';
  }
  const blob=new Blob([csv],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download='rerun_queue.csv';a.click();
  URL.revokeObjectURL(url);
}

export function exportRerunForSmartlead(){
  const queue=getFilteredRerunQueue().filter(r=>r.status==='queued'||r.status==='ready');
  if(!queue.length){alert('No queued/ready items to export.');return;}
  const headers=['email','first_name','last_name','company_name','website','location','custom1','custom2'];
  const rows=queue.map(r=>{
    const nameParts=(r.dealName||'').split(' ');
    return [r.email||'',nameParts[0]||'',nameParts.slice(1).join(' ')||'',r.dealName||'','',r.location||'',r.campaignName||'',r.stage||''];
  });
  let csv=headers.join(',')+'\n';
  for(const row of rows){
    csv+=row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')+'\n';
  }
  const blob=new Blob([csv],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download='rerun_smartlead.csv';a.click();
  URL.revokeObjectURL(url);
}

export function switchNurtureTab(tab){
  state.nurtureSubTab=tab;
  if(tab==='rerun') loadRerunData();
  else if(tab==='archive'){ const { loadArchive } = require_archive_sync(); if(!state.archiveLoaded) loadArchive(); else render(); }
  else { render(); }
}

function require_archive_sync(){
  // Lazy import to avoid circular dependency
  let mod;
  import('./archive.js').then(m=>{ mod=m; });
  return { loadArchive: ()=>{ import('./archive.js').then(m=>m.loadArchive()); } };
}

export function renderRerunTab(){
  const filtered = getFilteredRerunQueue();
  const states = getRerunStates();
  const cities = getRerunCities();
  const totalQueued = state.rerunQueue.filter(r=>(r.status||'').toLowerCase()==='queued').length;
  const totalSent = state.rerunQueue.filter(r=>(r.status||'').toLowerCase()==='sent').length;
  const uniqueStates = getRerunStates().length;
  const uniqueCities = new Set(state.rerunQueue.map(r=>r.city).filter(Boolean)).size;

  let h = `<div class="rerun-container">
    <div class="rerun-stat-cards">
      <div class="rerun-stat-card">
        <div class="stat-label">Total Queued</div>
        <div class="stat-value" style="color:#d97706">${totalQueued}</div>
      </div>
      <div class="rerun-stat-card">
        <div class="stat-label">Already Sent</div>
        <div class="stat-value" style="color:#22c55e">${totalSent}</div>
      </div>
      <div class="rerun-stat-card">
        <div class="stat-label">States</div>
        <div class="stat-value">${uniqueStates}</div>
      </div>
      <div class="rerun-stat-card">
        <div class="stat-label">Cities / Markets</div>
        <div class="stat-value">${uniqueCities}</div>
      </div>
    </div>

    <div class="rerun-filters">
      <select onchange="state.rerunFilterState=this.value;state.rerunFilterCity='';render()">
        <option value="">All States</option>
        ${states.map(s=>`<option value="${esc(s)}" ${state.rerunFilterState===s?'selected':''}>${esc(s)}</option>`).join('')}
      </select>
      <select onchange="state.rerunFilterCity=this.value;render()">
        <option value="">All Cities</option>
        ${cities.map(c=>`<option value="${esc(c)}" ${state.rerunFilterCity===c?'selected':''}>${esc(c)}</option>`).join('')}
      </select>
      <select onchange="state.rerunFilterStatus=this.value;render()">
        <option value="">All Statuses</option>
        <option value="queued" ${state.rerunFilterStatus==='queued'?'selected':''}>Queued</option>
        <option value="sent" ${state.rerunFilterStatus==='sent'?'selected':''}>Sent</option>
        <option value="skipped" ${state.rerunFilterStatus==='skipped'?'selected':''}>Skipped</option>
      </select>
      <button class="btn btn-primary" onclick="exportRerunCSV()">Export CSV</button>
      <button class="btn btn-ghost" style="background:#ecfdf5;color:var(--purple);border:1px solid #a7f3d0" onclick="exportRerunForSmartlead()">${svgIcon('upload',12)} Export for Smartlead</button>
      <span style="font-size:11px;color:var(--text-muted);margin-left:auto">${filtered.length} of ${state.rerunQueue.length} leads</span>
    </div>`;

  if(state.rerunLoading){
    h += `<div class="rerun-empty">Loading re-run queue...</div>`;
  } else if(filtered.length === 0){
    h += `<div class="rerun-empty">No leads in the re-run queue yet.<br><span style="font-size:11px">Leads auto-queue when moved to "Service Area Taken" or "Revisit" stages.</span></div>`;
  } else {
    h += `<table class="rerun-table">
      <thead><tr>
        <th>Company</th>
        <th>Email</th>
        <th>State</th>
        <th>City</th>
        <th>Source Stage</th>
        <th>Queued Date</th>
        <th>Re-Run Date</th>
        <th>Status</th>
        <th></th>
      </tr></thead>
      <tbody>`;
    for(const r of filtered){
      const statusCls = (r.status||'').toLowerCase()==='sent' ? 'sent' : (r.status||'').toLowerCase()==='skipped' ? 'skipped' : 'queued';
      h += `<tr>
        <td style="font-weight:600">${esc(r.company||r.contact||'')}</td>
        <td style="color:var(--text-muted)">${esc(r.email||'')}</td>
        <td>${esc(r.state||'')}</td>
        <td>${esc(r.city||'')}</td>
        <td><span class="deal-tag">${esc(r.sourceStage||'')}</span></td>
        <td style="color:var(--text-muted)">${esc(r.queuedDate||'')}</td>
        <td style="font-weight:600">${esc(r.rerunDate||'')}</td>
        <td><span class="rerun-status ${statusCls}">${esc(r.status||'Queued')}</span></td>
        <td>
          ${(r.status||'').toLowerCase()!=='sent'?`<button class="btn" style="font-size:10px;padding:2px 8px;background:#f3f4f6;color:#6b7280" onclick="updateRerunStatus('${esc(r.id)}','skipped')">Skip</button>`:''}
        </td>
      </tr>`;
    }
    h += `</tbody></table>`;
  }

  h += `</div>`;
  if(state.rerunShowMarketModal){
    h += renderMarketSettingsModal();
  }
  return h;
}

// Expose to inline HTML handlers
window.loadRerunData = loadRerunData;
window.updateRerunStatus = updateRerunStatus;
window.exportRerunCSV = exportRerunCSV;
window.exportRerunForSmartlead = exportRerunForSmartlead;
window.switchNurtureTab = switchNurtureTab;

// Market settings modal
export function renderMarketSettingsModal(){
  const ms = state.rerunMarketSettings;
  let h = `<div class="modal-overlay" onmousedown="this._mdownTarget=event.target" onclick="if(event.target===this&&this._mdownTarget===this){state.rerunShowMarketModal=false;render()}">
    <div class="modal" style="width:560px" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3>Market Re-Run Settings</h3>
        <button class="modal-close" onclick="state.rerunShowMarketModal=false;render()">\u00D7</button>
      </div>
      <div class="modal-body">
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:14px">Set how many months before leads are eligible for re-run by state or city. City settings override state defaults.</p>
        <table class="rerun-table" style="margin-bottom:16px">
          <thead><tr><th>State</th><th>City (optional)</th><th>Re-Run After (months)</th><th></th></tr></thead>
          <tbody>`;
  for(const [i,m] of ms.entries()){
    h += `<tr>
      <td><input type="text" value="${esc(m.state||'')}" style="width:60px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px" oninput="state.rerunMarketSettings[${i}].state=this.value"></td>
      <td><input type="text" value="${esc(m.city||'')}" placeholder="All cities" style="width:120px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px" oninput="state.rerunMarketSettings[${i}].city=this.value"></td>
      <td><input type="number" value="${esc(m.months||'6')}" min="1" max="24" style="width:60px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px" oninput="state.rerunMarketSettings[${i}].months=this.value"></td>
      <td><button class="act-delete" onclick="state.rerunMarketSettings.splice(${i},1);render()">\u00D7</button></td>
    </tr>`;
  }
  h += `</tbody></table>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost" style="background:#ecfdf5;color:var(--purple);border:1px solid #a7f3d0" onclick="state.rerunMarketSettings.push({state:'',city:'',months:'6'});render()">+ Add Market</button>
        </div>
      </div>
      <div class="modal-footer" style="justify-content:flex-end;gap:8px">
        <button class="btn" style="background:#f9fafb;color:#6b7280;border:1px solid #e5e7eb" onclick="state.rerunShowMarketModal=false;render()">Cancel</button>
        <button class="btn btn-primary" onclick="saveMarketSettings()">Save Settings</button>
      </div>
    </div>
  </div>`;
  return h;
}

export async function saveMarketSettings(){
  const btn = document.querySelector('.modal-footer .btn-primary');
  if(btn){ btn.textContent='Saving...'; btn.disabled=true; }
  try {
    for(const m of state.rerunMarketSettings){
      if(!m.state) continue;
      await sbSaveMarketSetting({ state: m.state, city: m.city||'', rerun_days: parseInt(m.months)||6 });
    }
    state.rerunShowMarketModal=false;
    await loadRerunData();
  } catch(e){
    alert('Failed to save market settings: '+e.message);
    if(btn){ btn.textContent='Save Settings'; btn.disabled=false; }
  }
}

window.saveMarketSettings = saveMarketSettings;
