// ═══════════════════════════════════════════════════════════
// EDGE-AUTH — call an Edge Function AS THE SIGNED-IN USER
// ═══════════════════════════════════════════════════════════
//
// invokeEdgeFunction() in api.js sends the anon key, which is published in this
// public repo — so a function authenticated that way cannot tell who is calling
// and must treat every caller as anonymous. Any function that acts on a
// person's behalf (their Google Tasks list, their mailbox) has to see their own
// session instead.
//
// google-task.js and smartlead-portal.js each grew their own copy of this;
// gmail-threads.js would have been the third.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=20260908134337';
import { supabase } from './supabase-client.js?v=20260908134337';

export async function invokeEdgeFunctionAsUser(fnName, body, { signal } = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Your session expired — reload and sign in again');

  const opts = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body ?? {}),
  };
  if (signal) opts.signal = signal;

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, opts);
  const data = await resp.json().catch(() => ({ error: `${fnName} returned ${resp.status}` }));
  if (!resp.ok || data.error) {
    const err = new Error(data.error || `${fnName} failed (${resp.status})`);
    err.code = data.code;
    err.status = resp.status;
    throw err;
  }
  return data;
}
