// Booked meetings for Client Triage — EMAIL ONLY, from the CRM lead tracker.
//
// Source of truth is lead_tracker (the PPM meetings tracker), not the client
// Google Sheets: automations push to those sheets and they are not relied on
// (Aidan, 2026-10-17). Triage measures cold email, so a meeting booked by cold
// calling must never count — it would make a weak campaign look like it is
// delivering (Woody's: three cold-call meetings in the week email produced none).
//
// How a row is classified:
//   1. lead_source on the tracker row, or on its deal, is set to anything other
//      than email ('' / 'smartlead')            -> not email, excluded.
//   2. its deal's campaign is named as a cold-call campaign -> excluded.
//   3. on or after COLD_CALL_START, a row must ALSO trace back to a SmartLead
//      lead or campaign. An untagged row that cannot is excluded and reported,
//      so a cold-call meeting someone forgot to tag cannot slip in as email.
// Rows before COLD_CALL_START predate client cold calling and are all email.

// First client cold-call deal in the CRM (Lightning Lawn Care / Woody's).
export const COLD_CALL_START = '2026-10-13';

const EMAIL_SOURCES = new Set(['', 'smartlead']);
const COLD_CALL_NAME = /cold[\s_-]*call/i;

const isEmailSource = (s) => EMAIL_SOURCES.has(String(s ?? '').trim().toLowerCase());

/** A deal that came from cold email (also used to keep cold-call deals out of
 *  the positive-reply counts). */
export function isEmailDeal(d) {
  return isEmailSource(d.lead_source) && !COLD_CALL_NAME.test(d.campaign_name || '');
}

/** lead_tracker.date_added is "M/D/YY"; fall back to created_at. */
export function trackerDate(row) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(String(row.date_added || '').trim());
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return row.created_at ? String(row.created_at).slice(0, 10) : null;
}

/**
 * @returns {{ byClient: Map<string,string[]>, excluded: object[], unverified: object[] }}
 *   byClient   — CRM client name -> ISO dates of email-sourced meetings
 *   excluded   — rows dropped as cold call / another channel
 *   unverified — untagged rows since COLD_CALL_START with no SmartLead trace (dropped)
 */
export function emailMeetings(tracker, deals) {
  const byId = new Map(deals.map(d => [d.id, d]));
  const byEmail = new Map();
  for (const d of deals) {
    const e = String(d.email || '').trim().toLowerCase();
    if (!e) continue;
    if (!byEmail.has(e)) byEmail.set(e, []);
    byEmail.get(e).push(d);
  }

  const byClient = new Map(), excluded = [], unverified = [];
  for (const r of tracker) {
    const date = trackerDate(r);
    if (!date || !r.client_name) continue;
    const info = { client: r.client_name, lead: r.lead_email, date };

    // The row's own deal, else every deal for that address (a deleted deal can
    // leave the tracker row orphaned). ANY non-email deal for the address wins.
    const own = byId.get(r.deal_id);
    const linked = own ? [own] : (byEmail.get(String(r.lead_email || '').trim().toLowerCase()) || []);

    if (!isEmailSource(r.lead_source) || linked.some(d => !isEmailDeal(d))) {
      excluded.push({ ...info, source: r.lead_source || linked.find(d => !isEmailDeal(d))?.lead_source || 'cold_call' });
      continue;
    }
    if (date >= COLD_CALL_START && !linked.some(d => d.sl_lead_id || d.sl_campaign_id)) {
      unverified.push(info);
      continue;
    }
    if (!byClient.has(r.client_name)) byClient.set(r.client_name, []);
    byClient.get(r.client_name).push(date);
  }
  return { byClient, excluded, unverified };
}
