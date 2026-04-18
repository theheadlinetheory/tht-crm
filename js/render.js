// ═══════════════════════════════════════════════════════════
// RENDER — Main render loop, refreshModal, list view
// ═══════════════════════════════════════════════════════════

import { state, savedScrollLeft, setSavedScrollLeft, clientArchivedDeals } from './app.js';
import { ACQUISITION_STAGES, NURTURE_STAGES, ACTIVITY_ICONS } from './config.js';
import { esc, svgIcon, getToday, fmtDate, fmtTime12, str, stripHtml } from './utils.js';
import { isAdmin, isClient, isEmployee, renderUserMenu, getOwnerForDeal } from './auth.js';
import { initialSync as syncFromSheet } from './api.js';
import { getStages, getPipelineDeals, getVisiblePipelinesWithArchive, globalSearch, clearSearch, getActivityBadge } from './search.js';
import { openDeal, openNewDeal, showDeleteZone, hideDeleteZone, doLostDrop, doWonDrop, renderDealModal, renderNewDealModal, renderAddClientModal, toggleBadgeDropdown } from './deal-modal.js';
import { renderActivateClientModal } from './activate-client.js';
import { renderOverdueBanner, renderBookedMeetingsBanner, leadAgeBadge } from './activities.js';
import { renderDashboard } from './dashboard.js';
import { loadArchive, renderArchiveTab, toggleViewMode, updateArchiveStatus, restoreFromArchive } from './archive.js';
import { toggleBulkMode, bulkMoveStage, bulkSelectAll, bulkArchive, bulkAddActivity, toggleBulkSelect } from './deals.js';
import { openSettings } from './settings.js';
import { serviceAreaResults } from './maps.js';
import { lookupClientInfo, isRetainerClient, openClientInfoPanel, removeClient } from './client-info.js';
import { openCalendlyEmbed, removeAppointment, addManualAppointment } from './calendly.js';
import { doDragOver, doDragLeave, clearAllDragOver, doDrop } from './deals.js';
import { renderDueTodayBanner, renderNurtureTab, renderNurtureEntryModal, renderReactivateModal, renderSnoozeModal, loadNurtureData } from './rerun.js';

// ─── renderListView ───
function renderListView(deals,stages){
  let h=`<div style="padding:16px 20px">
    <div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px;background:var(--card)">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#f9fafb;border-bottom:2px solid var(--border)">
          <th style="padding:8px 10px;text-align:left;font-weight:600;white-space:nowrap">Company</th>
          <th style="padding:8px 10px;text-align:left;font-weight:600;white-space:nowrap">Contact</th>
          <th style="padding:8px 10px;text-align:left;font-weight:600;white-space:nowrap">Email</th>
          <th style="padding:8px 10px;text-align:left;font-weight:600;white-space:nowrap">Phone</th>
          <th style="padding:8px 10px;text-align:left;font-weight:600;white-space:nowrap">Stage</th>
          <th style="padding:8px 10px;text-align:left;font-weight:600;white-space:nowrap">Location</th>
          <th style="padding:8px 10px;text-align:left;font-weight:600;white-space:nowrap">Activities</th>
          <th style="padding:8px 10px;text-align:left;font-weight:600;white-space:nowrap">Created</th>
          ${state.pipeline==='acquisition'?'<th style="padding:8px 10px;text-align:left;font-weight:600;white-space:nowrap">Owner</th>':''}
        </tr></thead><tbody>`;
  if(!deals.length){
    h+=`<tr><td colspan="${state.pipeline==='acquisition'?9:8}" style="padding:20px;text-align:center;color:var(--text-muted)">No deals</td></tr>`;
  }
  for(const d of deals){
    const badge=getActivityBadge(d.id);
    const stg=stages.find(s=>s.id===(isClient()?d.clientStage:d.stage));
    const stgColor=stg?stg.color:'#6b7280';
    const created=d.createdDate?new Date(d.createdDate).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';
    h+=`<tr style="border-bottom:1px solid var(--border);cursor:pointer" onclick="openDeal('${esc(d.id)}')">
      <td style="padding:8px 10px;font-weight:500">${esc(d.company||d.email||'')}</td>
      <td style="padding:8px 10px">${esc(d.contact||'')}</td>
      <td style="padding:8px 10px;color:var(--text-muted)">${esc(d.email||'')}</td>
      <td style="padding:8px 10px">${esc(d.phone||'')}</td>
      <td style="padding:8px 10px"><span style="padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:${stgColor}18;color:${stgColor}">${esc(isClient()?(d.clientStage||''):d.stage||'')}</span></td>
      <td style="padding:8px 10px;color:var(--text-muted)">${esc(d.location||'')}</td>
      <td style="padding:8px 10px">${badge?`<span style="display:inline-flex;align-items:center;gap:3px"><span style="width:7px;height:7px;border-radius:50%;background:${badge.color};display:inline-block"></span><span style="color:${badge.color};font-weight:600;font-size:11px">${badge.count} ${badge.label}</span></span>`:''}</td>
      <td style="padding:8px 10px;color:var(--text-muted);white-space:nowrap">${created}</td>
      ${state.pipeline==='acquisition'?`<td style="padding:8px 10px">${(()=>{ const ow=getOwnerForDeal(d); return ow?`<span class="owner-tag ${ow.cls}">${esc(ow.label)}</span>`:''; })()}</td>`:''}
    </tr>`;
  }
  h+=`</tbody></table></div></div>`;
  return h;
}

// ─── refreshModal ───
export function refreshModal(forceFullRebuild){
  if(!state.selectedDeal) return;
  const deal=state.selectedDeal;

  // Try targeted update first — only replace the activities container
  const actContainer=document.getElementById('activities-container');
  if(actContainer && !forceFullRebuild){
    // Build just the activities HTML by rendering full modal and extracting it
    const fresh=renderDealModal(deal);
    const tmp=document.createElement('div');
    tmp.innerHTML=fresh;
    const newAct=tmp.querySelector('#activities-container');
    if(newAct) actContainer.innerHTML=newAct.innerHTML;

    // Also update upcoming meetings if present
    const meetContainer=document.getElementById('upcoming-meetings-container');
    const newMeet=tmp.querySelector('#upcoming-meetings-container');
    if(meetContainer && newMeet) meetContainer.innerHTML=newMeet.innerHTML;
    return;
  }

  // Fallback: full modal rebuild (e.g. first open)
  const overlay=document.querySelector('.modal-overlay');
  if(overlay){
    const modal=overlay.querySelector('.modal');
    const savedScroll=modal?modal.scrollTop:0;
    const fresh=renderDealModal(deal);
    const tmp=document.createElement('div');
    tmp.innerHTML=fresh;
    const newOverlay=tmp.firstElementChild;
    if(newOverlay) overlay.innerHTML=newOverlay.innerHTML;
    const newModal=overlay.querySelector('.modal');
    if(newModal){
      newModal.scrollTop=savedScroll;
      // Restore scroll multiple times to counteract Leaflet map init reflows
      requestAnimationFrame(()=>{ newModal.scrollTop=savedScroll; });
      setTimeout(()=>{ newModal.scrollTop=savedScroll; }, 80);
      setTimeout(()=>{ newModal.scrollTop=savedScroll; }, 200);
      setTimeout(()=>{ newModal.scrollTop=savedScroll; }, 500);
      setTimeout(()=>{ newModal.scrollTop=savedScroll; }, 1000);
    }
  } else {
    render();
  }
}

function pipelineTabsHtml(){
  return getVisiblePipelinesWithArchive().map(p=>`<button class="topbar-tab ${state.pipeline===p.id?'active':''}" onclick="switchPipeline('${p.id}')">${p.label}</button>`).join('');
}

// ─── render ───
export function render(){
  try{
  const app=document.getElementById("app");
  // Save scroll position before destroying DOM
  const board=document.querySelector('.board');
  if(board) setSavedScrollLeft(board.scrollLeft);

  // ─── Loading Screen ───
  if(!state.synced && !state.loadFailed){
    app.innerHTML=`<div class="loading-screen"><div class="loading-logo"><span>T</span></div><div class="loading-text">Loading your deals...</div><div class="loading-spinner"></div></div>`;
    return;
  }

  // ─── Error Screen ───
  if(state.loadFailed){
    app.innerHTML=`<div class="loading-screen"><div class="loading-logo" style="opacity:0.5"><span>T</span></div><div class="loading-text" style="color:#ef4444">Failed to load CRM</div><div style="font-size:12px;color:#6b7280;max-width:400px;text-align:center;margin-top:8px">${esc(state.loadError||'Unknown error')}</div><button onclick="location.reload()" style="margin-top:16px;padding:8px 20px;background:var(--purple);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px">Retry</button></div>`;
    return;
  }

  // ─── Nurture Tab ───
  if(state.pipeline==='nurture'){
    if(!state.rerunQueue.length && !state.rerunLoading){
      loadNurtureData();
    }
    let html=`
    <div class="topbar">
      <div style="display:flex;align-items:center;">
        <div class="topbar-tabs">
          ${pipelineTabsHtml()}
        </div>
      </div>
      <div class="topbar-right">
        ${renderUserMenu()}
      </div>
    </div>`;
    html += renderNurtureTab();
    if(state._showReactivateModal) html += renderReactivateModal(state._reactivateNurtureId, state._reactivateDealId);
    if(state._showSnoozeModal) html += renderSnoozeModal(state._snoozeNurtureId, state._snoozeDealId);
    if(state._nurtureEntryDealId) html += renderNurtureEntryModal(state._nurtureEntryDealId);
    app.innerHTML = html;
    return;
  }

  // ─── Dashboard Tab ───
  if(state.pipeline==='dashboard'){
    let html=`
    <div class="topbar">
      <div style="display:flex;align-items:center;">
        <div class="topbar-tabs">
          ${pipelineTabsHtml()}
        </div>
      </div>
      <div class="topbar-right">
        <button class="btn btn-ghost" onclick="syncFromSheet()" style="display:inline-flex;align-items:center;gap:4px">${svgIcon('refresh-cw',12)} Sync</button>
        ${renderUserMenu()}
      </div>
    </div>`;
    html+=renderDashboard();
    app.innerHTML=html;
    return;
  }


  const stages=getStages();
  const deals=getPipelineDeals();
  const totalValue=deals.reduce((s,d)=>s+(Number(d.value)||0),0);
  const totalDeals=deals.length;

  let html=`
  <div class="topbar">
    <div style="display:flex;align-items:center;">
      <div class="topbar-tabs">
        ${pipelineTabsHtml()}
      </div>
    </div>
    <div class="topbar-right">
      ${isAdmin()||isEmployee()?`<div class="search-wrapper">
        <input type="text" class="search-input" id="search-input" placeholder="Search all deals..." value="${esc(state.searchQuery)}"
          oninput="globalSearch(this.value)" onfocus="if(this.value.length>=1)globalSearch(this.value)">
        ${state.searchQuery?'<span class="search-clear" onclick="clearSearch()">×</span>':''}
        ${state.searchResults!==null?`<div class="search-dropdown">
          ${state.searchResults.length===0?'<div class="search-empty">No deals found</div>':''}
          ${state.searchResults.map(d=>`
            <div class="search-result-item" onmousedown="event.preventDefault();clearSearch();openDeal('${d.id}')">
              <div class="search-result-main">
                <span class="search-result-name">${esc(d.company||d.contact||'Unknown')}</span>
                <span class="search-result-stage">${esc(d.stage||'')}</span>
              </div>
              <div class="search-result-meta">
                ${d.contact&&d.contact!==d.company?`<span>${esc(d.contact)}</span>`:''}
                ${d.email?`<span>${esc(d.email)}</span>`:''}
                ${d.phone?`<span>${esc(d.phone)}</span>`:''}
              </div>
            </div>`).join('')}
        </div>`:''}
      </div>`:''/* end search wrapper */}
      <span class="topbar-stat">${state.loadFailed?'⚠️ Offline (test data)':state.synced?'✓ Connected':'Connecting...'}${state.synced?' · ':' '}${totalDeals} deal${totalDeals!==1?'s':''}${state.syncing?' ↻':''}</span>
      ${isAdmin()||isEmployee()?`<button class="btn btn-ghost" onclick="syncFromSheet()" style="display:inline-flex;align-items:center;gap:4px">${svgIcon('refresh-cw',12)} Sync</button>`:''}
      ${isAdmin()||isEmployee()?`<button class="btn btn-ghost" onclick="toggleViewMode()" title="Toggle board/list view" style="display:inline-flex;align-items:center;gap:4px">${state.viewMode==='board'?svgIcon('list',12)+' List':svgIcon('grid',12)+' Board'}</button>`:''}
      ${isAdmin()||isEmployee()?`<button class="btn ${state.bulkMode?'btn-primary':'btn-ghost'}" onclick="toggleBulkMode()" title="Bulk select" style="display:inline-flex;align-items:center;gap:4px">${state.bulkMode?svgIcon('check-square',12)+' Bulk Mode':svgIcon('square',12)+' Bulk'}</button>`:''}
      <button class="btn btn-primary" onclick="openNewDeal()">+ ${isClient()?'Lead':'Deal'}</button>
      ${isClient()?`<button class="btn btn-ghost" onclick="openClientArchive()" title="View archived leads">${svgIcon('archive',12)} Archive${clientArchivedDeals.length?' ('+clientArchivedDeals.length+')':''}</button>`:''}
      ${isEmployee()||isAdmin()?`<button class="btn ${state.showEmployeeArchive?'btn-primary':'btn-ghost'}" data-action="toggleEmployeeArchive" title="View archived leads">${svgIcon('archive',12)} Archive</button>`:''}
      ${isAdmin()?`<button class="btn btn-ghost" onclick="openSettings()" title="Settings" style="display:inline-flex;align-items:center;gap:4px;padding:6px 10px">${svgIcon('settings',12)}</button>`:''}
      ${isClient()?`<button class="btn btn-ghost" onclick="openClientStageSettings()" title="Edit stages" style="display:inline-flex;align-items:center;gap:4px;padding:6px 10px">${svgIcon('settings',12)}</button>`:''}
      ${renderUserMenu()}
    </div>
  </div>
  ${state.pipeline==='nurture'?'':''}
  ${renderOverdueBanner()}
  ${state.pipeline==='acquisition' ? renderDueTodayBanner() : ''}
  ${renderBookedMeetingsBanner()}`;

  // ─── Acquisition Owner Filter Dropdown ───
  if(state.pipeline==='acquisition' && (isAdmin()||isEmployee())){
    const owners = [...new Set(Object.values(state.campaignAssignments))].filter(Boolean);
    if(owners.length > 0){
      const hasFilter = state.acquisitionFilter !== '';
      const filterLabel = hasFilter ? state.acquisitionFilter : 'All';
      html+=`<div style="padding:0 20px;margin-bottom:4px">
        <div class="acq-filter-wrap">
          <button class="acq-filter-toggle ${hasFilter?'has-filter':''}" onclick="event.stopPropagation();state.showAcqFilterDropdown=!state.showAcqFilterDropdown;render()">
            Filter: ${esc(filterLabel)} ▾
          </button>
          ${state.showAcqFilterDropdown?`<div class="acq-filter-dropdown" onclick="event.stopPropagation()">
            <div class="acq-filter-option ${!hasFilter?'selected':''}" onclick="state.acquisitionFilter='';state.showAcqFilterDropdown=false;render()">
              ${!hasFilter?'✓':'\u2003'} All
            </div>
            ${owners.map(o => `<div class="acq-filter-option ${state.acquisitionFilter===o?'selected':''}" onclick="state.acquisitionFilter='${esc(o)}';state.showAcqFilterDropdown=false;render()">
              ${state.acquisitionFilter===o?'✓':'\u2003'} ${esc(o)}
            </div>`).join('')}
          </div>`:''}
        </div>
      </div>`;
    }
  }

  // ─── Employee/Admin Archive View ───
  if((isEmployee()||isAdmin()) && state.showEmployeeArchive){
    // If archive not loaded yet (edge case), trigger background load (silent to avoid recursive render)
    if(!state.archiveLoaded){ loadArchive(true); }
    // Filter archive by current pipeline tab
    const archivePipeline = state.pipeline === 'acquisition' ? 'acquisition' : 'client';
    let empArchive = state.archiveData.filter(d => (d.pipeline||'').toLowerCase() === archivePipeline);
    // Apply filters
    if(state.archiveFilterClient) empArchive=empArchive.filter(d=>(d.clientName||d.stage||'').trim().toLowerCase()===state.archiveFilterClient.trim().toLowerCase());
    if(state.archiveFilterStatus) empArchive=empArchive.filter(d=>(d.archiveStatus||'')===state.archiveFilterStatus);
    const archQ = (state.archiveSearch||'').toLowerCase().trim();
    if(archQ){
      empArchive = empArchive.filter(d =>
        (d.company||'').toLowerCase().includes(archQ) ||
        (d.contact||'').toLowerCase().includes(archQ) ||
        (d.email||'').toLowerCase().includes(archQ)
      );
    }
    if(state.archiveSortDir==='oldest') empArchive.sort((a,b)=>(a.archivedAt||'').localeCompare(b.archivedAt||''));
    else empArchive.sort((a,b)=>(b.archivedAt||'').localeCompare(a.archivedAt||''));
    // Build client list for this pipeline's archive
    const empArchiveClients=[...new Set(state.archiveData.filter(d=>(d.pipeline||'').toLowerCase()===archivePipeline).map(d=>(d.clientName||d.stage||'').trim()).filter(Boolean))].sort();
    html+=`<div style="padding:16px 20px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
        <button class="btn btn-ghost" data-action="archiveBackToBoard" style="font-size:13px;padding:5px 12px;display:flex;align-items:center;gap:4px">\u2190 Back to Board</button>
        <span style="font-size:14px;font-weight:600">${state.pipeline==='acquisition'?'Archived Acquisition Deals':'Archived Client Leads'}</span>
        <span style="font-size:12px;color:var(--text-muted)">${empArchive.length} result${empArchive.length!==1?'s':''}</span>
        <button class="btn btn-ghost" data-action="archiveRefresh" style="font-size:11px;padding:3px 10px;display:inline-flex;align-items:center;gap:4px">${svgIcon('refresh-cw',12)} Refresh</button>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
        ${archivePipeline==='client'?`<select data-action="archiveFilterClientSelect" style="padding:5px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
          <option value="">All Clients</option>
          ${empArchiveClients.map(c=>`<option value="${esc(c)}" ${state.archiveFilterClient===c?'selected':''}>${esc(c)}</option>`).join('')}
        </select>`:''}
        <select data-action="archiveFilterStatusSelect" style="padding:5px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
          <option value="">All Statuses</option>
          <option value="Deleted/Lost" ${state.archiveFilterStatus==='Deleted/Lost'?'selected':''}>Deleted / Lost</option>
          <option value="Closed Won" ${state.archiveFilterStatus==='Closed Won'?'selected':''}>Closed Won</option>
          <option value="Passed Off" ${state.archiveFilterStatus==='Passed Off'?'selected':''}>Passed Off</option>
        </select>
        <select data-action="archiveSortSelect" style="padding:5px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
          <option value="newest" ${state.archiveSortDir==='newest'?'selected':''}>Newest First</option>
          <option value="oldest" ${state.archiveSortDir==='oldest'?'selected':''}>Oldest First</option>
        </select>
        <input type="text" id="archive-search-input" placeholder="Search..." value="${esc(state.archiveSearch||'')}" data-action="archiveSearchInput" style="margin-left:auto;padding:5px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);width:200px;background:var(--card)">
      </div>
      <div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px;background:var(--card)">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:#f9fafb;border-bottom:2px solid var(--border)">
            <th style="padding:8px 10px;text-align:left;font-weight:600">Company</th>
            <th style="padding:8px 10px;text-align:left;font-weight:600">Contact</th>
            <th style="padding:8px 10px;text-align:left;font-weight:600">Email</th>
            <th style="padding:8px 10px;text-align:left;font-weight:600">${state.pipeline==='acquisition'?'Stage':'Client'}</th>
            <th style="padding:8px 10px;text-align:left;font-weight:600">Status</th>
            <th style="padding:8px 10px;text-align:left;font-weight:600">Archived</th>
            <th style="padding:8px 10px;text-align:left;font-weight:600"></th>
          </tr></thead><tbody>`;
    if(!empArchive.length){
      html+=`<tr><td colspan="7" style="padding:20px;text-align:center;color:var(--text-muted)">${state.archiveLoaded?'No archived leads':'Loading...'}</td></tr>`;
    }
    for(const d of empArchive){
      const stColor=d.archiveStatus==='Closed Won'?'#22c55e':d.archiveStatus==='Passed Off'?'#f59e0b':'#ef4444';
      const stBg=d.archiveStatus==='Closed Won'?'#f0fdf4':d.archiveStatus==='Passed Off'?'#fffbeb':'#fef2f2';
      const dateStr=d.archivedAt?new Date(d.archivedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'}):'';
      html+=`<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:8px 10px;font-weight:500">${esc(d.company||'')}</td>
        <td style="padding:8px 10px">${esc(d.contact||'')}</td>
        <td style="padding:8px 10px;color:var(--text-muted)">${esc(d.email||'')}</td>
        <td style="padding:8px 10px">${esc(d.clientName||d.stage||'')}</td>
        <td style="padding:8px 10px"><select data-action="updateArchiveStatus" data-id="${esc(d.id)}" style="padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600;background:${stBg};color:${stColor};border:1px solid ${stColor}33;font-family:var(--font);cursor:pointer">
          <option value="Deleted/Lost" ${d.archiveStatus==='Deleted/Lost'?'selected':''}>Deleted/Lost</option>
          <option value="Closed Won" ${d.archiveStatus==='Closed Won'?'selected':''}>Closed Won</option>
          <option value="Passed Off" ${d.archiveStatus==='Passed Off'?'selected':''}>Passed Off</option>
        </select></td>
        <td style="padding:8px 10px;color:var(--text-muted);white-space:nowrap">${dateStr}</td>
        <td style="padding:8px 10px"><button class="btn btn-ghost" style="font-size:11px;padding:3px 10px;background:#f0fdf4;color:#059669;border:1px solid #a7f3d0" data-action="restoreFromArchive" data-id="${esc(d.id)}">&#8617; Restore</button></td>
      </tr>`;
    }
    html+=`</tbody></table></div></div>`;
    app.innerHTML=html;
    return;
  }

  // ─── List View ───
  if(state.viewMode==='list'){
    html+=renderListView(deals,stages);
  } else {
  // ─── Board View ───
  html+=`<div class="board">`;

  for(const stage of stages){
    // For client portal, filter by clientStage instead of stage
    const sd = isClient() ? deals.filter(d=>d.clientStage===stage.id) : deals.filter(d=>d.stage===stage.id);
    const sv=sd.reduce((s,d)=>s+(Number(d.value)||0),0);
    const stageKey=btoa(unescape(encodeURIComponent(stage.id)));

    html+=`<div class="column" data-stage-key="${stageKey}"
      ondragover="event.preventDefault();event.dataTransfer.dropEffect='move';doDragOver(this)"
      ondragleave="doDragLeave(event,this)"
      ondrop="doDrop('${stageKey}')">
      <div class="col-header" style="border-top-color:${stage.color}${state.pipeline==='client_leads'&&state.clients.some(c=>c.name===stage.label)?';cursor:pointer':''}" ${state.pipeline==='client_leads'&&state.clients.some(c=>c.name===stage.label)?`onclick="openClientInfoPanel(atob('${btoa(unescape(encodeURIComponent(stage.label)))}'))"`:''}>
        <div>
          <div class="col-title">${esc(stage.label)}${(()=>{if(state.pipeline!=='client_leads') return '';const ci=lookupClientInfo(stage.label);return ci&&ci.timeZone?` <span style="font-size:10px;font-weight:600;color:#94a3b8;background:#f1f5f9;padding:1px 6px;border-radius:8px;letter-spacing:.3px;vertical-align:middle">${esc(ci.timeZone)}</span>`:''})()}</div>
          <div class="col-meta">${sd.length} lead${sd.length!==1?'s':''}${(()=>{if(state.pipeline!=='client_leads') return '';const _cl=state.clients.find(c=>c.name===stage.label);if(!_cl) return '';const st=str(_cl.clientStanding).toLowerCase()||'neutral';const standingMap={happy:{color:'#22c55e',bg:'#f0fdf4',label:'Happy',rule:'Pass all tiers'},neutral:{color:'#eab308',bg:'#fefce8',label:'Neutral',rule:'A & B freely, limit C\'s'},unhappy:{color:'#ef4444',bg:'#fef2f2',label:'Unhappy',rule:'A & B only, hold C\'s'}};const s=standingMap[st];if(!s) return '';return ` <span title="${s.rule}" style="font-size:9px;font-weight:700;color:${s.color};background:${s.bg};padding:1px 6px;border-radius:8px;letter-spacing:.3px;vertical-align:middle;cursor:help;border:1px solid ${s.color}33">${s.label}</span>`;})()}</div>
        </div>
        ${(isAdmin()||isEmployee())&&state.pipeline==='client_leads'?`<div style="display:flex;gap:6px;align-items:center">
          ${(()=>{const cl=state.clients.find(c=>c.name===stage.label);return cl&&cl.calendlyUrl?'<button title="Open Calendly for '+esc(stage.label)+'" style="background:none;border:none;color:#818cf8;font-size:14px;cursor:pointer" onclick="event.stopPropagation();openCalendlyEmbed(null,atob(\''+btoa(unescape(encodeURIComponent(cl.calendlyUrl||'')))+'\'),atob(\''+btoa(unescape(encodeURIComponent(stage.label)))+'\'))">'+svgIcon('calendar',14,'#818cf8')+'</button>':'';})()}
          ${isAdmin()?`<button style="background:none;border:none;color:#d1d5db;font-size:14px;cursor:pointer" onclick="event.stopPropagation();if(confirm('Remove this client?'))removeClient(atob('${btoa(unescape(encodeURIComponent(stage.label)))}'))">×</button>`:''}
        </div>`:''}
      </div>
      ${(()=>{
        // Show upcoming appointments for client columns
        if(state.pipeline!=='client_leads' || isClient()) return '';
        const isClientCol=state.clients.some(c=>c.name===stage.label);
        if(!isClientCol) return '';
        const cn=stage.label;
        const todayStr=getToday();
        const appts=(state.appointments||[]).filter(a=>{
          if(a.clientName!==cn) return false;
          if(!a.apptDate||!/^\d{4}-\d{2}-\d{2}$/.test(a.apptDate)) return false;
          return a.apptDate>=todayStr;
        }).sort((a,b)=>(a.apptDate+(a.apptTime||'')).localeCompare(b.apptDate+(b.apptTime||'')));
        let ah='<div class="col-appts" style="padding:6px 8px;margin:0 0 2px 0">';
        if(appts.length){
          ah+=appts.map(a=>{
            const isToday=a.apptDate===todayStr;
            // Safe date/time formatting — never show "Invalid Date"
            let dateStr='', timeStr='';
            try {
              const time=a.apptTime&&/^\d{2}:\d{2}$/.test(a.apptTime)?a.apptTime:'12:00';
              const dt=new Date(a.apptDate+'T'+time);
              if(isNaN(dt.getTime())) throw 0;
              dateStr=isToday?'Today':dt.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
              if(a.apptTime&&/^\d{2}:\d{2}$/.test(a.apptTime)) timeStr=dt.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
            } catch(e) {
              dateStr=a.apptDate||'';
              timeStr=a.apptTime||'';
            }
            const addrText=str(a.address||'').trim();
            return '<div style="font-size:11px;margin:2px 0">'
              +'<div style="padding:3px 4px;background:'+(isToday?'#dbeafe':'#f0fdf4')+';border-radius:4px;display:flex;justify-content:space-between;align-items:center;gap:4px;cursor:pointer" onclick="event.stopPropagation();this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'block\':\'none\'">'
              +'<span style="'+(isToday?'font-weight:700;color:#1d4ed8':'color:#166534')+';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1" title="'+esc(a.leadName||'')+'">'+(isToday?'TODAY ':'')+ esc(a.leadName||'Appt')+'</span>'
              +'<span style="font-weight:600;color:'+(isToday?'#1d4ed8':'#166534')+';white-space:nowrap;font-size:10px">'+dateStr+(timeStr?' '+timeStr:'')+'</span>'
              +'<button onclick="event.stopPropagation();removeAppointment(\''+a.id+'\')" style="background:none;border:none;color:#d1d5db;cursor:pointer;font-size:12px;padding:0 2px" title="Remove">&times;</button>'
              +'</div>'
              +'<div style="display:none;padding:4px 6px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;margin-top:2px;font-size:10px;color:#475569">'
              +(addrText?'<div style="margin-bottom:2px">'+esc(addrText)+'</div><a href="https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(addrText)+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:#2563eb;text-decoration:none;font-weight:600">Open in Maps</a>':'<div style="color:#9ca3af">No address saved</div>')
              +'</div>'
              +'</div>';
          }).join('');
        }
        ah+='<button onclick="event.stopPropagation();addManualAppointment(atob(\''+btoa(unescape(encodeURIComponent(cn)))+'\'))" style="width:100%;font-size:10px;color:#9ca3af;background:none;border:1px dashed #d1d5db;border-radius:4px;padding:3px;cursor:pointer;margin-top:3px;font-family:var(--font)">+ Add Appointment</button>';
        ah+='</div>';
        return ah;
      })()}
      <div class="col-body" ondragover="event.preventDefault();event.dataTransfer.dropEffect='move';doDragOver(this.closest('.column'))" ondrop="doDrop('${stageKey}')">`;

    if(sd.length===0){
      html+=`<div class="col-empty" ondragover="event.preventDefault();event.dataTransfer.dropEffect='move';doDragOver(this.closest('.column'))" ondrop="doDrop('${stageKey}')">No leads yet</div>`;
    } else {
      for(const deal of sd){
        const badge=getActivityBadge(deal.id);
        const isBulkSel=state.bulkMode&&state.bulkSelected.has(deal.id);
        html+=`<div class="deal-card${isBulkSel?' bulk-selected':''}${deal.hasNewReply?' has-reply':''}" draggable="${state.bulkMode?'false':'true'}"
          ondragstart="event.dataTransfer.effectAllowed='move';state.dragId='${deal.id}';showDeleteZone()"
          ondragend="clearAllDragOver();hideDeleteZone()"
          ondragover="event.preventDefault();event.dataTransfer.dropEffect='move';doDragOver(this.closest('.column'))"
          ondrop="doDrop('${stageKey}')"
          data-deal-id="${deal.id}"
          onclick="${state.bulkMode?`event.preventDefault();event.stopPropagation();toggleBulkSelect('${deal.id}')`:`openDeal('${deal.id}')`}">
          ${state.bulkMode?`<div class="bulk-check">${isBulkSel?'✓':''}</div>`:''}
          <div class="deal-card-top">
            <div class="deal-company">${deal.hasNewReply?'<span class="reply-indicator" title="New reply received">'+svgIcon('mail',12,'#3b82f6')+'</span>':''}${esc(deal.company||deal.contact||deal.email||"New Deal")}${isRetainerClient(deal)?'<span style="display:inline-block;margin-left:6px;font-size:9px;font-weight:700;background:#dbeafe;color:#1d4ed8;padding:1px 5px;border-radius:3px;vertical-align:middle;white-space:nowrap;letter-spacing:.3px">RETAINER</span>':''}</div>
            ${isClient()?'':`<div class="status-indicator" onclick="event.stopPropagation();toggleBadgeDropdown('${deal.id}')">
              <div class="status-dot" style="background:${badge?badge.color:'#d1d5db'}"></div>
              ${badge?`<span class="status-count" style="color:${badge.color}">${badge.count}</span>`:''}
              ${badge?`<div class="badge-dropdown" id="badge-${deal.id}" style="display:none">
                  <div class="badge-dropdown-title">${badge.label} (${badge.count})</div>
                  ${state.activities.filter(a=>a.dealId===deal.id&&!a.done&&String(a.done)!=="TRUE").map(a=>`
                    <div class="badge-item">
                      <span>${ACTIVITY_ICONS[a.type]||"\u2713"}</span>
                      <span style="flex:1;color:#374151">${esc(a.subject||a.type)}</span>
                      <span style="font-size:10px;color:#9ca3af">${fmtDate(a.dueDate)}</span>
                    </div>`).join("")}
                </div>`:''}
            </div>`}
          </div>
          ${deal.contact?`<div class="deal-detail">${esc(deal.contact)}${deal.jobTitle?' · <span style="color:var(--text-muted)">'+esc(deal.jobTitle)+'</span>':''}</div>`:''}
          ${deal.email?`<div class="deal-detail">${esc(deal.email)}</div>`:''}
          ${deal.linkedinUrl?`<div class="deal-detail"><a href="${esc(deal.linkedinUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:#0a66c2;text-decoration:none;font-size:11px">${svgIcon('external-link',10,'#0a66c2')} LinkedIn</a></div>`:''}
          ${deal.bookedDate&&deal.bookedDate.match(/^\d{4}-\d{2}-\d{2}$/)?`<div class="deal-detail" style="color:#2563eb;font-weight:600">${new Date(deal.bookedDate+'T'+(deal.bookedTime||'00:00')).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}${deal.bookedTime?' @ '+fmtTime12(deal.bookedTime):''}</div>`:''}
          <div class="deal-bottom">
            <span style="display:flex;align-items:center;gap:4px">
              ${(()=>{const sa=serviceAreaResults[deal.id];if(!sa||sa.inArea===undefined)return'';if(sa.inArea===true)return'<span class="sa-badge sa-in" title="In service area">&#10003;</span>';if(sa.inArea===false)return'<span class="sa-badge sa-out" title="Outside service area">&#10007;</span>';return'<span class="sa-badge sa-unknown" title="Service area unknown">?</span>';})()}
              ${leadAgeBadge(deal)}
              ${deal.leadCategory?`<span class="deal-tag">${esc(deal.leadCategory)}</span>`:''}
              ${(()=>{ const ow=getOwnerForDeal(deal); return ow?`<span class="owner-tag ${ow.cls}">${esc(ow.label)}</span>`:''; })()}
            </span>
          </div>
          ${deal.emailBody?`<div class="deal-reply-snippet" title="${esc(stripHtml(deal.emailBody))}">${esc(stripHtml(deal.emailBody).substring(0,80))}${stripHtml(deal.emailBody).length>80?'…':''}</div>`:''}
        </div>`;
      }
    }
    html+=`</div></div>`;
  }

  html+=`</div>`;

  // Drag-to-archive/won zone
  html+=`<div class="delete-zone" id="delete-zone">
    <div class="delete-zone-half delete-zone-lost"
      ondragover="event.preventDefault();event.dataTransfer.dropEffect='move';this.classList.add('drag-hover')"
      ondragleave="this.classList.remove('drag-hover')"
      ondrop="doLostDrop()">${isClient()?'Archive Lead':'Lost / Delete'}</div>
    <div class="delete-zone-half delete-zone-won"
      ondragover="event.preventDefault();event.dataTransfer.dropEffect='move';this.classList.add('drag-hover')"
      ondragleave="this.classList.remove('drag-hover')"
      ondrop="doWonDrop()">${isClient()?'Won / Closed':state.pipeline==='acquisition'?'Won → Upload to Database':'Won → Push to Tracker'}</div>
  </div>`;
  } // end board view

  // Bulk action bar
  if(state.bulkMode && state.bulkSelected.size>0){
    const allStages=[...ACQUISITION_STAGES,...NURTURE_STAGES,...state.clients.map(c=>({id:c.name,label:c.name}))];
    html+=`<div class="bulk-bar">
      <span>${state.bulkSelected.size} selected</span>
      <select id="bulk-move-stage" style="padding:5px 8px;border-radius:6px;font-size:12px;font-family:var(--font);border:1px solid #4b5563;background:#1f2937;color:#fff">
        <option value="">Move to...</option>
        ${allStages.map(s=>`<option value="${esc(s.id)}">${esc(s.label||s.id)}</option>`).join('')}
      </select>
      <button class="bulk-action" onclick="bulkMoveStage()">Move</button>
      <button class="bulk-action" onclick="bulkAddActivity()" style="background:#2563eb">+ Activity</button>
      <button class="bulk-danger" onclick="bulkArchive()">Archive</button>
      <button class="bulk-cancel" onclick="bulkSelectAll()">Select All</button>
      <button class="bulk-cancel" onclick="toggleBulkMode()">✕ Cancel</button>
    </div>`;
  }

  // Modals
  if(state.selectedDeal) html+=renderDealModal(state.selectedDeal);
  if(state.showNew) html+=renderNewDealModal(stages);
  if(state.showAddClient) html+=renderAddClientModal();
  if(state.showActivateClient) html+=renderActivateClientModal();

  // Nurture modals (from banner actions on non-nurture tabs)
  if(state._nurtureEntryDealId && state.pipeline !== 'nurture'){
    html += renderNurtureEntryModal(state._nurtureEntryDealId);
  }
  if(state._showReactivateModal && state.pipeline !== 'nurture'){
    html += renderReactivateModal(state._reactivateNurtureId, state._reactivateDealId);
  }
  if(state._showSnoozeModal && state.pipeline !== 'nurture'){
    html += renderSnoozeModal(state._snoozeNurtureId, state._snoozeDealId);
  }

  app.innerHTML=html;
  // Restore scroll position
  const newBoard=document.querySelector('.board');
  if(newBoard && savedScrollLeft>0) newBoard.scrollLeft=savedScrollLeft;
  app.querySelectorAll('.deal-card[data-deal-id]').forEach(card=>{
    let downTime=0, downX=0, downY=0;
    card.addEventListener('mousedown',function(e){
      downTime=Date.now(); downX=e.clientX; downY=e.clientY;
    });
    card.addEventListener('mouseup',function(e){
      if(state.bulkMode) return; // Bulk mode uses onclick handler instead
      const dt=Date.now()-downTime;
      const dx=Math.abs(e.clientX-downX);
      const dy=Math.abs(e.clientY-downY);
      // Only open if it was a quick tap (< 300ms) with minimal movement (< 5px)
      if(dt<300 && dx<5 && dy<5){
        if(e.target.closest('.status-indicator')||e.target.closest('button'))return;
        openDeal(this.dataset.dealId);
      }
    });
  });
  // Restore search input focus and cursor
  if(state.searchQuery){
    const si=document.getElementById('search-input');
    if(si){si.focus();si.setSelectionRange(si.value.length,si.value.length);}
  }
  if(state.archiveSearch){
    const ai=document.getElementById('archive-search-input');
    if(ai){ai.focus();ai.setSelectionRange(ai.value.length,ai.value.length);}
  }
  }catch(err){console.error('Render error:',err,err.stack);}
}

// ─── Pipeline switching (single source of truth) ───
function switchPipeline(id){
  state.pipeline=id;
  location.hash=id;
  // Ensure nurture sub-tab is valid (board or archive)
  if(state.nurtureSubTab!=='board' && state.nurtureSubTab!=='archive') state.nurtureSubTab='board';
  if(id!=='nurture') state.nurtureSubTab='board';
  render();
}

// ─── Nurture sub-tab switching ───
function switchNurtureTab(tab){
  state.nurtureSubTab=tab;
  if(tab==='archive' && !state.archiveLoaded){
    // Defer archive load to avoid recursive render
    render();
    loadArchive();
  } else {
    render();
  }
}

// ─── Window exposures for inline HTML onclick handlers ───
// state is deferred because app.js re-exports it from state.js,
// and render.js evaluates before app.js finishes (circular import TDZ)
setTimeout(() => { window.state = state; }, 0);
window.render = render;
window.refreshModal = refreshModal;
window.switchPipeline = switchPipeline;
window.switchNurtureTab = switchNurtureTab;
