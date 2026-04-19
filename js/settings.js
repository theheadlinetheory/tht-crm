// ═══════════════════════════════════════════════════════════
// SETTINGS — Settings panel, auto-save, apply settings
// ═══════════════════════════════════════════════════════════
import { state, pendingWrites, settingsOpen, setSettingsOpen, settingsTab, setSettingsTab,
         settingsDraft, setSettingsDraft, clientsSubTab, setClientsSubTab } from './app.js';
import { ACQUISITION_STAGES, NURTURE_STAGES, SOP_DAYS, CLIENT_SOP_DAYS, ACTIVITY_TYPES, ACTIVITY_ICONS } from './config.js';
import { render } from './render.js';
import { apiPost, apiGet, sbBatchUpdateClients, camelToSnake, supabase } from './api.js';
import { esc, str, svgIcon } from './utils.js';
import { isAdmin, currentUser, loadAllUsers, updateUserRole, updateUserClient, db } from './auth.js';
import { lookupClientInfo } from './client-info.js';
import { findPolygonForClient } from './maps.js';

export function getDefaultSettings(){
  return {
    acquisition_stages: [...ACQUISITION_STAGES],
    nurture_stages: [...NURTURE_STAGES],
    activity_types: ACTIVITY_TYPES.map((t,i)=>({name:typeof t==='string'?t:t.name, icon:(typeof t==='string'?(ACTIVITY_ICONS[t]||'\u2713'):t.icon)||'\u2713', order:i})),
    sop_acquisition: Object.entries(SOP_DAYS).map(([name,acts])=>({name,activities:acts.map(a=>({type:a.type,subject:a.subject}))})),
    sop_client: Object.entries(CLIENT_SOP_DAYS).map(([name,acts])=>({name,activities:acts.map(a=>({type:a.type,subject:a.subject}))})),
  };
}

export function openSettings(){
  if(!isAdmin()) return;
  const draft = getDefaultSettings();
  if(state.savedSettings){
    for(const k of Object.keys(draft)){
      if(state.savedSettings[k]) draft[k] = JSON.parse(JSON.stringify(state.savedSettings[k]));
    }
  }
  setSettingsDraft(draft);
  setSettingsOpen(true);
  renderSettingsPanel();
}

export function closeSettings(){
  setSettingsOpen(false);
  const overlay = document.getElementById('settings-overlay');
  const panel = document.getElementById('settings-panel');
  if(overlay) overlay.classList.remove('open');
  if(panel) panel.classList.remove('open');
  setTimeout(()=>{
    if(overlay) overlay.remove();
    if(panel) panel.remove();
  }, 250);
}

let _autoSaveTimer = null;
let _expandedClientId = null;
let _expandedPipelineSections = { stages: false, activities: false, sop: false };

window.togglePipelineSection = function(section){
  _expandedPipelineSections[section] = !_expandedPipelineSections[section];
  const container = document.getElementById('pipeline-section-'+section);
  const chevron = document.getElementById('pipeline-chevron-'+section);
  if(container){
    container.style.display = _expandedPipelineSections[section] ? 'block' : 'none';
  }
  if(chevron){
    chevron.textContent = _expandedPipelineSections[section] ? '\u25BE' : '\u25B8';
  }
};

window.toggleClientAccordion = function(clientId){
  _expandedClientId = (_expandedClientId === clientId) ? null : clientId;
  const container = document.getElementById('settings-clients-container');
  if(!container) return;
  // Update all cards without full re-render to preserve form state
  container.querySelectorAll('.client-card-accordion').forEach(card => {
    const cid = card.dataset.clientId;
    const body = card.querySelector('.client-body');
    const chevron = card.querySelector('.client-chevron');
    if(cid === _expandedClientId){
      body.style.display = 'block';
      if(chevron) chevron.textContent = '\u25BE';
    } else {
      body.style.display = 'none';
      if(chevron) chevron.textContent = '\u25B8';
    }
  });
};

export function debouncedAutoSave(){
  clearTimeout(_autoSaveTimer);
  const statusEl = document.getElementById('settings-autosave-status');
  if(statusEl) statusEl.textContent = 'Unsaved changes...';
  _autoSaveTimer = setTimeout(async ()=>{
    try{
      applySettings(settingsDraft);
      const clientUpdates = state.clients.filter(c=>c.id).map(c=>({
        id:c.id,
        notifyEmails:str(c.notifyEmails),
        notifyEmail:str(c.notifyEmails),
        campaignKeywords:str(c.campaignKeywords),
        contactFirstName:str(c.contactFirstName),
        calendlyUrl:str(c.calendlyUrl),
        enableForward:str(c.enableForward),
        enableCalendly:str(c.enableCalendly),
        enableAutoForward:str(c.enableAutoForward),
        enableCopyInfo:str(c.enableCopyInfo),
        enableTracker:str(c.enableTracker),
        leadCost:str(c.leadCost),
        serviceAreaUrl:str(c.serviceAreaUrl),
        clientNotes:str(c.clientNotes||''),
        warmCallNotesText:str(c.warmCallNotesText||''),
        clientStanding:str(c.clientStanding||'neutral'),
        homeBase:str(c.homeBase||''),
        timeZone:str(c.timeZone||''),
        ghlLocationId:str(c.ghlLocationId||''),
        ghlApiKey:str(c.ghlApiKey||'')
      }));
      await Promise.all([
        apiPost('save_settings',{settings:settingsDraft}),
        sbBatchUpdateClients(clientUpdates.map(c => ({id:c.id, ...camelToSnake(c)})))
      ]);
      const s = document.getElementById('settings-autosave-status');
      if(s) s.textContent = '\u2713 Auto-saved';
      setTimeout(()=>{ const s2=document.getElementById('settings-autosave-status'); if(s2 && s2.textContent==='\u2713 Auto-saved') s2.textContent=''; }, 2000);
    }catch(e){
      const s = document.getElementById('settings-autosave-status');
      if(s) s.textContent = '\u26A0 Save failed';
    }
  }, 1500);
}

export function applySettings(s, skipCache){
  if(!s) return;
  state.savedSettings = s;
  if(!skipCache) try{ localStorage.setItem('tht_settings',JSON.stringify(s)); }catch(e){}
  if(s.acquisition_stages){
    ACQUISITION_STAGES.length=0;
    s.acquisition_stages.forEach(st=>ACQUISITION_STAGES.push({id:st.id||st.label,label:st.label,color:st.color}));
  }
  if(s.nurture_stages){
    NURTURE_STAGES.length=0;
    s.nurture_stages.forEach(st=>NURTURE_STAGES.push({id:st.id||st.label,label:st.label,color:st.color}));
  }
  if(s.activity_types){
    ACTIVITY_TYPES.length=0;
    s.activity_types.forEach(t=>{
      ACTIVITY_TYPES.push(t.name);
      ACTIVITY_ICONS[t.name]=t.icon||'\u2713';
    });
  }
  if(s.sop_acquisition){
    Object.keys(SOP_DAYS).forEach(k=>delete SOP_DAYS[k]);
    s.sop_acquisition.forEach(seq=>{
      SOP_DAYS[seq.name]=seq.activities.map(a=>({type:a.type,subject:a.subject}));
    });
  }
  if(s.sop_client){
    Object.keys(CLIENT_SOP_DAYS).forEach(k=>delete CLIENT_SOP_DAYS[k]);
    s.sop_client.forEach(seq=>{
      CLIENT_SOP_DAYS[seq.name]=seq.activities.map(a=>({type:a.type,subject:a.subject}));
    });
  }
  if(s.clientCalendlyUrls){
    try{
      const urls=typeof s.clientCalendlyUrls==='string'?JSON.parse(s.clientCalendlyUrls):s.clientCalendlyUrls;
      if(Array.isArray(urls)){
        for(const u of urls){
          const c=state.clients.find(x=>x.name===u.name);
          if(c){ if(u.calendlyUrl) c.calendlyUrl=u.calendlyUrl; if(u.color) c.color=u.color; }
        }
      }
    }catch(e){}
  }
}

// ─── Settings Panel Render ───
export function renderSettingsPanel(){
  const existingPanel = document.getElementById('settings-panel');
  const existingOverlay = document.getElementById('settings-overlay');
  let savedScroll = 0;
  if(existingPanel){
    const body = existingPanel.querySelector('.settings-body');
    if(body) savedScroll = body.scrollTop;
  }
  if(existingOverlay) existingOverlay.remove();
  if(existingPanel) existingPanel.remove();

  const overlay = document.createElement('div');
  overlay.id='settings-overlay';
  overlay.className='settings-overlay';
  overlay.onclick=closeSettings;
  document.body.appendChild(overlay);

  const panel = document.createElement('div');
  panel.id='settings-panel';
  panel.className='settings-panel';
  panel.onclick=e=>e.stopPropagation();

  let h=`<div class="settings-header">
    <h3>${svgIcon('settings',16)} Settings</h3>
    <button class="modal-close" onclick="closeSettings()">\u00D7</button>
  </div>
  <div class="settings-tab-bar">
    <button class="settings-tab ${settingsTab==='pipeline'?'active':''}" onclick="settingsTab='pipeline';refreshSettingsBody()">Pipeline Config</button>
    <button class="settings-tab ${settingsTab==='clients'?'active':''}" onclick="settingsTab='clients';refreshSettingsBody()">Clients</button>
    <button class="settings-tab ${settingsTab==='users'?'active':''}" onclick="settingsTab='users';refreshSettingsBody()">Users</button>
    <button class="settings-tab ${settingsTab==='campaigns'?'active':''}" onclick="settingsTab='campaigns';refreshSettingsBody()">Campaigns</button>
    <button class="settings-tab ${settingsTab==='dialer'?'active':''}" onclick="settingsTab='dialer';refreshSettingsBody()">Dialer</button>
    <button class="settings-tab ${settingsTab==='ai'?'active':''}" onclick="settingsTab='ai';refreshSettingsBody()">AI</button>
  </div>
  <div class="settings-body">`;

  if(settingsTab==='pipeline') h+=renderPipelineConfigSettings();
  else if(settingsTab==='clients') h+=renderClientsSettings();
  else if(settingsTab==='users') h+=renderUsersSettings();
  else if(settingsTab==='campaigns') h+=renderCampaignAssignSettings();
  else if(settingsTab==='dialer') h+=renderDialerSettings();
  else if(settingsTab==='ai') h+=renderAISettings();

  h+=`</div>
  <div class="settings-footer">
    <button class="btn" style="background:#f9fafb;color:#6b7280;border:1px solid #e5e7eb" onclick="closeSettings()">Cancel</button>
    <button class="btn btn-primary" onclick="saveSettingsToSheet()">Save Settings</button>
    <span id="settings-autosave-status" style="font-size:10px;color:#9ca3af;align-self:center;margin-left:8px"></span>
  </div>`;

  panel.innerHTML=h;
  document.body.appendChild(panel);
  if(savedScroll > 0){
    const body = panel.querySelector('.settings-body');
    if(body) body.scrollTop = savedScroll;
  }
  requestAnimationFrame(()=>{
    overlay.classList.add('open');
    panel.classList.add('open');
  });
  setupSettingsDrag();
}

export function refreshSettingsBody(){
  const panel=document.getElementById('settings-panel');
  if(!panel){ renderSettingsPanel(); return; }
  panel.querySelectorAll('.settings-tab').forEach(btn=>{
    const tab=btn.textContent.trim().toLowerCase();
    const map={'pipeline config':'pipeline','clients':'clients','users':'users','campaigns':'campaigns','dialer':'dialer','ai':'ai'};
    btn.classList.toggle('active', map[tab]===settingsTab);
  });
  const body=panel.querySelector('.settings-body');
  if(!body){ renderSettingsPanel(); return; }
  let h='';
  if(settingsTab==='pipeline') h=renderPipelineConfigSettings();
  else if(settingsTab==='clients') h=renderClientsSettings();
  else if(settingsTab==='users') h=renderUsersSettings();
  else if(settingsTab==='campaigns') h=renderCampaignAssignSettings();
  else if(settingsTab==='dialer') h=renderDialerSettings();
  else if(settingsTab==='ai') h=renderAISettings();
  body.innerHTML=h;
  body.scrollTop=0;
  setupSettingsDrag();
  if(settingsTab==='users') loadUsersIntoPanel();
  if(settingsTab==='campaigns') fetchAcquisitionCampaigns();
  if(settingsTab==='ai') loadAISettings();
}

function renderPipelineConfigSettings(){
  const sections = [
    { key: 'stages', label: 'Pipeline Stages', icon: 'bar-chart', count: (settingsDraft.acquisition_stages||[]).length + (settingsDraft.nurture_stages||[]).length + ' stages' },
    { key: 'activities', label: 'Activity Types', icon: 'clipboard', count: (settingsDraft.activity_types||[]).length + ' types' },
    { key: 'sop', label: 'SOP Sequences', icon: 'bar-chart', count: ((settingsDraft.sop_acquisition||[]).length + (settingsDraft.sop_client||[]).length) + ' sequences' }
  ];
  let h = '';
  for(const s of sections){
    const isOpen = _expandedPipelineSections[s.key];
    h += `<div style="margin-bottom:8px;background:var(--bg);border:1px solid var(--border);border-radius:10px;overflow:hidden">
      <div onclick="togglePipelineSection('${s.key}')" style="display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:pointer;user-select:none;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:8px">
          ${svgIcon(s.icon,14)}
          <span style="font-size:13px;font-weight:700;color:var(--text)">${s.label}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:10px;color:var(--text-muted)">${s.count}</span>
          <span id="pipeline-chevron-${s.key}" style="font-size:12px;color:var(--text-muted)">${isOpen?'\u25BE':'\u25B8'}</span>
        </div>
      </div>
      <div id="pipeline-section-${s.key}" style="display:${isOpen?'block':'none'};padding:0 14px 14px">
        ${s.key==='stages'?renderStagesSettings():s.key==='activities'?renderActivityTypesSettings():renderSopSettings()}
      </div>
    </div>`;
  }
  return h;
}

function renderStagesSettings(){
  let h='';
  h+=`<div class="settings-section">
    <h4>${svgIcon('bar-chart',14)} Acquisition Pipeline Stages</h4>
    <div class="settings-list" id="settings-acq-stages" data-key="acquisition_stages">`;
  for(const [i,s] of settingsDraft.acquisition_stages.entries()){
    h+=`<div class="settings-list-item" draggable="true" data-idx="${i}">
      <span class="drag-handle">\u2807</span>
      <input type="color" class="item-color" value="${s.color}" onchange="settingsDraft.acquisition_stages[${i}].color=this.value;debouncedAutoSave()" style="width:24px;height:24px;border:none;padding:0;cursor:pointer;background:none">
      <input class="item-label" value="${esc(s.label)}" oninput="settingsDraft.acquisition_stages[${i}].label=this.value;settingsDraft.acquisition_stages[${i}].id=this.value;debouncedAutoSave()" style="border:none;background:transparent;font-size:12px;font-weight:500;font-family:var(--font);flex:1">
      <button class="item-delete" onclick="settingsDraft.acquisition_stages.splice(${i},1);renderSettingsPanel();debouncedAutoSave()">\u00D7</button>
    </div>`;
  }
  h+=`</div>
    <div class="settings-add-row">
      <input id="new-acq-stage" placeholder="New stage name...">
      <button class="btn btn-primary" onclick="addSettingsStage('acquisition_stages','new-acq-stage')">+ Add</button>
    </div>
  </div>`;

  h+=`<div class="settings-section">
    <h4>Nurture Pipeline Stages</h4>
    <div class="settings-list" id="settings-nurt-stages" data-key="nurture_stages">`;
  for(const [i,s] of settingsDraft.nurture_stages.entries()){
    h+=`<div class="settings-list-item" draggable="true" data-idx="${i}">
      <span class="drag-handle">\u2807</span>
      <input type="color" class="item-color" value="${s.color}" onchange="settingsDraft.nurture_stages[${i}].color=this.value;debouncedAutoSave()" style="width:24px;height:24px;border:none;padding:0;cursor:pointer;background:none">
      <input class="item-label" value="${esc(s.label)}" oninput="settingsDraft.nurture_stages[${i}].label=this.value;settingsDraft.nurture_stages[${i}].id=this.value;debouncedAutoSave()" style="border:none;background:transparent;font-size:12px;font-weight:500;font-family:var(--font);flex:1">
      <button class="item-delete" onclick="settingsDraft.nurture_stages.splice(${i},1);renderSettingsPanel();debouncedAutoSave()">\u00D7</button>
    </div>`;
  }
  h+=`</div>
    <div class="settings-add-row">
      <input id="new-nurt-stage" placeholder="New stage name...">
      <button class="btn btn-primary" onclick="addSettingsStage('nurture_stages','new-nurt-stage')">+ Add</button>
    </div>
  </div>`;

  h+=`<p style="font-size:11px;color:var(--text-muted);margin-top:8px">Client Leads stages are managed via the + Client button. Drag stages to reorder.</p>`;
  return h;
}

function renderActivityTypesSettings(){
  let h=`<div class="settings-section">
    <h4>${svgIcon('clipboard',14)} Activity Types</h4>
    <div class="settings-list" id="settings-act-types" data-key="activity_types">`;
  for(const [i,t] of settingsDraft.activity_types.entries()){
    h+=`<div class="settings-list-item" draggable="true" data-idx="${i}">
      <span class="drag-handle">\u2807</span>
      <input value="${esc(t.icon)}" oninput="settingsDraft.activity_types[${i}].icon=this.value;debouncedAutoSave()" style="width:32px;text-align:center;border:1px solid var(--border);border-radius:4px;font-size:14px;padding:2px">
      <input class="item-label" value="${esc(t.name)}" oninput="settingsDraft.activity_types[${i}].name=this.value;debouncedAutoSave()" style="border:none;background:transparent;font-size:12px;font-weight:500;font-family:var(--font);flex:1">
      <button class="item-delete" onclick="settingsDraft.activity_types.splice(${i},1);renderSettingsPanel();debouncedAutoSave()">\u00D7</button>
    </div>`;
  }
  h+=`</div>
    <div class="settings-add-row">
      <input id="new-act-icon" placeholder="Icon" style="width:50px;text-align:center">
      <input id="new-act-name" placeholder="Activity type name...">
      <button class="btn btn-primary" onclick="addSettingsActivityType()">+ Add</button>
    </div>
  </div>`;
  return h;
}

function renderSopSettings(){
  let h='';
  h+=`<div class="settings-section">
    <h4>${svgIcon('bar-chart',14)} Acquisition SOP Sequences</h4>`;
  for(const [i,seq] of settingsDraft.sop_acquisition.entries()){
    h+=renderSopSequence('sop_acquisition',i,seq);
  }
  h+=`<div class="settings-add-row" style="margin-top:8px">
    <input id="new-acq-sop-name" placeholder="Sequence name (e.g. Day 11)...">
    <button class="btn btn-primary" onclick="addSopSequence('sop_acquisition','new-acq-sop-name')">+ Add Sequence</button>
  </div></div>`;

  h+=`<div class="settings-section">
    <h4>Client SOP Sequences</h4>`;
  for(const [i,seq] of settingsDraft.sop_client.entries()){
    h+=renderSopSequence('sop_client',i,seq);
  }
  h+=`<div class="settings-add-row" style="margin-top:8px">
    <input id="new-cli-sop-name" placeholder="Sequence name...">
    <button class="btn btn-primary" onclick="addSopSequence('sop_client','new-cli-sop-name')">+ Add Sequence</button>
  </div></div>`;
  return h;
}

function renderSopSequence(key,idx,seq){
  const actTypes = settingsDraft.activity_types.map(t=>t.name);
  let h=`<div class="sop-sequence">
    <div class="sop-sequence-header">
      <input value="${esc(seq.name)}" oninput="settingsDraft.${key}[${idx}].name=this.value;debouncedAutoSave()" style="border:none;background:transparent;font-size:12px;font-weight:700;color:var(--purple);font-family:var(--font);width:120px">
      <div style="display:flex;gap:4px">
        <button class="btn" style="font-size:10px;padding:2px 8px;background:#f0fdf4;color:#059669;border:1px solid #bbf7d0" onclick="addSopActivity('${key}',${idx})">+ Activity</button>
        <button class="item-delete" onclick="settingsDraft.${key}.splice(${idx},1);renderSettingsPanel();debouncedAutoSave()" style="font-size:16px">\u00D7</button>
      </div>
    </div>`;
  for(const [j,act] of seq.activities.entries()){
    h+=`<div class="sop-act-item">
      <select onchange="settingsDraft.${key}[${idx}].activities[${j}].type=this.value;debouncedAutoSave()">
        ${actTypes.map(t=>`<option value="${t}" ${t===act.type?'selected':''}>${t}</option>`).join('')}
      </select>
      <input value="${esc(act.subject)}" oninput="settingsDraft.${key}[${idx}].activities[${j}].subject=this.value;debouncedAutoSave()">
      <button class="item-delete" onclick="settingsDraft.${key}[${idx}].activities.splice(${j},1);renderSettingsPanel();debouncedAutoSave()">\u00D7</button>
    </div>`;
  }
  h+=`</div>`;
  return h;
}

function renderClientsSettings(){
  let h=`<div style="padding:16px 0">
    <h4 style="font-size:13px;font-weight:700;color:var(--text);margin:0 0 4px">Client Configuration</h4>
    <p style="font-size:11px;color:var(--text-muted);margin:0 0 12px">Set up how each client's leads are handled. Toggle actions on/off and fill in the details.</p>
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <button class="btn btn-ghost" style="font-size:12px;padding:7px 16px;flex:1" onclick="closeSettings();openAddClient()">+ Add Client</button>
      <button class="btn btn-primary" style="font-size:12px;padding:7px 16px;flex:1" onclick="closeSettings();openActivateClient()">\u26A1 Activate Client</button>
    </div>`;

  if(state.clients.length===0){
    h+=`<p style="font-size:12px;color:var(--text-muted);text-align:center;padding:20px">No clients added yet.</p></div>`;
    return h;
  }

  h+=`<div id="settings-clients-container">`;

  for(const c of state.clients){
    const isOn=(field)=>str(c[field]).toUpperCase()==='TRUE';
    const toggleCount = ['enableForward','enableCalendly','enableCopyInfo','enableTracker','enableAutoForward'].filter(f=>isOn(f)).length;
    const isExpanded = _expandedClientId === c.id;
    const standing = str(c.clientStanding).toLowerCase();
    const standingColor = standing==='happy'?'#22c55e':standing==='unhappy'?'#ef4444':'#eab308';
    const standingBg = standing==='happy'?'#f0fdf4':standing==='unhappy'?'#fef2f2':'#fefce8';

    h+=`<div class="client-card-accordion" data-client-id="${esc(c.id)}" style="margin-bottom:8px;background:var(--bg);border:1px solid var(--border);border-radius:10px;overflow:hidden">
      <div class="client-header" onclick="toggleClientAccordion('${esc(c.id)}')"
        style="display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:pointer;user-select:none;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
          <span style="width:10px;height:10px;border-radius:50%;background:${c.color||'#818cf8'};flex-shrink:0"></span>
          <span style="font-size:13px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.name)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
          <select onclick="event.stopPropagation()" onchange="updateClientField('${esc(c.id)}','clientStanding',this.value);debouncedAutoSave()"
            style="padding:3px 6px;border-radius:5px;font-size:10px;font-weight:700;font-family:var(--font);cursor:pointer;border:1px solid ${standingColor};color:${standingColor};background:${standingBg}">
            <option value="happy" ${standing==='happy'?'selected':''}>Happy</option>
            <option value="neutral" ${standing==='neutral'||!standing.trim()?'selected':''}>Neutral</option>
            <option value="unhappy" ${standing==='unhappy'?'selected':''}>Unhappy</option>
          </select>
          <span style="font-size:10px;color:var(--text-muted);white-space:nowrap">${toggleCount} action${toggleCount!==1?'s':''}</span>
          <span class="client-chevron" style="font-size:12px;color:var(--text-muted)">${isExpanded?'\u25BE':'\u25B8'}</span>
        </div>
      </div>
      <div class="client-body" style="display:${isExpanded?'block':'none'};padding:0 14px 14px">

      <div style="margin-bottom:10px">
        <label style="font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Campaign Keywords</label>
        <input type="text" placeholder="keyword1, keyword2 (matches campaign name)" value="${esc(str(c.campaignKeywords))}"
          oninput="updateClientField('${esc(c.id)}','campaignKeywords',this.value)"
          style="width:100%;box-sizing:border-box;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);background:var(--card);color:var(--text);margin-top:3px">
      </div>

      <div style="margin-bottom:10px">
        <label style="font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Contact First Name</label>
        <input type="text" placeholder="e.g. Joel, Jake" value="${esc(str(c.contactFirstName))}"
          oninput="updateClientField('${esc(c.id)}','contactFirstName',this.value)"
          style="width:160px;box-sizing:border-box;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);background:var(--card);color:var(--text);margin-top:3px">
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">
        <label style="display:flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px;background:${isOn('enableForward')?'#eff6ff':'var(--card)'}">
          <input type="checkbox" ${isOn('enableForward')?'checked':''} onchange="toggleClientField('${esc(c.id)}','enableForward',this.checked)"> ${svgIcon('mail',12)} Forward Email
        </label>
        <label style="display:flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px;background:${isOn('enableCalendly')?'#ecfdf5':'var(--card)'}">
          <input type="checkbox" ${isOn('enableCalendly')?'checked':''} onchange="toggleClientField('${esc(c.id)}','enableCalendly',this.checked)"> ${svgIcon('calendar',12)} Calendly
        </label>
        <label style="display:flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px;background:${isOn('enableCopyInfo')?'#f0fdf4':'var(--card)'}">
          <input type="checkbox" ${isOn('enableCopyInfo')?'checked':''} onchange="toggleClientField('${esc(c.id)}','enableCopyInfo',this.checked)"> ${svgIcon('clipboard',12)} Copy Info
        </label>
        <label style="display:flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px;background:${isOn('enableTracker')?'#fefce8':'var(--card)'}">
          <input type="checkbox" ${isOn('enableTracker')?'checked':''} onchange="toggleClientField('${esc(c.id)}','enableTracker',this.checked)"> ${svgIcon('upload',12)} Lead Tracker
        </label>
        <label style="display:flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid ${isOn('enableAutoForward')?'#f97316':'var(--border)'};border-radius:6px;cursor:pointer;font-size:12px;background:${isOn('enableAutoForward')?'#fff7ed':'var(--card)'}">
          <input type="checkbox" ${isOn('enableAutoForward')?'checked':''} onchange="toggleClientField('${esc(c.id)}','enableAutoForward',this.checked)"> ${svgIcon('mail',12)} Auto-Forward
        </label>
        <div style="display:flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:var(--card)">
          ${svgIcon('clock',12)}
          <select onchange="updateClientField('${esc(c.id)}','timeZone',this.value);debouncedAutoSave()"
            style="border:none;background:transparent;font-size:12px;font-family:var(--font);color:var(--text);cursor:pointer;flex:1">
            <option value="" ${!str(c.timeZone).trim()?'selected':''}>No TZ</option>
            <option value="EST" ${str(c.timeZone)==='EST'?'selected':''}>EST</option>
            <option value="CST" ${str(c.timeZone)==='CST'?'selected':''}>CST</option>
            <option value="MST" ${str(c.timeZone)==='MST'?'selected':''}>MST</option>
            <option value="PST" ${str(c.timeZone)==='PST'?'selected':''}>PST</option>
            <option value="AST" ${str(c.timeZone)==='AST'?'selected':''}>AST</option>
            <option value="HST" ${str(c.timeZone)==='HST'?'selected':''}>HST</option>
          </select>
        </div>
      </div>

      <div style="margin-bottom:8px">
        <label style="font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Client Email</label>
        <input type="text" placeholder="client@example.com" value="${esc(str(c.notifyEmails))}"
          oninput="updateClientField('${esc(c.id)}','notifyEmails',this.value)"
          style="width:100%;box-sizing:border-box;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);background:var(--card);color:var(--text);margin-top:3px">
      </div>

      <div style="margin-bottom:8px">
        <label style="font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Lead Cost ($)</label>
        <input type="text" placeholder="e.g. 200" value="${esc(str(c.leadCost))}"
          oninput="updateClientField('${esc(c.id)}','leadCost',this.value)"
          style="width:120px;box-sizing:border-box;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);background:var(--card);color:var(--text);margin-top:3px">
      </div>

      ${isOn('enableCalendly')?`<div style="margin-bottom:8px">
        <label style="font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Calendly URL</label>
        <input type="text" placeholder="https://calendly.com/..." value="${esc(str(c.calendlyUrl))}"
          oninput="updateClientField('${esc(c.id)}','calendlyUrl',this.value)"
          style="width:100%;box-sizing:border-box;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);background:var(--card);color:var(--text);margin-top:3px">
      </div>`:''}

      <div style="margin-bottom:8px;padding:10px;background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px">
        <div style="font-size:10px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">GoHighLevel Integration</div>
        <div style="margin-bottom:6px">
          <label style="font-size:10px;font-weight:600;color:var(--text-muted)">GHL Location ID</label>
          <input type="text" placeholder="e.g. ve9EPM428h8vShlRW1KT" value="${esc(str(c.ghlLocationId))}"
            oninput="updateClientField('${esc(c.id)}','ghlLocationId',this.value)"
            style="width:100%;box-sizing:border-box;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);background:var(--card);color:var(--text);margin-top:3px">
        </div>
        <div style="margin-bottom:6px;position:relative">
          <label style="font-size:10px;font-weight:600;color:var(--text-muted)">GHL API Key</label>
          <input type="password" id="ghl-key-${esc(c.id)}" placeholder="pit-..." value="${esc(str(c.ghlApiKey))}"
            oninput="updateClientField('${esc(c.id)}','ghlApiKey',this.value)"
            style="width:100%;box-sizing:border-box;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);background:var(--card);color:var(--text);margin-top:3px">
          <button onclick="const i=document.getElementById('ghl-key-${esc(c.id)}');i.type=i.type==='password'?'text':'password';this.textContent=i.type==='password'?'Show':'Hide'"
            style="position:absolute;right:6px;top:20px;border:none;background:none;color:var(--text-muted);cursor:pointer;font-size:10px;font-family:var(--font)">Show</button>
        </div>
        <div style="display:flex;gap:6px;margin-bottom:2px">
          <div style="flex:1">
            <label style="font-size:10px;font-weight:600;color:var(--text-muted)">Pipeline ID</label>
            <input type="text" placeholder="e.g. abc123..." value="${esc(str(c.ghlPipelineId))}"
              oninput="updateClientField('${esc(c.id)}','ghlPipelineId',this.value)"
              style="width:100%;box-sizing:border-box;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:11px;font-family:var(--font);background:var(--card);color:var(--text);margin-top:3px">
          </div>
          <div style="flex:1">
            <label style="font-size:10px;font-weight:600;color:var(--text-muted)">Stage ID</label>
            <input type="text" placeholder="e.g. xyz789..." value="${esc(str(c.ghlStageId))}"
              oninput="updateClientField('${esc(c.id)}','ghlStageId',this.value)"
              style="width:100%;box-sizing:border-box;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:11px;font-family:var(--font);background:var(--card);color:var(--text);margin-top:3px">
          </div>
        </div>
      </div>

      <div style="margin-bottom:8px;padding:10px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px">
        <div style="font-size:10px;font-weight:700;color:#0369a1;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Route Optimization</div>
        <div style="margin-bottom:6px">
          <label style="font-size:10px;font-weight:600;color:var(--text-muted)">Home Base Address</label>
          <input type="text" placeholder="123 Main St, City, ST 12345" value="${esc(str(c.homeBase))}"
            oninput="updateClientField('${esc(c.id)}','homeBase',this.value)"
            style="width:100%;box-sizing:border-box;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);background:var(--card);color:var(--text);margin-top:3px">
        </div>
        <div style="margin-bottom:6px">
          <label style="font-size:10px;font-weight:600;color:var(--text-muted)">Google Calendar ID</label>
          <input type="text" placeholder="email@example.com or 'primary'" value="${esc(str(c.calendarId))}"
            oninput="updateClientField('${esc(c.id)}','calendarId',this.value)"
            style="width:100%;box-sizing:border-box;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);background:var(--card);color:var(--text);margin-top:3px">
        </div>
        <div style="display:flex;gap:8px">
          <div style="flex:1">
            <label style="font-size:10px;font-weight:600;color:var(--text-muted)">Work Start</label>
            <input type="time" value="${esc(str(c.workStart)||'08:00')}"
              onchange="updateClientField('${esc(c.id)}','workStart',this.value)"
              style="width:100%;box-sizing:border-box;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);background:var(--card);color:var(--text);margin-top:3px">
          </div>
          <div style="flex:1">
            <label style="font-size:10px;font-weight:600;color:var(--text-muted)">Work End</label>
            <input type="time" value="${esc(str(c.workEnd)||'17:00')}"
              onchange="updateClientField('${esc(c.id)}','workEnd',this.value)"
              style="width:100%;box-sizing:border-box;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);background:var(--card);color:var(--text);margin-top:3px">
          </div>
        </div>
      </div>

      <div style="margin-bottom:8px">
        <label style="font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">\uD83D\uDDFA\uFE0F Service Area</label>
        ${(()=>{
          const pm = findPolygonForClient(c.name);
          if(pm){
            const coordCount = JSON.stringify(pm.polygon).length;
            return '<div style="display:flex;align-items:center;gap:6px;margin-top:3px;padding:6px 10px;background:#dcfce7;border:1px solid #86efac;border-radius:6px;font-size:11px;color:#166534"><span class="sa-badge sa-in" style="width:14px;height:14px;font-size:8px">&#10003;</span> Polygon configured ('+(coordCount/1024).toFixed(1)+'KB)</div>';
          }
          return '<div style="margin-top:3px;padding:6px 10px;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:6px;font-size:11px;color:#6b7280">No polygon data \u2014 leads will show "unknown" for service area</div>';
        })()}
      </div>

      <div style="margin-bottom:8px">
        <label style="font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">External Map URL (optional)</label>
        <div style="display:flex;gap:6px;align-items:center;margin-top:3px">
          <input type="text" placeholder="Paste service area map link..." value="${esc(str(c.serviceAreaUrl))}"
            oninput="updateClientField('${esc(c.id)}','serviceAreaUrl',this.value)"
            style="flex:1;box-sizing:border-box;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);background:var(--card);color:var(--text)">
          ${str(c.serviceAreaUrl).trim()?`<a href="${esc(str(c.serviceAreaUrl))}" target="_blank" rel="noopener" style="font-size:11px;color:#10b981;white-space:nowrap;text-decoration:none;padding:5px 8px;border:1px solid #a7f3d0;border-radius:6px;background:#ecfdf5">Test \u2197</a>`:''}
        </div>
      </div>

      <div style="margin-bottom:8px">
        <label style="font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">\uD83D\uDCDD Client Notes</label>
        <textarea placeholder="Services offered, booking preferences, special instructions..." rows="3"
          oninput="updateClientField('${esc(c.id)}','clientNotes',this.value)"
          style="width:100%;box-sizing:border-box;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);background:var(--card);color:var(--text);margin-top:3px;resize:vertical">${esc(str(c.clientNotes||''))}</textarea>
      </div>

      ${(()=>{
        let wcDefault='';
        if(!str(c.warmCallNotesText).trim()){const ci=lookupClientInfo(c.name);if(ci&&ci.warmCallNotes)wcDefault=ci.warmCallNotes.join('\\n');}
        const wcVal=str(c.warmCallNotesText).trim()||wcDefault;
        return `<div style="margin-bottom:8px">
        <label style="font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">${svgIcon('clipboard',10)} SDR / Warm Call Notes</label>
        <div style="font-size:10px;color:var(--text-muted);margin:2px 0 4px">Key talking points for the appointment setter (one per line)</div>
        <textarea placeholder="e.g. Veteran-owned&#10;24 years in business&#10;10% discount for churches&#10;Current clients: Marriott, YMCA" rows="6"
          oninput="updateClientField('${esc(c.id)}','warmCallNotesText',this.value)"
          style="width:100%;box-sizing:border-box;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);background:var(--card);color:var(--text);margin-top:3px;resize:vertical">${esc(wcVal)}</textarea>
      </div>`;
      })()}

      </div>
    </div>`;
  }

  h+=`</div>`;

  h+=`<div style="padding:10px 12px;background:rgba(37,99,235,.06);border:1px solid rgba(37,99,235,.15);border-radius:8px">
    <p style="font-size:11px;color:var(--text-muted);margin:0"><strong style="color:var(--text)">\uD83D\uDCA1 How it works:</strong> Toggle the actions each client needs. Only enabled actions show up on deal cards. Campaign keywords match against Smartlead campaign names to auto-assign leads to clients.</p>
  </div>`;

  h+=`</div>`;
  return h;
}

function renderUsersSettings(){
  let h = `<div class="settings-section">
    <h4>User Management</h4>
    <p style="font-size:11px;color:var(--text-muted);margin-bottom:12px">Manage who can access the CRM and what they can see.</p>
    <div id="users-list-container"><div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px">Loading users...</div></div>
    <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">
      <h4 style="font-size:12px;font-weight:700;margin-bottom:8px">\u2795 Invite New User</h4>
      <p style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Create an account for a team member or client.</p>
      <div style="display:flex;flex-direction:column;gap:6px">
        <input type="text" id="new-user-name" placeholder="Full name" style="padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
        <input type="email" id="new-user-email" placeholder="Email address" style="padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
        <input type="password" id="new-user-pass" placeholder="Temporary password (6+ chars)" style="padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
        <div style="display:flex;gap:6px">
          <select id="new-user-role" style="flex:1;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
            <option value="admin">Admin</option>
            <option value="employee">Employee</option>
            <option value="client" selected>Client</option>
          </select>
          <select id="new-user-client" style="flex:1;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
            <option value="">No client assigned</option>
            ${state.clients.map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-primary" onclick="createNewUser()" style="padding:10px;font-size:12px" id="create-user-btn">Create User Account</button>
        <div id="create-user-msg" style="font-size:11px;text-align:center;display:none"></div>
      </div>
    </div>
  </div>`;
  setTimeout(()=>loadUsersIntoPanel(), 50);
  return h;
}

let usersListCache = null;

async function loadUsersIntoPanel(){
  const container = document.getElementById('users-list-container');
  if(!container) return;
  const users = await loadAllUsers();
  usersListCache = users;
  if(!container.parentElement) return;
  let h = '';
  if(users.length===0){
    h = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px">No users found</div>';
  } else {
    for(const u of users){
      const isSelf = u.uid === currentUser.uid;
      const roleColor = u.role==='admin' ? '#059669' : u.role==='employee' ? '#f59e0b' : '#2563eb';
      h += `<div style="display:flex;align-items:center;gap:10px;padding:10px;margin-bottom:6px;background:#f9fafb;border:1px solid var(--border);border-radius:8px">
        <div style="width:36px;height:36px;border-radius:50%;background:${roleColor};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:14px;flex-shrink:0">${esc((u.name||u.email||'?')[0].toUpperCase())}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(u.name||'Unnamed')}${isSelf?' <span style="font-size:10px;color:var(--text-muted)">(you)</span>':''}</div>
          <div style="font-size:11px;color:var(--text-muted)">${esc(u.email||'')}</div>
          ${u.clientName?`<div style="font-size:10px;color:#2563eb;margin-top:2px">Assigned: ${esc(u.clientName)}</div>`:''}
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
          <select onchange="changeUserRole('${u.uid}',this.value)" style="padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:11px;font-family:var(--font)"${isSelf?' disabled':''}>
            <option value="admin"${u.role==='admin'?' selected':''}>Admin</option>
            <option value="employee"${u.role==='employee'?' selected':''}>Employee</option>
            <option value="client"${u.role==='client'?' selected':''}>Client</option>
          </select>
          <select onchange="changeUserClient('${u.uid}',this.value)" style="padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:11px;font-family:var(--font)">
            <option value=""${!u.clientName?' selected':''}>None</option>
            ${state.clients.map(c=>`<option value="${esc(c.name)}"${u.clientName===c.name?' selected':''}>${esc(c.name)}</option>`).join('')}
          </select>
        </div>
      </div>`;
    }
  }
  container.innerHTML = h;
}

async function changeUserRole(uid, role){
  await updateUserRole(uid, role);
  loadUsersIntoPanel();
}
async function changeUserClient(uid, clientName){
  await updateUserClient(uid, clientName);
  loadUsersIntoPanel();
}

// ─── Campaign Assignment Settings ───
let _fetchedCampaigns = null;

function renderCampaignAssignSettings(){
  let h = `<div class="settings-section">
    <h4>${svgIcon('bar-chart',14)} Acquisition Campaign Assignments</h4>
    <p style="font-size:11px;color:var(--text-muted);margin-bottom:12px">Assign each acquisition campaign to a team member. Leads from that campaign will be tagged with their color on the board.</p>
    <div id="campaign-assign-container"><div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px">Loading campaigns...</div></div>
  </div>`;
  setTimeout(()=>fetchAcquisitionCampaigns(), 50);
  return h;
}

async function fetchAcquisitionCampaigns(){
  const container = document.getElementById('campaign-assign-container');
  if(!container) return;
  if(!usersListCache || usersListCache.length===0){
    try { usersListCache = await loadAllUsers(); } catch(e){}
  }
  const adminUsers = (usersListCache||[]).filter(u => u.role==='admin').map(u => u.name||u.email);
  if(!_fetchedCampaigns){
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px">Fetching campaigns from SmartLead...</div>';
    try {
      const campaigns = await apiGet('get_acquisition_campaigns');
      if(Array.isArray(campaigns)){
        _fetchedCampaigns = campaigns;
      } else {
        container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red);font-size:12px">Failed to load campaigns. Try again.</div>';
        return;
      }
    } catch(e){
      container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red);font-size:12px">Error: '+esc(e.message)+'</div>';
      return;
    }
  }
  if(!container.parentElement) return;
  const assignments = state.campaignAssignments || {};
  const allNames = new Set(_fetchedCampaigns.map(c=>c.name));
  const extraAssigned = Object.keys(assignments).filter(n => !allNames.has(n));

  let h = '';
  if(_fetchedCampaigns.length === 0 && extraAssigned.length === 0){
    h = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px">No acquisition campaigns found in SmartLead.</div>';
  } else {
    h += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <span style="font-size:11px;font-weight:600;color:var(--text-secondary)">${_fetchedCampaigns.length} acquisition campaign${_fetchedCampaigns.length!==1?'s':''}</span>
      <button class="btn btn-ghost" style="font-size:10px;padding:3px 10px;background:#f9fafb;color:#6b7280;border:1px solid var(--border);display:inline-flex;align-items:center;gap:4px" onclick="_fetchedCampaigns=null;fetchAcquisitionCampaigns()">${svgIcon('refresh-cw',12)} Refresh</button>
    </div>`;
    for(const camp of _fetchedCampaigns){
      const assigned = assignments[camp.name] || '';
      const ownerInfo = assigned ? getOwnerColor(assigned) : null;
      h += `<div style="display:flex;align-items:center;gap:10px;padding:10px;margin-bottom:6px;background:#f9fafb;border:1px solid var(--border);border-radius:8px">
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(camp.name)}</div>
          <div style="font-size:10px;color:var(--text-muted)">${esc(camp.status||'')}</div>
        </div>
        ${ownerInfo?`<span class="owner-tag ${ownerInfo.cls}">${esc(assigned)}</span>`:''}
        <select onchange="assignCampaignOwner('${esc(camp.name).replace(/'/g,"\\'")}',this.value)" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:11px;font-family:var(--font);min-width:120px">
          <option value=""${!assigned?' selected':''}>Unassigned</option>
          ${adminUsers.map(u => `<option value="${esc(u)}"${assigned===u?' selected':''}>${esc(u)}</option>`).join('')}
        </select>
      </div>`;
    }
    if(extraAssigned.length > 0){
      h += '<div style="margin-top:12px;padding-top:8px;border-top:1px solid var(--border)"><div style="font-size:10px;font-weight:600;color:var(--text-muted);margin-bottom:6px">Previously assigned (not currently in SmartLead):</div>';
      for(const name of extraAssigned){
        h += `<div style="display:flex;align-items:center;gap:10px;padding:6px 10px;margin-bottom:4px;background:#fef3c7;border:1px solid #fde68a;border-radius:6px;font-size:11px">
          <span style="flex:1">${esc(name)}</span>
          <span style="color:#92400e;font-weight:600">${esc(assignments[name])}</span>
          <button onclick="removeCampaignAssignment('${esc(name).replace(/'/g,"\\'")}')" style="background:none;border:none;color:#d1d5db;cursor:pointer;font-size:14px" title="Remove">&times;</button>
        </div>`;
      }
      h += '</div>';
    }
  }
  container.innerHTML = h;
}

function getOwnerColor(name){
  const OWNER_COLORS = [
    {cls:'owner-a',label:'A'},{cls:'owner-b',label:'B'},{cls:'owner-c',label:'C'},
    {cls:'owner-d',label:'D'},{cls:'owner-e',label:'E'}
  ];
  const owners = [...new Set(Object.values(state.campaignAssignments))].filter(Boolean).sort();
  const idx = owners.indexOf(name);
  return idx>=0 ? {cls:OWNER_COLORS[idx%OWNER_COLORS.length].cls, label:name} : {cls:'owner-a', label:name};
}

function renderDialerSettings(){
  const mod = window.__numberHealthModule;
  if(mod) return mod.renderNumberHealthSettings();
  return `<div class="settings-section">
    <h4>${svgIcon('phone',14)} Dialer Numbers</h4>
    <p style="font-size:11px;color:var(--text-muted)">Loading number health data...</p>
  </div>`;
}

function setupSettingsDrag(){
  document.querySelectorAll('.settings-list').forEach(list=>{
    const key=list.dataset.key;
    let dragIdx=null;
    list.querySelectorAll('.settings-list-item').forEach(item=>{
      item.addEventListener('dragstart',e=>{
        dragIdx=parseInt(item.dataset.idx);
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed='move';
      });
      item.addEventListener('dragend',()=>{
        item.classList.remove('dragging');
        dragIdx=null;
      });
      item.addEventListener('dragover',e=>{
        e.preventDefault();
        e.dataTransfer.dropEffect='move';
      });
      item.addEventListener('drop',e=>{
        e.preventDefault();
        const dropIdx=parseInt(item.dataset.idx);
        if(dragIdx!==null && dragIdx!==dropIdx && settingsDraft[key]){
          const arr=settingsDraft[key];
          const [moved]=arr.splice(dragIdx,1);
          arr.splice(dropIdx,0,moved);
          renderSettingsPanel();
        }
      });
    });
  });
}

export function captureClientInputs(){
  const panel=document.querySelector('.settings-body');
  if(!panel) return;
  for(const c of state.clients){
    const id=c.id;
    panel.querySelectorAll('input[type="text"]').forEach(inp=>{
      const handler=inp.getAttribute('oninput')||'';
      const match=handler.match(/updateClientField\('([^']+)','([^']+)'/);
      if(match && match[1]===id){
        c[match[2]]=inp.value;
      }
    });
    panel.querySelectorAll('input[type="checkbox"]').forEach(inp=>{
      const handler=inp.getAttribute('onchange')||'';
      const match=handler.match(/toggleClientField\('([^']+)','([^']+)'/);
      if(match && match[1]===id){
        c[match[2]]=inp.checked?'TRUE':'FALSE';
      }
    });
    panel.querySelectorAll('select').forEach(sel=>{
      const handler=sel.getAttribute('onchange')||'';
      const match=handler.match(/updateClientField\('([^']+)','([^']+)'/);
      if(match && match[1]===id){
        c[match[2]]=sel.value;
      }
    });
  }
}

export function updateClientField(clientId, field, value){
  const c=state.clients.find(x=>str(x.id)===str(clientId));
  if(c) c[field]=value;
}

export function toggleClientField(clientId, field, checked){
  captureClientInputs();
  const c=state.clients.find(x=>str(x.id)===str(clientId));
  if(c){
    c[field]=checked?'TRUE':'FALSE';
  }
  const body=document.querySelector('.settings-body');
  if(body) body.innerHTML=renderClientsSettings();
  debouncedAutoSave();
}

export function updateClientCalendly(name, url){
  const c=state.clients.find(x=>x.name===name);
  if(c) c.calendlyUrl=url;
}

export async function saveSettingsToSheet(){
  captureClientInputs();
  applySettings(settingsDraft);
  render();
  const btn=document.querySelector('.settings-footer .btn-primary');
  if(btn){ btn.textContent='Saving...'; btn.disabled=true; }
  const oldBanner=document.getElementById('settings-save-banner');
  if(oldBanner) oldBanner.remove();
  try {
    const clientUpdates = state.clients.filter(c=>c.id).map(c=>({
      id:c.id,
      notifyEmails:str(c.notifyEmails),
      notifyEmail:str(c.notifyEmails),
      campaignKeywords:str(c.campaignKeywords),
      contactFirstName:str(c.contactFirstName),
      calendlyUrl:str(c.calendlyUrl),
      enableForward:str(c.enableForward),
      enableCalendly:str(c.enableCalendly),
      enableAutoForward:str(c.enableAutoForward),
      enableCopyInfo:str(c.enableCopyInfo),
      enableTracker:str(c.enableTracker),
      leadCost:str(c.leadCost),
      serviceAreaUrl:str(c.serviceAreaUrl),
      clientNotes:str(c.clientNotes||''),
      warmCallNotesText:str(c.warmCallNotesText||''),
      clientStanding:str(c.clientStanding||'neutral'),
      homeBase:str(c.homeBase||''),
      timeZone:str(c.timeZone||''),
      ghlLocationId:str(c.ghlLocationId||''),
      ghlApiKey:str(c.ghlApiKey||''),
      ghlPipelineId:str(c.ghlPipelineId||''),
      ghlStageId:str(c.ghlStageId||'')
    }));
    await Promise.all([
      apiPost('save_settings',{settings:settingsDraft}),
      sbBatchUpdateClients(clientUpdates.map(c => ({id:c.id, ...camelToSnake(c)})))
    ]);
    if(btn){ btn.textContent='Save Settings'; btn.disabled=false; }
    const banner=document.createElement('div');
    banner.id='settings-save-banner';
    banner.style.cssText='padding:12px 16px;background:#dcfce7;border:2px solid #22c55e;border-radius:8px;margin:0 20px 12px;display:flex;align-items:center;gap:8px;animation:fadeIn .3s';
    banner.innerHTML='<span style="font-size:18px">&#9989;</span><div><div style="font-size:13px;font-weight:700;color:#166534">Settings Saved Successfully</div><div style="font-size:11px;color:#15803d">All changes have been saved and will persist. You can safely close this panel.</div></div>';
    const settingsBody=document.querySelector('.settings-body');
    if(settingsBody) settingsBody.insertBefore(banner, settingsBody.firstChild);
    setTimeout(()=>{ const b=document.getElementById('settings-save-banner'); if(b) b.style.opacity='0'; setTimeout(()=>{ const b2=document.getElementById('settings-save-banner'); if(b2) b2.remove(); },300); },6000);
  } catch(e){
    if(btn){ btn.textContent='Error \u2014 Retry'; btn.disabled=false; }
  }
}

export async function createNewUser(){
  const name = document.getElementById('new-user-name').value.trim();
  const email = document.getElementById('new-user-email').value.trim();
  const pass = document.getElementById('new-user-pass').value;
  const role = document.getElementById('new-user-role').value;
  const clientName = document.getElementById('new-user-client').value;
  const btn = document.getElementById('create-user-btn');
  const msg = document.getElementById('create-user-msg');

  if(!name||!email||!pass){ msg.textContent='Please fill in all fields'; msg.style.color='var(--red)'; msg.style.display='block'; return; }
  if(pass.length<6){ msg.textContent='Password must be at least 6 characters'; msg.style.color='var(--red)'; msg.style.display='block'; return; }

  btn.disabled=true; btn.textContent='Creating...';
  msg.style.display='none';

  try {
    const { auth } = await import('./auth.js');
    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    await cred.user.updateProfile({ displayName: name });
    await db.collection('users').doc(cred.user.uid).set({
      name, email, role, clientName,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    msg.textContent='\u2713 Account created for '+name+'! Sign back in to continue.';
    msg.style.color='var(--green)';
    msg.style.display='block';
    document.getElementById('new-user-name').value='';
    document.getElementById('new-user-email').value='';
    document.getElementById('new-user-pass').value='';
    btn.textContent='Create User Account';
    btn.disabled=false;
  } catch(e){
    let errMsg='Failed to create account';
    if(e.code==='auth/email-already-in-use') errMsg='An account with this email already exists';
    else if(e.code==='auth/invalid-email') errMsg='Invalid email address';
    msg.textContent=errMsg;
    msg.style.color='var(--red)';
    msg.style.display='block';
    btn.textContent='Create User Account';
    btn.disabled=false;
  }
}

// Settings sub-functions called from inline HTML
export function addSettingsStage(key,inputId){
  const el=document.getElementById(inputId);
  const name=(el?el.value:'').trim();
  if(!name) return;
  const colors=['#059669','#10b981','#2563eb','#0891b2','#059669','#d97706','#ef4444','#34d399','#f97316','#10b981'];
  settingsDraft[key].push({id:name,label:name,color:colors[settingsDraft[key].length%colors.length],order:settingsDraft[key].length});
  renderSettingsPanel();
  debouncedAutoSave();
}
export function addSettingsActivityType(){
  const iconEl=document.getElementById('new-act-icon');
  const nameEl=document.getElementById('new-act-name');
  const icon=(iconEl?iconEl.value:'').trim()||'\u2713';
  const name=(nameEl?nameEl.value:'').trim();
  if(!name) return;
  settingsDraft.activity_types.push({name,icon,order:settingsDraft.activity_types.length});
  renderSettingsPanel();
  debouncedAutoSave();
}
export function addSopSequence(key,inputId){
  const el=document.getElementById(inputId);
  const name=(el?el.value:'').trim();
  if(!name) return;
  settingsDraft[key].push({name,activities:[{type:'Email',subject:'Email'},{type:'Call',subject:'Call'}]});
  renderSettingsPanel();
  debouncedAutoSave();
}
export function addSopActivity(key,idx){
  settingsDraft[key][idx].activities.push({type:'Call',subject:'Activity'});
  renderSettingsPanel();
  debouncedAutoSave();
}

// Expose to inline HTML handlers
// Expose settingsDraft as a live getter so inline handlers always see the current object
Object.defineProperty(window, 'settingsDraft', {
  get(){ return settingsDraft; },
  set(v){ setSettingsDraft(v); },
  configurable: true
});
Object.defineProperty(window, 'settingsTab', {
  get(){ return settingsTab; },
  set(v){ setSettingsTab(v); },
  configurable: true
});
// ── AI Settings ──────────────────────────────────────────
const DEFAULT_PASSOFF_TEMPLATE = `You are writing lead passoff instructions for a landscaping lead generation company (The Headline Theory) to send to their client.

Given the lead's information, email conversation, and call transcript (if available), write clear instructions for the client on what to do with this lead. Some leads are set up entirely through email with no phone call — use whatever context is available.

IMPORTANT: Always carefully read email signatures in the thread. Extract the sender's full name, title, phone numbers, and any other contact details from signatures. If the deal card is missing this info or has it wrong, use the signature data instead.

Output format (follow exactly):

Hey [clientFirstName], just scheduled a quote request for [appointment details] with [Business Name]. The address, phone, contact info and instructions are all included below. I've also added you to the email thread. Please check your spam folder if you are not seeing it.

Business: [company name]
Website: [website URL]
Address: [full address]
Email: [lead email]
Contact: [contact name]
Business Phone: [phone]
Mobile Phone: [mobile phone, only if available]
Instructions: [Write 2-4 sentences synthesizing what the lead wants based on the email thread and call transcript. Include: what service they're looking for, any specific details about the property or job, scheduling preferences, and any special notes. Be specific and actionable.]

Good luck!

— The Headline Theory Team`;

let _aiPassoffTemplate = '';

function renderAISettings(){
  return `
  <div style="padding:12px 0">
    <h3 style="margin:0 0 4px;font-size:14px;font-weight:600;color:var(--text)">Passoff Instructions Template</h3>
    <p style="margin:0 0 12px;font-size:11px;color:#6b7280">This prompt tells the AI how to generate passoff instructions. Use placeholders like [clientFirstName], [Business Name], etc. The AI receives the deal data, email thread, and call transcript automatically.</p>
    <textarea id="ai-passoff-template" style="width:100%;min-height:320px;padding:10px;font-size:12px;font-family:monospace;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);resize:vertical;line-height:1.5"
      oninput="window._aiPassoffDirty=true">${esc(_aiPassoffTemplate || DEFAULT_PASSOFF_TEMPLATE)}</textarea>
    <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
      <button class="btn btn-primary" onclick="saveAIPassoffTemplate()" style="font-size:12px">Save Template</button>
      <button class="btn" style="font-size:12px;background:#f9fafb;color:#6b7280;border:1px solid #e5e7eb" onclick="resetAIPassoffTemplate()">Reset to Default</button>
      <span id="ai-save-status" style="font-size:11px;color:#9ca3af"></span>
    </div>
  </div>`;
}

async function loadAISettings(){
  try {
    const { data } = await supabase.from('crm_settings').select('value').eq('key','passoff_template').single();
    if(data && data.value) _aiPassoffTemplate = data.value;
    else _aiPassoffTemplate = DEFAULT_PASSOFF_TEMPLATE;
    const el = document.getElementById('ai-passoff-template');
    if(el) el.value = _aiPassoffTemplate;
  } catch(e){ console.warn('[AI Settings] load failed:', e); }
}

async function saveAIPassoffTemplate(){
  const el = document.getElementById('ai-passoff-template');
  if(!el) return;
  const val = el.value.trim();
  const status = document.getElementById('ai-save-status');
  if(status) status.textContent = 'Saving...';
  try {
    await supabase.from('crm_settings').upsert({ key: 'passoff_template', value: val, updated_at: new Date().toISOString() });
    _aiPassoffTemplate = val;
    window._aiPassoffDirty = false;
    if(status) status.textContent = '✓ Saved';
    setTimeout(()=>{ if(status) status.textContent=''; }, 3000);
  } catch(e){
    if(status) status.textContent = 'Error saving';
    console.error('[AI Settings] save failed:', e);
  }
}

function resetAIPassoffTemplate(){
  const el = document.getElementById('ai-passoff-template');
  if(el) el.value = DEFAULT_PASSOFF_TEMPLATE;
  window._aiPassoffDirty = true;
}

window.saveAIPassoffTemplate = saveAIPassoffTemplate;
window.resetAIPassoffTemplate = resetAIPassoffTemplate;

window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.debouncedAutoSave = debouncedAutoSave;
window.applySettings = applySettings;
window.updateClientField = updateClientField;
window.toggleClientField = toggleClientField;
window.updateClientCalendly = updateClientCalendly;
window.captureClientInputs = captureClientInputs;
window.saveSettingsToSheet = saveSettingsToSheet;
window.renderSettingsPanel = renderSettingsPanel;
window.refreshSettingsBody = refreshSettingsBody;
window.addSettingsStage = addSettingsStage;
window.addSettingsActivityType = addSettingsActivityType;
window.addSopSequence = addSopSequence;
window.addSopActivity = addSopActivity;
window.createNewUser = createNewUser;
window.changeUserRole = changeUserRole;
window.changeUserClient = changeUserClient;
window.fetchAcquisitionCampaigns = fetchAcquisitionCampaigns;
// _fetchedCampaigns needs live getter for inline onclick="..._fetchedCampaigns=null;..."
Object.defineProperty(window, '_fetchedCampaigns', {
  get(){ return _fetchedCampaigns; },
  set(v){ _fetchedCampaigns = v; },
  configurable: true
});
