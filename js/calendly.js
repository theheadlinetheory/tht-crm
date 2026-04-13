// ═══════════════════════════════════════════════════════════
// CALENDLY — Calendly popup/inline widget integration
// ═══════════════════════════════════════════════════════════
import { state, store, pendingWrites } from './app.js';
import { TZ_TO_IANA, ACQ_CALENDLY_URLS } from './config.js';
import { render, refreshModal } from './render.js';
import { sbUpdateDeal, sbCreateAppointment, sbDeleteAppointment, camelToSnake } from './api.js';
import { esc, str, getToday, fmtTime12, uid } from './utils.js';
import { lookupClientInfo, findClientForDeal } from './client-info.js';

export function buildCalendlyUrl(baseUrl, deal){
  if(!baseUrl) return '';
  try {
    const url = new URL(baseUrl);
    if(deal){
      if(deal.contact) url.searchParams.set('name', deal.contact);
      if(deal.email) url.searchParams.set('email', deal.email);
      if(deal.company) url.searchParams.set('a1', deal.company);
    }
    return url.toString();
  } catch(e){ return baseUrl; }
}

export function openAcqCalendly(dealId, type){
  const deal=state.deals.find(d=>d.id===dealId);
  if(!deal) return;
  const baseUrl=ACQ_CALENDLY_URLS[type];
  if(!baseUrl){alert('No Calendly URL configured for '+type);return;}
  openCalendlyEmbed(dealId, baseUrl, null);
}

export function clientIanaTz(clientName){
  const info=lookupClientInfo(clientName);
  if(!info||!info.timeZone) return null;
  return TZ_TO_IANA[info.timeZone.toUpperCase()]||null;
}

let calendlyBookingDealId=null;

export function setCalendlyBookingDealId(id){
  calendlyBookingDealId=id;
}

export function toggleCalendlyBooking(dealId, calUrl){
  calendlyBookingDealId=dealId;
  // Toggle the inline prefill/review section instead of opening Calendly directly
  const section=document.getElementById('calendly-booking-section');
  if(section){
    section.style.display=section.style.display==='none'?'block':'none';
  }
}

let _prefillSaveTimers={};
export function savePrefillField(dealId, field, value){
  clearTimeout(_prefillSaveTimers[field]);
  _prefillSaveTimers[field]=setTimeout(()=>{
    const deal=state.deals.find(d=>d.id===dealId);
    if(deal){
      deal[field]=value;
      pendingWrites.value++;
      sbUpdateDeal(dealId, camelToSnake({[field]:value})).catch(e=>console.error('Update deal failed:',e)).finally(()=>{pendingWrites.value--;});
    }
  },800);
}

export function openCalendlyFromWarmCall(dealId, baseCalUrl, clientName){
  openCalendlyEmbed(dealId, baseCalUrl, clientName);
}

export function openCalendlyEmbed(dealId, baseCalUrl, clientName, overrideName, overrideEmail, overrideNotes){
  const deal=dealId?state.deals.find(d=>d.id===dealId):null;
  calendlyBookingDealId=dealId;
  const ianaTz=clientName?clientIanaTz(clientName):null;

  const urlObj=new URL(baseCalUrl);
  if(deal){
    const guestName=overrideName||deal.calName||deal.contact||deal.company||'';
    const guestEmail=overrideEmail||deal.calEmail||deal.email||'';
    const notes=overrideNotes||deal.calNotes||'';
    if(guestName) urlObj.searchParams.set('name',guestName);
    if(guestEmail) urlObj.searchParams.set('email',guestEmail);
    if(notes) urlObj.searchParams.set('a1',notes);
    else if(deal.company) urlObj.searchParams.set('a1',deal.company);
  }
  if(ianaTz) urlObj.searchParams.set('timezone',ianaTz);

  // Use Calendly popup widget
  if(window.Calendly){
    window.Calendly.initPopupWidget({url:urlObj.toString()});
  } else {
    window.open(urlObj.toString(),'_blank');
  }
}

let calendlySelectedDateTime=null;

// Listen for Calendly events
window.addEventListener('message',function(e){
  if(!e.data||!e.data.event) return;
  if(e.data.event==='calendly.event_scheduled'){
    const payload=e.data.payload||{};
    const startTime=payload.event&&payload.event.start_time;
    if(startTime && calendlyBookingDealId){
      const deal=state.deals.find(d=>d.id===calendlyBookingDealId);
      if(deal){
        const dt=new Date(startTime);
        const bookedDate=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');
        const bookedTime=String(dt.getHours()).padStart(2,'0')+':'+String(dt.getMinutes()).padStart(2,'0');
        const client=findClientForDeal(deal)||state.clients.find(c=>c.name===deal.stage);
        const clientName=client?client.name:'';
        const ianaTz=clientName?clientIanaTz(clientName):null;
        applyBookedDateTime(calendlyBookingDealId, deal, bookedDate, bookedTime, clientName, ianaTz, startTime);
      }
    }
    calendlyBookingDealId=null;
  }
});

export function applyBookedDateTime(dealId, deal, bookedDate, bookedTime, clientName, ianaTz, startTimeIso){
  deal.bookedDate=bookedDate;
  deal.bookedTime=bookedTime;
  deal.bookedTimezone=ianaTz||'';
  deal.lastUpdated=getToday();
  if(clientName){
    const apptData={
      clientName,
      leadName:deal.company||deal.contact||'Unknown',
      apptDate:bookedDate,
      apptTime:bookedTime,
      notes:'Booked via Calendly',
      address:deal.location||deal.address||''
    };
    const appt={id:uid(),...apptData};
    store.addAppointment(appt, {silent: true});
    pendingWrites.value++;
    sbCreateAppointment(camelToSnake(appt)).catch(e=>console.error('Create appointment failed:',e)).finally(()=>{pendingWrites.value--;});
  }
  // Save deal fields
  pendingWrites.value++;
  sbUpdateDeal(dealId, camelToSnake({bookedDate,bookedTime,bookedTimezone:deal.bookedTimezone,lastUpdated:deal.lastUpdated})).catch(e=>console.error('Update deal failed:',e)).finally(()=>{pendingWrites.value--;});
  if(state.selectedDeal && state.selectedDeal.id===dealId) refreshModal();
  else render();
}

export function saveAppointment(clientName, leadName, apptDate, apptTime, notes, address){
  const appt={id:uid(),clientName,leadName,apptDate,apptTime,notes:notes||'',address:address||''};
  store.addAppointment(appt, {silent: true});
  pendingWrites.value++;
  sbCreateAppointment(camelToSnake(appt)).catch(e=>console.error('Create appointment failed:',e)).finally(()=>{pendingWrites.value--;});
  return appt;
}

export function removeAppointment(id){
  store.removeAppointment(id);
  pendingWrites.value++;
  sbDeleteAppointment(id).catch(e=>console.error('Delete appointment failed:',e)).finally(()=>{pendingWrites.value--;});
}

// ─── Manual Appointment Entry ───
export function addManualAppointment(clientName){
  const overlay=document.createElement('div');
  overlay.id='manual-appt-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:100000;display:flex;align-items:center;justify-content:center';
  const todayStr=getToday();
  const existing=(state.appointments||[]).filter(a=>a.clientName===clientName&&a.apptDate&&/^\d{4}-\d{2}-\d{2}$/.test(a.apptDate)&&a.apptDate>=todayStr).sort((a,b)=>(a.apptDate+(a.apptTime||'')).localeCompare(b.apptDate+(b.apptTime||'')));
  let existHtml='';
  if(existing.length){
    existHtml='<div style="margin:8px 0;padding:6px 8px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;font-size:11px"><div style="font-weight:700;color:#166534;margin-bottom:4px">Existing ('+existing.length+')</div>'
      +existing.map(a=>{
        const dt=new Date(a.apptDate+'T'+(a.apptTime||'00:00'));
        return '<div style="color:#166534;padding:1px 0">'+esc(a.leadName||'Appt')+' \u2014 '+dt.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})+(a.apptTime?' '+dt.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):'')+'</div>';
      }).join('')+'</div>';
  }
  overlay.innerHTML='<div style="background:var(--card,#fff);border-radius:12px;padding:20px;width:340px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,.3)" onclick="event.stopPropagation()">'
    +'<div style="font-size:15px;font-weight:700;margin-bottom:12px">Add Appointment for '+esc(clientName)+'</div>'
    +existHtml
    +'<div style="margin-bottom:8px"><label style="font-size:11px;font-weight:600;color:var(--text-muted,#6b7280)">Lead / Business Name</label><input id="appt-lead" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border,#d1d5db);border-radius:6px;font-size:13px;font-family:var(--font);margin-top:2px" placeholder="e.g. Jet City"></div>'
    +'<div style="margin-bottom:8px"><label style="font-size:11px;font-weight:600;color:var(--text-muted,#6b7280)">Address</label><input id="appt-address" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border,#d1d5db);border-radius:6px;font-size:13px;font-family:var(--font);margin-top:2px" placeholder="e.g. 123 Main St, Orlando, FL"></div>'
    +'<div style="display:flex;gap:8px;margin-bottom:12px"><div style="flex:1"><label style="font-size:11px;font-weight:600;color:var(--text-muted,#6b7280)">Date</label><input type="date" id="appt-date" value="'+todayStr+'" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border,#d1d5db);border-radius:6px;font-size:13px;font-family:var(--font);margin-top:2px"></div><div style="flex:1"><label style="font-size:11px;font-weight:600;color:var(--text-muted,#6b7280)">Time</label><input type="time" id="appt-time" value="09:00" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border,#d1d5db);border-radius:6px;font-size:13px;font-family:var(--font);margin-top:2px"></div></div>'
    +'<button onclick="doSaveManualAppt(atob(\''+btoa(unescape(encodeURIComponent(clientName)))+'\'))" style="width:100%;padding:10px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font)">Save Appointment</button>'
    +'</div>';
  overlay.onmousedown=function(e){ overlay._clickStartedOnBackdrop=(e.target===overlay); };
  overlay.onclick=function(e){ if(e.target===overlay && overlay._clickStartedOnBackdrop) overlay.remove(); };
  document.body.appendChild(overlay);
  document.getElementById('appt-lead')?.focus();
}

export function doSaveManualAppt(clientName){
  const lead=(document.getElementById('appt-lead')?.value||'').trim();
  const address=(document.getElementById('appt-address')?.value||'').trim();
  const date=document.getElementById('appt-date')?.value||'';
  const time=document.getElementById('appt-time')?.value||'';
  if(!lead){ alert('Enter a lead/business name'); return; }
  if(!date){ alert('Pick a date'); return; }
  saveAppointment(clientName, lead, date, time, '', address);
  document.getElementById('manual-appt-overlay')?.remove();
}

export function showCalendlyTimeConfirm(dealId, deal, clientName, ianaTz){
  const overlay=document.createElement('div');
  overlay.id='cal-time-confirm-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100000;display:flex;align-items:center;justify-content:center';
  const tzLabel=ianaTz?` (${clientName} time)`:'';
  overlay.innerHTML=`<div style="background:#fff;border-radius:12px;width:380px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden" onclick="event.stopPropagation()">
    <div style="padding:16px 20px;background:#f5f3ff;border-bottom:1px solid #e5e7eb">
      <div style="font-size:15px;font-weight:700;color:#5b21b6">Meeting Booked!</div>
      <div style="font-size:12px;color:#6b7280;margin-top:4px">Confirm the appointment date & time${esc(tzLabel)}</div>
    </div>
    <div style="padding:20px">
      <div style="margin-bottom:12px">
        <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Date</label>
        <input type="date" id="cal-confirm-date" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;font-family:var(--font)">
      </div>
      <div style="margin-bottom:16px">
        <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Time</label>
        <input type="time" id="cal-confirm-time" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;font-family:var(--font)">
      </div>
      <button id="cal-confirm-save-btn" style="width:100%;padding:10px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;font-family:var(--font)">Confirm & Save</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  document.getElementById('cal-confirm-save-btn').onclick=function(){
    const bd=document.getElementById('cal-confirm-date').value;
    const bt=document.getElementById('cal-confirm-time').value;
    if(!bd){alert('Please select the appointment date.');return;}
    if(!bt){alert('Please select the appointment time.');return;}
    overlay.remove();
    applyBookedDateTime(dealId, deal, bd, bt, clientName, ianaTz, '');
  };
}

// Expose to inline HTML handlers
window.showCalendlyTimeConfirm = showCalendlyTimeConfirm;
window.toggleCalendlyBooking = toggleCalendlyBooking;
window.openCalendlyEmbed = openCalendlyEmbed;
window.openCalendlyFromWarmCall = openCalendlyFromWarmCall;
window.openAcqCalendly = openAcqCalendly;
window.savePrefillField = savePrefillField;
window.saveAppointment = saveAppointment;
window.removeAppointment = removeAppointment;
window.clientIanaTz = clientIanaTz;
window.addManualAppointment = addManualAppointment;
window.doSaveManualAppt = doSaveManualAppt;
