// ═══════════════════════════════════════════════════════════
// APP — Entry point, initApp, re-exports from state.js
// ═══════════════════════════════════════════════════════════
import { REPLY_CHECK_INTERVAL, REPLY_BACKEND_POLL_INTERVAL, SYNC_INTERVAL } from './config.js?v=20260720203041';
import { render } from './render.js?v=20260720203041';
import { syncFromSheet, pollReplyStatus, triggerBackendReplyCheck, initialSync, subscribeRealtime, flushRealtimeQueue } from './api.js?v=20260720203041';
import { isAdmin, isEmployee, loadCampaignAssignments, listenCampaignAssignments, setupAuthListener } from './auth.js?v=20260720203041';
import { initJustCallDialer } from './dialer.js?v=20260720203041';
import './email.js?v=20260720203041';
import './blooio.js?v=20260720203041';

// ─── Local import for vars used in this file ───
import { state } from './state.js?v=20260720203041';

// ─── Re-export state from centralized module ───
export {
  state, store,
  pendingWrites, failedWriteQueue, pendingDealFields, inFlightActivityIds,
  deletedDealIds, deletedActivityIds, completedActivityIds, deletedClientIds,
  savedScrollLeft, setSavedScrollLeft,
  settingsOpen, setSettingsOpen,
  settingsTab, setSettingsTab,
  clientsSubTab, setClientsSubTab,
  settingsDraft, setSettingsDraft,
} from './state.js?v=20260720203041';

// ─── Init ───
let appInitialized=false;
export async function initApp(){
  if(appInitialized) return;
  appInitialized=true;
  try {
    // Apply cached settings immediately
    try{
      const { applySettings } = await import('./settings.js?v=20260720203041');
      const cached=JSON.parse(localStorage.getItem('tht_settings'));
      if(cached) applySettings(cached, true);
    }catch(e){}
    if(isAdmin()||isEmployee()){
      await loadCampaignAssignments();
      listenCampaignAssignments();
      const { loadRoutingRules, listenRoutingRules } = await import('./routing-rules.js?v=20260720203041');
      await loadRoutingRules();
      listenRoutingRules();
    }
    // First render — show loading screen immediately so #app is never blank
    render();
    // Initialize service area polygon data from global script
    if(window.SERVICE_AREA_POLYGONS){
      try {
        const { setServiceAreaData } = await import('./maps.js?v=20260720203041');
        setServiceAreaData(window.SERVICE_AREA_POLYGONS);
      } catch(e){ console.warn('setServiceAreaData failed:', e); }
    }
    await initialSync(true);
    await subscribeRealtime();
    // Deep link: ?deal=ID opens that deal's modal after sync
    try {
      const urlDealId = new URLSearchParams(window.location.search).get('deal');
      if (urlDealId) {
        const { openDeal } = await import('./deal-modal.js?v=20260720203041');
        const target = state.deals.find(d => String(d.id) === urlDealId);
        if (target) openDeal(target.id);
        window.history.replaceState({}, '', window.location.pathname + window.location.hash);
      }
    } catch(e) { console.warn('Deep link failed:', e); }
    // Background sync — catches anything realtime missed
    setInterval(() => {
      flushRealtimeQueue();
      initialSync(false);
    }, SYNC_INTERVAL);
    // Re-sync when tab becomes visible after being hidden (sleep, tab switch)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        flushRealtimeQueue();
        initialSync(false);
      }
    });
    if(isAdmin()||isEmployee()){
      setInterval(pollReplyStatus, REPLY_CHECK_INTERVAL);
      triggerBackendReplyCheck();
      setInterval(triggerBackendReplyCheck, REPLY_BACKEND_POLL_INTERVAL);
    }
    initJustCallDialer();
    import('./number-health.js?v=20260720203041').then(m => m.loadNumberHealth()).catch(e => console.warn('Number health load failed:', e));
    import('./warm-call.js?v=20260720203041').catch(e => console.warn('Warm call module load failed:', e));
    // Load nurture data for Due Today banner
    import('./rerun.js?v=20260720203041').then(m => m.loadNurtureData()).catch(e => console.warn('Nurture data load failed:', e));
  } catch(e) {
    console.error('initApp failed:', e);
    state.loadFailed = true;
    state.loadError = e?.message || String(e);
    state.synced = true;
    render();
  }
}

// ─── Event Delegation ───
import { initDelegation } from './delegate.js?v=20260720203041';
initDelegation();

// ─── Bootstrap ───
setupAuthListener(initApp);
