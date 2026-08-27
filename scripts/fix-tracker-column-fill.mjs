#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// fix-tracker-column-fill — repair the "whole column went purple" bug in
// client Lead Tracker sheets.
//
// THE BUG
// Trackers created after ~2026-07-17 always get 17 columns; the last three
// (Recent Reply Preview / SmartLead Inbox Link / Reply Date) carry a purple
// #7B39EC header. `push-to-client-sheet` only writes columns A–N, so each
// appended row inherits its formatting from the row above — which chains all
// the way back to the purple header. The purple therefore walks down the sheet
// one lead at a time, and the cells stay blank because nothing ever fills them.
//
// WHY REPAIRING THE EXISTING ROWS ALSO STOPS IT RECURRING
// Inheritance is from the row directly above. Once the last data row's O:Q are
// white, the next appended row inherits white. This script also paints the
// first not-yet-written row so that sheets with zero leads (which would
// otherwise inherit straight from the purple header on their very first push)
// are covered too.
//
// This is a stopgap. The real fix belongs in `push-to-client-sheet` — see
// PROPER-FIX.md next to this file.
//
// USAGE
//   node scripts/fix-tracker-column-fill.mjs                # dry run, all clients
//   node scripts/fix-tracker-column-fill.mjs --apply        # write the fix
//   node scripts/fix-tracker-column-fill.mjs --sheet <id>   # just one sheet
//
// AUTH
//   Needs a Google OAuth token JSON with the `spreadsheets` scope. Defaults to
//   the client-onboarding token; override with GOOGLE_TOKEN=/path/to/token.json
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APPLY = process.argv.includes('--apply');
const ONE_SHEET = (() => {
  const i = process.argv.indexOf('--sheet');
  return i > -1 ? process.argv[i + 1] : null;
})();

const TOKEN_PATH = process.env.GOOGLE_TOKEN
  || path.resolve(__dirname, '../../fulfillment-dashboard/client onboarding/google_token.json');

const WHITE = { red: 1, green: 1, blue: 1 };
const MAX_ROWS = 2000;
// Header colour of the inbox-management group (Recent Reply Preview /
// SmartLead Inbox Link / Reply Date). Used ONLY to decide which columns of an
// as-yet-empty sheet to pre-paint; the repair pass matches each column against
// its own header colour and needs no hard-coded value.
const RISK_HEADER = '#7b39ec';

// ── auth ───────────────────────────────────────────────────────────────────
async function accessToken() {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(`No token at ${TOKEN_PATH}. Set GOOGLE_TOKEN=/path/to/token.json`);
  }
  const t = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  if (!Array.isArray(t.scopes) || !t.scopes.some(s => s.includes('spreadsheets'))) {
    throw new Error(`Token lacks the 'spreadsheets' scope (has: ${t.scopes})`);
  }
  const res = await fetch(t.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: t.client_id,
      client_secret: t.client_secret,
      refresh_token: t.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function sheetsApi(tok, url, method = 'GET', payload, attempt = 0) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  if (!res.ok) {
    // 429/500/503 from Sheets are routine under load — back off and retry.
    if ([429, 500, 503].includes(res.status) && attempt < 4) {
      await new Promise(r => setTimeout(r, 800 * 2 ** attempt));
      return sheetsApi(tok, url, method, payload, attempt + 1);
    }
    const body = await res.text();
    const err = new Error(`${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ── which clients ──────────────────────────────────────────────────────────
async function clientSheets() {
  if (ONE_SHEET) return [{ name: '(explicit)', id: ONE_SHEET }];
  const cfg = fs.readFileSync(path.resolve(__dirname, '../js/config.js'), 'utf8');
  const url = cfg.match(/SUPABASE_URL\s*=\s*'([^']+)'/)[1];
  const key = cfg.match(/SUPABASE_ANON_KEY\s*=\s*'([^']+)'/)[1];
  const res = await fetch(`${url}/rest/v1/clients?select=name,client_sheet_id&order=name`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Supabase: ${res.status} ${await res.text()}`);
  return (await res.json())
    .filter(c => c.client_sheet_id)
    .map(c => ({ name: c.name, id: c.client_sheet_id }));
}

// ── colour helpers ─────────────────────────────────────────────────────────
const rgb = c => c ? [c.red || 0, c.green || 0, c.blue || 0] : [1, 1, 1];
const same = (a, b) => rgb(a).every((v, i) => Math.abs(v - rgb(b)[i]) < 0.02);
const isWhite = c => same(c, WHITE);
const hex = c => '#' + rgb(c).map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
const colLetter = n => { let s = ''; n++; while (n) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; } return s; };

// ── the check ──────────────────────────────────────────────────────────────
// A column is "bleeding" when its header carries a non-white fill AND at least
// one body cell repeats that exact fill. We deliberately match against the
// column's OWN header colour rather than hard-coding purple, so this also
// catches the green columns if they ever start bleeding.
function findBleed(grid) {
  const rows = grid.rowData || [];
  if (!rows.length) return { bleeding: [], lastData: 1, width: 0 };
  const header = rows[0].values || [];
  const width = header.length;

  let lastData = 1;
  for (let r = 1; r < rows.length; r++) {
    const vals = rows[r].values || [];
    if (vals.some(v => v && v.formattedValue !== undefined && String(v.formattedValue).trim() !== '')) {
      lastData = r + 1;
    }
  }

  const bleeding = [];
  for (let c = 0; c < width; c++) {
    const hdrBg = header[c]?.effectiveFormat?.backgroundColor;
    if (!hdrBg || isWhite(hdrBg)) continue;
    let hits = 0;
    for (let r = 1; r < rows.length; r++) {
      const bg = rows[r].values?.[c]?.effectiveFormat?.backgroundColor;
      if (bg && same(bg, hdrBg)) hits++;
    }
    if (hits) bleeding.push({ col: c, hits, hex: hex(hdrBg), header: header[c]?.formattedValue || '' });
  }
  return { bleeding, lastData, width };
}

// ── main ───────────────────────────────────────────────────────────────────
const tok = await accessToken();
const targets = await clientSheets();

console.log(APPLY ? '── APPLYING FIX ──' : '── DRY RUN (pass --apply to write) ──');
console.log(`${targets.length} sheet(s)\n`);

let repaired = 0, clean = 0, skipped = 0, armed = 0;

for (const t of targets) {
  let doc;
  try {
    const fields = 'sheets(properties(sheetId,title),data(rowData(values(formattedValue,effectiveFormat(backgroundColor)))))';
    doc = await sheetsApi(tok,
      `https://sheets.googleapis.com/v4/spreadsheets/${t.id}`
      + `?includeGridData=true&ranges=A1:Z${MAX_ROWS}&fields=${encodeURIComponent(fields)}`);
  } catch (e) {
    console.log(`  SKIP  ${t.name} — ${e.status === 404 || e.status === 403 ? 'no access' : e.message}`);
    skipped++;
    continue;
  }

  const sheet = doc.sheets?.[0];
  const { bleeding, lastData, width } = findBleed(sheet?.data?.[0] || {});

  if (!bleeding.length) {
    // Nothing bleeding today, but an untouched sheet whose header is coloured
    // will bleed on its first push. Pre-paint the next row so it can't.
    // Only the inbox-management group (purple header) is at risk: those are the
    // columns `push-to-client-sheet` never writes, so nothing ever overwrites
    // the inherited colour. The green columns are written on every push and come
    // out white on their own — arming them would be noise.
    const header = (sheet?.data?.[0]?.rowData?.[0]?.values) || [];
    const risky = header
      .map((h, c) => ({ c, bg: h?.effectiveFormat?.backgroundColor }))
      .filter(x => x.bg && hex(x.bg).toLowerCase() === RISK_HEADER);
    if (risky.length && lastData === 1) {
      console.log(`  ARM   ${t.name} — empty sheet, pre-painting row 2 for ${risky.length} coloured col(s)`);
      if (APPLY) {
        await sheetsApi(tok, `https://sheets.googleapis.com/v4/spreadsheets/${t.id}:batchUpdate`, 'POST', {
          requests: risky.map(x => ({
            repeatCell: {
              range: { sheetId: sheet.properties.sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: x.c, endColumnIndex: x.c + 1 },
              cell: { userEnteredFormat: { backgroundColor: WHITE } },
              fields: 'userEnteredFormat.backgroundColor',
            },
          })),
        });
      }
      armed++;
    } else {
      console.log(`  OK    ${t.name} (${width} cols, ${lastData - 1} rows)`);
      clean++;
    }
    continue;
  }

  const desc = bleeding.map(b => `${colLetter(b.col)}"${b.header}" ${b.hex} x${b.hits}`).join(', ');
  console.log(`  FIX   ${t.name} (${width} cols, ${lastData - 1} rows) -> ${desc}`);

  if (APPLY) {
    // Repaint rows 2..lastData+1 white. The +1 covers the next row to be
    // appended, so the inheritance chain is broken going forward too.
    const endRow = Math.min(lastData + 1, MAX_ROWS);
    await sheetsApi(tok, `https://sheets.googleapis.com/v4/spreadsheets/${t.id}:batchUpdate`, 'POST', {
      requests: bleeding.map(b => ({
        repeatCell: {
          range: { sheetId: sheet.properties.sheetId, startRowIndex: 1, endRowIndex: endRow, startColumnIndex: b.col, endColumnIndex: b.col + 1 },
          cell: { userEnteredFormat: { backgroundColor: WHITE } },
          fields: 'userEnteredFormat.backgroundColor',
        },
      })),
    });
    console.log(`        applied to rows 2-${endRow}`);
  }
  repaired++;
}

console.log(`\n${APPLY ? 'repaired' : 'would repair'}: ${repaired} | armed: ${armed} | clean: ${clean} | skipped: ${skipped}`);
if (!APPLY && repaired) console.log('Re-run with --apply to write the changes.');
if (armed) {
  console.log(
    `\nNote: "armed" sheets are still empty, so there is no purple to clear yet — row 2 is\n`
    + `pre-painted white as a precaution. Whether that survives the first append depends on\n`
    + `how the backend inserts rows, so it re-runs (harmlessly) every time until a lead lands.\n`
    + `Check those sheets once after their first lead.`);
}
