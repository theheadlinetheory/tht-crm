// ═══════════════════════════════════════════════════════════
// APP — Entry point, state, initApp
// ═══════════════════════════════════════════════════════════
import { REPLY_CHECK_INTERVAL, REPLY_BACKEND_POLL_INTERVAL, DEFAULT_CLIENT_STAGES } from './config.js';
import { render } from './render.js';
import { syncFromSheet, pollReplyStatus, triggerBackendReplyCheck, initialSync, subscribeRealtime } from './api.js';
import { isAdmin, isClient, isEmployee, currentUser, loadCampaignAssignments, listenCampaignAssignments, setupAuthListener, db } from './auth.js';
import { initJustCallDialer } from './dialer.js';
import { esc, svgIcon } from './utils.js';

// ─── State Object (single source of truth) ───
export let state = {
  deals: [],
  activities: [],
  clients: [],
  appointments: [],
  pipeline: (() => { try { const h=location.hash.replace('#',''); if(h==='archive'){location.hash='nurture';return 'nurture';} return ['dashboard','acquisition','client_leads','nurture'].includes(h)?h:'dashboard'; } catch(e){ return 'acquisition'; } })(),
  selectedDeal: null,
  showNew: false,
  showAddClient: false,
  showActivateClient: false,
  activateClientLoading: false,
  unactivatedClients: [],
  activateClientsLoading: false,
  activateSelectedClient: null,
  showSop: false,
  dragId: null,
  overCol: null,
  synced: false,
  syncing: false,
  loadFailed: false,
  searchQuery: "",
  searchResults: null,
  savedSettings: null,
  // Re-Run Queue state
  nurtureSubTab: 'board',
  dashboardTab: 'client_leads',
  dashboardMonth: new Date().toISOString().slice(0,7),
  rerunQueue: [],
  rerunMarketSettings: [],
  rerunLoading: false,
  rerunFilterState: '',
  rerunFilterCity: '',
  rerunFilterStatus: '',
  rerunShowMarketModal: false,
  archiveData: [],
  archiveLoaded: false,
  archiveFilterPipeline: '',
  archiveFilterStatus: '',
  archiveFilterClient: '',
  archiveSortDir: 'newest',
  // Bulk select
  bulkMode: false,
  bulkSelected: new Set(),
  // View mode
  viewMode: 'board',
  // Campaign assignment (acquisition owner split)
  campaignAssignments: {},
  acquisitionFilter: '',
  showAcqFilterDropdown: false,
};

// ─── Mutable counters/sets (exported as objects for cross-module mutation) ───
export const pendingWrites = { value: 0 };
export const failedWriteQueue = [];
export const pendingDealFields = {};

// Restore deleted-ID sets from localStorage
export const deletedDealIds = new Set(JSON.parse(localStorage.getItem('tht_deletedDeals')||'[]'));
export const deletedActivityIds = new Set(JSON.parse(localStorage.getItem('tht_deletedActs')||'[]'));
export const completedActivityIds = new Set(JSON.parse(localStorage.getItem('tht_completedActs')||'[]'));
export const deletedClientIds = new Set();

// Preserve horizontal scroll across renders
export let savedScrollLeft = 0;
export function setSavedScrollLeft(v){ savedScrollLeft = v; }

// Settings state
export let settingsOpen = false;
export function setSettingsOpen(v){ settingsOpen = v; }
export let settingsTab = 'stages';
export function setSettingsTab(v){ settingsTab = v; }
export let clientsSubTab = 'notifications';
export function setClientsSubTab(v){ clientsSubTab = v; }
export let settingsDraft = null;
export function setSettingsDraft(v){ settingsDraft = v; }

// Client portal stages
export let clientPortalStages = null;
export function setClientPortalStages(v){ clientPortalStages = v; }
export let clientArchivedDeals = [];
export function setClientArchivedDeals(v){ clientArchivedDeals = v; }

// Warn user before closing if writes are still in flight
window.addEventListener('beforeunload', e => {
  if(pendingWrites.value > 0 || failedWriteQueue.length > 0){ e.preventDefault(); e.returnValue=''; }
});

// ─── Client Portal Stages (Firestore) ───
export async function loadClientPortalStages(){
  if(!isClient()||!currentUser.clientName) return;
  try {
    const doc = await db.collection('client_settings').doc(currentUser.clientName).get();
    if(doc.exists && doc.data().stages && doc.data().stages.length > 0){
      clientPortalStages = doc.data().stages;
    } else {
      clientPortalStages = [...DEFAULT_CLIENT_STAGES];
      await db.collection('client_settings').doc(currentUser.clientName).set({ stages: clientPortalStages }, { merge: true });
    }
  } catch(e){
    console.warn('Failed to load client stages:', e);
    clientPortalStages = [...DEFAULT_CLIENT_STAGES];
  }
}

export async function saveClientPortalStages(stages){
  if(!currentUser.clientName) return;
  clientPortalStages = stages;
  try {
    await db.collection('client_settings').doc(currentUser.clientName).set({ stages }, { merge: true });
  } catch(e){ console.error('Failed to save client stages:', e); }
}

// ─── Client Archive (soft-delete with restore) ───
export async function loadClientArchive(){
  if(!isClient()||!currentUser.clientName) return;
  const { sbGetArchive, normalizeRow } = await import('./api.js');
  let firestoreArchived = [];
  let sheetArchived = [];
  try {
    const [doc, sheetData] = await Promise.all([
      db.collection('client_settings').doc(currentUser.clientName).get(),
      sbGetArchive()
    ]);
    if(doc.exists && doc.data().archivedDeals){
      firestoreArchived = doc.data().archivedDeals;
    }
    if(Array.isArray(sheetData)){
      sheetArchived = sheetData.map(normalizeRow).filter(d => d.clientName === currentUser.clientName).map(d => ({
        ...d,
        archiveReason: d.archiveStatus === 'Closed Won' ? 'won' : (d.archiveStatus === 'Passed Off' ? 'passed' : 'admin'),
      }));
    }
  } catch(e){ console.warn('Failed to load archive:', e); }
  const seen = new Set();
  clientArchivedDeals = [];
  for(const d of firestoreArchived){ seen.add(d.id); clientArchivedDeals.push(d); }
  for(const d of sheetArchived){ if(!seen.has(d.id)){ clientArchivedDeals.push(d); } }
}

export async function archiveDeal(dealId, reason){
  const deal = state.deals.find(d=>d.id===dealId);
  if(!deal) return;
  const archived = { ...deal, archivedAt: new Date().toISOString(), archiveReason: reason };
  clientArchivedDeals.push(archived);
  try {
    await db.collection('client_settings').doc(currentUser.clientName).set(
      { archivedDeals: clientArchivedDeals }, { merge: true }
    );
  } catch(e){ console.error('Failed to save archive:', e); }
  state.deals = state.deals.filter(d=>d.id!==dealId);
  state.selectedDeal = null;
  render();
}

export async function restoreDeal(dealId){
  const idx = clientArchivedDeals.findIndex(d=>d.id===dealId);
  if(idx===-1) return;
  const deal = clientArchivedDeals.splice(idx, 1)[0];
  const isSheetArchived = deal.archiveReason === 'admin' || deal.archiveReason === 'passed';
  delete deal.archivedAt;
  delete deal.archiveReason;
  if(isSheetArchived){
    const { sbRestoreFromArchive, initialSync } = await import('./api.js');
    pendingWrites.value++;
    try {
      await sbRestoreFromArchive(dealId);
      initialSync();
    } catch(e){ console.error('Failed to restore from sheet archive:', e); }
    finally { pendingWrites.value--; }
  } else {
    if(clientPortalStages && clientPortalStages.length > 0){
      deal.clientStage = clientPortalStages[0].id;
    }
    state.deals.push(deal);
    try {
      await db.collection('client_settings').doc(currentUser.clientName).set(
        { archivedDeals: clientArchivedDeals }, { merge: true }
      );
    } catch(e){ console.error('Failed to update archive:', e); }
  }
  render();
}

// ─── Init ───
let appInitialized=false;
export async function initApp(){
  if(appInitialized) return;
  appInitialized=true;
  // Apply cached settings immediately
  try{
    const { applySettings } = await import('./settings.js');
    const cached=JSON.parse(localStorage.getItem('tht_settings'));
    if(cached) applySettings(cached, true);
  }catch(e){}
  if(isClient()){
    await loadClientPortalStages();
    await loadClientArchive();
  }
  if(isAdmin()||isEmployee()){
    await loadCampaignAssignments();
    listenCampaignAssignments();
  }
  render();
  await initialSync();
  subscribeRealtime();
  if(isAdmin()||isEmployee()){
    setInterval(pollReplyStatus, REPLY_CHECK_INTERVAL);
    triggerBackendReplyCheck();
    setInterval(triggerBackendReplyCheck, REPLY_BACKEND_POLL_INTERVAL);
  }
  if(!isClient()) initJustCallDialer();
  if(state.pipeline==='nurture' && state.nurtureSubTab==='rerun'){
    const { loadRerunData } = await import('./rerun.js');
    loadRerunData();
  }
}

// ─── Client Portal Archive View ───
export function openClientArchive(){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = ()=>overlay.remove();

  let h = `<div class="modal" style="width:520px;max-height:80vh" onclick="event.stopPropagation()">
    <div class="modal-header"><h3>${svgIcon('archive',16)} Archived Leads</h3><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">\u00D7</button></div>
    <div class="modal-body" style="max-height:60vh;overflow-y:auto">`;

  if(clientArchivedDeals.length === 0){
    h += `<div style="text-align:center;padding:30px;color:var(--text-muted)">No archived leads yet.<br><span style="font-size:11px">Drag a lead to "Archive" or "Won" to move it here.</span></div>`;
  } else {
    for(const deal of clientArchivedDeals){
      const reason = deal.archiveReason === 'won' ? 'Won' : deal.archiveReason === 'passed' ? 'Passed Off' : deal.archiveReason === 'admin' ? 'Archived by Admin' : 'Archived';
      const date = deal.archivedAt ? new Date(deal.archivedAt).toLocaleDateString() : '';
      h += `<div style="display:flex;align-items:center;gap:10px;padding:10px;margin-bottom:6px;background:#f9fafb;border:1px solid var(--border);border-radius:8px">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600">${esc(deal.company||deal.contact||'Unknown')}</div>
          <div style="font-size:11px;color:var(--text-muted)">${esc(deal.email||'')} ${deal.phone?'\u00B7 '+esc(deal.phone):''}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${reason} \u00B7 ${date}</div>
        </div>
        <button class="btn btn-primary" style="font-size:11px;padding:5px 12px;flex-shrink:0" onclick="restoreDeal('${deal.id}');this.closest('.modal-overlay').remove()">Restore</button>
      </div>`;
    }
  }
  h += `</div></div>`;
  overlay.innerHTML = h;
  document.body.appendChild(overlay);
}

// ─── Client Stage Settings ───
export function openClientStageSettings(){
  const overlay = document.createElement('div');
  overlay.id = 'client-stage-overlay';
  overlay.className = 'modal-overlay';
  overlay.onclick = ()=>overlay.remove();
  renderClientStageSettingsInner(overlay);
  document.body.appendChild(overlay);
}

function renderClientStageSettingsInner(overlay){
  if(!overlay) overlay = document.getElementById('client-stage-overlay');
  if(!overlay) return;
  const stages = clientPortalStages || DEFAULT_CLIENT_STAGES;
  const colors = ['#059669','#2563eb','#d97706','#059669','#ef4444','#0891b2','#10b981','#dc2626','#15803d','#b45309'];

  let h = `<div class="modal" style="width:420px" onclick="event.stopPropagation()">
    <div class="modal-header"><h3>${svgIcon('settings',16)} Pipeline Stages</h3><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">\u00D7</button></div>
    <div class="modal-body">
      <p style="font-size:11px;color:var(--text-muted);margin-bottom:12px">Customize your pipeline stages. Drag to reorder.</p>
      <div id="client-stages-list">`;

  for(let i=0;i<stages.length;i++){
    h += `<div style="display:flex;align-items:center;gap:8px;padding:8px;margin-bottom:4px;background:#f9fafb;border:1px solid var(--border);border-radius:6px">
      <span style="color:#d1d5db;cursor:grab">\u2807</span>
      <input type="color" value="${stages[i].color}" style="width:24px;height:24px;border:none;cursor:pointer;background:none" onchange="clientPortalStages[${i}].color=this.value">
      <input type="text" value="${esc(stages[i].label)}" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:var(--font)" onchange="clientPortalStages[${i}].label=this.value;clientPortalStages[${i}].id=this.value">
      ${stages.length>1?`<button style="background:none;border:none;color:#d1d5db;cursor:pointer;font-size:16px" onclick="clientPortalStages.splice(${i},1);renderClientStageSettingsInner()">\u00D7</button>`:''}
    </div>`;
  }

  h += `</div>
      <div style="margin-top:8px;display:flex;gap:6px">
        <input type="text" id="new-client-stage-name" placeholder="New stage name" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
        <button class="btn btn-primary" style="font-size:11px" onclick="addClientStage()">+ Add</button>
      </div>
    </div>
    <div class="modal-footer" style="justify-content:flex-end">
      <button class="btn" style="background:#f9fafb;color:#6b7280;border:1px solid #e5e7eb" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="saveClientStagesAndClose()">Save Stages</button>
    </div>
  </div>`;

  overlay.innerHTML = h;
}

export function addClientStage(){
  const input = document.getElementById('new-client-stage-name');
  const name = input.value.trim();
  if(!name) return;
  const colors = ['#059669','#2563eb','#d97706','#059669','#ef4444','#0891b2'];
  clientPortalStages.push({ id: name, label: name, color: colors[clientPortalStages.length % colors.length] });
  input.value = '';
  renderClientStageSettingsInner();
}

export async function saveClientStagesAndClose(){
  await saveClientPortalStages(clientPortalStages);
  const overlay = document.getElementById('client-stage-overlay');
  if(overlay) overlay.remove();
  render();
}


// Expose to inline HTML handlers
window.archiveDeal = archiveDeal;
window.restoreDeal = restoreDeal;
window.openClientArchive = openClientArchive;
window.openClientStageSettings = openClientStageSettings;
window.addClientStage = addClientStage;
window.saveClientStagesAndClose = saveClientStagesAndClose;
window.renderClientStageSettingsInner = renderClientStageSettingsInner;

// ─── Bootstrap ───
setupAuthListener(initApp);
