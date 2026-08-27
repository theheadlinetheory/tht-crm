#!/usr/bin/env node
// Move client Lead Tracker sheets into the Lead Trackers/Active folder.
//
// Galaxy Plumbing and Woody's were created outside it because client-sheet-setup
// silently skipped the Drive move when its narrow sheets+drive token failed.
// That is fixed in the edge function; this cleans up the sheets already stranded.
//
//   node scripts/file-trackers-into-folder.mjs            # dry run, all clients
//   node scripts/file-trackers-into-folder.mjs --apply
//
// Needs a token with the full `drive` scope (drive.file is not enough — it only
// covers files the app itself created).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
const ACTIVE_FOLDER_ID = '1XLJE6TFasYPT8bkVH0GgEKceCZ-lalD4';
const TOKEN_PATH = process.env.GOOGLE_TOKEN
  || path.resolve(__dirname, '../../fulfillment-dashboard/smartlead-campaign-setup/google_token.json');

async function accessToken() {
  const t = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  if (!t.scopes?.some(s => s.endsWith('/auth/drive'))) {
    throw new Error(`Token lacks the full drive scope (has: ${t.scopes}). Moving files needs it.`);
  }
  const res = await fetch(t.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: t.client_id, client_secret: t.client_secret,
      refresh_token: t.refresh_token, grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

const cfg = fs.readFileSync(path.resolve(__dirname, '../js/config.js'), 'utf8');
const sbUrl = cfg.match(/SUPABASE_URL\s*=\s*'([^']+)'/)[1];
const sbKey = cfg.match(/SUPABASE_ANON_KEY\s*=\s*'([^']+)'/)[1];

const tok = await accessToken();
const clients = await (await fetch(`${sbUrl}/rest/v1/clients?select=name,client_sheet_id&order=name`, {
  headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
})).json();

console.log(APPLY ? '── APPLYING ──' : '── DRY RUN (pass --apply to move) ──');
let moved = 0, ok = 0, failed = 0;

for (const c of clients.filter(x => x.client_sheet_id)) {
  const id = c.client_sheet_id;
  const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=parents,name&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${tok}` } });
  if (!metaRes.ok) { console.log(`  SKIP  ${c.name} — ${metaRes.status}`); failed++; continue; }
  const meta = await metaRes.json();
  const parents = meta.parents || [];
  if (parents.includes(ACTIVE_FOLDER_ID)) { console.log(`  OK    ${c.name}`); ok++; continue; }

  console.log(`  MOVE  ${c.name} — currently in [${parents.join(', ') || 'no folder'}]`);
  if (APPLY) {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${id}?addParents=${ACTIVE_FOLDER_ID}`
      + `${parents.length ? `&removeParents=${parents.join(',')}` : ''}&supportsAllDrives=true`,
      { method: 'PATCH', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: '{}' });
    if (!res.ok) { console.log(`        FAILED: ${(await res.text()).slice(0, 200)}`); failed++; continue; }
    console.log('        moved');
  }
  moved++;
}

console.log(`\n${APPLY ? 'moved' : 'would move'}: ${moved} | already filed: ${ok} | failed: ${failed}`);
