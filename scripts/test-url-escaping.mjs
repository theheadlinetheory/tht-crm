#!/usr/bin/env node
// Lead / applicant / uploaded data in hrefs and attributes (audit A2#15, Tim 2026-11-13).
//  1. safeUrl(): only http(s) gets through; javascript:/data:/vbscript: and control-char tricks return ''.
//  2. escAttr()/jsArg(): a value can't break out of a "…" attribute or an inline-handler argument.
//  3. Source scan: the files S2 fixed carry no href="${esc(…)} without safeUrl, no '${esc(…)}' handler
//     argument, and no Blooio key in config.js.
// Run: node scripts/test-url-escaping.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.document = { createElement: () => { let t = ''; return {
  set textContent(v) { t = String(v); },
  get innerHTML() { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); } }; } };
globalThis.window = globalThis;
const { safeUrl, escAttr, jsArg } = await import('../js/utils.js');

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1; }
};

// ── 1. safeUrl ──
test('http and https pass through unchanged', () => {
  assert.equal(safeUrl('https://www.loom.com/share/abc'), 'https://www.loom.com/share/abc');
  assert.equal(safeUrl('HTTP://Example.com/x?y=1'), 'HTTP://Example.com/x?y=1');
  assert.equal(safeUrl('  https://linkedin.com/in/x  '), 'https://linkedin.com/in/x');
});
test('bare domain gets https://', () => {
  assert.equal(safeUrl('acme.com'), 'https://acme.com');
  assert.equal(safeUrl('www.acme.com/about'), 'https://www.acme.com/about');
  assert.equal(safeUrl('//cdn.acme.com/x'), 'https://cdn.acme.com/x');
});
test('dangerous schemes are refused', () => {
  for (const u of ['javascript:alert(1)', 'JavaScript:fetch("//x")', 'data:text/html,<script>1</script>',
    'vbscript:msgbox(1)', 'file:///etc/passwd', 'blob:https://x/1', '  javascript:alert(1)']) {
    assert.equal(safeUrl(u), '', u);
  }
});
test('control characters inside the scheme are stripped before the check', () => {
  assert.equal(safeUrl('java\tscript:alert(1)'), '');
  assert.equal(safeUrl('java\nscript:alert(1)'), '');
  assert.equal(safeUrl('\u0000javascript:alert(1)'), '');
});
test('empty / null / undefined give empty string', () => {
  assert.equal(safeUrl(''), ''); assert.equal(safeUrl(null), ''); assert.equal(safeUrl(undefined), '');
});

// ── 2. escAttr / jsArg ──
const attrValue = (html, attr) => {
  // A browser-equivalent parse of a single double-quoted attribute: the value ends at the first ".
  const m = new RegExp(attr + '="([^"]*)"').exec(html);
  return m && m[1];
};
// What's left after the parser consumes each "…" value: any attribute an attacker added shows up here.
const outsideValues = (html) => html.replace(/"[^"]*"/g, '""');
test('escAttr: a quote cannot end the attribute', () => {
  const evil = 'hi" onmouseover="alert(1)" x="';
  const html = `<span title="${escAttr(evil)}">x</span>`;
  assert.equal(attrValue(html, 'title').includes('onmouseover'), true, 'payload stays inside title');
  assert.equal(/onmouseover/.test(outsideValues(html)), false, 'no new attribute appears');
});
test("escAttr: apostrophe, <, > and & are encoded", () => {
  assert.equal(escAttr(`a'b<c>&"`), 'a&#39;b&lt;c&gt;&amp;&quot;');
});
test('safeUrl + escAttr: a quote in a URL cannot break out of href', () => {
  const html = `<a href="${escAttr(safeUrl('https://x.com/" onclick="alert(1)'))}">`;
  assert.equal(/onclick/.test(outsideValues(html)), false);
});
test('jsArg: uploaded filename with quotes/apostrophes is one JS string argument', () => {
  const name = `O'Brien "plan".pdf');alert(1);//`;
  const attr = `docDownload(${jsArg('path/1')},${jsArg(name)})`;
  // Decode like a browser does before the JS parses, then run it against a recording stub.
  const decoded = attr.replace(/&(quot|#39|amp|lt|gt);/g, (m, k) => ({ quot: '"', '#39': "'", amp: '&', lt: '<', gt: '>' })[k]);
  const calls = [];
  new Function('docDownload', 'alert', decoded)((...a) => calls.push(a), () => { throw new Error('alert ran'); });
  assert.deepEqual(calls, [['path/1', name]]);
});

// ── 3. Source scan ──
const read = (f) => readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8');
test('no href built from esc() without safeUrl in the S2 files', () => {
  for (const f of ['hiring.js', 'aimfox.js', 'client-panel.js', 'warm-call.js', 'deal-modal.js']) {
    const bad = read(f).split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /href="\$\{esc\(/.test(l));
    assert.deepEqual(bad.map(([n]) => `${f}:${n}`), []);
  }
});
test("documents.js passes no '${esc(…)}' handler arguments", () => {
  assert.equal(/'\$\{esc\(/.test(read('documents.js')), false);
});
test('client-panel.js and documents.js put no esc() inside attributes', () => {
  for (const f of ['client-panel.js', 'documents.js']) assert.equal(/="\$\{esc\(/.test(read(f)), false, f);
});
test('no Blooio key or direct Blooio calls in the frontend', () => {
  assert.equal(/BLOOIO_API_KEY\s*=|api_[A-Za-z0-9]{16,}/.test(read('config.js')), false, 'config.js');
  assert.equal(/backend\.blooio\.com|BLOOIO_API_KEY/.test(read('blooio.js')), false, 'blooio.js');
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
