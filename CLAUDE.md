# THT CRM — Frontend (this repo)

This repo (`theheadlinetheory/tht-crm`) is the **live client-facing CRM frontend**.
Pushing to `main` auto-deploys to GitHub Pages via the "Verify & Deploy" Action.
Treat every change as going straight to production.

## Golden rule: deploy with `./deploy.sh`, never a bare `git push`

```bash
./deploy.sh "short description of the change"
```

It bumps the cache token everywhere, runs the guardrail, commits, and pushes. Do
NOT hand-edit version tokens or `git push` manually — you'll almost certainly
forget the cache-token bump and clients will keep running the old code.

**Why:** GitHub Pages ignores `?v=` query strings for caching. The `?v=` token on
every module import is how we force browsers to refetch. `deploy.sh` bumps them all
uniformly (plus `version.json`, which drives the auto-reload so nobody has to
hard-refresh). If the tokens don't all match, `scripts/ci-check.mjs` fails the
deploy — good, that's the guardrail catching it.

## What lives here (and what does NOT)

- **Here (you can fix):** everything visual/behavioral in the browser — the board,
  tables, modals, settings, Lead Tracker, dialer UI, styling. All in `js/*.js`,
  `index.html`, `css/`. Raw ES modules, no build step, no framework.
- **NOT here (escalate to Aidan):** anything server-side. Webhooks (SmartLead reply
  highlights, lead push), the reconcile cron, client-sheet creation, invoices,
  database schema, Supabase, API keys. Those are **edge functions + database** in a
  separate repo and deploy via the Supabase CLI — not by pushing here. If a bug is
  "leads aren't coming in", "highlights not working", "sheet not created", "invoice
  wrong" → that's backend → **Aidan**, not this repo.

## How to work a frontend bug

1. **Reproduce / locate.** Find the file + function. Module map: `render.js` (board
   + main render loop), `lead-tracker.js` (Lead Tracker table), `deal-modal.js`
   (deal detail), `settings.js` (settings panel), `deals.js`, `activities.js`,
   `dashboard.js`, `client-info.js`, `auth.js` (roles/owner colors), `api.js`
   (Supabase client + CRUD), `app.js`/`state.js` (state).
2. **Make a surgical edit.** Match the surrounding style. Don't rewrite whole files.
3. **Every change must work for all three roles:** admin, employee, client.
   Anything cost/money/setup-fee/lead-cost is **admin-only** — gate with `isAdmin()`.
4. **Deploy:** `./deploy.sh "…"`, then confirm the GitHub Action goes green, then
   open the live CRM (it auto-reloads) and verify the fix.

## Guardrails already in place

- `scripts/ci-check.mjs`: blocks a deploy if any file fails to parse, a critical
  feature anchor is missing, or cache tokens drift. Runs in `deploy.sh` AND in CI.
- `version.json` + the `<head>` version-check in `index.html`: clients auto-reload
  to a new deploy (no manual hard-refresh).
- Roll back a bad deploy: `git revert HEAD && ./deploy.sh "revert: …"`.

## Git identity

Commit as yourself (your `@theheadlinetheory.com` email) — the deploy triggers on
the push, not the author, so your own identity is correct and expected.
Set once: `git config user.email "you@theheadlinetheory.com"` and
`git config user.name "Your Name"`.
