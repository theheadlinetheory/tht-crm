# SDR $ per Dial + CFO Hub SDR ROI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Show what each SDR earns per dial on the CRM Manager tab, and what each SDR makes the company per dial in a new CFO Hub "SDR ROI" tab; $/hour shows "Coming soon".

**Architecture:** Dials/meetings come from the CRM's `cold_calls` (synced every 2 min by cold-call-sync). SDR commission = meetings × the setter's cold-call rate (SETTERS / setterRates). CFO Hub gets dials, meetings and billed cold-call leads per SDR from a new founders-only fulfillment edge fn `sdr-roi-report` (same auth as cac-report), and costs from the payroll ledger it already reads. The SDR Scorecard moves onto `cold_calls`; the duplicate `sdr_calls` sync is removed.

**Spec (approved in chat 2026-11-23):**
- SDR earns = commission only (cold-call rate per meeting). Shown as "$X every time they click dial" = earned ÷ dials, for Today / This week / Last 30 days, per rep, Manager tab only. $/hour column greyed "Coming soon".
- CFO Hub "SDR ROI" (founders only), per SDR, by Week or Month: dials, meetings, billed PPM meetings + revenue (lead_tracker cold_call rows, price = lead_cost), revenue/dial, cost (payroll ledger: cold-call lead lines + base for SDR-only payees), cost/dial, cost/meeting, profit/dial. $/hour "Coming soon".
- Retainer meetings bill nothing per meeting: shown as a count, never as $0 revenue.
- Hours (from #standard-work-checklist EOD) = later; question already added to the SWCL.

## Global Constraints
- Pull every repo before editing; frontend deploys only via `./deploy.sh`; payroll front only via `build.sh`.
- Setter by JustCall login: contact@ = Ioannis, leads@ = Marcell, aidan@ = Aidan (mirror of CRM `setter_for_email()`).
- Connection = outcome not in {no_answer, voicemail, bad_number, desk_dq} (Cold Calling tab rule).
- Meeting = `!not_counted && (outcome==='booked' || booked_on)`, dated by `booked_on || call_date`.
- Exclude Landy Rose Media from revenue. No pricing shown to non-admins (Manager tab is manager-only; it shows SDR pay, not client prices).
- Setters with no rate on file (Aidan) show "—", never Ioannis's default.
- Ioannis's base is not counted as SDR cost (it pays his other roles); UI says so.

## Review Focus
- Rep with 0 dials but a meeting (booked from a card later) → $/dial "—", never Infinity.
- A lead_tracker row "called back" or disputed → not billed revenue.
- Week/Month boundaries in CFO Hub use Mon–Sun weeks and calendar months on booked date.
- `cold_calls` > 1000 rows → paginated reads everywhere.
- Ledger lines voided or reversed → excluded / netted.

---

### Task 1: Pure money helpers (CRM)
**Files:** Create `js/sdr-money.js`; Test `scripts/test-sdr-money.mjs`.
**Produces:** `setterForEmail(email) -> 'Ioannis'|'Marcell'|'Aidan'|null`; `perDial(earned, dials) -> number|null`; `earnedFor(meetings, rate|null) -> number|null`.
- [ ] Tests: contact@→Ioannis, LEADS@ (case)→Marcell, other→null; perDial(50,100)=0.5, perDial(25,0)=null; earnedFor(3,25)=75, earnedFor(3,null)=null.
- [ ] Run → FAIL; implement; run → PASS; commit.

### Task 2: Manager tab "$ per dial" section (CRM)
**Files:** Create `js/cc-dollars-per-dial.js` (`renderDollarsPerDial(reps) -> string`); Modify `js/cold-calling-tab.js` managerHtml (≤5 lines, after the Reps section); `scripts/ci-check.mjs` feature anchor.
**Consumes:** Task 1; `setterRates`, `setterInfo` (lead-payout / lead-setter); tally() in cold-calling-tab.
- [ ] managerHtml builds `reps = [{ name, email, rate, periods: { today, week, last30 } }]` from tally (dials, booked) and passes it in.
- [ ] Section: per rep row, Today / This week / Last 30 days: dials, meetings, earned, **$/dial** (big, "every time they click dial"), and a greyed "$/hour · Coming soon" column. Footnote: commission only; rate shown.
- [ ] `node scripts/ci-check.mjs` passes; commit.

### Task 3: Scorecard onto cold_calls; remove sdr_calls pipeline
**Files:** Modify `js/sdr-scorecard.js`, `js/sdr-metrics.js`, `scripts/test-sdr-metrics.mjs`; backend migration `20261124000100_sdr_seats_email.sql` (add `agent_email`, backfill); drop cron `justcall-sdr-sync`, function, table `sdr_calls` (after the frontend is live).
- [ ] Tests updated to outcome codes (no_answer / voicemail / bad_number / desk_dq / '' = not connected; desk_dq now NOT a connect, matching the Cold Calling tab). Run → FAIL → fix NOT_CONNECTED → PASS.
- [ ] Scorecard loads `cold_calls` (call_id, agent_email, called_at, duration_sec, outcome) paginated; seats keyed by agent_email.
- [ ] Deploy frontend; verify live; then unschedule cron, delete function, drop `sdr_calls`; commit backend.

### Task 4: `sdr-roi-report` edge fn (fulfillment)
**Files:** Create `dashboard/supabase/functions/_shared/sdr-roi.ts` + `sdr-roi.test.ts`; `dashboard/supabase/functions/sdr-roi-report/index.ts`; `config.toml` `verify_jwt = false`.
**Produces:** POST → `{ ok, generated_at, floor, days: [{ setter, day, dials, connects, meetings }], leads: [{ id, setter, day, price, client }] }`.
- [ ] Pure `aggregateCalls(rows)` and `billableLeads(rows)` with tests (meeting rule, connect rule, setter map, called back / Landy Rose / disputed excluded, unknown login dropped).
- [ ] index: verifyCrmUser({issuers:['crm','payroll']}) + isFounder; paginated CRM reads via CRM_REST + crmKey; floor 2026-10-09.
- [ ] Deploy; invoke without auth → 401; commit + push.

### Task 5: CFO Hub "SDR ROI" tab (payroll front)
**Files:** Create `js/sdr-roi.js` (`renderSdrRoiTab()`), Modify `js/cfo.js` (pill + dispatch, ≤5 lines).
**Consumes:** Task 4 response; `ledger_items` (payee, kind, source_id, amount, earned_on, voided_at, reverses_item_id) via sbPayroll.
- [ ] Week / Month toggle + stepper; per SDR column: dials, meetings, billed meetings, retainer/unbilled meetings (count), revenue, revenue/dial, cost (lead lines for that SDR's billed leads by source_id + base lines for Marcell in period), cost/dial, cost/meeting, profit, **profit/dial**, $/hour "Coming soon".
- [ ] build.sh deploy; verify live as founder; sync front files into aidan529 repo; commit.
