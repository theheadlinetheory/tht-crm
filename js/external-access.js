// ═══════════════════════════════════════════════════════════
// APPROVED GMAIL ACCOUNTS — personal Gmail logins for SDRs (2026-11-24)
// ═══════════════════════════════════════════════════════════
//
// SDRs sign in with a personal Gmail instead of a paid Workspace seat. The database only lets a
// non-company account in when its exact address is on public.crm_external_access (admins only):
// it must sign in with Google, it is always an SDR, and revoking it bans the account and ends its
// sessions on the spot. This file is just the admin UI for that list — the rules live in the DB
// (tht-crm-backend migrations-applied-by-hand/20261124120000_approved_gmail_sdr_access.sql).
import { supabase } from './api.js?v=20261124160123';
import { esc, jsArg } from './utils.js?v=20261124160123';

const COMPANY = /@theheadlinetheory\.com$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function renderExternalAccessSettings(){
  return `<div class="settings-section">
    <h4>Approved Gmail accounts (SDRs)</h4>
    <p style="font-size:11px;color:var(--text-muted);margin-bottom:10px">An SDR without a company account signs in with the personal Gmail we made for them. Only an address on this list can get in. It must sign in with Google, it is always an SDR (Cold Calling tab only), and <b>Revoke</b> locks it out immediately. Use the same Gmail for their JustCall seat.</p>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <input id="ext-email" type="email" placeholder="firstname.lastname.tht@gmail.com" style="flex:1;min-width:220px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
      <input id="ext-note" type="text" placeholder="Who is it? (e.g. Marcell)" style="width:180px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
      <button class="btn btn-primary" onclick="approveExternalAccount()" style="font-size:12px">Approve</button>
    </div>
    <div id="ext-access-list" style="margin-top:10px"></div>
  </div>`;
}

export async function loadExternalAccess(){
  const el = document.getElementById('ext-access-list');
  if(!el) return;
  const { data, error } = await supabase.from('crm_external_access')
    .select('email,note,approved_at,revoked_at').order('approved_at', { ascending: false });
  if(error){ el.innerHTML = `<div style="font-size:11px;color:#dc2626">Couldn't load the list: ${esc(error.message)}</div>`; return; }
  el.innerHTML = (data || []).map(rowHtml).join('') || '<div style="font-size:11px;color:var(--text-muted)">No Gmail accounts approved yet.</div>';
}

function rowHtml(r){
  const revoked = !!r.revoked_at;
  const when = new Date(revoked ? r.revoked_at : r.approved_at).toLocaleDateString();
  const action = revoked
    ? `<button onclick="restoreExternalAccount(${jsArg(r.email)})" style="background:none;border:none;color:#2563eb;cursor:pointer;font-size:11px">Restore</button>`
    : `<button onclick="revokeExternalAccount(${jsArg(r.email)})" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:11px">Revoke</button>`;
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;border:1px solid var(--border);border-radius:6px;margin-bottom:4px;font-size:12px;${revoked ? 'opacity:.55' : ''}">
    <span>${esc(r.email)}${r.note ? ` · ${esc(r.note)}` : ''} · <b>${revoked ? 'Revoked' : 'Approved'}</b> <span style="color:var(--text-muted)">${esc(when)}</span></span>${action}</div>`;
}

async function approveExternalAccount(){
  const email = (document.getElementById('ext-email')?.value || '').trim().toLowerCase();
  const note = (document.getElementById('ext-note')?.value || '').trim() || null;
  if(!EMAIL.test(email)){ alert('Enter the full Gmail address.'); return; }
  if(COMPANY.test(email)){ alert('Company accounts don’t go here. Use "Invite someone" above.'); return; }
  const { error } = await supabase.from('crm_external_access')
    .upsert({ email, note, revoked_at: null }, { onConflict: 'email' });
  if(error){ alert('Approve failed: ' + error.message); return; }
  ['ext-email','ext-note'].forEach(id => { const i = document.getElementById(id); if(i) i.value = ''; });
  loadExternalAccess();
}

async function setRevoked(email, revoked){
  const { error } = await supabase.from('crm_external_access')
    .update({ revoked_at: revoked ? new Date().toISOString() : null }).eq('email', email);
  if(error) alert((revoked ? 'Revoke' : 'Restore') + ' failed: ' + error.message);
  loadExternalAccess();
}

async function revokeExternalAccount(email){
  if(!confirm(`Revoke ${email}? They are signed out and locked out of the CRM right away.`)) return;
  await setRevoked(email, true);
}

window.approveExternalAccount = approveExternalAccount;
window.revokeExternalAccount = revokeExternalAccount;
window.restoreExternalAccount = (email) => setRevoked(email, false);
