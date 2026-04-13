// ═══════════════════════════════════════════════════════════
// API — API layer (Google Sheets calls + Supabase CRUD)
// ═══════════════════════════════════════════════════════════
import { API_URL, SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export { supabase };
import { state, store, pendingWrites, failedWriteQueue, pendingDealFields, deletedDealIds, deletedActivityIds, completedActivityIds, deletedClientIds } from './app.js';
import { render, refreshModal } from './render.js';

/** @deprecated Use Supabase CRUD helpers (sb*) for data operations. Kept for server-side operations that will become Edge Functions. */
export async function apiGet(action){
  try {
    const r=await fetch(API_URL+"?action="+action, {redirect:"follow"});
    const text=await r.text();
    try { return JSON.parse(text); } catch(e) { console.warn("Parse error:",text.slice(0,200)); return null; }
  }
  catch(e){ console.warn("API GET error:",e); return null; }
}

/** @deprecated Use Supabase CRUD helpers (sb*) for data operations. Kept for server-side operations that will become Edge Functions. */
export async function apiPost(action,data,retries=2){
  for(let attempt=0; attempt<=retries; attempt++){
    try {
      const r=await fetch(API_URL,{method:"POST",redirect:"follow",headers:{"Content-Type":"text/plain"},body:JSON.stringify({action,data})});
      const text=await r.text();
      try {
        const parsed=JSON.parse(text);
        if(parsed && parsed.error) return parsed;
        if(parsed) return parsed;
      } catch(e) {}
      if(attempt<retries){ await new Promise(ok=>setTimeout(ok,800*(attempt+1))); continue; }
      return null;
    } catch(e){
      console.warn("API POST error (attempt "+(attempt+1)+"):",e);
      if(attempt<retries){ await new Promise(ok=>setTimeout(ok,800*(attempt+1))); continue; }
      return null;
    }
  }
}

// ─── Centralized Error Handling ───

function showToast(msg, type = 'error') {
  let el = document.getElementById('api-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'api-toast';
    document.body.appendChild(el);
  }
  const bg = type === 'error' ? '#dc2626' : type === 'success' ? '#059669' : '#d97706';
  el.style.cssText = `position:fixed;bottom:20px;right:20px;background:${bg};color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,.3);transition:opacity .3s;opacity:1`;
  el.textContent = msg;
  clearTimeout(el._fadeTimer);
  el._fadeTimer = setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 5000);
}

export { showToast };
export const showSaveError = (msg) => showToast(msg, 'error');

async function sbCall(fn, { retries = 1, label = 'Operation' } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      console.warn(`${label} failed (attempt ${attempt + 1}):`, e.message);
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      showToast(`${label} failed: ${e.message}`, 'error');
      throw e;
    }
  }
}

export { sbCall };

export async function retryFailedWrites(){
  if(failedWriteQueue.length===0) return;
  const batch=[...failedWriteQueue];
  failedWriteQueue.length=0;
  for(const item of batch){
    try {
      const res=await apiPost(item.action,item.data);
      if(!res||res.error){
        if(Date.now()-item.ts < 300000) failedWriteQueue.push(item);
        else console.error('Dropping failed write after 5min:',item);
      }
    } catch(e){ if(Date.now()-item.ts < 300000) failedWriteQueue.push(item); }
  }
}

export async function syncFromSheet(){
  if(state.selectedDeal) return;
  if(state.showNew) return;
  if(state.showAddClient) return;
  if(state.activateClientLoading) return;
  if(pendingWrites.value > 0) return;
  await retryFailedWrites();
  state.syncing=true; render();
  const data=await apiGet("get_all");
  if(data && !data.error){
    if(data.deals && Array.isArray(data.deals)) {
      state.deals=data.deals.filter(d=>!deletedDealIds.has(String(d.id)));
      state.deals.forEach(d=>{
        Object.keys(d).forEach(k=>{
          if(d[k]!=null && typeof d[k]!=='string') d[k]=String(d[k]);
        });
        if(d.phone && (d.phone.includes('#ERROR') || d.phone.includes('ERROR'))) d.phone='';
        if(d.pipeline==='Client Leads') d.pipeline='Client';
        if(d.value==='0') d.value='';
        if(d.bookedDate && !/^\d{4}-\d{2}-\d{2}$/.test(d.bookedDate)) d.bookedDate='';
        const pending=pendingDealFields[String(d.id)];
        if(pending) Object.assign(d, pending);
      });
    }
    if(data.activities && Array.isArray(data.activities)) {
      state.activities=data.activities.filter(a=>!deletedActivityIds.has(String(a.id)));
      state.activities.forEach(a=>{
        Object.keys(a).forEach(k=>{
          if(k==='done'){ a[k]=(a[k]===true||a[k]==='true'||a[k]==='TRUE'); return; }
          if(a[k]!=null && typeof a[k]!=='string') a[k]=String(a[k]);
        });
        if(completedActivityIds.has(String(a.id)) && !a.done){
          a.done=true;
          if(!a.completedAt) a.completedAt=new Date().toISOString();
        }
      });
    }
    if(data.clients && Array.isArray(data.clients) && data.clients.length>0){
      state.clients=data.clients.filter(c => !deletedClientIds.has(String(c.id)));
      for(const c of state.clients){
        if(!c.calendlyUrl){
          const { getClientConfig } = await import('./client-info.js');
          const cfg = getClientConfig(c.name);
          if(cfg?.calendly_url) c.calendlyUrl = cfg.calendly_url;
        }
      }
    }
    if(data.appointments && Array.isArray(data.appointments)){
      const { getToday } = await import('./utils.js');
      state.appointments=data.appointments;
      state.appointments.forEach(a=>{
        Object.keys(a).forEach(k=>{ if(a[k]!=null && typeof a[k]!=='string') a[k]=String(a[k]); });
        if(a.apptDate && !/^\d{4}-\d{2}-\d{2}$/.test(a.apptDate)){
          try{
            const isoMatch=a.apptDate.match(/^(\d{4}-\d{2}-\d{2})/);
            if(isoMatch){ a.apptDate=isoMatch[1]; }
            else { const d=new Date(a.apptDate); if(!isNaN(d.getTime())) a.apptDate=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); else a.apptDate=''; }
          }catch(e){ a.apptDate=''; }
        }
        if(a.apptTime && !/^\d{2}:\d{2}$/.test(a.apptTime)){
          const tmMatch=a.apptTime.match(/(\d{2}):(\d{2})/);
          if(tmMatch){ a.apptTime=tmMatch[1]+':'+tmMatch[2]; }
          else { a.apptTime=''; }
        }
      });
      state.appointments=state.appointments.filter(a=>a.apptDate && /^\d{4}-\d{2}-\d{2}$/.test(a.apptDate));
      const todayStr=getToday();
      const past=state.appointments.filter(a=>a.apptDate && a.apptDate<todayStr);
      for(const p of past){
        state.appointments=state.appointments.filter(a=>a.id!==p.id);
        sbDeleteAppointment(p.id).catch(()=>{});
      }
    }
    if(data.settings && typeof data.settings==='object' && Object.keys(data.settings).length>0){
      const { applySettings } = await import('./settings.js');
      applySettings(data.settings);
    }
    // Prune deleted-ID caches
    if(data.deals && deletedDealIds.size){
      const serverDealIds=new Set(data.deals.map(d=>String(d.id)));
      for(const id of deletedDealIds){ if(!serverDealIds.has(id)) deletedDealIds.delete(id); }
      localStorage.setItem('tht_deletedDeals',JSON.stringify([...deletedDealIds]));
    }
    if(data.activities && deletedActivityIds.size){
      const serverActIds=new Set(data.activities.map(a=>String(a.id)));
      for(const id of deletedActivityIds){ if(!serverActIds.has(id)) deletedActivityIds.delete(id); }
      localStorage.setItem('tht_deletedActs',JSON.stringify([...deletedActivityIds]));
    }
    if(data.activities && completedActivityIds.size){
      for(const id of completedActivityIds){
        const serverAct=data.activities.find(a=>String(a.id)===id);
        if(serverAct && (serverAct.done===true||serverAct.done==='true'||serverAct.done==='TRUE')){
          completedActivityIds.delete(id);
        }
        if(!serverAct && deletedActivityIds.has(id)) completedActivityIds.delete(id);
      }
      localStorage.setItem('tht_completedActs',JSON.stringify([...completedActivityIds]));
    }
    if(data.clients && deletedClientIds.size){
      const serverClientIds=new Set(data.clients.map(c=>String(c.id)));
      for(const id of deletedClientIds){ if(!serverClientIds.has(id)) deletedClientIds.delete(id); }
    }
    state.synced=true;
    state.loadFailed=false;
    // Run service area checks in background (all roles — clients need maps too)
    // Re-render after checks complete to show badges/maps
    const { runServiceAreaChecks } = await import('./maps.js');
    runServiceAreaChecks().then(() => render()).catch(e => console.warn('Service area checks failed:', e));
    // Pre-load archive
    if((isAdmin()||isEmployee()) && !state.archiveLoaded){
      const { loadArchive } = await import('./archive.js');
      loadArchive(true);
    }
  } else {
    if(state.deals.length===0){
      const { getTestData } = await import('./config.js');
      const { TEST_DEALS, TEST_ACTIVITIES, TEST_CLIENTS } = getTestData();
      state.deals=[...TEST_DEALS];
      state.activities=[...TEST_ACTIVITIES];
      state.clients=[...TEST_CLIENTS];
      state.loadFailed=true;
    }
  }
  state.syncing=false;
  if(state.selectedDeal){
    const freshDeal=state.deals.find(d=>String(d.id)===String(state.selectedDeal.id));
    if(freshDeal) state.selectedDeal=freshDeal;
    refreshModal();
  } else {
    render();
  }
}

// ─── Reply Polling ───
export async function pollReplyStatus(){
  if(pendingWrites.value>0) return;
  try{
    const replies=await apiGet('get_reply_status');
    if(!Array.isArray(replies)) return;
    let changed=false;
    for(const r of replies){
      const deal=state.deals.find(d=>String(d.id)===String(r.id));
      if(deal && !deal.hasNewReply){
        deal.hasNewReply=r.hasNewReply;
        changed=true;
      }
    }
    if(changed){
      if(state.selectedDeal) refreshModal();
      else render();
    }
  }catch(e){}
}

export async function triggerBackendReplyCheck(){
  try{ await apiGet('run_admin&fn=checkReplies'); }catch(e){}
}

// ─── Field Normalization (snake_case ↔ camelCase) ───

const FIELD_MAP = {
  sl_lead_id: 'slLeadId',
  sl_campaign_id: 'slCampaignId',
  campaign_name: 'campaignName',
  lead_category: 'leadCategory',
  created_at: 'createdDate',
  updated_at: 'lastUpdated',
  smartlead_url: 'smartleadUrl',
  forwarded_at: 'forwardedAt',
  email_body: 'emailBody',
  mobile_phone: 'mobilePhone',
  pushed_to_tracker: 'pushedToTracker',
  client_stage: 'clientStage',
  booked_date: 'bookedDate',
  booked_time: 'bookedTime',
  cal_name: 'calName',
  cal_email: 'calEmail',
  cal_notes: 'calNotes',
  deal_id: 'dealId',
  due_date: 'dueDate',
  day_label: 'dayLabel',
  scheduled_time: 'scheduledTime',
  completed_at: 'completedAt',
  notify_email: 'notifyEmail',
  notify_phone: 'notifyPhone',
  calendly_url: 'calendlyUrl',
  enable_auto_forward: 'enableAutoForward',
  lead_cost: 'leadCost',
  contact_first_name: 'contactFirstName',
  service_area_url: 'serviceAreaUrl',
  enable_forward: 'enableForward',
  enable_calendly: 'enableCalendly',
  enable_copy_info: 'enableCopyInfo',
  enable_tracker: 'enableTracker',
  time_zone: 'timeZone',
  deal_name: 'dealName',
  queued_at: 'queuedAt',
  rerun_after: 'rerunAfter',
  sent_at: 'sentAt',
  rerun_days: 'rerunDays',
  original_data: 'originalData',
  archived_at: 'archivedAt',
  archive_status: 'archiveStatus',
  client_name: 'clientName',
  lead_name: 'leadName',
  appt_date: 'apptDate',
  appt_time: 'apptTime',
  owner_override: 'ownerOverride',
  has_new_reply: 'hasNewReply',
  notify_emails: 'notifyEmails',
  client_standing: 'clientStanding',
  source_stage: 'sourceStage',
  queued_date: 'queuedDate',
  rerun_date: 'rerunDate',
};

const REVERSE_FIELD_MAP = {};
for (const [snake, camel] of Object.entries(FIELD_MAP)) {
  REVERSE_FIELD_MAP[camel] = snake;
}

const BOOLEAN_FIELDS = new Set(['done']);

export function normalizeRow(row) {
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = FIELD_MAP[key] || key;
    if (BOOLEAN_FIELDS.has(camelKey)) {
      normalized[camelKey] = (value === true || value === 'true' || value === 'TRUE');
    } else {
      normalized[camelKey] = value != null ? String(value) : '';
    }
  }
  return normalized;
}

const NULLABLE_COLS = new Set(['completed_at','scheduled_time','created_at','updated_at','forwarded_at','pushed_to_tracker','queued_at','rerun_after','sent_at','archived_at','value','lead_cost','rerun_days']);

export function camelToSnake(obj) {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = REVERSE_FIELD_MAP[key] || key;
    result[snakeKey] = (value === '' && NULLABLE_COLS.has(snakeKey)) ? null : value;
  }
  return result;
}

// ─── Supabase Initial Sync & Realtime ───

export async function initialSync() {
  try {
    const [deals, activities, clients, appointments] = await Promise.all([
      sbGetDeals(), sbGetActivities(), sbGetClients(), sbGetAppointments()
    ]);
    state.deals = deals.map(normalizeRow);
    state.activities = activities.map(normalizeRow);
    state.clients = clients.map(normalizeRow);
    state.appointments = (appointments || []).map(normalizeRow);

    // Normalize deal fields
    for (const d of state.deals) {
      if (d.phone && (d.phone.includes('#ERROR') || d.phone.includes('ERROR'))) d.phone = '';
      if (d.pipeline === 'Client Leads') d.pipeline = 'Client';
      if (d.value === '0') d.value = '';
      if (d.bookedDate && !/^\d{4}-\d{2}-\d{2}$/.test(d.bookedDate)) d.bookedDate = '';
      const pending = pendingDealFields[String(d.id)];
      if (pending) Object.assign(d, pending);
    }

    // Apply deletion guards
    state.deals = state.deals.filter(d => !deletedDealIds.has(String(d.id)));
    state.activities = state.activities.filter(a => !deletedActivityIds.has(String(a.id)));

    // Apply completed status guards
    for (const a of state.activities) {
      if (completedActivityIds.has(String(a.id)) && !a.done) {
        a.done = true;
        if (!a.completedAt) a.completedAt = new Date().toISOString();
      }
    }

    state.synced = true;
    state.loadFailed = false;
    render();
  } catch (e) {
    console.error('Initial sync failed:', e);
    state.loadFailed = true;
    state.synced = true;
    render();
  }
}

export function subscribeRealtime() {
  supabase.channel('deals-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'deals' }, payload => {
      if (pendingWrites.value > 0 || state.selectedDeal || state.showNew || state.showAddClient) return;
      handleRealtimeChange('deals', payload);
    })
    .subscribe();

  supabase.channel('activities-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'activities' }, payload => {
      if (pendingWrites.value > 0) return;
      handleRealtimeChange('activities', payload);
    })
    .subscribe();

  supabase.channel('clients-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, payload => {
      if (pendingWrites.value > 0) return;
      handleRealtimeChange('clients', payload);
    })
    .subscribe();

  supabase.channel('appointments-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, payload => {
      handleRealtimeChange('appointments', payload);
    })
    .subscribe();
}

function handleRealtimeChange(table, payload) {
  const { eventType } = payload;
  const newRow = payload.new ? normalizeRow(payload.new) : null;
  const oldRow = payload.old ? normalizeRow(payload.old) : null;

  const stateKey = table === 'rerun_queue' ? 'rerunQueue' : table;
  const list = state[stateKey];
  if (!list) return;

  if (eventType === 'INSERT' && newRow) {
    if (!list.find(item => String(item.id) === String(newRow.id))) {
      list.push(newRow);
    }
  } else if (eventType === 'UPDATE' && newRow) {
    const idx = list.findIndex(item => String(item.id) === String(newRow.id));
    if (idx >= 0) list[idx] = newRow;
  } else if (eventType === 'DELETE' && oldRow) {
    const idx = list.findIndex(item => String(item.id) === String(oldRow.id));
    if (idx >= 0) list.splice(idx, 1);
  }

  render();
}

// ─── Supabase CRUD Helpers ───

// Deals
export const sbGetDeals = () => sbCall(async () => {
  const { data, error } = await supabase.from('deals').select('*');
  if (error) throw error;
  return data;
}, { label: 'Load deals' });

export const sbCreateDeal = (fields) => sbCall(async () => {
  const { data, error } = await supabase.from('deals').insert(fields).select().single();
  if (error) throw error;
  return data;
}, { label: 'Create deal' });

export const sbUpdateDeal = (id, fields) => sbCall(async () => {
  const { error } = await supabase.from('deals').update(fields).eq('id', id);
  if (error) throw error;
}, { label: 'Update deal' });

export const sbDeleteDeal = (id) => sbCall(async () => {
  const { error } = await supabase.from('deals').delete().eq('id', id);
  if (error) throw error;
}, { label: 'Delete deal' });

// Activities
export const sbGetActivities = () => sbCall(async () => {
  const { data, error } = await supabase.from('activities').select('*');
  if (error) throw error;
  return data;
}, { label: 'Load activities' });

export const sbCreateActivity = (fields) => sbCall(async () => {
  const { data, error } = await supabase.from('activities').insert(fields).select().single();
  if (error) throw error;
  return data;
}, { label: 'Create activity' });

export const sbUpdateActivity = (id, fields) => sbCall(async () => {
  const { error } = await supabase.from('activities').update(fields).eq('id', id);
  if (error) throw error;
}, { label: 'Update activity' });

export const sbDeleteActivity = (id) => sbCall(async () => {
  const { error } = await supabase.from('activities').delete().eq('id', id);
  if (error) throw error;
}, { label: 'Delete activity' });

// Clients
export const sbGetClients = () => sbCall(async () => {
  const { data, error } = await supabase.from('clients').select('*');
  if (error) throw error;
  return data;
}, { label: 'Load clients' });

export const sbCreateClient = (fields) => sbCall(async () => {
  const { data, error } = await supabase.from('clients').insert(fields).select().single();
  if (error) throw error;
  return data;
}, { label: 'Create client' });

export const sbUpdateClient = (id, fields) => sbCall(async () => {
  const { error } = await supabase.from('clients').update(fields).eq('id', id);
  if (error) throw error;
}, { label: 'Update client' });

export const sbDeleteClient = (id) => sbCall(async () => {
  const { error } = await supabase.from('clients').delete().eq('id', id);
  if (error) throw error;
}, { label: 'Delete client' });

export const sbBatchUpdateClients = (updates) => sbCall(async () => {
  const promises = updates.map(({ id, ...fields }) =>
    supabase.from('clients').update(fields).eq('id', id)
  );
  const results = await Promise.all(promises);
  const failed = results.filter(r => r.error);
  if (failed.length) throw new Error(`${failed.length} client updates failed`);
}, { label: 'Save client settings' });

// Appointments
export const sbGetAppointments = () => sbCall(async () => {
  const { data, error } = await supabase.from('appointments').select('*');
  if (error) throw error;
  return data;
}, { label: 'Load appointments' });

export const sbCreateAppointment = (fields) => sbCall(async () => {
  const { data, error } = await supabase.from('appointments').insert(fields).select().single();
  if (error) throw error;
  return data;
}, { label: 'Create appointment' });

export const sbDeleteAppointment = (id) => sbCall(async () => {
  const { error } = await supabase.from('appointments').delete().eq('id', id);
  if (error) throw error;
}, { label: 'Delete appointment' });

// Rerun Queue
export const sbGetRerunQueue = () => sbCall(async () => {
  const { data, error } = await supabase.from('rerun_queue').select('*');
  if (error) throw error;
  return data;
}, { label: 'Load rerun queue' });

export const sbAddToRerun = (fields) => sbCall(async () => {
  const { data, error } = await supabase.from('rerun_queue').insert(fields).select().single();
  if (error) throw error;
  return data;
}, { label: 'Add to rerun queue' });

export const sbUpdateRerunStatus = (id, status) => sbCall(async () => {
  const { error } = await supabase.from('rerun_queue').update({ status }).eq('id', id);
  if (error) throw error;
}, { label: 'Update rerun status' });

// Market Settings
export const sbGetMarketSettings = () => sbCall(async () => {
  const { data, error } = await supabase.from('market_settings').select('*');
  if (error) throw error;
  return data;
}, { label: 'Load market settings' });

export const sbSaveMarketSetting = (fields) => sbCall(async () => {
  const { error } = await supabase.from('market_settings')
    .upsert(fields, { onConflict: 'state,city' });
  if (error) throw error;
}, { label: 'Save market setting' });

// Archive
export const sbGetArchive = () => sbCall(async () => {
  const { data, error } = await supabase.from('archive').select('*');
  if (error) throw error;
  return data;
}, { label: 'Load archive' });

export const sbArchiveDeal = (id, originalData) => sbCall(async () => {
  const { error } = await supabase.from('archive').insert({ id, original_data: originalData });
  if (error) throw error;
}, { label: 'Archive deal' });

export const sbRestoreFromArchive = (id) => sbCall(async () => {
  const { data, error } = await supabase.from('archive').select('*').eq('id', id).single();
  if (error) throw error;
  await supabase.from('archive').delete().eq('id', id);
  return data;
}, { label: 'Restore from archive' });

// Client Config
export const sbGetClientConfig = () => sbCall(async () => {
  const { data, error } = await supabase.from('client_config').select('*');
  if (error) throw error;
  return data;
}, { label: 'Load client config' });

export const sbUpdateClientConfig = (clientName, fields) => sbCall(async () => {
  const { error } = await supabase.from('client_config').update(fields).eq('client_name', clientName);
  if (error) throw error;
}, { label: 'Update client config' });

export const sbCreateClientConfig = (fields) => sbCall(async () => {
  const { data, error } = await supabase.from('client_config').insert(fields).select().single();
  if (error) throw error;
  return data;
}, { label: 'Create client config' });

// Webhook Log
export const sbGetWebhookLog = () => sbCall(async () => {
  const { data, error } = await supabase.from('webhook_log').select('*').order('timestamp', { ascending: false }).limit(100);
  if (error) throw error;
  return data;
}, { label: 'Load webhook log' });

// ─── Edge Function Invoker ───

export async function invokeEdgeFunction(fnName, body) {
  const url = `${SUPABASE_URL}/functions/v1/${fnName}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify(body)
  });
  const data = await resp.json();
  if (!resp.ok && !data.ok) throw new Error(data.error || `Edge Function ${fnName} failed (${resp.status})`);
  return data;
}

// Expose to inline HTML handlers — syncFromSheet now delegates to initialSync
window.syncFromSheet = initialSync;
window.initialSync = initialSync;
