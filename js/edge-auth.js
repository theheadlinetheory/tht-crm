// ═══════════════════════════════════════════════════════════
// EDGE-AUTH — call an Edge Function AS THE SIGNED-IN USER
// ═══════════════════════════════════════════════════════════
//
// Every CRM function call carries the signed-in user's own access token. The anon
// key is published in this public repo and is itself a valid JWT, so a call made
// with it told the function nothing about who was calling — anyone could send a
// THT invoice email or offboard a client (A2#2, Tim, 2026-11-13). The functions
// now check for a staff session (_shared/require-staff.ts), and signed out = no call.
//
// invokeEdgeFunction() in api.js and invokeEdgeFunctionAsUser() here share
// callEdgeFunction(); they differ only in what counts as a failure.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=20261113032638';
import { supabase } from './supabase-client.js?v=20261113032638';

/** The signed-in user's access token, or a thrown "Signed out — sign in again". */
export async function sessionAccessToken() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) {
    const err = new Error('Signed out — sign in again');
    err.code = 'signed_out';
    err.status = 401;
    throw err;
  }
  return token;
}

/**
 * POST to a CRM edge function as the signed-in user. Returns { resp, data }.
 * `apikey` adds the apikey header (only for functions whose CORS allows it).
 */
export async function callEdgeFunction(fnName, body, { signal, apikey = false } = {}) {
  const token = await sessionAccessToken();
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  if (apikey) headers.apikey = SUPABASE_ANON_KEY;
  const opts = { method: 'POST', headers, body: JSON.stringify(body ?? {}) };
  if (signal) opts.signal = signal;
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, opts);
  // A gateway/upstream outage answers with an HTML page — report the status, not a JSON parse error.
  const data = await resp.json().catch(() => ({ error: `${fnName} returned ${resp.status} (not JSON — service may be down)` }));
  return { resp, data };
}

export async function invokeEdgeFunctionAsUser(fnName, body, { signal } = {}) {
  const { resp, data } = await callEdgeFunction(fnName, body, { signal, apikey: true });
  if (!resp.ok || data.error) {
    const err = new Error(data.error || `${fnName} failed (${resp.status})`);
    err.code = data.code;
    err.status = resp.status;
    throw err;
  }
  return data;
}

/**
 * fetch() for the few modules that call a CRM function by URL: same call, but the
 * Authorization header becomes the signed-in user's token. Rejects when signed out.
 */
export async function authedFetch(url, opts = {}) {
  const token = await sessionAccessToken();
  return fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
}
