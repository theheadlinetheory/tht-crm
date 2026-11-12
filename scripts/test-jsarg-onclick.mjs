#!/usr/bin/env node
// Every inline handler in the F3 files that passes free text through jsArg()
// must still parse and hand the exact string to its function when that text
// contains an apostrophe, a double quote or a newline. `'${esc(x)}'` broke on
// O'Brien / Woody's because the browser decodes &#39; back to ' before the JS
// parses (Tim, 2026-11-12). This renders the REAL attribute templates from the
// source files, decodes them like a browser does, then compiles (new Function)
// and runs each one against recording stubs.
// Run: node scripts/test-jsarg-onclick.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// esc() uses the DOM: textContent → innerHTML escapes & < > (like Chrome).
globalThis.document = { createElement: () => { let t = ''; return {
  set textContent(v) { t = String(v); },
  get innerHTML() { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); } }; } };
globalThis.window = globalThis;
const { esc, jsArg, str } = await import('../js/utils.js');

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1; }
};

const decodeAttr = (s) => s.replace(/&(quot|#39|#x27|amp|lt|gt);/g, (m, k) =>
  ({ quot: '"', '#39': "'", '#x27': "'", amp: '&', lt: '<', gt: '>' })[k]);

// Template-time scope: any variable / property read yields the payload.
function payloadScope(payload) {
  const deep = new Proxy(function () {}, {
    // ids are numbers/uuids in real data — never free text — so give them an id.
    get: (t, k) => (k === Symbol.toPrimitive || k === 'toString' || k === 'valueOf') ? () => payload : (/^(id|uid)$/.test(k) ? '4252315' : payload),
  });
  const known = { esc, jsArg, str };
  return new Proxy({}, {
    has: (t, k) => typeof k === 'string' && !(k in globalThis) || k in known,
    get: (t, k) => (k === Symbol.unscopables ? undefined : k in known ? known[k] : k === 'dealId' ? '4252315' : deep),
  });
}
// Run-time scope: every identifier is a recorder that logs calls and runs callbacks.
function recorderScope(calls) {
  const rec = new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : rec),
    set: () => true,
    apply: (t, self, args) => { calls.push(args); for (const a of args) if (typeof a === 'function') a.call(el); return rec; },
  });
  const el = { textContent: '', disabled: false, style: {} };
  const scope = new Proxy({}, { has: (t, k) => k !== 'JSON', get: (t, k) => (k === Symbol.unscopables ? undefined : rec) });
  return { scope, el };
}

const FILES = ['deal-modal', 'settings', 'warm-call', 'won-modal', 'lead-tracker', 'activities', 'cold-calling-tab', 'power-dialer'];
const sites = [];
for (const f of FILES) {
  const src = readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8');
  for (const m of src.matchAll(/\bon(click|change|input|keydown)="([^"]*jsArg\([^"]*)"/g)) {
    const line = src.slice(0, m.index).split('\n').length;
    sites.push({ where: `${f}.js:${line}`, tpl: m[2] });
  }
}

// The brief's named sites must all be on jsArg now.
test('every named site uses jsArg (no quoted esc() for free text)', () => {
  const want = ['writeText(${jsArg(cPhone)})', 'writeText(${jsArg(cEmail)})', 'copyToClipboard(${jsArg(info.primaryEmail)}',
    'copyToClipboard(${jsArg(info.forwardEmail)}', 'copyToClipboard(${jsArg(deal.email)}', 'copyToClipboard(${jsArg(e)}',
    'wonModalLink(${jsArg(dup.name)})', 'trackerSendInvoiceEmail(${jsArg(entry.stripeInvoiceId)},${jsArg(entry.clientName)})',
    'handleDeleteUser(${jsArg(u.uid)},${jsArg(u.name||u.email||\'\')})', 'removeInvite(${jsArg(i.email)})',
    'assignCampaignOwner(${jsArg(camp.name)}', 'removeCampaignAssignment(${jsArg(name)})', 'openEnlargedMap(${jsArg(deal.id)},${jsArg(_mc ? _mc.name : \'\')})'];
  const all = sites.map(s => s.tpl).join('\n');
  for (const w of want) assert.ok(all.includes(w), `missing: ${w}`);
});

const PAYLOADS = ["O'Brien", "Woody's Landcare LLC", 'say "hi"', 'line1\nline2', "o'brien@x.com", "mix ' \" \\ </b> &amp;"];

for (const s of sites) {
  test(`${s.where} parses and passes the exact text`, () => {
    for (const p of PAYLOADS) {
      const rendered = new Function('scope', 'with(scope){ return `' + s.tpl + '`; }')(payloadScope(p));
      assert.ok(!rendered.includes('"'), `raw " would end the attribute early (${JSON.stringify(p)})`);
      const js = decodeAttr(rendered);
      let fn;
      try { fn = new Function('scope', 'with(scope){' + js + '}'); }
      catch (e) { throw new Error(`syntax error for ${JSON.stringify(p)}: ${e.message}\n        ${js}`); }
      const calls = []; const { scope, el } = recorderScope(calls);
      fn.call(el, scope);
      assert.ok(calls.some(args => args.includes(p)), `no call received ${JSON.stringify(p)}: ${js}`);
    }
  });
}

test('control: the old `\'${esc(x)}\'` pattern really breaks on an apostrophe', () => {
  const rendered = `wonModalLink('${esc("Woody's")}')`.replace(/'/g, "'");
  assert.throws(() => new Function(decodeAttr(rendered)), SyntaxError);
});

assert.ok(sites.length >= 13, `expected ≥13 jsArg sites, found ${sites.length}`);
console.log(`\n${passed} passed across ${sites.length} handler sites${process.exitCode ? ', some FAILED' : ''}`);
