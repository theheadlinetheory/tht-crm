// node scripts/test-edge-auth.mjs — every CRM function call sends the signed-in user's token,
// never the public anon key, and makes no call when signed out (A2#2, Tim, 2026-11-13).
// The real js/edge-auth.js is loaded; only the esm.sh supabase-js import is swapped for a stub.
import assert from 'node:assert/strict';
import { register } from 'node:module';

const stub = `export function createClient() { return globalThis.__sbStub; }`;
const hooks = `
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('https://esm.sh/@supabase/supabase-js')) return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(stub)}), shortCircuit: true };
  return next(spec, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(hooks));

let session = null;
globalThis.__sbStub = { auth: { getSession: async () => ({ data: { session } }) } };
const calls = [];
let reply = () => new Response(JSON.stringify({ ok: true, n: 1 }), { status: 200 });
globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return reply(); };

const { SUPABASE_ANON_KEY, SUPABASE_URL } = await import('../js/config.js');
const { callEdgeFunction, invokeEdgeFunctionAsUser, authedFetch } = await import('../js/edge-auth.js');

// api.js pulls the whole app in, so its five-line wrapper is checked against the same rule
// as the source text, and its behaviour through the shared core it delegates to.
const { readFileSync } = await import('node:fs');
const apiSrc = readFileSync(new URL('../js/api.js', import.meta.url), 'utf8');
const wrapper = apiSrc.slice(apiSrc.indexOf('export async function invokeEdgeFunction('), apiSrc.indexOf('// The Sync button.'));
const invokeEdgeFunction = async (fnName, body, signal) => {
  const { resp, data } = await callEdgeFunction(fnName, body, { signal });
  if (!resp.ok && !data.ok) throw new Error(data.error || `Edge Function ${fnName} failed (${resp.status})`);
  return data;
};

let passed = 0;
async function test(name, fn) {
  calls.length = 0;
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('FAIL  ' + name + '\n      ' + (e && e.stack || e)); process.exitCode = 1; }
}

await test('api.js invokeEdgeFunction delegates to the session-token core and no longer names the anon key', () => {
  assert.match(wrapper, /callEdgeFunction\(fnName, body, \{ signal \}\)/);
  assert.doesNotMatch(wrapper, /SUPABASE_ANON_KEY/);
  assert.match(apiSrc, /import \{ callEdgeFunction \} from '\.\/edge-auth\.js\?v=/);
});

await test('signed in: sends the session access token, not the anon key', async () => {
  session = { access_token: 'user-token-123' };
  const out = await invokeEdgeFunction('send-email', { action: 'x' });
  assert.deepEqual(out, { ok: true, n: 1 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${SUPABASE_URL}/functions/v1/send-email`);
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer user-token-123');
  assert.notEqual(calls[0].opts.headers.Authorization, `Bearer ${SUPABASE_ANON_KEY}`);
  assert.equal(calls[0].opts.headers.apikey, undefined, 'same header set as before: no CORS preflight change');
  assert.equal(calls[0].opts.body, JSON.stringify({ action: 'x' }));
});

await test('signed out: throws "Signed out — sign in again" and makes no request', async () => {
  session = null;
  await assert.rejects(invokeEdgeFunction('send-email', {}), /Signed out — sign in again/);
  await assert.rejects(invokeEdgeFunctionAsUser('deal-invoice', {}), (e) => e.status === 401 && e.code === 'signed_out');
  assert.equal(calls.length, 0);
});

await test('signal is passed through', async () => {
  session = { access_token: 't' };
  const ctl = new AbortController();
  await invokeEdgeFunction('enrich-lead', {}, ctl.signal);
  assert.equal(calls[0].opts.signal, ctl.signal);
});

await test('keeps the old lenient shape: 200 with {error} returns, non-2xx without ok throws', async () => {
  session = { access_token: 't' };
  reply = () => new Response(JSON.stringify({ ok: false, error: 'soft' }), { status: 200 });
  assert.deepEqual(await invokeEdgeFunction('x', {}), { ok: false, error: 'soft' });
  reply = () => new Response(JSON.stringify({ ok: false, error: 'Admins only', code: 'forbidden' }), { status: 403 });
  await assert.rejects(invokeEdgeFunction('finalize-stripe-invoice', {}), /Admins only/);
  reply = () => new Response('<html>bad gateway</html>', { status: 502 });
  await assert.rejects(invokeEdgeFunction('x', {}), /x returned 502 \(not JSON/);
});

await test('invokeEdgeFunctionAsUser: user token + apikey, throws on {error}', async () => {
  session = { access_token: 'u' };
  reply = () => new Response(JSON.stringify({ error: 'nope', code: 'c' }), { status: 200 });
  await assert.rejects(invokeEdgeFunctionAsUser('gmail-threads', {}), (e) => e.message === 'nope' && e.code === 'c');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer u');
  assert.equal(calls[0].opts.headers.apikey, SUPABASE_ANON_KEY);
  reply = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
});

await test('authedFetch swaps the anon bearer for the session token and keeps other headers', async () => {
  session = { access_token: 'sess' };
  await authedFetch(`${SUPABASE_URL}/functions/v1/pipeline-daily`, { method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY }, body: '{}' });
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer sess');
  assert.equal(calls[0].opts.headers.apikey, SUPABASE_ANON_KEY);
  assert.equal(calls[0].opts.method, 'POST');
  session = null;
  await assert.rejects(authedFetch('x', {}), /Signed out/);
  assert.equal(calls.length, 1);
});

console.log(`\n${passed} passed`);
