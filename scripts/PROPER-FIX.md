# Lead Tracker bugs: root causes and fixes

Two separate defects in `client-sheet-setup`, both found via Galaxy Plumbing.
Code changes are written and syntax-checked but **not committed and not deployed**.

## Bug 1: sheets created outside the Lead Trackers/Active folder

**Cause.** `create_sheet` asked for a `sheets-drive` scoped token and, if that call
threw, fell straight back to `getGoogleAccessToken(true)` which is **sheets-only**.
With no Drive scope it skipped both the folder move and the public share, logged a
`console.warn`, and still returned `ok: true`. The CRM showed a clean success for a
sheet that was unfiled and unshared. That is exactly how Galaxy Plumbing and Woody's
ended up outside the folder, and why Galaxy was unopenable by anyone but Aidan.

**Fix** (`supabase/functions/client-sheet-setup/index.ts`):
- Fall back to `getGoogleAccessToken(false)` (the full scope set, which *also*
  contains Drive) before giving up on Drive. Only sheets-only as a last resort.
- Placement now runs for **both** creation paths, not just the new-sheet branch;
  a sheet passed in via `existingSheetId` was never filed either.
- Verify the parents after the PATCH rather than trusting a 200.
- Return `placed`, `shared`, `folderId` and `placementError` so the caller can
  surface a failure. `settings.js` now shows an error toast when `placed === false`,
  and `lead-tracker-sheet.js` logs it.

## Bug 2: the purple column bleed

**Cause.** Two different flags disagreed.
- The **layout** came from the frontend passing `billingModel === 'retainer'`.
- The **row writer** (`push-to-client-sheet`) keys off `clients.has_inbox_mgmt`.

So any retainer client without inbox management got a 17-column sheet whose last
three columns (`Recent Reply Preview`, `SmartLead Inbox Link`, `Reply Date`, purple
header `#7B39EC`) nothing ever wrote. Sheets gives an appended row the formatting of
the row above it, so the purple walked down from the header one lead at a time and
the cells stayed blank.

Confirmed exactly against live data: every 17-column sheet is a `retainer` client,
and the six that bled or were latent are precisely those with
`billing_model = retainer` **and** `has_inbox_mgmt = false` (Galaxy, Landy Rose,
Landry's, McFarlane, Merry & Bright, From The Ground Up).

**Fix:**
- `create_sheet` accepts `clientId` and re-reads `has_inbox_mgmt` from the database,
  so the layout can no longer disagree with the writer regardless of what a caller
  passes.
- All three frontend call sites corrected: `settings.js`, `lead-tracker-sheet.js`,
  `won-modal.js` (which now seeds `false`, correct for a client being onboarded).

## Status

| Item | State |
|---|---|
| Existing purple rows cleaned (incl. Galaxy) | done, 6 sheets |
| Galaxy + Woody's filed into the folder | done by Aidan |
| Backend + frontend code fixes | written, not committed, not deployed |

**Deploy:** `supabase functions deploy client-sheet-setup --project-ref vjwkafnlgqidftxbeqjp`
(not a webhook, so no `--no-verify-jwt`). Frontend goes out via `deploy.sh`, which
bumps the `?v=` cache token. The Supabase CLI is not installed on this machine.

## Scripts

- `fix-tracker-column-fill.mjs` — clears stray header fill from data rows. Idempotent.
  Still worth a run after the next few leads land, to confirm the backend fix holds.
- `file-trackers-into-folder.mjs` — audits every tracker's Drive parent and moves
  stragglers into Active. Currently reports 29/29 filed.

## Still open

Existing 17-column sheets for non-inbox clients keep three empty columns with purple
headers. New sheets won't have them. Removing them from live client sheets deletes
columns from a client-facing document, so it needs a decision rather than a silent
cleanup. The alternative is to populate O:Q for everyone, which is arguably more
useful since those clients currently get no reply preview or inbox link at all.
