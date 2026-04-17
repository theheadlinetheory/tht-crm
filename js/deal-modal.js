// ═══════════════════════════════════════════════════════════
// DEAL-MODAL — Deal detail modal, SmartLead thread viewer
// ═══════════════════════════════════════════════════════════
//
// NOTE: renderDealModal() is 450+ lines. It will be fully
// populated during the final migration. This module provides
// the key functions other modules depend on.

import { state, pendingWrites, pendingDealFields } from './app.js';
import { flushRealtimeQueue } from './api.js';
import { ACQUISITION_STAGES, NURTURE_STAGES, SOP_DAYS, ACTIVITY_TYPES, ACTIVITY_ICONS, SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { render, refreshModal } from './render.js';
import { apiGet, invokeEdgeFunction, sbUpdateDeal, camelToSnake } from './api.js';
import { esc, str, getToday, TODAY, uid, svgIcon, fmtDate, fmtTime12, fmtTimestamp, stripHtml } from './utils.js';
import { isAdmin, isClient, isEmployee } from './auth.js';
import { saveDeal, createDeal, moveDeal, deleteDeal as deleteDealFn } from './deals.js';
import { addActivity, assignSequence, getSopDays, renderUpcomingMeetings, generateAppointmentSequence } from './activities.js';
import { addClient, findClientForDeal, lookupClientInfo, isRetainerClient, getWarmCallQA } from './client-info.js';
import { getStagesForPipeline } from './dashboard.js';
import { renderServiceAreaMap, findPolygonForClient, serviceAreaResults, geocodeCache, geocodeAndCheckDeal } from './maps.js';
import { loadSmartleadThread, renderSmartleadThread, renderThreadMessage, toggleFullThread, getThreadCache, openSendToClientPreview, doSendToClientThread } from './threads.js';
import { renderPassoffSection, startTranscriptPolling, stopTranscriptPolling } from './passoff.js';

function renderSuggestedUpdates(deal) {
  const su = deal.suggestedUpdates;
  if (!su || !su.suggestions || su.suggestions.length === 0) return '';
  const fieldLabels = {
    contact: 'Contact', phone: 'Phone', mobilePhone: 'Mobile', address: 'Address', jobTitle: 'Title',
    contact2: 'Contact 2', email2: 'Email 2', phone2: 'Phone 2', title2: 'Title 2',
    contact3: 'Contact 3', email3: 'Email 3', phone3: 'Phone 3', title3: 'Title 3',
  };
  let rows = su.suggestions.map((s, i) => {
    const label = fieldLabels[s.field] || s.field;
    const current = s.current ? '"' + esc(s.current) + '"' : '(empty)';
    return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid rgba(0,0,0,0.06)">
      <span style="min-width:70px;font-weight:600;font-size:11px;color:#374151">${label}</span>
      <span style="font-size:11px;color:#6b7280">${current} → <strong style="color:#059669">"${esc(s.suggested)}"</strong></span>
      <div style="margin-left:auto;display:flex;gap:4px">
        <button onclick="acceptSuggestion('${esc(deal.id)}',${i})" style="font-size:10px;padding:2px 8px;background:#059669;color:#fff;border:none;border-radius:4px;cursor:pointer">Accept</button>
        <button onclick="skipSuggestion('${esc(deal.id)}',${i})" style="font-size:10px;padding:2px 8px;background:#e5e7eb;color:#374151;border:none;border-radius:4px;cursor:pointer">Skip</button>
      </div>
    </div>`;
  }).join('');

  return `<div style="background:linear-gradient(135deg,#ecfdf5,#f0fdf4);border:1px solid #86efac;border-radius:10px;padding:10px 14px;margin-bottom:12px">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
      <span style="font-size:12px;font-weight:700;color:#065f46">Suggested Updates</span>
      <span style="font-size:10px;color:#6b7280;margin-left:4px">from email signature</span>
      <div style="margin-left:auto;display:flex;gap:6px">
        <button onclick="acceptAllSuggestions('${esc(deal.id)}')" style="font-size:10px;padding:2px 10px;background:#059669;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:600">Accept All</button>
        <button onclick="dismissSuggestions('${esc(deal.id)}')" style="font-size:10px;padding:2px 10px;background:transparent;color:#6b7280;border:1px solid #d1d5db;border-radius:4px;cursor:pointer">Dismiss</button>
      </div>
    </div>
    ${rows}
  </div>`;
}

async function acceptSuggestion(dealId, index) {
  const deal = state.deals.find(d => d.id === dealId);
  if (!deal || !deal.suggestedUpdates) return;
  const su = deal.suggestedUpdates;
  const suggestion = su.suggestions[index];
  if (!suggestion) return;
  deal[suggestion.field] = suggestion.suggested;
  pendingWrites.value++;
  sbUpdateDeal(dealId, camelToSnake({ [suggestion.field]: suggestion.suggested }))
    .finally(() => { pendingWrites.value--; });
  su.suggestions.splice(index, 1);
  const newSu = su.suggestions.length > 0 ? su : null;
  deal.suggestedUpdates = newSu;
  pendingWrites.value++;
  sbUpdateDeal(dealId, { suggested_updates: newSu })
    .finally(() => { pendingWrites.value--; });
  refreshModal();
}

async function acceptAllSuggestions(dealId) {
  const deal = state.deals.find(d => d.id === dealId);
  if (!deal || !deal.suggestedUpdates) return;
  const su = deal.suggestedUpdates;
  const fields = {};
  for (const s of su.suggestions) {
    deal[s.field] = s.suggested;
    fields[s.field] = s.suggested;
  }
  deal.suggestedUpdates = null;
  fields.suggestedUpdates = null;
  pendingWrites.value++;
  sbUpdateDeal(dealId, camelToSnake(fields))
    .finally(() => { pendingWrites.value--; });
  refreshModal();
}

async function skipSuggestion(dealId, index) {
  const deal = state.deals.find(d => d.id === dealId);
  if (!deal || !deal.suggestedUpdates) return;
  const su = deal.suggestedUpdates;
  su.suggestions.splice(index, 1);
  const newSu = su.suggestions.length > 0 ? su : null;
  deal.suggestedUpdates = newSu;
  pendingWrites.value++;
  sbUpdateDeal(dealId, { suggested_updates: newSu })
    .finally(() => { pendingWrites.value--; });
  refreshModal();
}

async function dismissSuggestions(dealId) {
  const deal = state.deals.find(d => d.id === dealId);
  if (!deal) return;
  deal.suggestedUpdates = null;
  pendingWrites.value++;
  sbUpdateDeal(dealId, { suggested_updates: null })
    .finally(() => { pendingWrites.value--; });
  refreshModal();
}

window.acceptSuggestion = acceptSuggestion;
window.acceptAllSuggestions = acceptAllSuggestions;
window.skipSuggestion = skipSuggestion;
window.dismissSuggestions = dismissSuggestions;

export function openDeal(id){
  const deal=state.deals.find(d=>d.id===id);
  if(!deal) return;
  // Clear new-reply indicator when opening the deal card
  if(deal.hasNewReply){
    deal.hasNewReply=false;
    sbUpdateDeal(id, { has_new_reply: false });
  }
  state.selectedDeal=deal;
  render();
}

export function closeDealModal(){
  stopTranscriptPolling();
  state.selectedDeal=null;
  state.showSop=false;
  flushRealtimeQueue();
  render();
}

// SmartLead thread viewer and client thread sender moved to threads.js
// Re-exported above for backward compatibility

export function openNewDeal(){ state.showNew=true; render(); }
export function openAddClient(){ state.showAddClient=true; render(); }

export function changeDealPipeline(newPipeline){
  const deal = state.selectedDeal;
  if(!deal) return;
  deal.pipeline = newPipeline;
  // Set stage to first stage of the new pipeline
  if(newPipeline === 'Acquisition'){
    deal.stage = ACQUISITION_STAGES[0]?.id || 'Cold Email Response';
  } else if(newPipeline === 'Nurture'){
    deal.stage = NURTURE_STAGES[0]?.id || 'Revisit';
  } else if(newPipeline === 'Client'){
    deal.stage = 'Client Not Distributed';
  }
  // Save to Supabase
  pendingWrites.value++;
  sbUpdateDeal(deal.id, camelToSnake({ pipeline: deal.pipeline, stage: deal.stage }))
    .catch(e => console.error('Update deal pipeline failed:', e))
    .finally(() => { pendingWrites.value--; });
  refreshModal(true);
}

export function changeDealOwner(val){
  // Used in acquisition pipeline to override deal owner
  if(!state.selectedDeal) return;
  state.selectedDeal.ownerOverride=val;
  pendingWrites.value++;
  sbUpdateDeal(state.selectedDeal.id, camelToSnake({ownerOverride:val})).catch(e=>console.error('Update deal failed:',e)).finally(()=>{pendingWrites.value--;});
  refreshModal();
}

// ─── Debounced Deal Field Save ───
let _dealFieldSaveTimer=null;
export function debouncedDealFieldSave(){
  clearTimeout(_dealFieldSaveTimer);
  _dealFieldSaveTimer=setTimeout(()=>{
    if(!state.selectedDeal) return;
    const deal=state.selectedDeal;
    const fields={};
    // Read all editable fields from the modal DOM
    const fieldMap=['company','contact','email','phone','mobilePhone','website','location','address','value','notes',
      'email2','email3','email4','contact2','contact3','phone2','phone3','title2','title3',
      'bookedDate','bookedTime','bookedFor','prefillName','prefillEmail','prefillNotes',
      'stage','pipeline'];
    for(const f of fieldMap){
      const el=document.getElementById('deal-'+f);
      if(el && el.value!==undefined){
        const val=el.value;
        if((deal[f]||'')!==(val||'')){
          deal[f]=val;
          fields[f]=val;
        }
      }
    }
    if(Object.keys(fields).length===0) return;
    // Track pending fields so sync doesn't overwrite them
    if(!pendingDealFields[String(deal.id)]) pendingDealFields[String(deal.id)]={};
    Object.assign(pendingDealFields[String(deal.id)], fields);
    pendingWrites.value++;
    sbUpdateDeal(deal.id, camelToSnake(fields)).then(()=>{
      // Clear pending fields after successful save
      const pending=pendingDealFields[String(deal.id)];
      if(pending){
        for(const k of Object.keys(fields)){
          if(pending[k]===fields[k]) delete pending[k];
        }
        if(Object.keys(pending).length===0) delete pendingDealFields[String(deal.id)];
      }
    }).finally(()=>{pendingWrites.value--;});
  },800);
}

export function updateDealField(key,val){
  if(!state.selectedDeal) return;
  state.selectedDeal[key]=val;
  // Stage and pipeline changes save immediately (like drag-drop) — not debounced.
  // The debounced save is killed when the modal closes, so stage changes were lost.
  if(key==='stage'||key==='pipeline'){
    const dealId=state.selectedDeal.id;
    if(!pendingDealFields[String(dealId)]) pendingDealFields[String(dealId)]={};
    pendingDealFields[String(dealId)][key]=val;
    pendingWrites.value++;
    sbUpdateDeal(dealId, {[key]:val}).then(()=>{
      const pending=pendingDealFields[String(dealId)];
      if(pending && pending[key]===val) delete pending[key];
      if(pending && Object.keys(pending).length===0) delete pendingDealFields[String(dealId)];
    }).finally(()=>{pendingWrites.value--;});
    return;
  }
  debouncedDealFieldSave();
}

export function refreshPushButton(){
  const btn=document.getElementById('push-tracker-btn');
  if(!btn||!state.selectedDeal) return;
  if(state.selectedDeal.pushedToTracker){
    btn.textContent='\u2713 Pushed';
    btn.disabled=true;
    btn.style.opacity='0.5';
  }
}

export function doSaveDeal(id){
  const deal=state.deals.find(d=>d.id===id);
  if(!deal) return;
  // Read all fields from modal
  const fieldMap=['company','contact','email','phone','mobilePhone','website','location','address','value','notes'];
  const updated={id};
  for(const f of fieldMap){
    const el=document.getElementById('deal-'+f);
    if(el) updated[f]=el.value;
  }
  saveDeal(updated);
}

export function doCreateDeal(){
  const fields=['company','contact','email','phone','value','stage'];
  const form={};
  for(const f of fields){
    const el=document.getElementById('new-'+f);
    if(el) form[f]=el.value.trim();
  }
  if(!form.company&&!form.contact){alert('Enter a company or contact name');return;}
  if(!form.stage){alert('Select a stage');return;}
  state.showNew=false;
  flushRealtimeQueue();
  createDeal(form);
}

export function doAddClient(){
  const nameEl=document.getElementById('new-client-name');
  const name=nameEl?nameEl.value.trim():'';
  if(!name){alert('Enter a client name');return;}
  state.showAddClient=false;
  flushRealtimeQueue();
  addClient(name);
}

export function doAddActivity(dealId){
  const typeEl=document.getElementById('new-act-type');
  const subEl=document.getElementById('new-act-subject');
  const dateEl=document.getElementById('new-act-date');
  if(!typeEl||!subEl||!dateEl) return;
  const type=typeEl.value;
  const subject=subEl.value.trim()||type;
  const dueDate=dateEl.value;
  if(!dueDate){alert('Select a due date');return;}
  addActivity(dealId,{type,subject,dueDate});
  subEl.value='';
}

export function doAssignSequence(dealId,day){
  const sopDaysMap=getSopDaysForDeal(dealId);
  const acts=sopDaysMap[day];
  if(!acts) return;
  assignSequence(dealId,day,acts,getToday());
}

export function doAssignSequenceWithDate(dealId,day){
  const dateEl=document.getElementById('sop-target-date');
  const targetDate=dateEl?dateEl.value:getToday();
  const sopDaysMap=getSopDaysForDeal(dealId);
  const acts=sopDaysMap[day];
  if(!acts) return;
  assignSequence(dealId,day,acts,targetDate);
}

function getSopDaysForDeal(dealId){
  const deal=state.deals.find(d=>d.id===dealId);
  return getSopDays(deal);
}

// ─── Delete Zone (drag to archive/won) ───
export function showDeleteZone(){
  const zone=document.getElementById('delete-zone');
  if(zone) zone.style.display='flex';
}

export function hideDeleteZone(){
  const zone=document.getElementById('delete-zone');
  if(zone) zone.style.display='none';
}

export function doLostDrop(){
  hideDeleteZone();
  if(!state.dragId) return;
  const id=state.dragId;
  state.dragId=null;
  const deal=state.deals.find(d=>d.id===id);
  const client=deal?(findClientForDeal(deal)||{name:deal.stage}):null;
  const { deleteDeal } = window;
  if(deleteDeal) deleteDeal(id, 'Deleted/Lost', client?client.name:'');
}

export async function doWonDrop(){
  hideDeleteZone();
  if(!state.dragId) return;
  const id=state.dragId;
  state.dragId=null;
  const deal=state.deals.find(d=>d.id===id);
  if(!deal) return;
  const client=findClientForDeal(deal)||state.clients.find(c=>c.name===deal.stage);
  const clientName=client?client.name:deal.stage;

  // Acquisition Won → Client Tracker (new client onboarding)
  // Client Won → Lead Entry (syncs to admin Lead Tracker)
  try {
    if(deal.pipeline==='Acquisition'){
      const { pushToClientInfo } = await import('./warm-call.js');
      await pushToClientInfo(deal.id);
    } else {
      const { autoPushToTracker } = await import('./email.js');
      await autoPushToTracker(deal);
    }
  } catch(e){
    console.error('Push on won failed:', e);
    const { showToast } = await import('./api.js');
    showToast('Lead tracker push failed: ' + e.message, 'error');
  }

  const { deleteDeal } = await import('./deals.js');
  deleteDeal(id, 'Closed Won', clientName);
}


export function toggleBadgeDropdown(dealId){
  const el=document.getElementById('badge-dropdown-'+dealId);
  if(el) el.style.display=el.style.display==='block'?'none':'block';
}

// Expose to inline HTML handlers
window.openDeal = openDeal;
window.closeDealModal = closeDealModal;
window.openNewDeal = openNewDeal;
window.openAddClient = openAddClient;
window.changeDealPipeline = changeDealPipeline;
window.changeDealOwner = changeDealOwner;
window.updateDealField = updateDealField;
window.debouncedDealFieldSave = debouncedDealFieldSave;
window.doSaveDeal = doSaveDeal;
window.doCreateDeal = doCreateDeal;
window.doAddClient = doAddClient;
window.doAddActivity = doAddActivity;
window.doAssignSequence = doAssignSequence;
window.doAssignSequenceWithDate = doAssignSequenceWithDate;
window.showDeleteZone = showDeleteZone;
window.hideDeleteZone = hideDeleteZone;
window.doLostDrop = doLostDrop;
window.doWonDrop = doWonDrop;
window.toggleBadgeDropdown = toggleBadgeDropdown;
window.refreshPushButton = refreshPushButton;
window.startTranscriptPolling = startTranscriptPolling;

// ─── Route Suggestion Handlers ───

window._routeSuggestions = {};

function renderRouteResults(dealId, data, clientName) {
  if (data.error) return `<div style="padding:8px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;font-size:12px;color:#991b1b;margin-bottom:8px">Error: ${esc(data.error)}</div>`;
  if (!data.suggestions || data.suggestions.length === 0) return '<div style="padding:8px;font-size:12px;color:var(--text-muted)">No suggestions available.</div>';
  let h = '<div style="margin-bottom:8px"><div style="font-size:11px;font-weight:700;color:#0369a1;margin-bottom:8px">SUGGESTED APPOINTMENT TIMES</div>';
  data.suggestions.forEach(function(s) {
    const effColor = s.routeEfficiency === 'high' ? '#059669' : s.routeEfficiency === 'medium' ? '#d97706' : '#dc2626';
    const isTop = s.rank === 1;
    const dateLabel = (()=>{ try { return new Date(s.date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}); } catch(e) { return s.date; } })();
    h += `<div style="padding:10px;margin-bottom:6px;background:${isTop?'#f0f9ff':'var(--bg)'};border:1px solid ${isTop?'#0ea5e9':'var(--border)'};border-radius:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <div style="font-size:13px;font-weight:700;color:var(--text)">${isTop?'BEST: ':'#'+s.rank+': '}${dateLabel} at ${fmtTime12(s.suggestedTime)}</div>
        <span style="font-size:10px;font-weight:600;color:${effColor};text-transform:uppercase">${esc(s.routeEfficiency)}</span>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">
        ${s.driveFromPrevious?esc(s.driveFromPrevious)+' from prev':''} ${s.driveToNext&&s.driveToNext!=='N/A'?' · '+esc(s.driveToNext)+' to next':''}
      </div>
      <div style="font-size:11px;color:var(--text);margin-bottom:8px">${esc(s.reasoning)}</div>
      <button class="btn btn-primary" style="font-size:11px;padding:5px 14px;background:#0ea5e9;border-color:#0ea5e9"
        onclick="bookSuggestionClick('${esc(dealId)}','${esc(clientName)}','${esc(s.date)}','${esc(s.suggestedTime)}','${esc(s.estimatedDuration)}')">
        Book This
      </button>
    </div>`;
  });
  return h + '</div>';
}

window.suggestScheduleClick = async function(dealId, clientName) {
  const btn = document.getElementById('suggest-schedule-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = 'Analyzing routes for the next 7 days...'; }
  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 7);
  const fmt = d => d.toISOString().split('T')[0];
  try {
    const { apiPost } = await import('./api.js');
    const result = await apiPost('suggest_schedule', {
      clientName, leadDealId: dealId,
      dateRangeStart: fmt(today), dateRangeEnd: fmt(endDate)
    });
    window._routeSuggestions[dealId] = result;
    const container = document.getElementById('route-results-' + dealId);
    if (container) { container.innerHTML = renderRouteResults(dealId, result, clientName); }
    if (btn) { btn.disabled = false; btn.innerHTML = 'Suggest Schedule'; }
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Suggest Schedule'; }
    alert('Route suggestion failed: ' + e.message);
  }
};

window.bookSuggestionClick = async function(dealId, clientName, date, time, duration) {
  const dateLabel = (()=>{ try { return new Date(date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}); } catch(e) { return date; } })();
  if (!confirm('Book ' + dateLabel + ' at ' + fmtTime12(time) + '?')) return;
  const deal = state.deals.find(d => d.id === dealId);
  if (!deal) return;
  deal.bookedDate = date;
  deal.bookedTime = time;
  const { sbUpdateDeal: _sbUpd, invokeEdgeFunction: _ief, sbCreateAppointment: _sbAppt } = await import('./api.js');
  await _sbUpd(dealId, { bookedDate: date, bookedTime: time });
  try {
    await _sbAppt({
      client_name: clientName,
      lead_name: deal.company || deal.contact || '',
      appt_date: date,
      appt_time: time,
      address: deal.address || deal.location || '',
      notes: 'Route-optimized booking (' + duration + ')'
    });
  } catch (apptErr) { console.warn('Appointment creation failed:', apptErr); }
  try {
    await _ief('create-calendar-event', {
      dealId, clientName, date, time,
      duration: parseInt(duration) || 60,
      title: (deal.company || deal.contact || 'New Lead') + ' - Quote',
      location: deal.address || deal.location || ''
    });
  } catch (calErr) { console.warn('Calendar event creation failed:', calErr); }
  refreshModal();
};

// ─── Render Functions ───

export function renderDealModal(deal){
  const stages=getStagesForPipeline(deal.pipeline||'Client');
  const dealActs=state.activities.filter(a=>a.dealId===deal.id);
  const pending=dealActs.filter(a=>!a.done&&String(a.done)!=="TRUE");
  const completed=dealActs.filter(a=>a.done||String(a.done)==="TRUE");

  let h=`<div class="modal-overlay" onmousedown="this._mdownTarget=event.target" onclick="if(event.target===this&&this._mdownTarget===this)closeDealModal()">
    <div class="modal" style="width:520px" onclick="event.stopPropagation()">
      <div class="modal-header"><h3>Edit Deal</h3><button class="modal-close" onclick="closeDealModal()">×</button></div>
      <div class="modal-body">
        ${isRetainerClient(deal)?`<div style="background:#dbeafe;border:2px solid #3b82f6;border-radius:8px;padding:8px 12px;margin-bottom:12px;display:flex;align-items:center;gap:8px">
          <span style="font-size:16px">${svgIcon('clipboard',16)}</span>
          <div>
            <div style="font-size:13px;font-weight:700;color:#1d4ed8">RETAINER CLIENT</div>
            <div style="font-size:11px;color:#1e40af">No calling needed — categorize, check service area, and forward to client.</div>
          </div>
        </div>`:''}
        ${renderSuggestedUpdates(deal)}
        <div class="form-grid">
          ${["company:Company","contact:Contact Name","email:Email","phone:Business Phone","mobilePhone:Mobile Phone","website:Website","jobTitle:Job Title","location:Address",...(isAdmin()?["value:Deal Value ($)"]:[])].map(f=>{
            const[k,label]=f.split(":");
            let extra='';
            if((k==='phone'||k==='mobilePhone') && deal[k]){
              const ph=String(deal[k]).replace(/[^0-9+]/g,'');
              extra='<div id="phone-btns-'+k+'" style="margin-top:4px;display:flex;gap:6px">'
                +(!isClient()?'<button onclick="callInJustCall(\''+esc(deal.id)+'\',\''+k+'\');event.stopPropagation()" class="imessage-btn" style="display:inline-flex;align-items:center;gap:4px;background:#f97316;color:#fff;border-color:#f97316;cursor:pointer;font-weight:600">'+svgIcon('phone',14,'#fff')+' Call</button>':'')
                +'<a href="sms:'+esc(ph)+'" class="imessage-btn" style="display:inline-flex;align-items:center;gap:4px;background:#dcfce7;color:#166534;border-color:#86efac">'+svgIcon('message-circle',14)+' Text</a>'
                +'</div>';
            }
            if(k==='website'&&deal[k]){
              const url=String(deal[k]||'').trim();
              const href=url.match(/^https?:\/\//i)?url:'https://'+url;
              extra='<div style="margin-top:4px"><a href="'+esc(href)+'" target="_blank" rel="noopener" class="imessage-btn" style="display:inline-flex;align-items:center;gap:4px">🔗 Open Website</a></div>';
            }
            if(k==='location'&&deal[k]){
              const mapsAddr=String(deal.address||deal[k]||'').trim();
              extra+='<div style="margin-top:4px"><a href="https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(mapsAddr)+'" target="_blank" rel="noopener" class="imessage-btn" style="display:inline-flex;align-items:center;gap:4px;background:#4285f4;color:#fff;border-color:#4285f4">📍 Open in Google Maps</a></div>';
            }
            const extraOninput = (k === 'location' && deal.pipeline === 'Client') ? ';onAddressFieldChange(\''+deal.id+'\',this.value)' : '';
            return'<div class="form-group"><label>'+label+'</label><input id="deal-'+k+'" value="'+esc(String(deal[k]||''))+'" oninput="updateDealField(\''+k+'\',this.value)'+extraOninput+'">'+extra+'</div>';
          }).join("")}
          <div class="form-group form-span2" style="margin-top:0">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
              <label style="margin:0;font-size:11px;font-weight:600;color:var(--text-muted)">Additional Emails</label>
              ${!(deal.email2||deal.email3||deal.email4)?`<button onclick="document.getElementById('extra-emails').style.display='flex';this.style.display='none'" style="background:none;border:1px solid var(--border);border-radius:4px;font-size:11px;color:#2563eb;cursor:pointer;padding:1px 8px;font-weight:600">+ Add</button>`:''}
            </div>
            <div id="extra-emails" style="display:${(deal.email2||deal.email3||deal.email4)?'flex':'none'};flex-direction:column;gap:4px">
              <input id="deal-email2" placeholder="Email 2" value="${esc(String(deal.email2||''))}" oninput="updateDealField('email2',this.value)" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
              <input id="deal-email3" placeholder="Email 3" value="${esc(String(deal.email3||''))}" oninput="updateDealField('email3',this.value)" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
              <input id="deal-email4" placeholder="Email 4" value="${esc(String(deal.email4||''))}" oninput="updateDealField('email4',this.value)" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
            </div>
          </div>
          <div class="form-group form-span2" style="margin-top:0">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
              <label style="margin:0;font-size:11px;font-weight:600;color:var(--text-muted)">Additional Contacts</label>
              ${!(deal.contact2||deal.contact3||deal.phone2||deal.phone3)?`<button onclick="document.getElementById('extra-contacts').style.display='flex';this.style.display='none'" style="background:none;border:1px solid var(--border);border-radius:4px;font-size:11px;color:#2563eb;cursor:pointer;padding:1px 8px;font-weight:600">+ Add</button>`:''}
            </div>
            <div id="extra-contacts" style="display:${(deal.contact2||deal.contact3||deal.phone2||deal.phone3)?'flex':'none'};flex-direction:column;gap:6px">
              <div style="display:flex;gap:4px">
                <input id="deal-contact2" placeholder="Contact 2" value="${esc(String(deal.contact2||''))}" oninput="updateDealField('contact2',this.value)" style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
                <input id="deal-title2" placeholder="Title" value="${esc(String(deal.title2||''))}" oninput="updateDealField('title2',this.value)" style="width:120px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
              </div>
              <input id="deal-phone2" placeholder="Phone 2" value="${esc(String(deal.phone2||''))}" oninput="updateDealField('phone2',this.value)" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
              <div style="display:flex;gap:4px;margin-top:4px">
                <input id="deal-contact3" placeholder="Contact 3" value="${esc(String(deal.contact3||''))}" oninput="updateDealField('contact3',this.value)" style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
                <input id="deal-title3" placeholder="Title" value="${esc(String(deal.title3||''))}" oninput="updateDealField('title3',this.value)" style="width:120px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
              </div>
              <input id="deal-phone3" placeholder="Phone 3" value="${esc(String(deal.phone3||''))}" oninput="updateDealField('phone3',this.value)" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
            </div>
          </div>
          <div class="form-group">
            <label>Pipeline</label>
            <select id="deal-pipeline" onchange="changeDealPipeline(this.value)">
              <option value="Acquisition" ${deal.pipeline==='Acquisition'?'selected':''}>Acquisition</option>
              <option value="Client" ${deal.pipeline==='Client'?'selected':''}>Client Leads</option>
              <option value="Nurture" ${deal.pipeline==='Nurture'?'selected':''}>Long Term Nurture</option>
            </select>
          </div>
          <div class="form-group">
            <label>Stage</label>
            <select id="deal-stage" onchange="updateDealField('stage',this.value)">
              ${stages.map(s=>`<option value="${esc(s.id)}" ${deal.stage===s.id?'selected':''}>${esc(s.label)}</option>`).join("")}
            </select>
          </div>
          ${deal.pipeline==='Acquisition'&&(isAdmin()||isEmployee())?`<div class="form-group">
            <label>Owner</label>
            <select id="deal-owner" onchange="changeDealOwner(this.value)">
              <option value="" ${!deal.ownerOverride?'selected':''}>Campaign Default${(()=>{const o=state.campaignAssignments[deal.campaignName];return o?' ('+o+')':'';})()}</option>
              ${[...new Set(Object.values(state.campaignAssignments))].filter(Boolean).sort().map(o=>`<option value="${esc(o)}" ${deal.ownerOverride===o?'selected':''}>${esc(o)}</option>`).join('')}
            </select>
          </div>`:''}
        </div>
        ${deal.linkedinUrl?`<div class="form-group form-span2" style="margin-bottom:8px">
          <label style="font-size:11px;font-weight:600;color:var(--text-muted)">LinkedIn</label>
          <div style="display:flex;align-items:center;gap:8px">
            <input id="deal-linkedinUrl" value="${esc(deal.linkedinUrl||'')}" oninput="updateDealField('linkedinUrl',this.value)"
              style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
            <a href="${esc(deal.linkedinUrl)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;padding:6px 12px;background:#0a66c2;color:#fff;border-radius:6px;font-size:11px;font-weight:600;text-decoration:none;white-space:nowrap">${svgIcon('external-link',12,'#fff')} Open</a>
          </div>
        </div>`:`<div class="form-group form-span2" style="margin-bottom:8px">
          <label style="font-size:11px;font-weight:600;color:var(--text-muted)">LinkedIn</label>
          <input id="deal-linkedinUrl" value="" placeholder="LinkedIn profile URL" oninput="updateDealField('linkedinUrl',this.value)"
            style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
        </div>`}
        <div class="form-group form-span2" style="margin-bottom:16px">
          <label>Notes</label>
          <textarea id="deal-notes" rows="2" oninput="updateDealField('notes',this.value)">${esc(deal.notes||'')}</textarea>
        </div>
        ${(()=>{
          if(deal.pipeline==='Client'){
            const _mc=findClientForDeal(deal)||state.clients.find(c=>c.name===deal.stage);
            return _mc ? renderPassoffSection(deal, _mc.name) : '';
          }
          return '';
        })()}
        <div class="form-group form-span2" style="margin-bottom:16px">
          <label>${svgIcon('calendar',14)} Meeting Date & Time</label>
          <div style="display:flex;gap:8px">
            <input type="date" id="deal-bookedDate" value="${esc(deal.bookedDate||'')}"
              onchange="updateDealField('bookedDate',this.value)"
              style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font);background:var(--card);color:var(--text)">
            <input type="time" id="deal-bookedTime" value="${esc(deal.bookedTime||'')}"
              onchange="updateDealField('bookedTime',this.value)"
              style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font);background:var(--card);color:var(--text)">
          </div>
        </div>`;

  if(deal.campaignName){
    const isSubseqActive = str(deal.leadCategory).toLowerCase() === 'ht subsequence fu';
    h+=`<div class="sl-info">
      <div class="sl-info-title">Smartlead Source</div>
      <div>Campaign: ${esc(deal.campaignName)}</div>
      ${deal.leadCategory?`<div>Category: ${esc(deal.leadCategory)}</div>`:''}
      ${(deal.smartleadUrl||deal.email)?`<a href="${esc(deal.smartleadUrl||('https://app.smartlead.ai/app/master-inbox?sortBy=REPLY_TIME_DESC&search='+encodeURIComponent(deal.email)))}" target="_blank" rel="noopener">Open in Smartlead →</a>`:''}
      ${(deal.pipeline==='Acquisition'||ACQUISITION_STAGES.some(s=>s.id===deal.stage))&&str(deal.slLeadId).trim()&&str(deal.slCampaignId).trim()&&!isSubseqActive
        ?`<div style="margin-top:12px;padding-top:10px;border-top:1px solid #e9d5ff"><button class="sl-subseq-btn" onclick="event.stopPropagation();startAutoFollowUp('${esc(deal.id)}')" style="display:inline-flex;align-items:center;gap:6px;padding:7px 16px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font);box-shadow:0 1px 3px rgba(124,58,237,.3);transition:opacity .15s" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">${svgIcon('send',14,'#fff')} Start Auto Follow-Up</button></div>`
        :''}
      ${isSubseqActive?`<div style="margin-top:12px;padding-top:10px;border-top:1px solid #e9d5ff"><div style="display:inline-flex;align-items:center;gap:6px;padding:7px 16px;background:#f3e8ff;color:#6d28d9;border-radius:8px;font-size:12px;font-weight:600">${svgIcon('check',14,'#6d28d9')} Auto Follow-Up Active</div></div>`:''}
    </div>`;
  }

  // Reply preview — show in ALL pipelines
  const replyText=stripHtml(str(deal.emailBody||'')).trim();
  if(replyText){
    const catClass=str(deal.leadCategory||'').toLowerCase().includes('interested')?'cat-interested':
      str(deal.leadCategory||'').toLowerCase().includes('meeting')?'cat-meeting':'cat-info';
    h+=`<div class="reply-preview">
      <div class="reply-preview-title">${svgIcon('mail',14)} Their Reply <span class="reply-preview-category ${catClass}">${esc(deal.leadCategory||'')}</span></div>
      <div class="reply-preview-body">${esc(replyText)}</div>
    </div>`;
  }

  // SmartLead Email Thread — on-demand viewer (admin + employee only)
  if((isAdmin()||isEmployee()) && str(deal.slLeadId).trim() && str(deal.slCampaignId).trim()){
    const _tc = getThreadCache();
    if(_tc[deal.id]){
      h+=renderSmartleadThread(deal.id, _tc[deal.id]);
    } else {
      h+=`<button id="sl-thread-btn-${esc(deal.id)}" class="sl-thread-btn" onclick="event.stopPropagation();var _b=this;_b.disabled=true;_b.innerHTML='Loading...';loadSmartleadThread('${esc(deal.id)}').then(function(){_b.style.display='none'})">
        ${svgIcon('mail',14)} View Email Thread
      </button>`;
    }
  }

  // Client Action Buttons — CLIENT PIPELINE ONLY
  if(deal.pipeline==='Client'){
    // Find matched client for this deal (by campaign keyword OR by stage name)
    const matchedClient=findClientForDeal(deal) || state.clients.find(c=>c.name===deal.stage);

    if(matchedClient){
      const isOn=(field)=>str(matchedClient[field]).toUpperCase()==='TRUE';

      // Enhanced Client Info panel
      {
        const cn=matchedClient;
        const info=lookupClientInfo(cn.name)||{};
        const fwdName=info.forwardName||str(cn.contactFirstName).trim()||'';
        const fwdEmail=info.forwardEmail||str(cn.notifyEmails).trim()||'';
        const priContact=info.primaryContact||str(cn.contactFirstName).trim()||'';
        const priEmail=info.primaryEmail||'';
        const phone=info.phone||'';
        const loc=info.location||'';
        const tz=info.timeZone||'';
        const saCities=info.serviceAreaCities||'';
        const svcs=info.services||[];
        const pModel=info.pricingModel||'';
        const warmQA=getWarmCallQA(cn.name);

        // Warm Call Sheet button (contains all client info + lead info)
        h+=`<div style="margin:0 0 8px 0">
          <button class="btn" style="width:100%;justify-content:center;gap:6px;font-size:13px;background:#059669;border-color:#059669;color:#fff;font-weight:700"
            onclick="openWarmCallSheet('${esc(deal.id)}')">
            ${svgIcon('clipboard',14)} ${esc(cn.name)} — Client Info & Warm Call Sheet
          </button>
        </div>`;
      }

      // Forward Lead Email button
      if(isOn('enableForward')){
        const forwarded=deal.forwardedAt && str(deal.forwardedAt).trim()!=='';
        const fwdLabel=forwarded
          ? '<span style="color:#059669">Forwarded to '+esc(matchedClient.name)+' — '+new Date(deal.forwardedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+'</span>'
          : svgIcon('mail',14)+' Forward Lead to '+esc(matchedClient.name);
        h+=`<div style="margin:0 0 8px 0">
          <button class="btn forward-btn ${forwarded?'sent':'ready'}"
            onclick="${forwarded?'':'forwardDealToClient(\''+deal.id+'\')'}" ${forwarded?'disabled':''}>
            ${fwdLabel}
          </button>
        </div>`;
      }

      // Book Meeting via Calendly — inline with editable prefill
      if(isOn('enableCalendly') && matchedClient.calendlyUrl){
        const prefillLines=[];
        if(deal.company) prefillLines.push('Business: '+deal.company);
        if(deal.website) prefillLines.push('Website: '+deal.website);
        const calAddr=str(deal.address||deal.location||'').trim();
        if(calAddr) prefillLines.push('Address: '+calAddr);
        if(deal.email) prefillLines.push('Email: '+deal.email);
        if(deal.email2) prefillLines.push('Contact email: '+deal.email2);
        if(deal.phone) prefillLines.push('Business Phone: '+deal.phone);
        if(deal.contact && deal.contact!==deal.company) prefillLines.push('Contact: '+deal.contact);
        if(deal.mobilePhone) prefillLines.push('Mobile Phone: '+deal.mobilePhone);
        prefillLines.push('Instructions: ');
        h+=`<div style="margin:0 0 8px 0">
          <button class="btn btn-primary" style="width:100%;justify-content:center;gap:6px;font-size:13px;background:#818cf8;border-color:#818cf8"
            onclick="toggleCalendlyBooking('${esc(deal.id)}','${esc(matchedClient.calendlyUrl)}')">
            ${svgIcon('calendar',14)} Book Meeting on ${esc(matchedClient.name)}'s Calendar
          </button>
        </div>
        <div id="calendly-booking-section" style="display:none;margin:0 0 12px 0;padding:12px;background:#f5f3ff;border:1px solid #c4b5fd;border-radius:8px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div style="font-size:11px;font-weight:700;color:#5b21b6">Review & Edit Info Sent to Calendly</div>
            ${(()=>{const ci=lookupClientInfo(matchedClient.name);const tz=ci&&ci.timeZone?ci.timeZone:'';return tz?'<div style="font-size:11px;font-weight:700;color:#fff;background:#7c3aed;padding:2px 8px;border-radius:10px;letter-spacing:.3px">'+esc(matchedClient.name)+' Time: '+esc(tz)+'</div>':'';})()}
          </div>
          <div style="margin-bottom:6px">
            <label style="font-size:11px;color:#6b7280;font-weight:600">Guest Name</label>
            <input type="text" id="cal-prefill-name" value="${esc(deal.calName||(deal.contact||deal.company||''))}"
              oninput="savePrefillField('${esc(deal.id)}','calName',this.value)"
              style="width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:var(--font);margin-top:2px">
          </div>
          <div style="margin-bottom:6px">
            <label style="font-size:11px;color:#6b7280;font-weight:600">Guest Email</label>
            <input type="text" id="cal-prefill-email" value="${esc(deal.calEmail||(deal.email||''))}"
              oninput="savePrefillField('${esc(deal.id)}','calEmail',this.value)"
              style="width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:var(--font);margin-top:2px">
          </div>
          <div style="margin-bottom:8px">
            <label style="font-size:11px;color:#6b7280;font-weight:600">Additional Info / Instructions</label>
            <textarea id="cal-prefill-notes" rows="5"
              oninput="savePrefillField('${esc(deal.id)}','calNotes',this.value)"
              style="width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:var(--font);margin-top:2px;resize:vertical">${esc(deal.calNotes||prefillLines.join('\n'))}</textarea>
          </div>
          <button class="btn btn-primary" style="width:100%;justify-content:center;font-size:13px;background:#818cf8;border-color:#818cf8"
            onclick="openCalendlyEmbed('${esc(deal.id)}','${esc(matchedClient.calendlyUrl)}',atob('${btoa(unescape(encodeURIComponent(matchedClient.name)))}'),document.getElementById('cal-prefill-name')?.value||'',document.getElementById('cal-prefill-email')?.value||'',document.getElementById('cal-prefill-notes')?.value||'')">
            Open Calendar & Book
          </button>
        </div>`;
      }

      // Client's Upcoming Meetings — show all future bookings for this client
      h+=renderUpcomingMeetings(deal, matchedClient.name);

      // Editable instructions for non-Calendly clients (auto-saves to calNotes)
      if(!isOn('enableCalendly') || !matchedClient.calendlyUrl){
        const instrLines=[];
        if(deal.company) instrLines.push('Business: '+deal.company);
        if(deal.website) instrLines.push('Website: '+deal.website);
        const instrAddr=str(deal.address||deal.location||'').trim();
        if(instrAddr) instrLines.push('Address: '+instrAddr);
        if(deal.email) instrLines.push('Email: '+deal.email);
        if(deal.phone) instrLines.push('Phone: '+deal.phone);
        if(deal.contact && deal.contact!==deal.company) instrLines.push('Contact: '+deal.contact);
        instrLines.push('Instructions: ');
        h+=`<div style="margin:0 0 10px 0;padding:10px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px">
          <label style="font-size:11px;font-weight:700;color:#0369a1;display:block;margin-bottom:4px">Send Instructions</label>
          <textarea rows="5" id="send-instructions-notes"
            oninput="savePrefillField('${esc(deal.id)}','calNotes',this.value)"
            style="width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:var(--font);resize:vertical">${esc(deal.calNotes||instrLines.join('\n'))}</textarea>
        </div>`;
      }

      // Send Lead Info to Client button
      if(isOn('enableCopyInfo')){
        const forwarded=deal.forwardedAt && str(deal.forwardedAt).trim()!=='';
        h+=`<div style="margin:0 0 8px 0">
          <button class="btn ${forwarded?'btn-ghost':'btn-primary'}" style="width:100%;justify-content:center;gap:6px;font-size:13px;${forwarded?'':'background:#2563eb;border-color:#2563eb'}"
            onclick="openSendToClientPreview('${esc(deal.id)}',atob('${btoa(unescape(encodeURIComponent(matchedClient.name)))}'))" ${forwarded?'':''}>
            ${forwarded?'<span style="color:#059669">Sent to '+esc(matchedClient.name)+' — Send Again?</span>':svgIcon('send',14)+' Send Lead Info to '+esc(matchedClient.name)}
          </button>
        </div>
`;

      }

      // Push to Lead Tracker button
      if(isOn('enableTracker')){
        const pushed=deal.pushedToTracker;
        h+=`<div style="margin:0 0 8px 0">
          <button id="push-tracker-btn" class="btn ${pushed?'btn-ghost':'btn-primary'}" style="width:100%;justify-content:center;gap:6px;font-size:13px"
            onclick="${pushed?'':'pushToLeadTracker(\''+deal.id+'\')'}" ${pushed?'disabled':''}>
            ${pushed?'<span style="color:#059669">Pushed to Lead Tracker</span>':svgIcon('upload',14)+' Push to Lead Tracker'}
          </button>
        </div>`;
      }

      // Route Optimization — Suggest Schedule (admin only, needs address)
      if(isAdmin() && str(deal.address||deal.location).trim()){
        h+=`<div style="margin:0 0 8px 0">
          <button id="suggest-schedule-btn" class="btn btn-primary" style="width:100%;justify-content:center;gap:6px;font-size:13px;background:#0ea5e9;border-color:#0ea5e9"
            onclick="suggestScheduleClick('${esc(deal.id)}','${esc(matchedClient.name)}')">
            Suggest Schedule
          </button>
        </div>
        <div id="route-results-${esc(deal.id)}"></div>`;
      }

      // Legacy external map link
      if(str(matchedClient.serviceAreaUrl).trim()){
        h+=`<div style="margin:0 0 8px 0">
          <a href="${esc(str(matchedClient.serviceAreaUrl))}" target="_blank" rel="noopener"
            class="btn btn-ghost" style="width:100%;justify-content:center;gap:6px;font-size:12px;text-decoration:none;display:flex;color:var(--text-muted)"
            onclick="event.stopPropagation()">
            Open external service area map ↗
          </a>
        </div>`;
      }

      // Show warning if no actions are enabled
      const hasPolygon = !!findPolygonForClient(matchedClient.name);
      if(!isOn('enableForward') && !isOn('enableCalendly') && !isOn('enableCopyInfo') && !isOn('enableTracker') && !str(matchedClient.serviceAreaUrl).trim() && !hasPolygon){
        h+=`<div style="margin:0 0 12px 0;padding:8px 12px;background:#fef3c7;border:1px solid #fde68a;border-radius:var(--radius);font-size:11px;color:#92400e">
          ⚠️ No actions enabled for ${esc(matchedClient.name)}. Configure in Settings → Clients.
        </div>`;
      }
    } else if(deal.campaignName){
      h+=`<div style="margin:0 0 12px 0;padding:8px 12px;background:#fef3c7;border:1px solid #fde68a;border-radius:var(--radius);font-size:11px;color:#92400e">
        ⚠️ No client matched for this campaign. Add campaign keywords in Settings → Clients.
      </div>`;
    }
  }

  // ACQUISITION PIPELINE — Demo Call + Strategy Call buttons (Calendly popup widgets)
  if(deal.pipeline==='Acquisition'){
    h+=`<div style="margin:0 0 8px 0;display:flex;gap:6px">
      <button class="btn btn-primary"
        style="flex:1;justify-content:center;gap:6px;font-size:12px;display:flex;background:#2563eb;border-color:#2563eb"
        onclick="event.stopPropagation();openAcqCalendly('${esc(deal.id)}','demo')">
        ${svgIcon('calendar',14)} Demo Call
      </button>
      <button class="btn btn-primary"
        style="flex:1;justify-content:center;gap:6px;font-size:12px;display:flex;background:#7c3aed;border-color:#7c3aed"
        onclick="event.stopPropagation();openAcqCalendly('${esc(deal.id)}','strategy')">
        ${svgIcon('calendar',14)} Strategy Call
      </button>
    </div>`;
  }

  // JustCall Dialer — inline buttons added under phone fields above

  // Location Map — show for ANY deal with an address, regardless of pipeline or matched client
  {
    const saResult = serviceAreaResults[deal.id] || {};
    const _mc = findClientForDeal(deal) || state.clients.find(c=>c.name===deal.stage) || null;
    const polyMatch = _mc ? findPolygonForClient(_mc.name) : null;
    const _addr = str(deal.address || deal.location || '').trim();
    const cachedGeo = _addr ? geocodeCache[_addr] : null;
    // Use serviceAreaResults OR fall back to geocodeCache directly
    const mapLat = saResult.lat || (cachedGeo ? cachedGeo.lat : null);
    const mapLng = saResult.lng || (cachedGeo ? cachedGeo.lng : null);
    const hasGeo = mapLat && mapLng;
    const hasAddr = _addr.length > 0;
    const hasResult = saResult.inArea !== undefined && hasGeo;

    // Status banner (only for client pipeline with polygon)
    if(hasResult && _mc){
      const bannerClass = saResult.inArea ? 'sa-in-banner' : 'sa-out-banner';
      const bannerIcon = saResult.inArea ? '&#10003;' : '&#10007;';
      const bannerText = saResult.inArea
        ? 'In ' + esc(_mc.name) + "'s service area"
        : 'Outside ' + esc(_mc.name) + "'s service area";
      h += `<div class="sa-result-banner ${bannerClass}">${bannerIcon} ${bannerText}</div>`;
    }

    // Always show a map on every deal modal
    {
      const mapId = 'sa-map-' + deal.id;
      h += `<div class="sa-map-container">
        <div id="${mapId}" style="min-height:220px"></div>
        ${(_mc || hasGeo) ? `<button class="sa-enlarge-btn" onclick="event.stopPropagation();openEnlargedMap('${esc(deal.id)}','${esc(_mc ? _mc.name : '')}')" title="Enlarge map">
          ⛶ Enlarge
        </button>` : ''}
      </div>`;

      // Auto-geocode if address exists but not yet geocoded
      const needsGeocode = hasAddr && !cachedGeo;
      if(needsGeocode){
        const _did = deal.id;
        setTimeout(() => geocodeAndCheckDeal(_did), 100);
      }

      // Render map — if geocoding is pending, only pass polygon/client (no fake lat/lng)
      // so the map centers on the polygon instead of flashing at US center first
      {
        const renderLat = hasGeo ? mapLat : null;
        const renderLng = hasGeo ? mapLng : null;
        const renderZoom = hasGeo ? undefined : undefined;
        setTimeout(() => renderServiceAreaMap(mapId, deal.id, {
          clientName: _mc ? _mc.name : '',
          polygonKey: polyMatch ? polyMatch.key : undefined,
          lat: renderLat, lng: renderLng,
          inArea: saResult.inArea,
          defaultZoom: renderZoom
        }), 200);
      }
    }
  }

  // Lead Timeline
  {
    const events=[];
    if(deal.createdDate) events.push({date:deal.createdDate,label:'Lead created',icon:'📥'});
    if(deal.forwardedAt) events.push({date:deal.forwardedAt,label:'Forwarded to client',icon:'📧'});
    if(deal.bookedDate) events.push({date:deal.bookedDate+'T'+(deal.bookedTime||'00:00'),label:'Meeting scheduled',icon:'📅'});
    if(deal.pushedToTracker) events.push({date:deal.pushedToTracker,label:'Pushed to Lead Tracker',icon:'📤'});
    if(deal.lastUpdated && deal.lastUpdated !== deal.createdDate) events.push({date:deal.lastUpdated,label:'Last updated',icon:'✏️'});
    events.sort((a,b)=>new Date(a.date)-new Date(b.date));
    if(events.length){
      h+=`<details style="margin:0 0 12px 0;border:1px solid var(--border);border-radius:8px;background:#fafafa">
        <summary style="padding:8px 12px;font-size:12px;font-weight:700;color:var(--text);cursor:pointer;list-style:none;display:flex;align-items:center;gap:6px">
          <span style="font-size:10px">▶</span> ${svgIcon('list',14)} Lead Timeline (${events.length})
        </summary>
        <div style="padding:0 12px 10px;border-left:2px solid #d1d5db;margin-left:22px">
          ${events.map(e=>`<div style="padding:4px 0 4px 10px;font-size:11px;color:#374151;position:relative">
            <span style="position:absolute;left:-7px;top:6px;width:8px;height:8px;background:#d1d5db;border-radius:50%;border:2px solid #fafafa"></span>
            <span>${e.icon} ${esc(e.label)}</span>
            <span style="color:#9ca3af;margin-left:6px">${fmtTimestamp(e.date)}</span>
          </div>`).join('')}
        </div>
      </details>`;
    }
  }

  // Activities section — hidden for client users
  if(!isClient()){
  h+=`<div id="activities-container"><div class="activities-section">
    <div class="activities-header">
      <h4>Activities</h4>
      <button class="sop-btn ${state.showSop?'active':''}" onclick="state.showSop=!state.showSop;refreshModal()">${svgIcon('clipboard',14)} Assign SOP Day</button>
    </div>`;

  if(state.showSop){
    const sopDays=getSopDays(deal);
    h+=`<div class="sop-grid">
      <div style="width:100%;margin-bottom:8px;display:flex;align-items:center;gap:8px">
        <label style="font-size:11px;font-weight:600;color:#6b7280">Date:</label>
        <input type="date" id="sop-target-date" value="${TODAY()}" style="padding:4px 8px;border:1px solid #a7f3d0;border-radius:6px;font-size:12px;font-family:inherit">
        <span style="font-size:10px;color:#6ee7b7">${deal.pipeline==='Client'?'Client SOP':'Acquisition SOP'}</span>
      </div>
      ${(deal.stage==='Discovery Scheduled'||deal.stage==='Demo Scheduled')&&deal.bookedDate&&/^\d{4}-\d{2}-\d{2}$/.test(deal.bookedDate)?`
      <button class="sop-day-btn" style="background:#2563eb;color:#fff;border-color:#2563eb" onclick="generateAppointmentSequence(state.deals.find(d=>d.id==='${esc(deal.id)}'));state.showSop=false;refreshModal()">
        ${svgIcon('calendar',12,'#fff')} Appointment Sequence
        <span style="font-weight:400;color:#bfdbfe">(${(()=>{const dd=Math.round((new Date(deal.bookedDate+'T00:00:00')-new Date(TODAY()+'T00:00:00'))/(1000*60*60*24));return dd+'d out'})()})</span>
      </button>`:''}
      ${Object.entries(sopDays).map(([day,acts])=>`
      <button class="sop-day-btn" onclick="doAssignSequenceWithDate('${deal.id}','${day}')">${day} <span style="font-weight:400;color:#6ee7b7">(${acts.length})</span></button>`).join("")}</div>`;
  }

  h+=`<div class="add-act-row">
    <select id="new-act-type">${ACTIVITY_TYPES.map(t=>`<option value="${t}">${ACTIVITY_ICONS[t]||""} ${t}</option>`).join("")}</select>
    <input id="new-act-subject" placeholder="Subject" style="flex:1">
    <input id="new-act-date" type="date" value="${TODAY()}">
    <button class="btn btn-primary" onclick="doAddActivity('${deal.id}')">+ Add</button>
  </div>`;

  // Pending
  for(const a of pending){
    const dd=(a.dueDate||'').slice(0,10);
    const today=getToday();
    const nowDate=new Date();
    let overdue=dd&&dd<today;
    const dueToday=dd===today;
    // Time-based overdue: if due today and has a scheduledTime, mark overdue if past that time
    let timeOverdue=false;
    if(dueToday && a.scheduledTime){
      const [h24,m24]=(a.scheduledTime||'').split(':').map(Number);
      if(!isNaN(h24) && (nowDate.getHours()>h24 || (nowDate.getHours()===h24 && nowDate.getMinutes()>=m24))){
        timeOverdue=true;
        overdue=true;
      }
    }
    const cls=overdue?'overdue':dueToday?'today':'future';
    const timeLabel=a.scheduledTime?fmtTime12(a.scheduledTime):'';
    const createdStr=a.createdDate?'<span style="font-size:9px;color:#b0b0b0;margin-left:4px" title="Created '+fmtTimestamp(a.createdDate)+'">'+fmtTimestamp(a.createdDate)+'</span>':'';
    h+=`<div class="act-item ${cls}">
      <input type="checkbox" onchange="toggleActivity('${a.id}')">
      <span style="font-size:13px">${ACTIVITY_ICONS[a.type]||"✓"}</span>
      <span class="act-subject">${esc(a.subject||a.type)}${timeLabel?'<span style="font-size:10px;color:'+(timeOverdue?'#ef4444':overdue?'#ef4444':'#6b7280')+';margin-left:4px;font-weight:600">by '+timeLabel+'</span>':''}</span>
      ${a.dayLabel?`<span class="act-day-label">${esc(a.dayLabel)}</span>`:''}
      ${a.dueDate?`<input type="date" value="${dd}" style="font-size:10px;color:${overdue?'#ef4444':dueToday?'#059669':'#9ca3af'};background:none;border:none;cursor:pointer;padding:0;width:90px" onchange="updateActivityDate('${a.id}',this.value)">`:''}
      <button class="act-delete" onclick="deleteActivity('${a.id}')">×</button>
    </div>
    ${createdStr?'<div style="padding-left:28px;margin-top:-4px;margin-bottom:4px">'+createdStr+'</div>':''}`;
  }

  // Completed
  if(completed.length){
    h+=`<details style="margin-top:8px"><summary class="completed-toggle">Completed (${completed.length})</summary>`;
    for(const a of completed){
      const completedStr=a.completedAt?'<span style="font-size:9px;color:#22c55e;margin-left:6px">✓ '+fmtTimestamp(a.completedAt)+'</span>':'';
      h+=`<div class="completed-item">
        <input type="checkbox" checked onchange="toggleActivity('${a.id}')">
        <span style="font-size:13px">${ACTIVITY_ICONS[a.type]||"✓"}</span>
        <span class="act-subject">${esc(a.subject||a.type)}${completedStr}</span>
      </div>`;
    }
    h+=`</details>`;
  }

  if(!pending.length&&!completed.length) h+=`<div class="no-activities">No activities yet</div>`;

  h+=`</div></div></div>`;
  } // end !isClient() activities block

  h+=`<div class="modal-footer">
      ${isAdmin()||isEmployee()?`<button class="btn btn-danger" onclick="if(confirm('Archive this deal?'))deleteDeal('${deal.id}','Deleted/Lost')">Archive</button>`:''}
      ${isClient()?`<button class="btn btn-danger" onclick="if(confirm('Archive this lead?'))archiveDeal('${deal.id}','manual')">Archive</button>`:''}
      <div style="display:flex;gap:8px">
        <button class="btn" style="background:#f9fafb;color:#6b7280;border:1px solid #e5e7eb" onclick="closeDealModal()">Close</button>
        <button class="btn btn-primary" onclick="doSaveDeal('${deal.id}')">Save</button>
      </div>
    </div></div></div>`;
  return h;
}

export function renderNewDealModal(stages){
  const defVal=state.pipeline==="acquisition"?1057:0;
  const isClientView = isClient();
  const fields = isClientView
    ? ["company:Company/Name","contact:Contact Name","email:Email","phone:Phone","location:Address/Location"]
    : ["company:Company","contact:Contact Name","email:Email","phone:Phone","website:Website"];
  return`<div class="modal-overlay" onmousedown="this._mdownTarget=event.target" onclick="if(event.target===this&&this._mdownTarget===this){state.showNew=false;render()}">
    <div class="modal" style="width:440px" onclick="event.stopPropagation()">
      <div class="modal-header"><h3>${isClientView?'New Lead':'New Deal'}</h3><button class="modal-close" onclick="state.showNew=false;render()">×</button></div>
      <div class="modal-body">
        <div class="form-grid">
          ${fields.map(f=>{
            const[k,label]=f.split(":");
            return`<div class="form-group"><label>${label}</label><input id="new-${k}"></div>`;
          }).join("")}
          ${!isClientView?`<div class="form-group"><label>Deal Value ($)</label><input id="new-value" type="number" value="${defVal}"></div>`:''}
          ${!isClientView?`<div class="form-group form-span2">
            <label>Stage</label>
            <select id="new-stage">${stages.map(s=>`<option value="${esc(s.id)}">${esc(s.label)}</option>`).join("")}</select>
          </div>`:''}
          ${isClientView?`<div class="form-group form-span2">
            <label>Notes</label>
            <textarea id="new-notes" rows="2" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);resize:vertical"></textarea>
          </div>`:''}
        </div>
      </div>
      <div class="modal-footer" style="justify-content:flex-end">
        <button class="btn" style="background:#f9fafb;color:#6b7280;border:1px solid #e5e7eb" onclick="state.showNew=false;render()">Cancel</button>
        <button class="btn btn-primary" onclick="doCreateDeal()">Create ${isClientView?'Lead':'Deal'}</button>
      </div>
    </div></div>`;
}

export function renderAddClientModal(){
  const fS=`width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;font-family:var(--font);outline:none;margin-top:3px`;
  const lS=`font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;display:block;margin-top:10px`;
  return`<div class="modal-overlay" onmousedown="this._mdownTarget=event.target" onclick="if(event.target===this&&this._mdownTarget===this){state.showAddClient=false;render()}">
    <div class="modal" style="width:420px;max-height:90vh;overflow-y:auto" onclick="event.stopPropagation()">
      <div style="padding:20px">
        <h3 style="margin:0 0 4px;font-size:16px;font-weight:800">Add Client</h3>
        <p style="font-size:11px;color:#9ca3af;margin:0 0 16px">All fields except name can be updated later in Settings → Clients.</p>

        <label style="${lS}">Client Name *</label>
        <input id="new-client-name" placeholder="e.g. Lightning Lawn Care" style="${fS}"
          onkeydown="if(event.key==='Enter'){doAddClient()}">

        <label style="${lS}">Campaign Keywords</label>
        <input id="new-client-keywords" placeholder="keyword1, keyword2 (matches Smartlead campaign name)" style="${fS}">

        <label style="${lS}">Contact First Name</label>
        <input id="new-client-firstname" placeholder="e.g. Joel" style="${fS};width:160px">

        <label style="${lS}">Notification Email(s)</label>
        <input id="new-client-email" placeholder="owner@company.com, manager@company.com" style="${fS}">

        <label style="${lS}">Calendly URL</label>
        <input id="new-client-calendly" placeholder="https://calendly.com/..." style="${fS}">

        <label style="${lS}">Service Area Map URL</label>
        <input id="new-client-mapurl" placeholder="https://workiz.com/... or any map link" style="${fS}">
        <p style="font-size:10px;color:#9ca3af;margin:3px 0 0">Lead addresses will be pre-filled in the search when you click Check Service Area.</p>

        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
          <button class="btn" style="background:#f9fafb;color:#6b7280;border:1px solid #e5e7eb" onclick="state.showAddClient=false;render()">Cancel</button>
          <button class="btn btn-primary" onclick="doAddClient()">Add Client</button>
        </div>
      </div>
    </div></div>`;
}

window.renderDealModal = renderDealModal;
window.renderNewDealModal = renderNewDealModal;
window.renderAddClientModal = renderAddClientModal;
// Expose globals needed by inline onclick handlers in render HTML
// Deferred to avoid circular import TDZ errors
setTimeout(() => {
  window.state = state;
  window.render = render;
  window.refreshModal = refreshModal;
  window.generateAppointmentSequence = generateAppointmentSequence;
}, 0);

// Additional functions called from inline HTML
export function confirmScheduleAndCopy(){
  const dealId=window._schedDealId;
  const deal=state.deals.find(d=>d.id===dealId);
  if(!deal) return;
  const dateVal=document.getElementById('sched-date')?.value||'';
  const timeVal=document.getElementById('sched-time')?.value||'';
  deal.bookedDate=dateVal;
  deal.bookedTime=timeVal;
  const dateEl=document.getElementById('deal-bookedDate');
  const timeEl=document.getElementById('deal-bookedTime');
  if(dateEl) dateEl.value=dateVal;
  if(timeEl) timeEl.value=timeVal;
  pendingWrites.value++;
  sbUpdateDeal(dealId, camelToSnake({bookedDate:dateVal,bookedTime:timeVal})).catch(e=>console.error('Update deal failed:',e)).finally(()=>{pendingWrites.value--;});
  const client=findClientForDeal(deal)||state.clients.find(c=>c.name===deal.stage);
  if(client && dateVal){
    import('./calendly.js').then(mod=>{
      const apptAddr=(deal.address||deal.location||'').trim();
      mod.saveAppointment(client.name, deal.company||deal.contact||'Unknown', dateVal, timeVal, '', apptAddr);
    });
  }
  document.getElementById('schedule-prompt-overlay')?.remove();
  if(window._schedOnDone) window._schedOnDone();
}

export function skipScheduleAndCopy(){
  document.getElementById('schedule-prompt-overlay')?.remove();
  if(window._schedOnDone) window._schedOnDone();
}

window.confirmScheduleAndCopy = confirmScheduleAndCopy;
window.skipScheduleAndCopy = skipScheduleAndCopy;

// ─── Auto Follow-Up (SmartLead Subsequence) ───
async function startAutoFollowUp(dealId){
  const deal = state.deals.find(d => d.id === dealId);
  if(!deal){ console.error('[Subseq] Deal not found:', dealId); return; }
  if(!deal.slLeadId || !deal.slCampaignId){ console.error('[Subseq] Missing SmartLead IDs:', {slLeadId:deal.slLeadId, slCampaignId:deal.slCampaignId}); return; }
  if(!confirm('Start automated email follow-up sequence for this lead?\n\nSmartLead will send follow-up emails automatically until they reply.')) return;

  const btn = document.querySelector('.sl-subseq-btn');
  if(btn){ btn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px"><svg width="14" height="14" viewBox="0 0 24 24" style="animation:spin 1s linear infinite"><style>@keyframes spin{to{transform:rotate(360deg)}}</style><circle cx="12" cy="12" r="10" stroke="#fff" stroke-width="3" fill="none" stroke-dasharray="31.4 31.4" stroke-linecap="round"/></svg> Starting\u2026</span>'; btn.disabled = true; }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    console.log('[Subseq] Calling edge function...', { leadId:deal.slLeadId, campaignId:deal.slCampaignId, email:deal.email });
    const url = `${SUPABASE_URL}/functions/v1/smartlead-subsequence`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ action:'start-subsequence', leadId:deal.slLeadId, campaignId:deal.slCampaignId, dealId:deal.id, email:deal.email }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const result = await resp.json();
    console.log('[Subseq] Response:', resp.status, result);

    if(resp.ok && result.status === 'ok'){
      deal.leadCategory = 'HT Subsequence FU';
      refreshModal();
    } else {
      throw new Error(result.error || `SmartLead returned ${resp.status}`);
    }
  } catch(e){
    clearTimeout(timeout);
    const msg = e.name === 'AbortError' ? 'Request timed out (25s). The lead lookup may be slow — try again.' : e.message;
    console.error('[Subseq] Error:', e);
    alert('Failed to start auto follow-up: ' + msg);
    if(btn){ btn.innerHTML = '\u26A0 Retry Follow-Up'; btn.disabled = false; }
  }
}
window.startAutoFollowUp = startAutoFollowUp;
