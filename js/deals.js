// ═══════════════════════════════════════════════════════════
// DEALS — CRUD operations, bulk actions, drag-drop
// ═══════════════════════════════════════════════════════════
import { state, store, pendingWrites, pendingDealFields, deletedDealIds, clientPortalStages } from './app.js';
import { ACQUISITION_STAGES } from './config.js';
import { render } from './render.js';
import { sbCreateDeal, sbUpdateDeal, sbDeleteDeal, sbArchiveDeal, sbRestoreFromArchive, sbCreateActivity, camelToSnake } from './api.js';
import { uid, getToday, str } from './utils.js';
import { isClient, currentUser } from './auth.js';

const TODAY = getToday;

export async function createDeal(form){
  const pip=state.pipeline==="acquisition"?"Acquisition":state.pipeline==="nurture"?"Nurture":"Client";
  const deal={...form,id:uid(),pipeline:pip,flag:"",createdDate:TODAY(),lastUpdated:TODAY()};
  if(isClient() && currentUser.clientName){
    deal.stage = currentUser.clientName;
    deal.pipeline = 'Client';
    deal.clientStage = (clientPortalStages && clientPortalStages.length > 0) ? clientPortalStages[0].id : 'Positive Response';
  }
  store.addDeal(deal);
  await sbCreateDeal(camelToSnake(deal));
}

export async function saveDeal(updated){
  store.updateDeal(updated.id, {...updated, lastUpdated: TODAY()}, {silent: true});
  store.set({selectedDeal: null});
  pendingWrites.value++;
  try { const {id, ...fields} = updated; await sbUpdateDeal(id || updated.id, camelToSnake(fields)); }
  finally { pendingWrites.value--; }
}

export async function deleteDeal(id, archiveStatus, clientName){
  const deal=state.deals.find(d=>d.id===id);
  const status=archiveStatus||'Deleted/Lost';
  const cName=clientName||(deal?deal.stage:'');
  const pipeline=deal?deal.pipeline:'';
  deletedDealIds.add(id);
  localStorage.setItem('tht_deletedDeals',JSON.stringify([...deletedDealIds]));
  store.removeDeal(id, {silent: true});
  store.removeActivitiesForDeal(id, {silent: true});
  store.set({selectedDeal: null});
  pendingWrites.value++;
  try { await sbArchiveDeal(id, JSON.stringify({...deal, archiveStatus:status, pipeline, clientName:cName})); await sbDeleteDeal(id); }
  catch(e){ console.error('Archive failed, falling back to delete:',e); try { await sbDeleteDeal(id); } catch(e2){} }
  finally { pendingWrites.value--; }
}

export async function moveDeal(dealId,newStage){
  const d=state.deals.find(x=>x.id===dealId);
  if(d){d.stage=newStage;d.lastUpdated=TODAY();}
  // Track pending stage so sync doesn't revert it
  if(!pendingDealFields[String(dealId)]) pendingDealFields[String(dealId)]={};
  pendingDealFields[String(dealId)].stage=newStage;
  render();
  pendingWrites.value++;
  try {
    await sbUpdateDeal(dealId, {stage:newStage});
    // Clear pending after successful save
    const pending=pendingDealFields[String(dealId)];
    if(pending && pending.stage===newStage) delete pending.stage;
    if(pending && Object.keys(pending).length===0) delete pendingDealFields[String(dealId)];
  } finally { pendingWrites.value--; }
  if(d && (newStage==='Service Area Taken' || newStage==='Revisit')){
    const { addToRerunQueue } = await import('./rerun.js');
    addToRerunQueue(dealId).catch(e=>console.warn('Re-run queue auto-add failed:',e));
  }
  if(d && (newStage==='Discovery Scheduled' || newStage==='Demo Scheduled') && d.bookedDate && /^\d{4}-\d{2}-\d{2}$/.test(d.bookedDate)){
    const { generateAppointmentSequence } = await import('./activities.js');
    generateAppointmentSequence(d);
  }
}

// ═══════════════════════════════════════════════════════════
// BULK SELECT & ACTIONS
// ═══════════════════════════════════════════════════════════
export function toggleBulkMode(){
  state.bulkMode=!state.bulkMode;
  state.bulkSelected=new Set();
  render();
}

export function toggleBulkSelect(id){
  if(state.bulkSelected.has(id)) state.bulkSelected.delete(id);
  else state.bulkSelected.add(id);
  render();
}

export function bulkSelectAll(){
  const pipMap={'acquisition':'Acquisition','client_leads':'Client','nurture':'Nurture'};
  const pip=pipMap[state.pipeline]||null;
  const visible=pip?state.deals.filter(d=>d.pipeline===pip):state.deals;
  if(state.bulkSelected.size===visible.length){ state.bulkSelected=new Set(); }
  else { state.bulkSelected=new Set(visible.map(d=>d.id)); }
  render();
}

export async function bulkMoveStage(){
  const sel=document.getElementById('bulk-move-stage');
  const stage=sel?sel.value:'';
  if(!stage){ alert('Select a stage to move to.'); return; }
  const ids=[...state.bulkSelected];
  if(!confirm('Move '+ids.length+' deal'+(ids.length!==1?'s':'')+' to "'+stage+'"?')) return;
  for(const id of ids){
    const d=state.deals.find(x=>x.id===id);
    if(d){ d.stage=stage; d.lastUpdated=TODAY(); }
  }
  state.bulkSelected=new Set();
  state.bulkMode=false;
  render();
  pendingWrites.value++;
  try{
    for(const id of ids){ await sbUpdateDeal(id, {stage}); }
  }finally{ pendingWrites.value--; }
}

export async function bulkAddActivity(){
  const type=prompt('Activity type (Call, Email, Text, Task, Meeting):','Call');
  if(!type) return;
  const subject=prompt('Subject:',type);
  if(subject===null) return;
  const dueDate=prompt('Due date (YYYY-MM-DD):',TODAY());
  if(!dueDate||!dueDate.match(/^\d{4}-\d{2}-\d{2}$/)) return;
  const ids=[...state.bulkSelected];
  if(!confirm('Add "'+subject+'" activity to '+ids.length+' deal'+(ids.length!==1?'s':'')+'?')) return;
  const newActs=[];
  for(const dealId of ids){
    const a={id:uid(),dealId,type,subject,dueDate,done:false,dayLabel:'',scheduledTime:null,createdDate:new Date().toISOString(),completedAt:null};
    store.addActivity(a, {silent: true});
    newActs.push(a);
  }
  store.set({bulkSelected: new Set(), bulkMode: false});
  pendingWrites.value++;
  try{
    for(const a of newActs){ await sbCreateActivity(camelToSnake(a)); }
  }finally{ pendingWrites.value--; }
}

export async function bulkArchive(){
  const ids=[...state.bulkSelected];
  if(!confirm('Archive '+ids.length+' deal'+(ids.length!==1?'s':'')+'? They can be restored later.')) return;
  for(const id of ids){
    deletedDealIds.add(String(id));
    store.removeDeal(id, {silent: true});
    store.removeActivitiesForDeal(id, {silent: true});
  }
  localStorage.setItem('tht_deletedDeals',JSON.stringify([...deletedDealIds]));
  store.set({bulkSelected: new Set(), bulkMode: false});
  pendingWrites.value++;
  try{
    for(const id of ids){ const d=state.deals.find(x=>x.id===id); await sbArchiveDeal(id, JSON.stringify({...d, archiveStatus:'Deleted/Lost'})); await sbDeleteDeal(id); }
  }finally{ pendingWrites.value--; }
}

export async function bulkRestoreFromArchive(){
  const ids=[...state.bulkSelected];
  if(!confirm('Restore '+ids.length+' deal'+(ids.length!==1?'s':'')+' from archive?')) return;
  state.bulkSelected=new Set();
  state.bulkMode=false;
  pendingWrites.value++;
  try{
    for(const id of ids){
      await sbRestoreFromArchive(id);
    }
    const { initialSync } = await import('./api.js');
    initialSync();
  }finally{ pendingWrites.value--; }
}

// ─── Drag & Drop ───
export function doDragOver(colEl){
  colEl.classList.add('drag-over');
}

export function doDragLeave(evt,colEl){
  if(!colEl.contains(evt.relatedTarget)){
    colEl.classList.remove('drag-over');
  }
}

export function clearAllDragOver(){
  document.querySelectorAll('.drag-over').forEach(el=>el.classList.remove('drag-over'));
}

export function doDrop(stageKey){
  clearAllDragOver();
  if(!state.dragId) return;
  const stage = decodeURIComponent(escape(atob(stageKey)));
  moveDeal(state.dragId, stage);
  state.dragId=null;
}

export async function moveClientDeal(dealId, newClientStage){
  const d=state.deals.find(x=>x.id===dealId);
  if(!d) return;
  d.clientStage=newClientStage;
  d.lastUpdated=TODAY();
  render();
  pendingWrites.value++;
  try { await sbUpdateDeal(dealId, camelToSnake({clientStage:newClientStage})); }
  finally { pendingWrites.value--; }
}

// Expose to inline HTML handlers
window.toggleBulkMode = toggleBulkMode;
window.toggleBulkSelect = toggleBulkSelect;
window.bulkSelectAll = bulkSelectAll;
window.bulkMoveStage = bulkMoveStage;
window.bulkAddActivity = bulkAddActivity;
window.bulkArchive = bulkArchive;
window.bulkRestoreFromArchive = bulkRestoreFromArchive;
window.doDragOver = doDragOver;
window.doDragLeave = doDragLeave;
window.doDrop = doDrop;
window.clearAllDragOver = clearAllDragOver;
window.moveClientDeal = moveClientDeal;
window.moveDeal = moveDeal;
window.deleteDeal = deleteDeal;
