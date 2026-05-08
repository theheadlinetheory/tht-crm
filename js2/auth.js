// ═══════════════════════════════════════════════════════════
// AUTH — Firebase Auth, user management, campaign assignments
// ═══════════════════════════════════════════════════════════
import { firebaseConfig, ROLES } from './config.js';
import { state } from './app.js';
import { render } from './render.js';
import { esc, svgIcon, str } from './utils.js';

// Firebase instances (initialized once)
firebase.initializeApp(firebaseConfig);
export const auth = firebase.auth();
export const db = firebase.firestore();

export let currentUser = null;
let authMode = 'login';

// ─── Role Checks ───
export function isAdmin(){ return currentUser && currentUser.role === 'admin'; }
export function isClient(){ return currentUser && currentUser.role === 'client'; }
export function isEmployee(){ return currentUser && currentUser.role === 'employee'; }

// ─── Auth UI Toggle ───
export function toggleAuthMode(){
  authMode = authMode==='login' ? 'signup' : 'login';
  document.getElementById('login-subtitle').textContent = authMode==='signup' ? 'Create your account' : 'Sign in to your CRM';
  document.getElementById('login-btn').textContent = authMode==='signup' ? 'Create Account' : 'Sign In';
  document.getElementById('name-field').style.display = authMode==='signup' ? 'block' : 'none';
  document.getElementById('reset-link').style.display = authMode==='signup' ? 'none' : 'block';
  document.getElementById('auth-toggle').innerHTML = authMode==='signup'
    ? 'Already have an account? <strong style="color:var(--purple)">Sign in</strong>'
    : 'Don\'t have an account? <strong style="color:var(--purple)">Sign up</strong>';
  document.getElementById('login-error').style.display='none';
}

export async function handleAuth(){
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-password').value;
  const nameVal = document.getElementById('login-name').value.trim();
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  errEl.style.display='none';

  if(!email || !pass){ errEl.textContent='Please fill in all fields'; errEl.style.display='block'; return; }
  if(authMode==='signup' && !nameVal){ errEl.textContent='Please enter your name'; errEl.style.display='block'; return; }
  if(pass.length < 6){ errEl.textContent='Password must be at least 6 characters'; errEl.style.display='block'; return; }

  btn.disabled=true;
  btn.textContent = authMode==='signup' ? 'Creating account...' : 'Signing in...';

  try {
    let cred;
    if(authMode==='signup'){
      cred = await auth.createUserWithEmailAndPassword(email, pass);
      await cred.user.updateProfile({ displayName: nameVal });
      const usersSnap = await db.collection('users').get();
      const isFirstUser = usersSnap.empty;
      await db.collection('users').doc(cred.user.uid).set({
        name: nameVal,
        email: email,
        role: isFirstUser ? 'admin' : 'client',
        clientName: '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } else {
      cred = await auth.signInWithEmailAndPassword(email, pass);
    }
  } catch(e){
    let msg = 'Something went wrong';
    if(e.code==='auth/email-already-in-use') msg='An account with this email already exists';
    else if(e.code==='auth/invalid-email') msg='Invalid email address';
    else if(e.code==='auth/weak-password') msg='Password must be at least 6 characters';
    else if(e.code==='auth/user-not-found') msg='No account found with this email';
    else if(e.code==='auth/wrong-password'||e.code==='auth/invalid-credential') msg='Incorrect email or password';
    else if(e.code==='auth/too-many-requests') msg='Too many attempts — try again later';
    errEl.textContent=msg;
    errEl.style.display='block';
    btn.disabled=false;
    btn.textContent = authMode==='signup' ? 'Create Account' : 'Sign In';
  }
}

export async function handlePasswordReset(){
  const email = document.getElementById('login-email').value.trim();
  const errEl = document.getElementById('login-error');
  if(!email){ errEl.textContent='Enter your email above first'; errEl.style.display='block'; return; }
  try {
    await auth.sendPasswordResetEmail(email);
    errEl.textContent='Password reset email sent! Check your inbox.';
    errEl.style.color='var(--green)';
    errEl.style.display='block';
    setTimeout(()=>{ errEl.style.color=''; }, 4000);
  } catch(e){
    errEl.textContent='Could not send reset email — check the address';
    errEl.style.display='block';
  }
}

export async function handleGoogleSignIn(){
  const errEl = document.getElementById('login-error');
  errEl.style.display='none';
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    const result = await auth.signInWithPopup(provider);
    // onAuthStateChanged handles the rest
  } catch(e){
    if(e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
    // If popup blocked, fall back to redirect
    if(e.code === 'auth/popup-blocked'){
      try {
        await auth.signInWithRedirect(new firebase.auth.GoogleAuthProvider());
        return;
      } catch(e2){}
    }
    errEl.textContent = e.message || 'Google sign-in failed';
    errEl.style.display='block';
  }
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

export function logout(){
  showTransitionScreen('Logging out...');
  resetAppState();
  document.getElementById('app').style.display='none';
  document.getElementById('app').innerHTML='';
  auth.signOut().then(()=>{
    hideTransitionScreen();
    document.getElementById('login-screen').style.display='flex';
  });
}

export function switchUser(){
  showTransitionScreen('Switching account...');
  resetAppState();
  document.getElementById('app').style.display='none';
  document.getElementById('app').innerHTML='';
  auth.signOut().then(()=>{
    hideTransitionScreen();
    document.getElementById('login-screen').style.display='flex';
  });
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

// ─── User Management (Admin only) ───
export async function loadAllUsers(){
  try {
    const snap = await db.collection('users').orderBy('createdAt','asc').get();
    return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  } catch(e){ console.error('loadAllUsers error:',e); return []; }
}

export async function loadAssignableUsers(){
  if(state.assignableUsers.length > 0) return state.assignableUsers;
  try {
    const snap = await db.collection('users').get();
    state.assignableUsers = snap.docs
      .map(d => ({ uid: d.id, ...d.data() }))
      .filter(u => u.role === 'admin' || u.role === 'employee');
  } catch(e){ console.warn('Failed to load assignable users:', e); }
  return state.assignableUsers;
}

export async function updateUserName(uid, name){
  try { await db.collection('users').doc(uid).update({ name }); }
  catch(e){ alert('Failed to update name: '+e.message); }
}

export async function updateUserEmail(uid, email){
  try { await db.collection('users').doc(uid).update({ email }); }
  catch(e){ alert('Failed to update email: '+e.message); }
}

export async function updateUserRole(uid, newRole){
  try { await db.collection('users').doc(uid).update({ role: newRole }); }
  catch(e){ alert('Failed to update role: '+e.message); }
}

export async function updateUserClient(uid, clientName){
  try { await db.collection('users').doc(uid).update({ clientName }); }
  catch(e){ alert('Failed to update client: '+e.message); }
}

export async function deleteFirebaseUser(uid){
  try { await db.collection('users').doc(uid).delete(); }
  catch(e){ alert('Failed to remove user: '+e.message); }
}

// ─── Campaign Assignments (Firestore) ───
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

export async function loadCampaignAssignments(){
  try {
    const doc = await db.collection('crm_settings').doc('campaign_assignments').get();
    if(doc.exists && doc.data().assignments){
      state.campaignAssignments = doc.data().assignments;
    }
  } catch(e){ console.warn('Failed to load campaign assignments:', e); }
}

export async function saveCampaignAssignment(campaignName, userName){
  state.campaignAssignments[campaignName] = userName;
  render();
  try {
    await db.collection('crm_settings').doc('campaign_assignments').set({ assignments: state.campaignAssignments }, { merge: true });
  } catch(e){ console.warn('Failed to save campaign assignment:', e); }
}

export function getOwnerForDeal(deal){
  if(deal.ownerOverride) return getOwnerColor(deal.ownerOverride);
  if(!deal.campaignName) return null;
  const owner = state.campaignAssignments[deal.campaignName];
  if(!owner) return null;
  return getOwnerColor(owner);
}

export function getOwnerNameForDeal(deal){
  if(deal.ownerOverride) return deal.ownerOverride;
  if(!deal.campaignName) return '';
  return state.campaignAssignments[deal.campaignName] || '';
}

export function listenCampaignAssignments(){
  try {
    db.collection('crm_settings').doc('campaign_assignments').onSnapshot(doc => {
      if(doc.exists && doc.data().assignments){
        state.campaignAssignments = doc.data().assignments;
        render();
      }
    });
  } catch(e){ console.warn('Campaign assignment listener failed:', e); }
}

// ─── Auth State Listener (called from app.js) ───
export function setupAuthListener(onLogin){
  // Handle Google redirect result (if popup was blocked and redirect was used)
  auth.getRedirectResult().catch(e => {
    if(e.code !== 'auth/popup-closed-by-user'){
      const errEl = document.getElementById('login-error');
      if(errEl){ errEl.textContent = e.message || 'Google sign-in failed'; errEl.style.display='block'; }
    }
  });

  auth.onAuthStateChanged(async (user) => {
    const bootLoader = document.getElementById('boot-loader');
    if(bootLoader) bootLoader.remove();

    if(user){
      let userDoc;
      try {
        const snap = await db.collection('users').doc(user.uid).get();
        if(snap.exists){
          userDoc = snap.data();
        } else {
          userDoc = { name: user.displayName || user.email.split('@')[0], email: user.email, role: 'client', clientName: '' };
          await db.collection('users').doc(user.uid).set({ ...userDoc, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        }
      } catch(e){
        console.warn('Firestore read failed, defaulting to client role:', e);
        userDoc = { name: user.displayName || user.email.split('@')[0], email: user.email, role: 'client', clientName: '' };
      }

      currentUser = {
        uid: user.uid,
        name: userDoc.name || user.displayName || user.email.split('@')[0],
        email: user.email,
        role: userDoc.role || 'client',
        clientName: userDoc.clientName || ''
      };

      document.getElementById('login-screen').style.display='none';
      showTransitionScreen('Loading your CRM...');

      if(isClient()){
        state.pipeline = 'client_leads';
        location.hash = 'client_leads';
      } else if(isEmployee()){
        const hash = location.hash.replace('#','');
        state.pipeline = hash && ['acquisition','client_leads'].includes(hash) ? hash : 'client_leads';
      } else if(isAdmin()){
        const hash = location.hash.replace('#','');
        state.pipeline = hash && ['dashboard','acquisition','client_leads','nurture'].includes(hash) ? hash : 'client_leads';
      }

      document.getElementById('app').style.display='block';
      try {
        await onLogin();
      } catch(e){
        console.error('initApp error:', e);
      }
      // Hide transition once synced, or after 8s max
      const _waitForSync = setInterval(()=>{
        if(state.synced){
          clearInterval(_waitForSync);
          hideTransitionScreen();
        }
      }, 100);
      setTimeout(()=>{ clearInterval(_waitForSync); hideTransitionScreen(); }, 8000);
    } else {
      currentUser = null;
      document.getElementById('app').style.display='none';
      document.getElementById('login-screen').style.display='flex';
    }
  });
}

// Expose to inline HTML handlers
window.handleAuth = handleAuth;
window.handlePasswordReset = handlePasswordReset;
window.handleGoogleSignIn = handleGoogleSignIn;
window.toggleAuthMode = toggleAuthMode;
window.logout = logout;
window.switchUser = switchUser;
window.toggleUserMenu = toggleUserMenu;

// User management functions exposed to inline handlers
export async function changeUserRole(uid, role){
  await updateUserRole(uid, role);
}
export async function changeUserClient(uid, clientName){
  await updateUserClient(uid, clientName);
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
    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    await cred.user.updateProfile({ displayName: name });
    await db.collection('users').doc(cred.user.uid).set({
      name,
      email,
      role,
      clientName,
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

export async function assignCampaignOwner(campaignName, userName){
  if(!userName){
    delete state.campaignAssignments[campaignName];
  } else {
    state.campaignAssignments[campaignName] = userName;
  }
  try {
    await db.collection('crm_settings').doc('campaign_assignments').set({ assignments: state.campaignAssignments }, { merge: true });
  } catch(e){ console.warn('Failed to save campaign assignment:', e); }
  render();
}

export async function removeCampaignAssignment(campaignName){
  delete state.campaignAssignments[campaignName];
  try {
    await db.collection('crm_settings').doc('campaign_assignments').set({ assignments: state.campaignAssignments }, { merge: true });
  } catch(e){ console.warn('Failed to save:', e); }
  render();
}

window.changeUserRole = changeUserRole;
window.changeUserClient = changeUserClient;
window.createNewUser = createNewUser;
window.assignCampaignOwner = assignCampaignOwner;
window.removeCampaignAssignment = removeCampaignAssignment;
