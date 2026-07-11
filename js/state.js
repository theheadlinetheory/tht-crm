// ═══════════════════════════════════════════════════════════
// STATE — Centralized state management
// ═══════════════════════════════════════════════════════════
// All mutations go through store.* methods to prevent direct
// state tampering and ensure consistent re-renders.

import { render, refreshModal } from './render.js?v=20260711c';

// ─── Raw State (private — modules should use store.*) ───
export const state = {
  deals: [],
  activities: [],
  clients: [],
  appointments: [],
  pipeline: (() => { try { const h=location.hash.replace('#','').split('/')[0]; if(h==='archive'||h==='nurture'){location.hash='acquisition';return 'acquisition';} return ['dashboard','acquisition','client_leads','retargeting'].includes(h)?h:'dashboard'; } catch(e){ return 'acquisition'; } })(),
  selectedDeal: null,
  showNew: false,
  showAddClient: false,
  onboardingModal: null,
  showSop: false,
  dragId: null,
  overCol: null,
  synced: false,
  syncing: false,
  loadFailed: false,
  loadError: '',
  searchQuery: "",
  searchResults: null,
  savedSettings: null,
  dashboardTab: 'client_leads',
  dashboardMonth: new Date().toISOString().slice(0,7),
  rerunQueue: [],
  rerunLoading: false,
  nurtureFilterCampaign: '',
  nurtureFilterBucket: '',
  satSelected: new Set(),
  satSelectAll: false,
  archiveData: [],
  archiveLoaded: false,
  archiveFilterPipeline: '',
  archiveFilterStatus: '',
  archiveFilterClient: '',
  archiveSortDir: 'newest',
  archiveSearch: '',
  showEmployeeArchive: false,
  showPastClients: false,
  bulkMode: false,
  bulkSelected: new Set(),
  viewMode: 'board',
  campaignAssignments: {},
  acquisitionFilter: '',
  showAcqFilterDropdown: false,
  verticalFilter: '',
  showVerticalFilterDropdown: false,
  countryFilter: (() => { try { const v = JSON.parse(localStorage.getItem('tht_countryFilter') || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } })(),
  showCountryFilterDropdown: false,
  acquisitionSubTab: (() => { try { const parts = location.hash.replace('#','').split('/'); if (parts[0] === 'acquisition' && parts[1]) { const valid = ['pipeline','nurture','demo_tracker','cold_calls','retargeting']; return valid.includes(parts[1]) ? parts[1] : 'pipeline'; } return 'pipeline'; } catch { return 'pipeline'; } })(),
  clientLeadsSubTab: 'pipeline',
  assignableUsers: [],
  myDealsFilter: false,
  trackerEntries: [],
  trackerLoaded: false,
  trackerFilters: { client: '', paidStatus: '', leadQuality: '', dateFrom: '', dateTo: '' },
  trackerSort: { field: 'dateAdded', dir: 'asc' },
  trackerEditingCell: null,
  trackerView: 'entries',
  trackerSelected: new Set(),
  trackerBulkField: '',
  trackerBulkValue: '',
  passOffs: [],
  passOffsLoaded: false,
  passOffsFilters: { client: '', dateFrom: '', dateTo: '' },
  passOffsSort: { field: 'datePassed', dir: 'desc' },
  invoiceModal: null,
  demoEntries: [],
  demoLoaded: false,
  demoFilters: { month: '', showStatus: '', outcome: '', dateFrom: '', dateTo: '', bookedBy: '' },
  demoSort: { field: 'callDate', dir: 'desc' },
  demoEditingCell: null,
  demoSelected: new Set(),
  retargetHistory: [],
  retargetExports: [],
  retargetLoaded: false,
  retargetSelected: new Set(),
  retargetSelectAll: false,
  retargetFilters: { stage: '', minDays: 90, campaign: '', location: '', pipeline: '' },
  retargetBuilderStep: 0,
  retargetBuilderName: '',
  retargetBuilderLeads: [],
  retargetValidationResults: null,
  retargetValidating: false,
};

// ─── Pending writes guard ───
export const pendingWrites = { value: 0 };
export const failedWriteQueue = [];
export const pendingDealFields = {};

// ─── In-flight activity guard ───
export const inFlightActivityIds = new Set();

// ─── Deletion/completion caches ───
export const deletedDealIds = new Set(JSON.parse(localStorage.getItem('tht_deletedDeals')||'[]'));
export const deletedActivityIds = new Set(JSON.parse(localStorage.getItem('tht_deletedActs')||'[]'));
export const completedActivityIds = new Set(JSON.parse(localStorage.getItem('tht_completedActs')||'[]'));
export const deletedClientIds = new Set();

// ─── Scroll preservation ───
export let savedScrollLeft = 0;
export function setSavedScrollLeft(v){ savedScrollLeft = v; }

// ─── Settings state ───
export let settingsOpen = false;
export function setSettingsOpen(v){ settingsOpen = v; }
export let settingsTab = 'pipeline';
export function setSettingsTab(v){ settingsTab = v; }
export let clientsSubTab = 'notifications';
export function setClientsSubTab(v){ clientsSubTab = v; }
export let settingsDraft = null;
export function setSettingsDraft(v){ settingsDraft = v; }

// ─── Client portal ───
export let clientPortalStages = null;
export function setClientPortalStages(v){ clientPortalStages = v; }
export let clientArchivedDeals = [];
export function setClientArchivedDeals(v){ clientArchivedDeals = v; }

// ─── Store: centralized mutation API ───
// All list mutations and field sets go through here.
// Callers pass { silent: true } to skip auto-render.

export const store = {
  // ── List operations ──
  addDeal(deal, opts) {
    state.deals.push(deal);
    if (!opts?.silent) render();
  },
  updateDeal(id, fields, opts) {
    const idx = state.deals.findIndex(d => String(d.id) === String(id));
    if (idx >= 0) state.deals[idx] = { ...state.deals[idx], ...fields };
    if (!opts?.silent) render();
  },
  removeDeal(id, opts) {
    state.deals = state.deals.filter(d => String(d.id) !== String(id));
    if (!opts?.silent) render();
  },
  setDeals(deals, opts) {
    state.deals = deals;
    if (!opts?.silent) render();
  },

  addActivity(activity, opts) {
    state.activities.push(activity);
    if (!opts?.silent) render();
  },
  removeActivity(id, opts) {
    state.activities = state.activities.filter(a => String(a.id) !== String(id));
    if (!opts?.silent) render();
  },
  removeActivitiesForDeal(dealId, opts) {
    state.activities = state.activities.filter(a => String(a.dealId) !== String(dealId));
    if (!opts?.silent) render();
  },
  setActivities(activities, opts) {
    state.activities = activities;
    if (!opts?.silent) render();
  },

  addClient(client, opts) {
    state.clients.push(client);
    if (!opts?.silent) render();
  },
  removeClient(name, opts) {
    state.clients = state.clients.filter(c => c.name !== name);
    if (!opts?.silent) render();
  },
  setClients(clients, opts) {
    state.clients = clients;
    if (!opts?.silent) render();
  },

  addAppointment(appt, opts) {
    state.appointments.push(appt);
    if (!opts?.silent) render();
  },
  removeAppointment(id, opts) {
    state.appointments = state.appointments.filter(a => String(a.id) !== String(id));
    if (!opts?.silent) render();
  },
  setAppointments(appointments, opts) {
    state.appointments = appointments;
    if (!opts?.silent) render();
  },

  addRerunItem(item, opts) {
    state.rerunQueue.push(item);
    if (!opts?.silent) render();
  },
  setRerunQueue(queue, opts) {
    state.rerunQueue = queue;
    if (!opts?.silent) render();
  },

  setArchiveData(data, opts) {
    state.archiveData = data;
    if (!opts?.silent) render();
  },
  removeArchiveItem(id, opts) {
    state.archiveData = state.archiveData.filter(d => String(d.id) !== String(id));
    if (!opts?.silent) render();
  },

  setRetargetHistory(data, opts) {
    state.retargetHistory = data;
    if (!opts?.silent) render();
  },
  setRetargetExports(data, opts) {
    state.retargetExports = data;
    if (!opts?.silent) render();
  },

  // ── Field setters (UI state) ──
  set(fields, opts) {
    Object.assign(state, fields);
    if (!opts?.silent) {
      if (state.selectedDeal && fields.selectedDeal !== undefined) refreshModal();
      else render();
    }
  },
};

// Warn user before closing if writes are still in flight
window.addEventListener('beforeunload', e => {
  if(pendingWrites.value > 0 || failedWriteQueue.length > 0){ e.preventDefault(); e.returnValue=''; }
});
