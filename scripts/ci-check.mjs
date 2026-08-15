#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Deploy guardrail — runs in CI before GitHub Pages publishes `main`.
//
// It exists because a commit ("Remove reply notification emails", 14c25a7)
// once silently deleted the entire Weekly Updates tab out of render.js as
// collateral, and — with no checks and instant auto-deploy — it went straight
// to the live client-facing CRM and stayed broken for a week.
//
// Three cheap, high-signal checks. Any failure exits non-zero and blocks deploy:
//   1. SYNTAX      — every js/*.js parses as an ES module.
//   2. INVENTORY   — a curated list of critical UI features still exists.
//                    Deleting a feature now REQUIRES editing this list too,
//                    which makes the removal a visible, intentional diff.
//   3. CACHE-TOKENS — every module ?v= cache token is identical, so a stale
//                     token can't spawn a duplicate module instance.
//
// To intentionally remove a feature: delete its line from REQUIRED_FEATURES.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsDir = join(ROOT, 'js');
const jsFiles = readdirSync(jsDir).filter(f => f.endsWith('.js')).sort();

let failures = 0;
const fail = (check, msg) => { failures++; console.error(`  ✗ [${check}] ${msg}`); };

// ── 1. SYNTAX ────────────────────────────────────────────────────────────────
// node --check parses ES-module syntax when fed via stdin with --input-type.
console.log('1. Syntax (ES module parse) …');
for (const f of jsFiles) {
  try {
    execSync('node --check --input-type=module', { input: readFileSync(join(jsDir, f)) });
  } catch (e) {
    fail('syntax', `js/${f} failed to parse:\n${(e.stderr || e.message).toString().trim()}`);
  }
}
console.log(`   checked ${jsFiles.length} files`);

// ── 2. FEATURE INVENTORY ─────────────────────────────────────────────────────
// Each entry: a substring that MUST still exist in the given file. These are
// stable structural anchors for whole features/tabs — not cosmetic strings.
const REQUIRED_FEATURES = [
  // Client Leads sub-tabs + the Weekly Updates feature (the one that got deleted)
  // The sub-tab buttons route through switchClientLeadsTab(), which also writes
  // the URL hash so the tab survives a reload — don't go back to setting
  // state.clientLeadsSubTab inline.
  { file: 'render.js',         needle: "switchClientLeadsTab('pipeline')",       feature: 'Client Leads: Pipeline tab' },
  { file: 'render.js',         needle: "switchClientLeadsTab('lead_tracker')",   feature: 'Client Leads: Lead Tracker tab' },
  { file: 'render.js',         needle: "switchClientLeadsTab('weekly_updates')", feature: 'Client Leads: Weekly Updates tab button' },
  { file: 'render.js',         needle: "location.hash = tab === 'pipeline' ? 'client_leads'", feature: 'Client Leads: sub-tab mirrored into the URL' },
  { file: 'state.js',          needle: "parts[0] === 'client_leads' && parts[1]", feature: 'Client Leads: sub-tab restored from the URL on load' },
  { file: 'render.js',         needle: "clSubTab === 'weekly_updates'",      feature: 'Client Leads: Weekly Updates render dispatch' },
  { file: 'weekly-updates.js', needle: 'export function renderWeeklyUpdates', feature: 'Weekly Updates: module entrypoint' },
  { file: 'weekly-updates.js', needle: 'window.weeklyPrepare',               feature: 'Weekly Updates: Prepare handler wired to window' },
  // Adding an extra CC recipient must stay self-serve — it used to need a dev.
  { file: 'weekly-updates.js', needle: 'window.weeklyClientCcChange',        feature: 'Weekly Updates: add-a-CC on the idle client checklist' },
  { file: 'weekly-updates.js', needle: 'window.weeklyToggleCtx',            feature: 'Weekly Updates: per-client context dropdown' },
  { file: 'settings.js',       needle: "'otherContacts',this.value",         feature: 'Settings → Clients: Additional Contacts (weekly-update CC) field' },
  // Top-level tabs
  { file: 'render.js',         needle: "state.pipeline==='dashboard'",  feature: 'Dashboard tab' },
  { file: 'render.js',         needle: "state.pipeline==='acquisition'", feature: 'Acquisition tab' },
  { file: 'render.js',         needle: "state.pipeline==='client_leads'", feature: 'Client Leads tab' },
  // Acquisition sub-tabs
  { file: 'render.js',         needle: "switchAcqSubTab('cold_calls')",  feature: 'Acquisition: Cold Calls sub-tab' },
  { file: 'render.js',         needle: "switchAcqSubTab('retargeting')", feature: 'Acquisition: Retargeting sub-tab' },
  { file: 'render.js',         needle: "switchAcqSubTab('demo_tracker')", feature: 'Acquisition: Demo Tracker sub-tab' },
  // Lead Tracker views
  { file: 'render.js',         needle: "switchTrackerView('trends')",   feature: 'Lead Tracker: Trends view' },
  { file: 'render.js',         needle: "switchTrackerView('passoffs')", feature: 'Lead Tracker: Retainer Leads (pass-offs) view' },
  // Weekly KPI targets (>=1 booked meeting / >=2 interested responses per week)
  { file: 'dashboard.js',      needle: 'export function renderKpiTargetBar', feature: 'Weekly KPI targets: banner' },
  { file: 'dashboard.js',      needle: '${renderKpiTargetBar(selWeek)}',     feature: 'Weekly KPI targets: shown on the dashboard' },
  { file: 'render.js',         needle: 'renderKpiTargetBar(null, { compact:true })', feature: 'Weekly KPI targets: strip above the Lead Tracker sheets' },
  // Retainer Leads rendered a blank Date column and an always-empty date filter
  // for as long as this mapping was missing — normalizeRow left the column as
  // date_passed, so entry.datePassed was undefined everywhere.
  { file: 'api.js',            needle: "date_passed: 'datePassed'", feature: 'Retainer Leads: date_passed → datePassed field mapping' },
  // Analysis tab (why a client missed their weekly KPI)
  { file: 'render.js',         needle: "switchClientLeadsTab('analysis')", feature: 'Client Leads: Analysis tab button' },
  { file: 'render.js',         needle: "clSubTab === 'analysis'",          feature: 'Client Leads: Analysis render dispatch' },
  // A throw in renderAnalysis must stay inside the tab: render() is one big
  // try/catch, so an unguarded throw aborts before app.innerHTML is assigned
  // and silently leaves the previous screen up.
  { file: 'render.js',         needle: "Analysis render failed",           feature: 'Analysis: render failure contained inside the tab' },
  { file: 'analysis.js',       needle: 'function normalizeRow',            feature: 'Analysis: cached rows coerced to the current shape' },
  { file: 'analysis.js',       needle: 'export function renderAnalysis', feature: 'Analysis: module entrypoint' },
  { file: 'analysis.js',       needle: "action: 'client_week_breakdown'", feature: 'Analysis: weekly Smartlead breakdown pull' },
];
console.log('2. Feature inventory …');
const fileCache = {};
const readJs = f => (fileCache[f] ??= readFileSync(join(jsDir, f), 'utf8'));
for (const { file, needle, feature } of REQUIRED_FEATURES) {
  let src;
  try { src = readJs(file); } catch { fail('inventory', `expected file js/${file} is missing (feature: ${feature})`); continue; }
  if (!src.includes(needle)) {
    fail('inventory', `MISSING FEATURE "${feature}" — expected \`${needle}\` in js/${file}. ` +
      `If this removal is intentional, delete this entry from REQUIRED_FEATURES in scripts/ci-check.mjs.`);
  }
}
console.log(`   checked ${REQUIRED_FEATURES.length} feature anchors`);

// ── 3. CACHE-TOKEN CONSISTENCY ───────────────────────────────────────────────
// All module imports must share one ?v= token. A drifting token makes the
// browser fetch a second copy of a module under a different cache key — a
// duplicate instance with its own module-level state (subtle, nasty bugs).
// Standalone data scripts (service_area_data*) are excluded — not ES modules.
console.log('3. Cache-token consistency …');
const TOKEN_RE = /([\w./-]+)\?v=(\d{8}[a-z]?)/g;
const tokens = new Map(); // token -> [ "file: importedThing", ... ]
const scan = ['index.html', ...jsFiles.map(f => join('js', f))];
for (const rel of scan) {
  let src;
  try { src = readFileSync(join(ROOT, rel), 'utf8'); } catch { continue; }
  for (const m of src.matchAll(TOKEN_RE)) {
    const [, target, token] = m;
    if (target.includes('service_area_data')) continue; // standalone, own cadence
    if (!tokens.has(token)) tokens.set(token, []);
    tokens.get(token).push(`${rel} → ${target}`);
  }
}
if (tokens.size > 1) {
  const sorted = [...tokens.entries()].sort((a, b) => b[1].length - a[1].length);
  const [majority] = sorted[0];
  fail('cache-tokens', `module cache tokens are not in sync — expected all to be "${majority}". Offenders:`);
  for (const [tok, uses] of sorted.slice(1)) {
    for (const u of uses) console.error(`      ${tok}   ${u}`);
  }
} else {
  console.log(`   all module imports on token ${[...tokens.keys()][0] || '(none found)'}`);
}

// ── result ───────────────────────────────────────────────────────────────────
if (failures) {
  console.error(`\n✗ Deploy guardrail FAILED with ${failures} problem(s). Not deploying.`);
  process.exit(1);
}
console.log('\n✓ Deploy guardrail passed.');
