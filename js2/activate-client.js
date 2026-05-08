// ═══════════════════════════════════════════════════════════
// ACTIVATE-CLIENT — Client onboarding modal
// ═══════════════════════════════════════════════════════════
import { state, pendingWrites } from './app.js';
import { API_URL } from './config.js';
import { render } from './render.js';
import { apiPost, initialSync } from './api.js';
import { esc, str, uid } from './utils.js';
import { addClient } from './client-info.js';

export function renderActivateClientModal(){
  const loading=state.activateClientLoading;
  const clients=state.unactivatedClients||[];
  const sel=state.activateSelectedClient;
  const loadingList=state.activateClientsLoading;

  return`<div class="modal-overlay" onmousedown="this._mdownTarget=event.target" onclick="if(event.target===this&&this._mdownTarget===this&&!state.activateClientLoading){state.showActivateClient=false;render()}">
    <div class="modal" style="width:440px;max-height:90vh;overflow-y:auto" onclick="event.stopPropagation()">
      <div id="activate-modal-inner" style="padding:20px">
        <h3 style="margin:0 0 4px;font-size:16px;font-weight:800">\u26A1 Activate Client</h3>
        <p style="font-size:11px;color:#9ca3af;margin:0 0 16px">Pick a client from the Client Info sheet. Everything is pulled automatically.</p>

        ${loadingList?'<p style="font-size:12px;color:var(--purple)">Loading clients from Client Info sheet...</p>':''}
        ${!loadingList&&clients.length===0?'<p style="font-size:12px;color:#9ca3af">No unactivated clients found. Add a client to the Client Info sheet first.</p>':''}
        ${!loadingList&&clients.length>0?`
          <div style="display:flex;flex-direction:column;gap:6px;max-height:300px;overflow-y:auto">
            ${clients.map((c,idx)=>{
              const isSelected=sel&&sel.row===c.row;
              return`<div onclick="state.activateSelectedClient=state.unactivatedClients[${idx}];refreshActivateModal()" style="padding:10px 12px;border:2px solid ${isSelected?'var(--purple)':'var(--border)'};border-radius:8px;cursor:pointer;background:${isSelected?'#f5f3ff':'var(--card)'};transition:all .15s">
                <div style="font-weight:600;font-size:13px">${esc(c.name)}</div>
                <div style="font-size:11px;color:#6b7280;margin-top:2px">${esc(c.contact||'')}${c.email?' \u00B7 '+esc(c.email):''}${c.location?' \u00B7 '+esc(c.location):''}</div>
                ${c.calendlyUrl?'<div style="font-size:10px;color:#22c55e;margin-top:2px">\u2713 Calendly</div>':''}
                ${c.leadCost?'<div style="font-size:10px;color:#22c55e;margin-top:1px">\u2713 Lead cost: '+esc(c.leadCost)+'</div>':''}
              </div>`;
            }).join('')}
          </div>
        `:''}

        ${loading?'<p style="font-size:12px;color:var(--purple);margin-top:12px">Activating... This may take a moment.</p>':''}
        ${state.activateResult?`<div style="margin-top:12px;padding:10px;background:${state.activateResult.ok?'#f0fdf4':'#fef2f2'};border:1px solid ${state.activateResult.ok?'#86efac':'#fca5a5'};border-radius:6px;font-size:12px;color:${state.activateResult.ok?'#166534':'#991b1b'}">${state.activateResult.html}</div>`:''}

        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
          <button class="btn" style="background:#f9fafb;color:#6b7280;border:1px solid #e5e7eb" onclick="state.showActivateClient=false;state.activateSelectedClient=null;state.activateResult=null;render()" ${loading?'disabled':''}>Cancel</button>
          <button class="btn btn-primary" onclick="doActivateClient()" ${loading||!sel?'disabled':''}>${loading?'Activating...':'\u26A1 Activate'}</button>
        </div>
      </div>
    </div></div>`;
}

export function refreshActivateModal(){
  const el=document.getElementById('activate-modal-inner');
  if(!el) return;
  const loading=state.activateClientLoading;
  const clients=state.unactivatedClients||[];
  const sel=state.activateSelectedClient;
  const loadingList=state.activateClientsLoading;
  let h=`<h3 style="margin:0 0 4px;font-size:16px;font-weight:800">\u26A1 Activate Client</h3>
    <p style="font-size:11px;color:#9ca3af;margin:0 0 16px">Pick a client from the Client Info sheet. Everything is pulled automatically.</p>
    ${loadingList?'<p style="font-size:12px;color:var(--purple)">Loading clients from Client Info sheet...</p>':''}
    ${!loadingList&&clients.length===0?'<p style="font-size:12px;color:#9ca3af">No unactivated clients found. Add a client to the Client Info sheet first.</p>':''}
    ${!loadingList&&clients.length>0?`<div style="display:flex;flex-direction:column;gap:6px;max-height:300px;overflow-y:auto">
      ${clients.map((c,idx)=>{
        const isSelected=sel&&sel.row===c.row;
        return`<div onclick="state.activateSelectedClient=state.unactivatedClients[${idx}];refreshActivateModal()" style="padding:10px 12px;border:2px solid ${isSelected?'var(--purple)':'var(--border)'};border-radius:8px;cursor:pointer;background:${isSelected?'#f5f3ff':'var(--card)'};transition:all .15s">
          <div style="font-weight:600;font-size:13px">${esc(c.name)}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:2px">${esc(c.contact||'')}${c.email?' \u00B7 '+esc(c.email):''}${c.location?' \u00B7 '+esc(c.location):''}</div>
          ${c.calendlyUrl?'<div style="font-size:10px;color:#22c55e;margin-top:2px">\u2713 Calendly</div>':''}
          ${c.leadCost?'<div style="font-size:10px;color:#22c55e;margin-top:1px">\u2713 Lead cost: '+esc(c.leadCost)+'</div>':''}
        </div>`;
      }).join('')}
    </div>`:''}
    ${loading?'<p style="font-size:12px;color:var(--purple);margin-top:12px">Activating... This may take a moment.</p>':''}
    ${state.activateResult?`<div style="margin-top:12px;padding:10px;background:${state.activateResult.ok?'#f0fdf4':'#fef2f2'};border:1px solid ${state.activateResult.ok?'#86efac':'#fca5a5'};border-radius:6px;font-size:12px;color:${state.activateResult.ok?'#166534':'#991b1b'}">${state.activateResult.html}</div>`:''}
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
      <button class="btn" style="background:#f9fafb;color:#6b7280;border:1px solid #e5e7eb" onclick="state.showActivateClient=false;state.activateSelectedClient=null;state.activateResult=null;render()" ${loading?'disabled':''}>Cancel</button>
      <button class="btn btn-primary" onclick="doActivateClient()" ${loading||!sel?'disabled':''}>${loading?'Activating...':'\u26A1 Activate'}</button>
    </div>`;
  el.innerHTML=h;
}

export async function openActivateClient(){
  state.showActivateClient=true;
  state.activateSelectedClient=null;
  state.activateResult=null;
  state.unactivatedClients=[];
  state.activateClientsLoading=true;
  render();
  try{
    const resp=await fetch(API_URL+'?action=get_unactivated_clients');
    const result=await resp.json();
    const clients=result.clients||result;
    state.unactivatedClients=Array.isArray(clients)?clients:[];
    if(result.headers) console.log('Client Info headers:',result.headers);
  }catch(e){
    state.unactivatedClients=[];
  }
  state.activateClientsLoading=false;
  render();
}

export async function doActivateClient(){
  const sel=state.activateSelectedClient;
  if(!sel) return;

  state.activateClientLoading=true;
  state.activateResult=null;
  refreshActivateModal();

  try{
    const resp=await apiPost('activate_client',{
      clientInfoRow:sel.row,
      calendlyUrl:sel.calendlyUrl||'',
      leadCost:sel.leadCost||''
    });

    state.activateClientLoading=false;

    if(resp.ok){
      initialSync();
      state.unactivatedClients=(state.unactivatedClients||[]).filter(c=>c.row!==sel.row);
      state.activateSelectedClient=null;
      const msg=[];
      msg.push('\u2713 Client "'+resp.clientName+'" activated!');
      if(resp.crmClientCreated) msg.push('\u2713 CRM client created with pipeline stage.');
      if(resp.dropdownsAdded) msg.push('\u2713 Added to Lead Entry + Lead Tracker dropdowns.');
      if(resp.smartlead&&resp.smartlead.ok) msg.push('\u2713 SmartLead client created.');
      else if(resp.smartlead&&resp.smartlead.error) msg.push('\u26A0 SmartLead: '+resp.smartlead.error);
      state.activateResult={ok:true,html:msg.join('<br>')};
    }else{
      state.activateResult={ok:false,html:'Error: '+(resp.error||JSON.stringify(resp))};
    }
  }catch(e){
    state.activateClientLoading=false;
    state.activateResult={ok:false,html:'Failed: '+e.message};
  }
  refreshActivateModal();
}

// Expose to inline HTML handlers
window.openActivateClient = openActivateClient;
window.doActivateClient = doActivateClient;
window.refreshActivateModal = refreshActivateModal;
