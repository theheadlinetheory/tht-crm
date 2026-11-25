// ═══════════════════════════════════════════════════════════
// INFO EMAIL — one click from an acquisition lead to a filled SmartLead reply
// ═══════════════════════════════════════════════════════════
//
// Brief 7 Part A (16 Nov acquisition call): when an acquisition lead doesn't pick up the warm call, the
// booker replies in SmartLead with the info email — and used to spend a minute or two finding it in a long
// template list. This button copies that template, already addressed to the lead, and opens the lead's
// SmartLead thread. He pastes, changes DAY at TIME, and sends himself.
//
// Decisions (Tim, 2026-11-18/19): the template is pinned by the card's Vertical, never picked from a list —
// HVAC = "ACQ HVAC Sales Resource Response" (SmartLead 177910); every other vertical = "ACQ Cleaning Company
// Sales Resource" (179098), which is the Orlando lawn-care case study. The two differ only in that case-study
// line. A button, not a trigger off the JustCall disposition. It never sends:
// SmartLead has no way to prefill its reply box from a link and its API cannot save a draft, so the
// filled email goes on the clipboard as rich text (the HERE / Calendar links survive the paste).
//
// The body is a copy of the SmartLead templates as of 2026-11-18. If either is edited in SmartLead, update
// INFO_EMAIL_HTML / CASE_STUDIES here too.

import { state } from './app.js?v=20261125104050';
import { esc, str } from './utils.js?v=20261125104050';
import { showToast } from './api.js?v=20261125104050';

const CASE_STUDIES = {
  hvac: {
    template: 'ACQ HVAC Sales Resource Response',
    html: 'An HVAC company in Chicago ran this same system and added $100K in new commercial quotes in the first month. You can watch their full interview:&nbsp;<a href="https://theheadlinetheory.com/#case-study-northstar-hvac-r"><strong>HERE</strong></a>',
  },
  other: {
    template: 'ACQ Cleaning Company Sales Resource',
    html: 'A lawn care company in Orlando ran this same system and closed $270k ARR in new commercial work. You can watch their full interview:&nbsp;<a href="https://theheadlinetheory.com/#case-study-lightning-lawn-care"><strong>HERE</strong></a>',
  },
};

/** HVAC cards get the HVAC case study; Landscaping, Snow Removal, Holiday Lighting, Plumbing and Other get lawn care. */
const caseStudyFor = (deal) => (str(deal && deal.vertical).trim().toUpperCase() === 'HVAC' ? CASE_STUDIES.hvac : CASE_STUDIES.other);

/** The SmartLead template name this card's button copies. */
export const infoEmailTemplate = (deal) => caseStudyFor(deal).template;

const INFO_EMAIL_HTML = `<p>Hey {{first_name}},<br><br>You can check out the breakdown of our findings:&nbsp;<a href="https://docs.google.com/document/d/1QG_GkYrThnW-OMqWkCh271_xDdcr5hQJRQfEqYwZGGg/edit?usp=sharing"><strong>HERE</strong></a><br><br>We actually built a system around this, it gets you more commercial jobs without waiting on referrals or chasing it yourself. We build a list of every commercial property in your area, reach out from inboxes we manage for you, and send the interested replies straight to your team to quote and close.<br><br>{{case_study}}<br><br>We only work with one company per service area and it takes about 15 minutes to figure out if this is a good fit. Does DAY at TIME or DAY at TIME work for a quick call?</p><div>If neither of those times work for you, you can choose a time that does here: <a href="https://calendly.com/contact-theheadlinetheory/strategy-call-with-the-headline-theory-clone"><strong>Calendar</strong></a><br><br>Best,<br>Aidan Hutchinson<br>Co-founder | The Headline Theory</div>`;

/** Shown on acquisition leads that have a SmartLead thread to reply in. */
export const showInfoEmailButton = (deal) =>
  !!deal && deal.pipeline === 'Acquisition' && !!(str(deal.smartleadUrl).trim() || str(deal.email).trim());

/** The lead's first name, as SmartLead's {{first_name}} would fill it; "there" when the card has none. */
export function infoEmailFirstName(deal) {
  const first = str(deal && deal.contact).trim().split(/\s+/)[0] || '';
  return first && !/^(team|info|office|admin|contact|sales|hello)$/i.test(first) ? first : 'there';
}

/** The filled email: html for SmartLead's editor, text as the plain-text fallback. */
export function infoEmailBody(deal) {
  const html = INFO_EMAIL_HTML
    .replace('{{case_study}}', caseStudyFor(deal).html)
    .replace(/\{\{first_name\}\}/g, esc(infoEmailFirstName(deal)));
  const text = html
    .replace(/<a href="([^"]+)"><strong>([^<]+)<\/strong><\/a>/g, '$2 ($1)')
    .replace(/<br\s*\/?>/g, '\n').replace(/<\/p>|<\/div>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n').trim();
  return { html, text };
}

export function renderInfoEmailButton(deal) {
  if (!showInfoEmailButton(deal)) return '';
  return `<div style="margin-top:10px">
    <button class="btn" onclick="event.stopPropagation();sendInfoEmail(this)" data-deal-id="${esc(String(deal.id))}"
      title="Copies '${esc(infoEmailTemplate(deal))}' (from the card's Vertical) addressed to this lead and opens their SmartLead thread. Paste, change DAY at TIME, send. Nothing is sent from here."
      style="padding:6px 14px;font-size:12px;font-weight:600;background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe">Send info email</button>
  </div>`;
}

// Called from the button. The clipboard write starts before the new tab opens: the browser only allows it
// while the CRM still has focus.
function sendInfoEmail(btn) {
  const id = String(btn.dataset.dealId);
  const deal = state.deals.find(d => String(d.id) === id) || (state.selectedDeal && String(state.selectedDeal.id) === id ? state.selectedDeal : null);
  if (!deal) return;
  const { html, text } = infoEmailBody(deal);
  let copied;
  try {
    copied = typeof ClipboardItem !== 'undefined' && navigator.clipboard.write
      ? navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        })])
      : navigator.clipboard.writeText(text);
  } catch (e) {
    copied = Promise.reject(e);
  }
  const url = str(deal.smartleadUrl).trim()
    || 'https://app.smartlead.ai/app/master-inbox?sortBy=REPLY_TIME_DESC&search=' + encodeURIComponent(deal.email || '');
  window.open(url, '_blank', 'noopener');
  copied.then(
    () => showToast('Info email copied: paste it into the reply, change DAY at TIME, then send.', 'success'),
    (e) => {
      console.warn('[info-email] clipboard write failed', e);
      showToast('Could not copy the info email. Pick "' + infoEmailTemplate(deal) + '" in SmartLead instead.', 'error');
    });
}

window.sendInfoEmail = sendInfoEmail;
