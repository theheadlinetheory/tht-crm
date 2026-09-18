# Acquisition Reactivation — Design

**Date:** 2026-09-18 · **Status:** approved in chat, pending spec review
**Systems:** THT CRM (frontend `tht-crm`, backend edge fns / Supabase `vjwkafnlgqidftxbeqjp`) + Fulfillment Dashboard (`fulfillment-dashboard`, Supabase `zrmobsgcfcloufajemxj`)

## Goal
Re-engage every past acquisition positive responder once a quarter, ~90+ days after their last touch, and
see in the CRM how it performs — without flooding the board.

## Already done (2026-09-18)
- **Backfill:** 510 SmartLead positive responders (Nov 2025 → Apr 2026) that never reached the CRM were written to
  `archive` as `Deleted/Lost` Acquisition cards, `archived_at` = original reply date, notes
  "Backfilled 2026-09-18 from SmartLead…". 5 flagged `DO NOT CONTACT` in notes. Script: kept in session scratchpad.
- **Verticals:** `DEAL_VERTICALS` (config.js) = HVAC, Landscaping, Snow Removal, Holiday Lighting, Plumbing, Other.

## Tiers (decided by whether we actually spoke to them)
| Tier | Who | Channel |
|---|---|---|
| A | Demo held, or demo booked (disco happened) | 1:1 Gmail draft from Aidan; card worked in **Reactivating** |
| B | Discovery held, no demo | 1:1 Gmail draft from Aidan; card worked in **Reactivating** |
| C | Replied positive only, or disco booked but never held | Quarterly SmartLead campaign per industry |

Tier source: `pipeline_leads` (disco/demo timestamps). **Eligible pool** = Acquisition/Nurture cards on the board
**and** in `archive`, deduped by email (most recent wins), excluding: notes contain `DO NOT CONTACT`; status matches
Closed Won / Desk DQ / Bad Lead / Miscategorized / Duplicate / Disqualified / Passed Off / Client Offboarded; active
board stages; last touch < 90 days; an existing `retarget_history` row in the last 90 days.
First run (2026-09-18): A 8 · B 5 · C 721.

## Rules
1. **Sending never moves a card.** Tier C cards stay archived. Only a `retarget_history` row is written.
2. **Reactivating** column = high-intent manual follow-ups (Tier A/B) only.
3. **A positive reply reuses the existing card** — never a duplicate.
4. **Lead data comes from SmartLead**, not the CRM card. The card carries `slLeadId`; SmartLead's global lead record
   (by email) holds company, phone, website, location and the original custom fields (508/511 backfilled leads have them).

## Part 1 — Webhook: replies land on the existing card (build first)
`smartlead-webhook`, positive reply on a non-client campaign:
1. Look up the email in `deals` (pipeline Acquisition/Nurture) → else in `archive` (`original_data` email, Acquisition/Nurture).
2. **Archived card** → restore into `deals` with its original id/notes (same column mapping as `sbRestoreFromArchive`),
   stage **Cold Email Response**, delete the archive row.
   **Board card** → keep its stage if already in an active stage; otherwise (Nurture etc.) move to Cold Email Response.
3. If the reply's campaign is a reactivation campaign (name contains `Reactivation`) or the card has an open
   `retarget_history` row → set `deals.retarget_status='replied'`, `retarget_campaign`, `retarget_date`; mark the
   `retarget_history` row `replied` + `replied_at`.
4. Always insert a timeline `interactions` row (type `Email`): `Reactivation reply · {campaign} · "{snippet}"`
   (or `Positive reply · {campaign}` for a non-reactivation reuse).
5. No existing card → create a new card exactly as today.
6. Webhook `vertical` detection uses the same six verticals as `DEAL_VERTICALS`.

Also applies to organic re-replies to any acquisition campaign (stops duplicate cards).

## Part 2 — "Reactivated" is obvious on the card
- Board card: `REACTIVATED` badge (same style as the `RETAINER` badge) when `retargetStatus === 'replied'`.
- Deal modal: banner at the top — "Reactivated · replied to {retargetCampaign} on {retargetDate} · originally replied {createdDate month}".
- Timeline entry from Part 1 stays as history.

## Part 3 — CRM ↔ Fulfillment Dashboard hookup
**CRM edge fn `reactivation-list`** (auth: shared secret, called by the dashboard's `smartlead-proxy`-style server side):
- `GET ?vertical=Landscaping&tier=C` → eligible Tier C leads for that vertical, each enriched from SmartLead
  (`GET /leads/?email=`) into Smartlead upload shape: email, first/last name, company_name, phone_number, website,
  location, custom_fields (original fields preserved) + `crm_deal_id`.
- `POST /mark` `{campaign_name, smartlead_campaign_id, deal_ids[]}` → insert `retarget_history` rows
  (`status='active'`, `segment_type` = tier) and a `retarget_exports` row.

**Dashboard `ReactivationCard`** (New Markets page, beside `AcquisitionCustomListCard`):
- Pick vertical → shows eligible count → opens the existing upload wizard via the acquisition custom-list path
  (pseudo-client name ends in "Acquisition"; campaign name `Reactivation Q{n}-{yyyy} {Vertical} Acquisition`).
- Inbox groups assigned with the existing `AcquisitionGroupPicker` (Aidan persona only).
- New `StartUploadParams.reactivation = true` → `ignore_duplicate_leads_in_other_campaign: false` and
  `subsequence: null`. Default (`undefined`) behaviour unchanged for every other caller.
- On upload success → `POST /mark` with the landed deal ids; `custom_lists` row with `scope='acquisition'`.

Sequence (copy TBD later): 2 steps, plain text, no open/click tracking, no links — Step 1 day 0, Step 2 day 4 bump.
No reference to the lead's prior message.

## Part 4 — Measurement (after the first campaign is live)
Rework the CRM Retargeting tab (`js/retargeting.js`): source = board + archive; per reactivation campaign show
sent / replied / disco booked / demo booked, from `retarget_history` + `pipeline_leads`. Remove the dead
JSON-export/fake-validation builder.

## Tier A/B handling
Gmail drafts per lead (old reply + call notes + Fathom summary). Cards restored to **Reactivating** when drafted;
timeline note on send.

## Out of scope
Copy; the pre-Nov-2025 campaigns (not in SmartLead); Retargeting tab until Part 1–3 ship.

## Testing
- Webhook: replay payloads for (a) archived card, (b) board Nurture card, (c) board active card, (d) unknown email,
  (e) client campaign — verify no duplicate, correct stage, timeline row, retarget fields. Verify on a test email
  before relying on live traffic.
- Dashboard: unit test that `reactivation=true` flips only the dedupe flag + subsequence; existing processor/parity
  tests stay green.
- `reactivation-list`: count matches the eligible-pool query; every lead carries SmartLead custom fields.
