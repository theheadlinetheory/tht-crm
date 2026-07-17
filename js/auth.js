// ═══════════════════════════════════════════════════════════
// AUTH — Supabase Auth (Google OAuth), roles, campaign assignments
// ═══════════════════════════════════════════════════════════
import { supabase } from './supabase-client.js?v=20260717b';
import { state } from './app.js?v=20260717b';
import { render } from './render.js?v=20260717b';
import { esc, svgIcon } from './utils.js?v=20260717b';
import { resolveRoutingOwner } from './routing-rules.js?v=20260717b';

const ALLOWED_DOMAIN = 'theheadlinetheory.com';
export let currentUser = null;

export function isAdmin(){ return currentUser && currentUser.role === 'admin'; }
export function isEmployee(){ return currentUser && currentUser.role === 'employee'; }

// ─── Google sign-in ───
export async function handleGoogleSignIn(){
  const errEl = document.getElementById('login-error');
  if(errEl) errEl.style.display='none';
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.pathname,
      queryParams: { hd: ALLOWED_DOMAIN, prompt: 'select_account' }
    }
  });
  if(error && errEl){ errEl.textContent = error.message || 'Google sign-in failed'; errEl.style.display='block'; }
}

// map a profiles row (snake_case) -> frontend user (camelCase)
function toUser(sessionUser, profile){
  return {
    uid: sessionUser.id,
    id: sessionUser.id,
    name: (profile && profile.name) || sessionUser.user_metadata?.full_name || sessionUser.email.split('@')[0],
    email: sessionUser.email,
    role: profile.role,
    tagColor: profile.tag_color,
    photoURL: profile.photo_url
  };
}

// ─── Auth state listener (called from app.js) ───
export function setupAuthListener(onLogin){
  let _bootedUid = null;

  const boot = async (session) => {
    const bootLoader = document.getElementById('boot-loader');
    if(bootLoader) bootLoader.remove();

    const user = session && session.user;
    if(user){
      // Domain gate — reject anything outside the company Google workspace.
      if(!user.email || !user.email.toLowerCase().endsWith('@'+ALLOWED_DOMAIN)){
        await supabase.auth.signOut();
        const errEl = document.getElementById('login-error');
        if(errEl){ errEl.textContent = 'Use your @'+ALLOWED_DOMAIN+' Google account'; errEl.style.display='block'; }
        return;
      }
      if(_bootedUid === user.id) return;   // token refresh re-fire — no re-boot
      _bootedUid = user.id;

      // maybeSingle(): profile=null with NO error when the row is genuinely absent
      // (vs single() which errors PGRST116). Lets us tell "not provisioned" from
      // "read failed" and never silently grant a role from a missing/failed read.
      let profile = null, hardError = false;
      try {
        const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
        if(error) hardError = true;
        profile = data;
      } catch(e){ console.warn('profile load failed:', e); hardError = true; }

      if(!profile){
        // No provisioned profile (deleted / trigger never ran) or a transient read
        // failure — deny access rather than defaulting to a role. Retry on reload.
        await supabase.auth.signOut();
        _bootedUid = null;
        const errEl = document.getElementById('login-error');
        if(errEl){
          errEl.textContent = hardError
            ? 'Could not verify your account — please try again.'
            : 'Your account isn’t set up in the CRM. Contact an admin.';
          errEl.style.display = 'block';
        }
        document.getElementById('login-screen').style.display = 'flex';
        return;
      }
      currentUser = toUser(user, profile);

      document.getElementById('login-screen').style.display='none';
      showTransitionScreen('Loading your CRM...');

      const hash = location.hash.replace('#','').split('/')[0];
      if(isAdmin()){
        state.pipeline = hash && ['dashboard','acquisition','client_leads','nurture'].includes(hash) ? hash : 'client_leads';
      } else {
        state.pipeline = hash && ['acquisition','client_leads'].includes(hash) ? hash : 'client_leads';
      }

      document.getElementById('app').style.display='block';
      try { await onLogin(); } catch(e){ console.error('initApp error:', e); }

      const _waitForSync = setInterval(()=>{ if(state.synced){ clearInterval(_waitForSync); hideTransitionScreen(); } }, 100);
      setTimeout(()=>{ clearInterval(_waitForSync); hideTransitionScreen(); }, 8000);
    } else {
      _bootedUid = null;
      currentUser = null;
      const app = document.getElementById('app');
      if(app){ app.style.display='none'; }
      const login = document.getElementById('login-screen');
      if(login) login.style.display='flex';
    }
  };

  supabase.auth.getSession().then(({ data }) => boot(data.session));
  supabase.auth.onAuthStateChange((_event, session) => boot(session));
}

export function logout(){
  showTransitionScreen('Logging out...');
  resetAppState();
  document.getElementById('app').style.display='none';
  document.getElementById('app').innerHTML='';
  supabase.auth.signOut().then(()=>{
    hideTransitionScreen();
    document.getElementById('login-screen').style.display='flex';
  });
}
export function switchUser(){ logout(); }   // same flow: sign out -> Google picker (prompt:select_account)

// ─── User management (admin) — profiles table ───
export async function loadAllUsers(){
  try {
    const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: true });
    if(error) throw error;
    return (data||[]).map(p => ({ uid: p.id, name: p.name, email: p.email, role: p.role, tagColor: p.tag_color, photoURL: p.photo_url }));
  } catch(e){ console.error('loadAllUsers error:', e); return []; }
}
export async function loadAssignableUsers(){
  if(state.assignableUsers.length > 0) return state.assignableUsers;
  const all = await loadAllUsers();
  state.assignableUsers = all.filter(u => u.role === 'admin' || u.role === 'employee');
  return state.assignableUsers;
}
export async function updateUserName(uid, name){
  const { error } = await supabase.from('profiles').update({ name }).eq('id', uid);
  if(error) throw error;
}
export async function updateUserRole(uid, role){
  const { error } = await supabase.from('profiles').update({ role }).eq('id', uid);
  if(error) throw error;
}
export async function updateUserTagColor(uid, tagColor){
  const { error } = await supabase.from('profiles').update({ tag_color: tagColor }).eq('id', uid);
  if(error) throw error;
}
export async function updateUserPhoto(uid, photoURL){
  const { error } = await supabase.from('profiles').update({ photo_url: photoURL }).eq('id', uid);
  if(error) throw error;
}
export async function deleteUser(uid){
  const { error } = await supabase.from('profiles').delete().eq('id', uid);
  if(error) throw error;
}

// ─── Campaign assignments — crm_settings row ───
// NOTE: crm_settings is a PRE-EXISTING table whose `value` column is TEXT holding a
// JSON string (RLS is OFF). Always JSON.parse on read and JSON.stringify on write, and
// set updated_at — matching the existing pattern (see settings.js dialer_default_fields).
export async function loadCampaignAssignments(){
  try {
    const { data } = await supabase.from('crm_settings').select('value').eq('key','campaign_assignments').single();
    if(data && data.value) state.campaignAssignments = JSON.parse(data.value);
  } catch(e){ console.warn('Failed to load campaign assignments:', e); }
}
async function persistAssignments(){
  try {
    await supabase.from('crm_settings').upsert(
      { key:'campaign_assignments', value: JSON.stringify(state.campaignAssignments), updated_at: new Date().toISOString() },
      { onConflict: 'key' });
  } catch(e){ console.warn('Failed to save campaign assignment:', e); }
}
export async function saveCampaignAssignment(campaignName, userName){
  state.campaignAssignments[campaignName] = userName; render(); await persistAssignments();
}
export async function assignCampaignOwner(campaignName, userName){
  if(!userName) delete state.campaignAssignments[campaignName];
  else state.campaignAssignments[campaignName] = userName;
  await persistAssignments(); render();
}
export async function removeCampaignAssignment(campaignName){
  delete state.campaignAssignments[campaignName]; await persistAssignments(); render();
}
export function listenCampaignAssignments(){
  try {
    supabase.channel('crm_settings-assignments')
      .on('postgres_changes', { event:'*', schema:'public', table:'crm_settings', filter:'key=eq.campaign_assignments' },
        payload => { if(payload.new && payload.new.value){ try { state.campaignAssignments = JSON.parse(payload.new.value); render(); } catch(_){} } })
      .subscribe();
  } catch(e){ console.warn('Campaign assignment listener failed:', e); }
}

// ─── Copied verbatim from the previous auth.js — unchanged ───
const TAG_PALETTE = ['#2563eb','#d97706','#059669','#dc2626','#7c3aed','#0891b2','#c026d3','#ea580c'];
const TAG_COLOR_MAP = {
  '#2563eb': { bg: '#dbeafe', fg: '#1d4ed8' },
  '#d97706': { bg: '#fef3c7', fg: '#92400e' },
  '#059669': { bg: '#d1fae5', fg: '#065f46' },
  '#dc2626': { bg: '#fee2e2', fg: '#991b1b' },
  '#7c3aed': { bg: '#ede9fe', fg: '#5b21b6' },
  '#0891b2': { bg: '#cffafe', fg: '#155e75' },
  '#c026d3': { bg: '#fae8ff', fg: '#86198f' },
  '#ea580c': { bg: '#ffedd5', fg: '#9a3412' },
};

export { TAG_PALETTE };

function hexToTagStyle(hex) {
  const mapped = TAG_COLOR_MAP[hex];
  if (mapped) return mapped;
  return { bg: hex + '22', fg: hex };
}

export function getOwnerColor(name){
  if(!name) return null;
  const lower = name.toLowerCase().trim();
  const user = state.assignableUsers.find(u =>
    (u.name || '').toLowerCase().trim() === lower ||
    (u.name || '').toLowerCase().split(/\s+/)[0] === lower
  );
  const hex = (user && user.tagColor) || TAG_PALETTE[0];
  const style = hexToTagStyle(hex);
  return { label: name, bg: style.bg, fg: style.fg };
}

export function getOwnerForDeal(deal){
  if(deal.ownerOverride) return getOwnerColor(deal.ownerOverride);
  if(!deal.campaignName) return null;
  const owner = state.campaignAssignments[deal.campaignName] || resolveRoutingOwner(deal.campaignName);
  if(!owner) return null;
  return getOwnerColor(owner);
}

export function getOwnerNameForDeal(deal){
  if(deal.ownerOverride) return deal.ownerOverride;
  if(!deal.campaignName) return '';
  return state.campaignAssignments[deal.campaignName] || resolveRoutingOwner(deal.campaignName) || '';
}

export function resetAppState(){
  currentUser = null;
  state.pipeline = 'client_leads';
  state.selectedDeal = null;
  state.showNew = false;
  state.showAddClient = false;
  state.showEmployeeArchive = false;
  state.archiveSearch = '';
  state.archiveLoaded = false;
  state.archiveData = [];
  state.nurtureSubTab = 'board';
  state.searchQuery = '';
  state.searchResults = null;
  state.bulkMode = false;
  state.bulkSelected = new Set();
  state.synced = false;
  state.syncing = false;
  state.showSop = false;
  state.viewMode = 'board';
  location.hash = '';
}

export function showTransitionScreen(msg){
  let overlay = document.getElementById('transition-overlay');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.id = 'transition-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:var(--bg);display:flex;flex-direction:column;align-items:center;justify-content:center';
    overlay.innerHTML = '<div class="loading-logo"><span>T</span></div><div id="transition-text" class="loading-text" style="color:var(--text-muted);font-size:14px;margin-top:12px">Loading...</div><div class="loading-spinner"></div>';
    document.body.appendChild(overlay);
  }
  const textEl = overlay.querySelector('#transition-text');
  if(textEl) textEl.textContent = msg || 'Loading...';
  overlay.style.display = 'flex';
}

export function hideTransitionScreen(){
  const overlay = document.getElementById('transition-overlay');
  if(overlay) overlay.style.display = 'none';
}

export function toggleUserMenu(e){
  e.stopPropagation();
  const menu = document.getElementById('user-menu-dropdown');
  if(menu) menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
}

// Close user menu on outside click
document.addEventListener('click', ()=>{ const m=document.getElementById('user-menu-dropdown'); if(m) m.style.display='none'; if(state.showAcqFilterDropdown){state.showAcqFilterDropdown=false;render();} });

export function renderUserMenu(){
  if(!currentUser) return '';
  return `<div style="position:relative;display:inline-block">
    <button class="btn btn-ghost" onclick="toggleUserMenu(event)" style="font-size:11px;padding:5px 10px;color:#9ca3af;display:flex;align-items:center;gap:4px">
      ${esc(currentUser.name)} ▾
    </button>
    <div id="user-menu-dropdown" style="display:none;position:absolute;right:0;top:100%;margin-top:4px;background:#fff;border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);min-width:160px;z-index:9999;overflow:hidden">
      <div style="padding:8px 12px;border-bottom:1px solid var(--border);font-size:11px;color:#6b7280">${esc(currentUser.email||'')}</div>
      <button onclick="switchUser()" style="width:100%;text-align:left;padding:8px 12px;border:none;background:none;font-size:12px;cursor:pointer;color:var(--text);font-family:var(--font)" onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='none'">${svgIcon('refresh-cw',12)} Switch User</button>
      <button onclick="logout()" style="width:100%;text-align:left;padding:8px 12px;border:none;background:none;font-size:12px;cursor:pointer;color:#dc2626;font-family:var(--font)" onmouseover="this.style.background='#fef2f2'" onmouseout="this.style.background='none'">Log Out</button>
    </div>
  </div>`;
}

// ─── Expose to inline HTML handlers ───
window.handleGoogleSignIn = handleGoogleSignIn;
window.logout = logout;
window.switchUser = switchUser;
window.toggleUserMenu = toggleUserMenu;
window.assignCampaignOwner = assignCampaignOwner;
window.removeCampaignAssignment = removeCampaignAssignment;
