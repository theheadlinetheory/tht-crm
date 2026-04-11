// ═══════════════════════════════════════════════════════════
// ARCHIVE — Admin archive (Deals sheet archive), load/render
// ═══════════════════════════════════════════════════════════
import { state, pendingWrites } from './app.js';
import { render } from './render.js';
import { sbGetArchive, sbRestoreFromArchive, normalizeRow, supabase } from './api.js';
import { esc, str, fmtDate } from './utils.js';

export async function loadArchive(silent){
  if(!silent){
    state.archiveLoaded=false;
    render();
  }
  try {
    const data=await sbGetArchive();
    if(Array.isArray(data)){
      state.archiveData=data.map(normalizeRow);
    }
  } catch(e){ console.warn('Failed to load archive:', e); }
  state.archiveLoaded=true;
  if(!silent) render();
}

export function renderArchiveTab(){
  if(!state.archiveLoaded){
    return `<div style="padding:40px;text-align:center;color:var(--text-muted)">
      <div class="loading-spinner"></div>
      <div style="margin-top:12px;font-size:13px">Loading archive...</div>
    </div>`;
  }

  let filtered=[...state.archiveData];
  if(state.archiveFilterPipeline) filtered=filtered.filter(d=>d.pipeline===state.archiveFilterPipeline);
  if(state.archiveFilterStatus) filtered=filtered.filter(d=>d.archiveStatus===state.archiveFilterStatus);
  if(state.archiveFilterClient) filtered=filtered.filter(d=>d.clientName===state.archiveFilterClient);

  // Sort
  if(state.archiveSortDir==='newest'){
    filtered.sort((a,b)=>(b.archivedAt||'').localeCompare(a.archivedAt||''));
  } else {
    filtered.sort((a,b)=>(a.archivedAt||'').localeCompare(b.archivedAt||''));
  }

  const pipelines=[...new Set(state.archiveData.map(d=>d.pipeline).filter(Boolean))];
  const statuses=[...new Set(state.archiveData.map(d=>d.archiveStatus).filter(Boolean))];
  const clients=[...new Set(state.archiveData.map(d=>d.clientName).filter(Boolean))];

  let h=`<div style="padding:16px 20px">
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
      <select onchange="state.archiveFilterPipeline=this.value;render()" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:11px;font-family:var(--font)">
        <option value="">All Pipelines</option>
        ${pipelines.map(p=>`<option value="${esc(p)}" ${state.archiveFilterPipeline===p?'selected':''}>${esc(p)}</option>`).join('')}
      </select>
      <select onchange="state.archiveFilterStatus=this.value;render()" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:11px;font-family:var(--font)">
        <option value="">All Statuses</option>
        ${statuses.map(s=>`<option value="${esc(s)}" ${state.archiveFilterStatus===s?'selected':''}>${esc(s)}</option>`).join('')}
      </select>
      <select onchange="state.archiveFilterClient=this.value;render()" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:11px;font-family:var(--font)">
        <option value="">All Clients</option>
        ${clients.map(c=>`<option value="${esc(c)}" ${state.archiveFilterClient===c?'selected':''}>${esc(c)}</option>`).join('')}
      </select>
      <button class="btn btn-ghost" style="font-size:11px" onclick="state.archiveSortDir=state.archiveSortDir==='newest'?'oldest':'newest';render()">
        Sort: ${state.archiveSortDir==='newest'?'Newest First':'Oldest First'}
      </button>
      <span style="font-size:11px;color:var(--text-muted);margin-left:auto">${filtered.length} archived deals</span>
    </div>`;

  if(!filtered.length){
    h+=`<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">No archived deals${state.archiveFilterPipeline||state.archiveFilterStatus||state.archiveFilterClient?' matching filters':''}</div>`;
  } else {
    h+=`<table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;border:1px solid var(--border)">
      <thead><tr style="background:#f9fafb">
        <th style="text-align:left;padding:8px 10px;font-size:11px;font-weight:700;color:var(--text-muted)">Company</th>
        <th style="text-align:left;padding:8px 10px;font-size:11px;font-weight:700;color:var(--text-muted)">Client</th>
        <th style="text-align:left;padding:8px 10px;font-size:11px;font-weight:700;color:var(--text-muted)">Status</th>
        <th style="text-align:left;padding:8px 10px;font-size:11px;font-weight:700;color:var(--text-muted)">Archived</th>
        <th style="text-align:center;padding:8px 10px;font-size:11px;font-weight:700;color:var(--text-muted)">Actions</th>
      </tr></thead><tbody>`;
    for(const d of filtered){
      h+=`<tr style="border-top:1px solid #f3f4f6">
        <td style="padding:8px 10px;font-size:12px;font-weight:600">${esc(d.company||d.contact||'?')}</td>
        <td style="padding:8px 10px;font-size:12px;color:var(--text-muted)">${esc(d.clientName||d.stage||'')}</td>
        <td style="padding:8px 10px;font-size:11px">
          <select onchange="updateArchiveStatus('${esc(d.id)}',this.value)" style="padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:11px;font-family:var(--font)">
            <option value="Deleted/Lost" ${d.archiveStatus==='Deleted/Lost'?'selected':''}>Deleted/Lost</option>
            <option value="Closed Won" ${d.archiveStatus==='Closed Won'?'selected':''}>Closed Won</option>
            <option value="Passed Off" ${d.archiveStatus==='Passed Off'?'selected':''}>Passed Off</option>
          </select>
        </td>
        <td style="padding:8px 10px;font-size:11px;color:var(--text-muted)">${fmtDate(d.archivedAt)||''}</td>
        <td style="text-align:center;padding:8px 10px">
          <button class="btn btn-ghost" style="font-size:10px;padding:4px 8px" onclick="restoreFromArchive('${esc(d.id)}')">Restore</button>
        </td>
      </tr>`;
    }
    h+=`</tbody></table>`;
  }
  h+=`</div>`;
  return h;
}

export function archiveToggleAll(ids){
  if(state.bulkSelected.size===ids.length){
    state.bulkSelected=new Set();
  } else {
    state.bulkSelected=new Set(ids);
  }
  render();
}

export async function updateArchiveStatus(id,newStatus){
  const d=state.archiveData.find(x=>x.id===id);
  if(d) d.archiveStatus=newStatus;
  render();
  pendingWrites.value++;
  try { const { error } = await supabase.from('archive').update({archive_status:newStatus}).eq('id',id); if(error) throw error; }
  finally { pendingWrites.value--; }
}

export async function restoreFromArchive(id){
  if(!confirm('Restore this deal from archive?')) return;
  state.archiveData=state.archiveData.filter(d=>d.id!==id);
  render();
  pendingWrites.value++;
  try {
    await sbRestoreFromArchive(id);
    const { initialSync } = await import('./api.js');
    initialSync();
  } finally { pendingWrites.value--; }
}

export function toggleViewMode(){
  state.viewMode=state.viewMode==='board'?'list':'board';
  render();
}

// Expose to inline HTML handlers
window.loadArchive = loadArchive;
window.updateArchiveStatus = updateArchiveStatus;
window.restoreFromArchive = restoreFromArchive;
window.archiveToggleAll = archiveToggleAll;
window.toggleViewMode = toggleViewMode;
