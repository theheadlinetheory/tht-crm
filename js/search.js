// ═══════════════════════════════════════════════════════════
// SEARCH — Global search, activity badges, pipeline helpers
// ═══════════════════════════════════════════════════════════
import { state, clientPortalStages } from './app.js';
import { ACQUISITION_STAGES, NURTURE_STAGES, CLIENT_PALETTE, ALL_PIPELINES } from './config.js';
import { render } from './render.js';
import { getToday } from './utils.js';
import { isClient, isEmployee, currentUser, getOwnerNameForDeal } from './auth.js';
import { lookupClientInfo } from './client-info.js';

export function globalSearch(q){
  state.searchQuery=q;
  if(!q||q.length<1){state.searchResults=null;render();return;}
  const lq=q.toLowerCase().trim();
  const digits=q.replace(/[^0-9]/g,'');
  const isDigitQuery=digits.length>=2 && digits.length===q.replace(/[\s\-\(\)\+]/g,'').length;
  state.searchResults=state.deals.filter(d=>{
    if(isDigitQuery){
      const ph=(d.phone||'').replace(/[^0-9]/g,'');
      if(ph.includes(digits))return true;
      if(ph.length>1 && ph.startsWith('1') && ph.slice(1).includes(digits))return true;
      return false;
    }
    if((d.company||'').toLowerCase().includes(lq))return true;
    if((d.contact||'').toLowerCase().includes(lq))return true;
    if((d.email||'').toLowerCase().includes(lq))return true;
    if((d.website||'').toLowerCase().includes(lq))return true;
    if((d.notes||'').toLowerCase().includes(lq))return true;
    return false;
  }).slice(0,15);
  render();
}

export function clearSearch(){state.searchQuery="";state.searchResults=null;render();}

export function getActivityBadge(dealId){
  const pending=state.activities.filter(a=>a.dealId===dealId && !a.done && String(a.done)!=="TRUE");
  if(!pending.length) return null;
  const today=getToday();
  const dateOnly=d=>(d||'').slice(0,10);
  const hasOverdue=pending.some(a=>dateOnly(a.dueDate)<today);
  const hasDueToday=pending.some(a=>dateOnly(a.dueDate)===today);
  if(hasOverdue) return {color:"#ef4444",count:pending.length,label:"overdue"};
  if(hasDueToday) return {color:"#22c55e",count:pending.length,label:"due today"};
  return {color:"#9ca3af",count:pending.length,label:"upcoming"};
}

// ─── Get stages for current pipeline ───
export function getStages(){
  if(state.pipeline==="acquisition") return ACQUISITION_STAGES;
  if(state.pipeline==="nurture") return NURTURE_STAGES;
  if(isClient() && clientPortalStages){
    return clientPortalStages;
  }
  const TZ_ORDER={'EST':0,'CST':1,'MST':2,'PST':3};
  const sorted=[...state.clients].sort((a,b)=>{
    const aInfo=lookupClientInfo(a.name);
    const bInfo=lookupClientInfo(b.name);
    const aOrd=aInfo&&aInfo.timeZone?TZ_ORDER[aInfo.timeZone.toUpperCase()]??9:9;
    const bOrd=bInfo&&bInfo.timeZone?TZ_ORDER[bInfo.timeZone.toUpperCase()]??9:9;
    return aOrd-bOrd;
  });
  const clientCols=sorted.map((c,i)=>({id:c.name,label:c.name,color:c.color||CLIENT_PALETTE[i%CLIENT_PALETTE.length]}));
  return [{id:"Client Not Distributed",label:"Not Distributed",color:"#6b7280"},...clientCols];
}

// ─── Filter deals for pipeline ───
export function getPipelineDeals(){
  if(state.pipeline==="acquisition"){
    let acqDeals = state.deals.filter(d=>ACQUISITION_STAGES.some(s=>s.id===d.stage));
    if(state.acquisitionFilter){
      acqDeals = acqDeals.filter(d => getOwnerNameForDeal(d) === state.acquisitionFilter);
    }
    return acqDeals;
  }
  if(state.pipeline==="nurture") return state.deals.filter(d=>NURTURE_STAGES.some(s=>s.id===d.stage));

  if(isClient() && currentUser && currentUser.clientName && clientPortalStages){
    const stageIds = clientPortalStages.map(s=>s.id);
    return state.deals.filter(d => {
      if(d.stage !== currentUser.clientName) return false;
      if(!d.clientStage || !stageIds.includes(d.clientStage)){
        d.clientStage = stageIds[0] || 'Positive Response';
      }
      return true;
    });
  }

  const clientNames=state.clients.map(c=>c.name);
  return state.deals.filter(d=>d.stage==="Client Not Distributed"||clientNames.includes(d.stage));
}

// ─── Visible Pipelines ───
export function getVisiblePipelines(){
  if(isClient()) return ALL_PIPELINES.filter(p => p.id === 'client_leads');
  if(isEmployee()) return ALL_PIPELINES.filter(p => p.id === 'client_leads' || p.id === 'acquisition' || p.id === 'dashboard');
  return ALL_PIPELINES.filter(p => p.id !== 'archive');
}

export function getVisiblePipelinesWithArchive(){
  if(isClient()) return ALL_PIPELINES.filter(p => p.id === 'client_leads');
  if(isEmployee()) return ALL_PIPELINES.filter(p => p.id === 'client_leads' || p.id === 'acquisition' || p.id === 'dashboard');
  return ALL_PIPELINES;
}

// Expose to inline HTML handlers
window.globalSearch = globalSearch;
window.clearSearch = clearSearch;
