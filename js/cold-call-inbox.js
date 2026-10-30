// ═══════════════════════════════════════════════════════════
// COLD-CALL-INBOX — buy the client's contact@<brand>.info inbox
// ═══════════════════════════════════════════════════════════
// Won with "Include cold calling" ticked: email-infra buys one .info domain and
// opens an order for a single contact@ mailbox, then finishes it on its own over
// the next hour or two, built like the hand-made ones (contact@woodyslandcare.info):
// company name + logo on the mailbox, Zapmail → SmartLead with the client's tags,
// warm-up on, no campaign. That inbox becomes clients.cold_call_email — the one
// a cold-call lead's follow-up email goes from (cold-call-email.js).
//
// Sends the caller's CRM session, not a password: this repo is public, and
// email-infra checks the token against our auth server (crm_auth.py).
import { supabase } from './supabase-client.js?v=20261031025129';
import { str } from './utils.js?v=20261031025129';

const FN_URL = 'https://email-infra.vercel.app/api/cold-call-inbox';

// Idempotent server-side per client id, so Retry re-reads the existing order
// instead of buying a second domain.
export async function createColdCallInbox(client) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Your session expired. Reload the page and sign in again.');
  const resp = await fetch(FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
    body: JSON.stringify({ crm_client_id: str(client.id), client_name: str(client.name), website: str(client.website) }),
  });
  const data = await resp.json().catch(() => ({ error: 'cold-call-inbox returned a non-JSON response (' + resp.status + ')' }));
  if (!resp.ok || data.error) throw new Error(data.error || ('cold-call-inbox failed (' + resp.status + ')'));

  // The address is fixed the moment the domain is bought, so record it now —
  // the mailbox itself goes live later.
  const { error } = await supabase.from('clients')
    .update({ cold_calling: true, cold_call_email: data.email }).eq('id', client.id);
  if (error) throw new Error('Inbox ordered (' + data.email + ') but the client row did not save: ' + error.message);
  client.coldCalling = true;
  client.coldCallEmail = data.email;
  return data;
}
