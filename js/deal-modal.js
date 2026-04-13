// ═══════════════════════════════════════════════════════════
// DEAL-MODAL — Deal detail modal, SmartLead thread viewer
// ═══════════════════════════════════════════════════════════
//
// NOTE: renderDealModal() is 450+ lines. It will be fully
// populated during the final migration. This module provides
// the key functions other modules depend on.

import { state, pendingWrites, pendingDealFields } from './app.js';
import { ACQUISITION_STAGES, NURTURE_STAGES, SOP_DAYS, ACTIVITY_TYPES, ACTIVITY_ICONS } from './config.js';
import { render, refreshModal } from './render.js';
import { apiGet, invokeEdgeFunction, sbUpdateDeal, camelToSnake } from './api.js';
import { esc, str, getToday, TODAY, uid, svgIcon, fmtDate, fmtTime12, fmtTimestamp, stripHtml } from './utils.js';
import { isAdmin, isClient, isEmployee } from './auth.js';
import { saveDeal, createDeal, moveDeal, deleteDeal as deleteDealFn } from './deals.js';
import { addActivity, assignSequence, getSopDays, renderUpcomingMeetings, generateAppointmentSequence } from './activities.js';
import { addClient, findClientForDeal, lookupClientInfo, isRetainerClient, getWarmCallQA, isZeroCostClient } from './client-info.js';
import { getStagesForPipeline } from './dashboard.js';
import { renderServiceAreaMap, findPolygonForClient, serviceAreaResults, geocodeCache, geocodeAndCheckDeal } from './maps.js';
import { loadSmartleadThread, renderSmartleadThread, renderThreadMessage, toggleFullThread, getThreadCache, openSendToClientPreview, doSendToClientThread } from './threads.js';

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
  state.selectedDeal=null;
  state.showSop=false;
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
      'email2','email3','email4','bookedDate','bookedTime','bookedFor','prefillName','prefillEmail','prefillNotes'];
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
  createDeal(form);
}

export function doAddClient(){
  const nameEl=document.getElementById('new-client-name');
  const name=nameEl?nameEl.value.trim():'';
  if(!name){alert('Enter a client name');return;}
  state.showAddClient=false;
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
  const client=deal?(findClientForDealSync(deal)||{name:deal.stage}):null;
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
  const client=findClientForDealSync(deal)||state.clients.find(c=>c.name===deal.stage);
  const clientName=client?client.name:deal.stage;

  // Auto-push to tracker on Won
  try {
    const { autoPushToTracker } = await import('./email.js');
    await autoPushToTracker(deal);
  } catch(e){ console.warn('Tracker push on won failed:', e); }

  const { deleteDeal } = await import('./deals.js');
  deleteDeal(id, 'Closed Won', clientName);
}

function findClientForDealSync(deal){
  // Sync version — avoids import
  if(deal.pipeline==='Client' && deal.stage){
    return state.clients.find(c=>c.name===deal.stage);
  }
  return null;
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
        <div class="form-grid">
          ${["company:Company","contact:Contact Name","email:Email","phone:Business Phone","mobilePhone:Mobile Phone","website:Website","location:Address",...(isAdmin()?["value:Deal Value ($)"]:[])].map(f=>{
            const[k,label]=f.split(":");
            let extra='';
            if((k==='phone'||k==='mobilePhone') && deal[k]){
              const ph=String(deal[k]).replace(/[^0-9+]/g,'');
              extra='<div id="phone-btns-'+k+'" style="margin-top:4px;display:flex;gap:6px">'
                +(!isClient()?'<button onclick="callInJustCall(\''+esc(deal.id)+'\');event.stopPropagation()" class="imessage-btn" style="display:inline-flex;align-items:center;gap:4px;background:#f97316;color:#fff;border-color:#f97316;cursor:pointer;font-weight:600">'+svgIcon('phone',14,'#fff')+' Call</button>':'')
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
        <div class="form-group form-span2" style="margin-bottom:16px">
          <label>Notes</label>
          <textarea id="deal-notes" rows="2" oninput="updateDealField('notes',this.value)">${esc(deal.notes||'')}</textarea>
        </div>${deal.pipeline==='Client'?`
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
        </div>`:''}`;

  if(deal.campaignName){
    h+=`<div class="sl-info">
      <div class="sl-info-title">Smartlead Source</div>
      <div>Campaign: ${esc(deal.campaignName)}</div>
      ${deal.leadCategory?`<div>Category: ${esc(deal.leadCategory)}</div>`:''}
      ${(deal.smartleadUrl||deal.email)?`<a href="${esc(deal.smartleadUrl||('https://app.smartlead.ai/app/master-inbox?sortBy=REPLY_TIME_DESC&search='+encodeURIComponent(deal.email)))}" target="_blank" rel="noopener">Open in Smartlead →</a>`:''}
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
        const zeroCost=isZeroCostClient(matchedClient.name||'');
        h+=`<div style="margin:0 0 8px 0">
          <button id="push-tracker-btn" class="btn ${pushed?'btn-ghost':'btn-primary'}" style="width:100%;justify-content:center;gap:6px;font-size:13px"
            onclick="${pushed?'':'pushToLeadTracker(\''+deal.id+'\')'}" ${pushed?'disabled':''}>
            ${pushed?'<span style="color:#059669">Pushed to Lead Tracker</span>':svgIcon('upload',14)+' Push to Lead Tracker'}
          </button>
        </div>`;
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

      // Render map — skip if geocoding will replace it shortly
      if(hasGeo || !needsGeocode){
        const renderLat = mapLat || 39.8;
        const renderLng = mapLng || -98.5;
        const renderZoom = hasGeo ? undefined : 4;
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
