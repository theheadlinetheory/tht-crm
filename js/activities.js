// ═══════════════════════════════════════════════════════════
// ACTIVITIES — Activity CRUD, SOP sequences, overdue tracking
// ═══════════════════════════════════════════════════════════
import { state, store, pendingWrites, completedActivityIds, deletedActivityIds } from './app.js';
import { SOP_DAYS, CLIENT_SOP_DAYS } from './config.js';
import { render, refreshModal } from './render.js';
import { sbCreateActivity, sbUpdateActivity, sbDeleteActivity, camelToSnake } from './api.js';
import { uid, getToday, isValidDate, fmtTime12 } from './utils.js';
import { findClientForDeal } from './client-info.js';

export function getSopDays(deal){
  if(!deal) return SOP_DAYS;
  const client = findClientForDeal(deal);
  return client ? CLIENT_SOP_DAYS : SOP_DAYS;
}

export function addActivity(dealId,act){
  const a={id:uid(),dealId,...act,done:false,createdDate:new Date().toISOString(),completedAt:null};
  store.addActivity(a, {silent: true});
  if(state.selectedDeal && state.selectedDeal.id===dealId) refreshModal();
  else render();
  pendingWrites.value++;
  sbCreateActivity(camelToSnake(a)).catch(e=>console.error('Create activity failed:',e)).finally(()=>{pendingWrites.value--;});
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
  return state.activities.filter(a=>!a.done && String(a.done)!=="TRUE" && a.dueDate && a.dueDate.slice(0,10)<today);
}

export function renderOverdueBanner(){
  const overdue=getOverdueActivities();
  if(!overdue.length) return '';
  return `<div class="overdue-banner" style="padding:8px 16px;background:#fef2f2;border-bottom:1px solid #fecaca;display:flex;align-items:center;gap:8px;font-size:12px;color:#dc2626;font-weight:600">
    <span>\u26A0\uFE0F ${overdue.length} overdue activit${overdue.length===1?'y':'ies'}</span>
  </div>`;
}

export function renderBookedMeetingsBanner(){
  const today=getToday();
  const booked=state.deals.filter(d=>isValidDate(d.bookedDate) && d.bookedDate>=today).sort((a,b)=>a.bookedDate.localeCompare(b.bookedDate));
  if(!booked.length) return '';
  const shown=booked.slice(0,3);
  let h=`<div style="padding:6px 16px;background:#fffbeb;border-bottom:1px solid #fde68a;display:flex;align-items:center;gap:12px;font-size:11px;overflow-x:auto">
    <span style="font-weight:700;color:#92400e;white-space:nowrap">\u{1F4C5} Upcoming:</span>`;
  for(const d of shown){
    h+=`<span style="white-space:nowrap;color:#78350f;cursor:pointer" onclick="openDeal('${d.id}')">${d.company||d.contact||'?'} \u2014 ${d.bookedDate}${d.bookedTime?' @ '+fmtTime12(d.bookedTime):''}</span>`;
  }
  if(booked.length>3) h+=`<span style="color:#92400e">+${booked.length-3} more</span>`;
  h+=`</div>`;
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
  pendingWrites.value++;
  sbUpdateActivity(actId, camelToSnake({dueDate:newDate})).catch(e=>console.error('Update activity failed:',e)).finally(()=>{pendingWrites.value--;});
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
  pendingWrites.value++;
  try {
    await sbUpdateActivity(actId, camelToSnake({done:act.done,completedAt:act.completedAt}));
  } finally { pendingWrites.value--; }
}

export async function deleteActivity(actId){
  deletedActivityIds.add(String(actId));
  localStorage.setItem('tht_deletedActs',JSON.stringify([...deletedActivityIds]));
  store.removeActivity(actId, {silent: true});
  if(state.selectedDeal) refreshModal();
  else render();
  pendingWrites.value++;
  try { await sbDeleteActivity(actId); }
  finally { pendingWrites.value--; }
}

export function assignSequence(dealId,dayLabel,acts,targetDate){
  for(const act of acts){
    const a={id:uid(),dealId,type:act.type,subject:act.subject,dueDate:targetDate,done:false,dayLabel:dayLabel,scheduledTime:null,createdDate:new Date().toISOString(),completedAt:null};
    store.addActivity(a, {silent: true});
    pendingWrites.value++;
    sbCreateActivity(camelToSnake(a)).catch(e=>console.error('Create activity failed:',e)).finally(()=>{pendingWrites.value--;});
  }
  if(state.selectedDeal && state.selectedDeal.id===dealId) refreshModal();
  else render();
}

export function generateAppointmentSequence(deal){
  if(!deal.bookedDate || !isValidDate(deal.bookedDate)) return;
  const bookedDate=new Date(deal.bookedDate+'T00:00:00');
  const today=new Date(getToday()+'T00:00:00');
  const daysUntil=Math.floor((bookedDate-today)/(1000*60*60*24));
  // Clear existing appointment-related activities
  const existingApptActs=state.activities.filter(a=>a.dealId===deal.id && (a.subject||'').toLowerCase().includes('appointment'));
  for(const a of existingApptActs){
    store.removeActivity(a.id, {silent: true});
    pendingWrites.value++;
    sbDeleteActivity(a.id).catch(e=>console.error('Delete activity failed:',e)).finally(()=>{pendingWrites.value--;});
  }

  // Day before: reminder call + confirmation text
  if(daysUntil>=1){
    const dayBefore=new Date(bookedDate);
    dayBefore.setDate(dayBefore.getDate()-1);
    const dbStr=dayBefore.toISOString().split('T')[0];
    addActivity(deal.id,{type:'Call',subject:'Appointment reminder call (tomorrow)',dueDate:dbStr,dayLabel:'Pre-Appt'});
    addActivity(deal.id,{type:'Text',subject:'Appointment confirmation text (tomorrow)',dueDate:dbStr,dayLabel:'Pre-Appt'});
  }
  // Day of: pre-meeting prep
  addActivity(deal.id,{type:'Task',subject:'Pre-meeting prep',dueDate:deal.bookedDate,dayLabel:'Appt Day'});
}

// Expose to inline HTML handlers
window.addActivity = addActivity;
window.toggleActivity = toggleActivity;
window.deleteActivity = deleteActivity;
window.updateActivityDate = updateActivityDate;
window.assignSequence = assignSequence;
