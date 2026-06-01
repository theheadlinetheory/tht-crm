// ═══════════════════════════════════════════════════════════
// ACTIVITIES — Activity CRUD, SOP sequences, overdue tracking
// ═══════════════════════════════════════════════════════════
import { state, store, pendingWrites, completedActivityIds, deletedActivityIds, inFlightActivityIds } from './app.js?v=20260531c';
import { SOP_DAYS, CLIENT_SOP_DAYS, PRE_CALL_SEQUENCE, NO_SHOW_SEQUENCE } from './config.js?v=20260531c';
import { render, refreshModal } from './render.js?v=20260531c';
import { sbCreateActivity, sbUpdateActivity, sbDeleteActivity, camelToSnake } from './api.js?v=20260531c';
import { uid, getToday, isValidDate, fmtTime12 } from './utils.js?v=20260531c';
import { findClientForDeal } from './client-info.js?v=20260531c';

async function retryActivityWrite(fn, label, maxRetries=3){
  pendingWrites.value++;
  for(let attempt=0;attempt<=maxRetries;attempt++){
    try{
      await fn();
      pendingWrites.value--;
      return;
    }catch(e){
      console.error(`${label} failed (attempt ${attempt+1}):`,e);
      if(attempt<maxRetries) await new Promise(r=>setTimeout(r,1000*(attempt+1)));
    }
  }
  pendingWrites.value--;
  console.error(`${label} failed after ${maxRetries+1} attempts`);
}

const WAL_KEY='tht_pendingActivities';
function savePendingActivity(a){
  try{
    const pending=JSON.parse(localStorage.getItem(WAL_KEY)||'[]');
    if(!pending.find(p=>p.id===a.id)) pending.push(a);
    localStorage.setItem(WAL_KEY,JSON.stringify(pending));
  }catch(e){}
}
function removePendingActivity(id){
  try{
    const pending=JSON.parse(localStorage.getItem(WAL_KEY)||'[]');
    localStorage.setItem(WAL_KEY,JSON.stringify(pending.filter(p=>p.id!==id)));
  }catch(e){}
}
export function replayPendingActivities(){
  try{
    const pending=JSON.parse(localStorage.getItem(WAL_KEY)||'[]');
    if(!pending.length) return;
    console.log(`Replaying ${pending.length} pending activities from WAL`);
    for(const a of pending){
      if(!state.activities.find(x=>x.id===a.id)){
        inFlightActivityIds.add(String(a.id));
        store.addActivity(a,{silent:true});
      }
      persistActivity(a);
    }
  }catch(e){ console.error('WAL replay failed:',e); }
}

export function getSopDays(deal){
  if(!deal) return SOP_DAYS;
  const client = findClientForDeal(deal);
  return client ? CLIENT_SOP_DAYS : SOP_DAYS;
}

export function addActivity(dealId,act){
  const a={id:uid(),dealId,...act,done:false,createdDate:new Date().toISOString(),completedAt:null};
  savePendingActivity(a);
  inFlightActivityIds.add(String(a.id));
  store.addActivity(a, {silent: true});
  if(state.selectedDeal && state.selectedDeal.id===dealId) refreshModal();
  else render();
  persistActivity(a);
}

async function persistActivity(a, attempt=0){
  const maxRetries=4;
  pendingWrites.value++;
  try{
    await sbCreateActivity(camelToSnake(a));
    setTimeout(()=>inFlightActivityIds.delete(String(a.id)),5000);
    removePendingActivity(a.id);
  }catch(e){
    console.error(`Create activity failed (attempt ${attempt+1}):`,e);
    if(attempt<maxRetries){
      const delay=Math.min(2000*(attempt+1),10000);
      setTimeout(()=>persistActivity(a,attempt+1),delay);
      return;
    }
    alert('Activity failed to save after multiple attempts. Please check your connection and try again.');
    inFlightActivityIds.delete(String(a.id));
  }finally{
    pendingWrites.value--;
  }
}

export function getLeadAge(deal){
  if(!deal.createdDate) return null;
  const raw=deal.createdDate.slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const created=new Date(raw+'T00:00:00');
  const today=new Date(getToday()+'T00:00:00');
  const age=Math.floor((today-created)/(1000*60*60*24));
  return isNaN(age)?null:age;
}

export function leadAgeBadge(deal){
  const age=getLeadAge(deal);
  if(age===null) return '';
  if(age<=1) return `<span style="font-size:9px;color:#22c55e;font-weight:600">NEW</span>`;
  if(age<=3) return `<span style="font-size:9px;color:#f59e0b;font-weight:600">${age}d</span>`;
  return `<span style="font-size:9px;color:#ef4444;font-weight:600">${age}d</span>`;
}

export function getOverdueActivities(){
  const today=getToday();
  const acqDealIds = new Set(state.deals.filter(d => d.pipeline === 'Acquisition').map(d => String(d.id)));
  return state.activities.filter(a=>!a.done && String(a.done)!=="TRUE" && a.dueDate && a.dueDate.slice(0,10)<today && acqDealIds.has(String(a.dealId)));
}

export function renderOverdueBanner(){
  const overdue=getOverdueActivities();
  if(!overdue.length) return '';
  return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#dc2626;font-weight:600">\u26A0 ${overdue.length} overdue</span>`;
}

export function renderBookedMeetingsBanner(){
  const today=getToday();
  const booked=state.deals.filter(d=>isValidDate(d.bookedDate) && d.bookedDate>=today).sort((a,b)=>a.bookedDate.localeCompare(b.bookedDate));
  if(!booked.length) return '';
  const shown=booked.slice(0,2);
  let h=`<span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#78350f">\u{1F4C5}`;
  for(const d of shown){
    h+=`<span style="white-space:nowrap;cursor:pointer" onclick="openDeal('${d.id}')">${d.company||d.contact||'?'}${d.bookedTime?' @ '+fmtTime12(d.bookedTime):''}</span>`;
  }
  if(booked.length>2) h+=`<span style="color:#92400e">+${booked.length-2}</span>`;
  h+=`</span>`;
  return h;
}

export function renderUpcomingMeetings(deal, clientName){
  // Returns HTML for upcoming meetings section in deal modal
  const today=getToday();
  const appts=(state.appointments||[]).filter(a=>a.clientName===clientName&&a.apptDate>=today)
    .sort((a,b)=>(a.apptDate+(a.apptTime||'')).localeCompare(b.apptDate+(b.apptTime||'')));
  if(!appts.length) return '';
  let h=`<div style="margin-bottom:12px;padding:10px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px">
    <div style="font-size:11px;font-weight:700;color:#92400e;margin-bottom:6px">Upcoming Appointments</div>`;
  for(const a of appts){
    h+=`<div style="font-size:12px;color:#78350f;padding:2px 0">${a.leadName||'?'} — ${a.apptDate}${a.apptTime?' @ '+fmtTime12(a.apptTime):''}</div>`;
  }
  h+=`</div>`;
  return h;
}

export function updateActivityDate(actId, newDate){
  const act=state.activities.find(a=>a.id===actId);
  if(!act) return;
  act.dueDate=newDate;
  act.updatedAt=new Date().toISOString();
  refreshModal();
  retryActivityWrite(() => sbUpdateActivity(actId, camelToSnake({dueDate:newDate})), 'Update activity date');
}

export async function toggleActivity(actId){
  const act=state.activities.find(a=>a.id===actId);
  if(!act) return;
  act.done=!act.done;
  act.completedAt=act.done?new Date().toISOString():null;
  act.updatedAt=new Date().toISOString();
  if(act.done){
    completedActivityIds.add(String(actId));
  } else {
    completedActivityIds.delete(String(actId));
  }
  localStorage.setItem('tht_completedActs',JSON.stringify([...completedActivityIds]));
  if(state.selectedDeal) refreshModal();
  else render();
  retryActivityWrite(() => sbUpdateActivity(actId, camelToSnake({done:act.done,completedAt:act.completedAt})), 'Toggle activity');
}

export async function deleteActivity(actId){
  deletedActivityIds.add(String(actId));
  localStorage.setItem('tht_deletedActs',JSON.stringify([...deletedActivityIds]));
  store.removeActivity(actId, {silent: true});
  if(state.selectedDeal) refreshModal();
  else render();
  retryActivityWrite(() => sbDeleteActivity(actId), 'Delete activity');
}

export function assignSequence(dealId,dayLabel,acts,targetDate){
  for(const act of acts){
    const a={id:uid(),dealId,type:act.type,subject:act.subject,dueDate:targetDate,done:false,dayLabel:dayLabel,scheduledTime:null,createdDate:new Date().toISOString(),completedAt:null};
    savePendingActivity(a);
    inFlightActivityIds.add(String(a.id));
    store.addActivity(a, {silent: true});
    persistActivity(a);
  }
  if(state.selectedDeal && state.selectedDeal.id===dealId) refreshModal();
  else render();
}

export function generateAppointmentSequence(deal){
  if(!deal.bookedDate || !isValidDate(deal.bookedDate)) return;
  const bookedDate=new Date(deal.bookedDate+'T00:00:00');
  const today=new Date(getToday()+'T00:00:00');
  const daysUntil=Math.floor((bookedDate-today)/(1000*60*60*24));

  // Skip duplicate pre-call activities (don't delete existing ones)
  const existingSubjects=new Set(state.activities.filter(a=>a.dealId===deal.id)
    .map(a=>(a.subject||'').toLowerCase().trim()));

  const typeLabel=deal.stage==='Demo Scheduled'?'Demo':'Discovery';

  for(const step of PRE_CALL_SEQUENCE){
    let targetDate;
    if(step.offset==='scheduling_day'){
      targetDate=getToday();
    } else {
      const offsetDate=new Date(bookedDate);
      offsetDate.setDate(offsetDate.getDate()+step.offset);
      const offsetStr=offsetDate.toISOString().split('T')[0];
      if(offsetStr<getToday()) continue;
      targetDate=offsetStr;
    }

    const subject=step.subject.replace('{type}',typeLabel);
    if(existingSubjects.has(subject.toLowerCase().trim())) continue;
    const dayLabel=step.offset==='scheduling_day'?'Booking Day'
      :step.offset===0?'Meeting Day'
      :Math.abs(step.offset)+'d before';

    addActivity(deal.id,{type:step.type,subject,dueDate:targetDate,dayLabel});
  }
}

export function reschedulePreCallSequence(deal){
  if(!deal || !deal.bookedDate || !isValidDate(deal.bookedDate)) return;
  const typeLabel=deal.stage==='Demo Scheduled'?'Demo':'Discovery';
  const preCallSubjects=new Set(PRE_CALL_SEQUENCE.map(s=>s.subject.replace('{type}',typeLabel).toLowerCase().trim()));
  const toDelete=state.activities.filter(a=>
    a.dealId===deal.id && !a.done && preCallSubjects.has((a.subject||'').toLowerCase().trim()));
  for(const a of toDelete) deleteActivity(a.id);
  generateAppointmentSequence(deal);
}

export function assignNoShowSequence(deal){
  if(!deal) return;
  const today = getToday();
  for(const step of NO_SHOW_SEQUENCE){
    const d = new Date(today+'T00:00:00');
    d.setDate(d.getDate() + step.dayOffset);
    const targetDate = d.toISOString().split('T')[0];
    const dayLabel = step.dayOffset === 0 ? 'Immediately' : '+' + step.dayOffset + 'd';
    addActivity(deal.id, { type: step.type, subject: step.subject, dueDate: targetDate, dayLabel });
  }
}

// Expose to inline HTML handlers
window.addActivity = addActivity;
window.toggleActivity = toggleActivity;
window.deleteActivity = deleteActivity;
window.updateActivityDate = updateActivityDate;
window.assignSequence = assignSequence;
