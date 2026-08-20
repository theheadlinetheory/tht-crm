// ═══════════════════════════════════════════════════════════
// SMARTLEAD-PORTAL — the client's own Smartlead login
// ═══════════════════════════════════════════════════════════
// Creating the portal has to happen server-side (the Smartlead API key must not
// reach the browser), so this calls an edge function on the fulfillment-
// dashboard project, where that key already lives.
//
// It sends the caller's Supabase session token so the function can prove the
// request came from a signed-in @theheadlinetheory.com user. Same reasoning as
// weekly-updates.js and followup-reminders.js: this repo is public, so the
// function's URL is published, and without the header anyone could POST it.
import { supabase } from './supabase-client.js?v=20260821052046';
import { str } from './utils.js?v=20260821052046';

// Lives on the fulfillment-dashboard Supabase project (verify_jwt=false)
const FN_URL = 'https://zrmobsgcfcloufajemxj.supabase.co/functions/v1/crm-smartlead-client';

// The portal login. notifyEmail can hold several comma-separated addresses and
// a portal takes exactly one, so the first wins. With no contact email at all,
// fall back to the THT-owned placeholder the June 2026 batch used — better a
// portal we hold the login for than no portal.
export function portalEmail(client){
  const first = str(client.notifyEmail || client.notifyEmails).split(',')[0].trim();
  if(first) return first.toLowerCase();
  const slug = str(client.name).toLowerCase().replace(/[^a-z0-9]/g,'');
  return slug ? `tht.${slug}.client@gmail.com` : '';
}

// Creates the portal and records it on the client row.
//
// Idempotent: the edge function re-attaches a portal that already exists for
// this email instead of failing, so the Won modal's Retry button and the
// Settings button can both be pressed twice without making a second portal.
// That matters — Smartlead has no delete endpoint, so a duplicate is permanent.
//
// Returns { clientId, email, password, existed }. `password` is null when the
// portal already existed: Smartlead only ever discloses it at creation.
export async function createSmartleadPortal(client){
  const email = portalEmail(client);
  if(!email) throw new Error('This client has no email and no usable name — add a contact email first.');
  const { data: { session } } = await supabase.auth.getSession();
  if(!session) throw new Error('Your session expired. Reload the page and sign in again.');
  const resp = await fetch(FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
    body: JSON.stringify({ crmClientId: client.id, name: str(client.name), email }),
  });
  const data = await resp.json().catch(() => ({ error: 'crm-smartlead-client returned a non-JSON response (' + resp.status + ')' }));
  if(!resp.ok || data.error) throw new Error(data.error || ('crm-smartlead-client failed (' + resp.status + ')'));

  // Mirror onto the in-memory row so Settings shows it without a reload — the
  // edge function has already written both columns to the database.
  client.smartleadClientId = str(data.clientId);
  if(data.password) client.smartleadPortalPassword = data.password;
  return data;
}
