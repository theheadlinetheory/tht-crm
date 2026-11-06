// ═══════════════════════════════════════════════════════════
// HIRING CHANNEL — where a hiring card came from (Aidan, 2026-11-06).
// Stored in hiring_candidates.channel (backfilled 20261106_hiring_channel.sql).
// New rows without one fall back to the webhook's answers.channel or the
// form's "Where did you find this job application" answer.
// Hiring-only: nothing in acquisition/client stats reads this.
// ═══════════════════════════════════════════════════════════
import { esc, str, svgIcon } from './utils.js?v=20261106130356';
import { CHANNEL_PILL } from './acquisition-channel.js?v=20261106130356';

const BADGES = {
  Email: { bg: '#7c3aed', content: () => svgIcon('mail', 10, '#fff') },
  LinkedIn: { bg: '#0a66c2', content: () => 'in' },
  Facebook: { bg: '#1877f2', content: () => 'f' },
  Upwork: { bg: '#14a800', content: () => 'Up' },
  Phone: { bg: '#0f766e', content: () => svgIcon('phone', 10, '#fff') },
  Other: { bg: '#6b7280', content: () => '•' },
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
  const b = BADGES[ch] || BADGES.Other;
  return `<span title="${esc(ch)}" style="${CHANNEL_PILL};background:${b.bg}">${b.content()}</span>`;
}

export function channelSelectHtml(selected, onchange, withAll) {
  const opts = (withAll ? ['all'] : []).concat(HIRING_CHANNELS);
  return `<select onchange="${onchange}" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
    ${opts.map(o => `<option value="${o}" ${o === selected ? 'selected' : ''}>${o === 'all' ? 'All channels' : o}</option>`).join('')}
  </select>`;
}
