#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Cache-token bumper — rewrites every version token to a new value.
//
//   node scripts/bump-tokens.mjs [token]
//
// Called by deploy.sh. With no argument it derives the token from the clock,
// exactly as deploy.sh used to (`date +%Y%m%d%H%M%S`).
//
// WHY THIS IS NOT A ONE-LINE sed ANY MORE
// deploy.sh used to do:
//     LC_ALL=C sed -i '' "s/$CUR/$NEXT/g" js/*.js index.html version.json
// which broke in two separate ways:
//
//   1. `sed -i ''` is BSD/macOS syntax. GNU sed (Git Bash on Windows, Linux CI)
//      reads the '' as the script and then treats s/…/…/g as a filename, so the
//      whole deploy aborts under `set -e` before writing anything. Nobody not on
//      a Mac could deploy.
//   2. It substituted ONE literal old value — whatever `?v=` happened to come
//      first in index.html. Any token that had already drifted away from that
//      value was skipped. On 2026-08-26 a lazy `await import('./render.js?v=…')`
//      in js/dialer.js sat a day behind the rest of the tree; ci-check compares
//      only the 8-digit date prefix so it read as "in sync" until the date
//      rolled over, and then the guardrail failed the deploy.
//
// So: rewrite every token found, regardless of its old value, and run on node —
// which deploy.sh already requires for ci-check.mjs.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Same timestamp shape deploy.sh used: always unique, always increasing.
const pad = n => String(n).padStart(2, '0');
const stamp = (d => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
                    pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()))(new Date());

const NEXT = process.argv[2] || stamp;
if (!/^[0-9A-Za-z]+$/.test(NEXT)) {
  console.error(`✗ "${NEXT}" is not a valid token (letters and digits only).`);
  process.exit(1);
}

const seen = new Map(); // old token -> occurrences
let touched = 0, total = 0;

const note = old => {
  seen.set(old, (seen.get(old) || 0) + 1);
  if (old !== NEXT) total++;
};

// The three shapes a token appears in. Every one is matched by pattern, never by
// its current value, so drift gets healed instead of skipped.
//
// Each replacer spells its capture groups out rather than sharing one generic
// callback: String.replace passes (match, ...groups, offset, string), so a
// callback written for two groups silently receives the OFFSET as its second
// group when the pattern only has one — which appends the byte offset to every
// token it rewrites. (Yes, that happened while writing this.)
const PATTERNS = [
  // module imports + <script src>
  [/(\?v=)[0-9A-Za-z]+/g, (m, pre) => { note(m.slice(pre.length)); return pre + NEXT; }],
  // index.html auto-reload constant
  [/(__APP_V\s*=\s*['"])[0-9A-Za-z]+(['"])/g,
    (m, pre, post) => { note(m.slice(pre.length, m.length - post.length)); return pre + NEXT + post; }],
  // version.json
  [/("v"\s*:\s*")[0-9A-Za-z]+(")/g,
    (m, pre, post) => { note(m.slice(pre.length, m.length - post.length)); return pre + NEXT + post; }],
];

const files = ['index.html', 'version.json',
  ...readdirSync(join(ROOT, 'js')).filter(f => f.endsWith('.js')).sort().map(f => join('js', f))];

for (const rel of files) {
  let src;
  try { src = readFileSync(join(ROOT, rel), 'utf8'); } catch { continue; }
  let out = src;
  for (const [re, fn] of PATTERNS) out = out.replace(re, fn);
  if (out !== src) { writeFileSync(join(ROOT, rel), out, 'utf8'); touched++; }
}

// Every token we wrote must be exactly NEXT — belt-and-braces against another
// replace-callback slip quietly corrupting all 51 files.
for (const rel of files) {
  let src;
  try { src = readFileSync(join(ROOT, rel), 'utf8'); } catch { continue; }
  for (const [, tok] of src.matchAll(/\?v=([0-9A-Za-z]+)/g)) {
    if (tok !== NEXT) {
      console.error(`✗ ${rel} still carries ?v=${tok} after the bump — aborting before ci-check.`);
      process.exit(1);
    }
  }
}

if (seen.size === 0) {
  console.error('✗ Found no version tokens at all — refusing to continue.');
  process.exit(1);
}

const olds = [...seen.keys()].filter(t => t !== NEXT);
console.log(`→ Bumping version token: ${olds.join(', ') || '(already current)'} → ${NEXT}`);
console.log(`   rewrote ${total} occurrence(s) across ${touched} file(s)`);

// More than one pre-existing value means the tree had drifted. It is now healed,
// but say so — a token that drifts repeatedly is a symptom worth chasing.
if (olds.length > 1) {
  console.log(`   ⚠ tokens had DRIFTED across ${olds.length} values; all are now ${NEXT}:`);
  for (const t of olds) console.log(`       ${t}  (${seen.get(t)} occurrence(s))`);
}
