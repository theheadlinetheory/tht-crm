// ═══════════════════════════════════════════════════════════
// HIRING CHANNEL — where a hiring card came from (Aidan, 2026-11-06).
// Stored in hiring_candidates.channel (backfilled 20261106_hiring_channel.sql).
// New rows without one fall back to the webhook's answers.channel or the
// form's "Where did you find this job application" answer.
// Hiring-only: nothing in acquisition/client stats reads this.
// ═══════════════════════════════════════════════════════════
import { esc, str, svgIcon } from './utils.js?v=20261114043221';

// Email cards came in through SmartLead, so they show SmartLead's own favicon
// (smartlead.ai, 48px PNG inlined so nothing loads from their CDN).
const SMARTLEAD_FAVICON = 'data:image/png;base64,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';
// Other brand marks from Simple Icons (simple-icons@13.21.0, CC0) at pill size. Phone/Other have no brand, so they use plain line icons.
const BRAND = (title, color, d) => () => `<svg viewBox="0 0 24 24" width="13" height="13" role="img" aria-label="${title}" style="vertical-align:middle;margin-right:4px;flex-shrink:0"><path fill="${color}" d="${d}"/></svg>`;
const PLAIN = (icon, color) => () => `<span style="display:inline-flex;margin-right:4px;vertical-align:middle">${svgIcon(icon, 13, color)}</span>`;
const BADGES = {
  Email: () => `<img src="${SMARTLEAD_FAVICON}" width="13" height="13" alt="SmartLead" style="vertical-align:middle;margin-right:4px;border-radius:3px;flex-shrink:0">`,
  LinkedIn: BRAND('LinkedIn', '#0A66C2', 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z'),
  Facebook: BRAND('Facebook', '#0866FF', 'M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z'),
  Upwork: BRAND('Upwork', '#000000', 'M18.561 13.158c-1.102 0-2.135-.467-3.074-1.227l.228-1.076.008-.042c.207-1.143.849-3.06 2.839-3.06 1.492 0 2.703 1.212 2.703 2.703-.001 1.489-1.212 2.702-2.704 2.702zm0-8.14c-2.539 0-4.51 1.649-5.31 4.366-1.22-1.834-2.148-4.036-2.687-5.892H7.828v7.112c-.002 1.406-1.141 2.546-2.547 2.548-1.405-.002-2.543-1.143-2.545-2.548V3.492H0v7.112c0 2.914 2.37 5.303 5.281 5.303 2.913 0 5.283-2.389 5.283-5.303v-1.19c.529 1.107 1.182 2.229 1.974 3.221l-1.673 7.873h2.797l1.213-5.71c1.063.679 2.285 1.109 3.686 1.109 3 0 5.439-2.452 5.439-5.45 0-3-2.439-5.439-5.439-5.439z'),
  Phone: PLAIN('phone', '#0f766e'),
  Other: PLAIN('globe', '#6b7280'),
};
export const HIRING_CHANNELS = Object.keys(BADGES);

const FOUND_VIA = 'Where did you find this job application';
const RULES = [[/facebook/i, 'Facebook'], [/upwork/i, 'Upwork'], [/linkedin/i, 'LinkedIn'], [/email/i, 'Email'], [/phone|call/i, 'Phone']];

export function candidateChannel(c) {
  if (c.channel) return c.channel;
  if (c.kind === 'partner') return c.answers?.channel || 'Email';
  const found = str(c.answers?.[FOUND_VIA]);
  return RULES.find(([re]) => re.test(found))?.[1] || 'Other';
}

export function channelPill(c) {
  const ch = candidateChannel(c);
  return `<span title="${esc(ch)}" style="display:inline-flex;vertical-align:middle">${(BADGES[ch] || BADGES.Other)()}</span>`;
}

export function channelSelectHtml(selected, onchange, withAll) {
  const opts = (withAll ? ['all'] : []).concat(HIRING_CHANNELS);
  return `<select onchange="${onchange}" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
    ${opts.map(o => `<option value="${o}" ${o === selected ? 'selected' : ''}>${o === 'all' ? 'All channels' : o}</option>`).join('')}
  </select>`;
}
