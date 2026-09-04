// ═══════════════════════════════════════════════════════════
// WEEKLY TEMPLATE — the pure text half of Weekly Updates: the default email
// template, its placeholders, the greeting rule and token substitution.
//
// Deliberately IMPORT-FREE and browser-global-free, like weekly-context.js:
// weekly-updates.js imports app.js and can never be loaded by node, so the
// logic that decides what a client reads lives here, where
// scripts/test-weekly-template.mjs can exercise it. Keep it that way.
// ═══════════════════════════════════════════════════════════

const str = v => (v == null ? '' : String(v));

export const DEFAULT_WEEKLY_UPDATE_TEMPLATE = `Hey {CLIENT_FIRST},

Quick end of week update.

This week we sent {SENT} emails, got {REPLIES} responses, and {POSITIVES} positive responses. {PPM_NOTE}

Enjoy your weekend!`;

// Pay-per-meeting clients hear that we are still booking their positives;
// retainer clients get the replies handed straight over, so for them the
// token resolves to nothing.
export const PPM_NOTE = 'Still in talks with some of them to figure out meeting times.';

export const WEEKLY_TOKENS = ['{CLIENT_FIRST}','{CLIENT_NAME}','{SENT}','{REPLIES}','{POSITIVES}','{PPM_NOTE}','{WEEK_RANGE}'];

const INTERNAL_DOMAIN = '@theheadlinetheory.com';
const splitAddrs = v => (Array.isArray(v) ? v : str(v).split(/[,;\s]+/))
  .map(e => str(e).trim().toLowerCase()).filter(e => e.includes('@'));

// "Hey Team," whenever more than one client-side person is on the email —
// whether they sit on the To line (clients.notify_email often holds several
// addresses) or on Cc. Our own @theheadlinetheory.com addresses never count:
// aidan@ is CC'd on every send. Until 2026-09-04 only the Cc list was
// checked, so a client with two To addresses and no Cc was greeted by one
// person's first name (Denair, Landry's), and a Cc that duplicated a To
// address was stripped by the sender before it could count (Dallas, Peak,
// Woody's). Addresses are de-duplicated case-insensitively before counting.
export function weeklyGreeting(first, toLine, ccList){
  const people = new Set(splitAddrs(toLine).concat(splitAddrs(ccList || [])).filter(e => !e.endsWith(INTERNAL_DOMAIN)));
  return people.size > 1 ? 'Team' : (str(first).trim() || 'there');
}

// ctx.ppm: true for pay-per-meeting (per_lead) clients → {PPM_NOTE} becomes
// the sentence; false (retainer) → blank. Trailing spaces a blank token leaves
// behind are trimmed per line so "responses. " never reaches a client.
export function applyWeeklyTemplate(tpl, ctx){
  let out = str(tpl);
  const map = {
    '{CLIENT_FIRST}': ctx.first || 'there',
    '{CLIENT_NAME}': ctx.name || '',
    '{SENT}': String(ctx.sent ?? 0),
    '{REPLIES}': String(ctx.replies ?? 0),
    '{POSITIVES}': String(ctx.positives ?? 0),
    '{PPM_NOTE}': ctx.ppm ? PPM_NOTE : '',
    '{WEEK_RANGE}': ctx.rangeLabel || ''
  };
  for(const [k,v] of Object.entries(map)) out = out.split(k).join(v);
  return out.replace(/[ \t]+$/gm, '').trim();
}
