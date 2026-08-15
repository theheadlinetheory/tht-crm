// ═══════════════════════════════════════════════════════════
// WEEKLY CONTEXT — the CRM half of the Weekly Updates context panel, plus the
// pure formatting helpers the panel renderer needs (ctxDay/ctxSummary/
// ctxSection).
//
// Meetings booked (lead_tracker) and leads passed off (pass_offs) for one
// client in one Saturday→Friday week. Both tables are already in state from
// bootstrapData(), so none of this costs a request.
//
// Deliberately IMPORT-FREE and browser-global-free: that is what lets
// scripts/test-weekly-context.mjs load it in node. This repo has no test
// runner, so a pure module is the only testable shape available. Keep it that
// way — the moment this imports app.js (or utils.js's DOM-based esc()) it
// stops being verifiable. weekly-updates.js imports app.js, so it can NEVER
// be loaded by node — a throw inside its renderRow would break the whole
// Weekly Updates tab with nothing to catch it before it ships. The three
// formatting helpers below live here instead, specifically so ci-check.mjs's
// sibling test script can exercise them.
// ═══════════════════════════════════════════════════════════

export function normName(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Lead Tracker stores dates as 'M/D/YY' (or 'M/D/YYYY'). Returns 'YYYY-MM-DD'
// so it compares lexically against the week range, or '' when unparseable —
// an unparseable date must drop out, never land in an arbitrary week.
export function mdyToIso(mdy) {
  const parts = String(mdy || '').split('/');
  if (parts.length !== 3) return '';
  const m = parseInt(parts[0], 10);
  const d = parseInt(parts[1], 10);
  let y = parseInt(parts[2], 10);
  if (isNaN(m) || isNaN(d) || isNaN(y)) return '';
  if (y < 100) y += 2000;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// pass_offs.date_passed is an ISO timestamp. Takes its LOCAL calendar date, not
// the UTC one — the Retainer Leads tab renders these with toLocaleDateString,
// so a UTC slice would put a late-evening pass-off in a different week than the
// one the person reading the grid sees.
export function localDay(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Free-typed clientName on a row → the canonical client name it belongs to.
// Mirrors dashboard.js's resolveClientName: exact, then case-insensitive, then
// a prefix match in either direction. First match wins, so a row lands under
// exactly one client and can never be double-counted across two.
export function resolveClientName(rawName, clientNames) {
  if (!rawName) return rawName;
  const names = clientNames || [];
  const exact = names.find(n => n === rawName);
  if (exact) return exact;
  const lower = String(rawName).toLowerCase();
  const ci = names.find(n => String(n).toLowerCase() === lower);
  if (ci) return ci;
  const partial = names.find(n => {
    const nl = String(n).toLowerCase();
    return nl.startsWith(lower) || lower.startsWith(nl);
  });
  if (partial) return partial;
  return rawName;
}

// One client's CRM-side week. `range` is {start, end} as 'YYYY-MM-DD',
// both inclusive — the same Saturday→Friday window weeklyPrepare() computes.
export function crmWeekContext({ clientName, range, trackerEntries, passOffs, clientNames }) {
  const target = normName(clientName);
  const names = clientNames || [];
  const inRange = iso => !!iso && iso >= range.start && iso <= range.end;
  const belongs = raw => normName(resolveClientName(raw, names)) === target;

  const meetings = (trackerEntries || [])
    .filter(e => belongs(e.clientName))
    .map(e => ({
      date: mdyToIso(e.dateAdded),
      leadName: String(e.leadName || ''),
      apptTime: String(e.apptTime || ''),
    }))
    .filter(e => inRange(e.date))
    .sort((a, b) => a.date.localeCompare(b.date));

  const passed = (passOffs || [])
    .filter(p => belongs(p.clientName))
    .map(p => ({
      date: localDay(p.datePassed),
      company: String(p.company || ''),
      contact: String(p.contact || ''),
    }))
    .filter(p => inRange(p.date))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { meetings, passed };
}

// ─── Panel formatting helpers (pure — no imports, no browser globals) ─────
// utils.js's esc() escapes via a real <div> (document.createElement), which
// is exactly the browser global this file can't touch. This mirrors its
// output for the text-node context these three render into: & < > escaped,
// quotes left alone (matching esc()'s own documented behavior elsewhere in
// weekly-updates.js — "esc() escapes &<> but not quotes"). Every piece of
// server- or user-derived text (lead names, company names, Tim's prose,
// calendar titles) passes through here before it reaches the HTML string.
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// '2026-08-13' → e.g. 'Thu, 8/13' (exact separator is locale-data dependent).
// Parsed as a LOCAL date (not `new Date(iso)`, which reads a bare date string
// as UTC and can render the previous day west of UTC). Never throws — bad
// input falls back to the raw string, unchanged.
export function ctxDay(iso) {
  const raw = String(iso == null ? '' : iso);
  const p = raw.split('-');
  if (p.length !== 3) return raw;
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
}

// Collapsed-header summary: names only the non-empty parts, in a fixed order,
// and reads 'nothing logged this week' when there is nothing to mention. The
// check-in named is the UPCOMING one — the call still ahead, worth flagging
// in the email — not one that already happened. Defensive against a ctx
// missing any optional sub-object (old localStorage drafts predate some of
// these fields); never throws, always returns a string.
export function ctxSummary(ctx) {
  if (!ctx) return 'nothing logged this week';
  const meetings = Array.isArray(ctx.meetings) ? ctx.meetings : [];
  const passed = Array.isArray(ctx.passed) ? ctx.passed : [];
  const work = Array.isArray(ctx.work) ? ctx.work : [];
  const swcl = Array.isArray(ctx.swcl) ? ctx.swcl : [];
  const checkins = ctx.checkins || {};
  const upcoming = Array.isArray(checkins.upcoming) ? checkins.upcoming : [];
  const parts = [];
  const m = meetings.length, p = passed.length;
  const updates = work.length + swcl.length;
  if (m) parts.push(`${m} meeting${m === 1 ? '' : 's'} booked`);
  if (p) parts.push(`${p} lead${p === 1 ? '' : 's'} passed`);
  if (updates) parts.push(`${updates} update${updates === 1 ? '' : 's'}`);
  const next = upcoming[0];
  if (next) parts.push(`check-in ${ctxDay(next && next.date)}`);
  if (parts.length) return parts.join(' · ');
  // An unmatched client (no fulfillment client record) never had work/swcl/
  // checkins looked up — an empty summary here means "we couldn't look", not
  // "it was a quiet week". Say so, instead of the misleading default. Local
  // CRM data (meetings/passed) still counts above if present, same as always.
  return ctx.unmatched ? "couldn't match this client" : 'nothing logged this week';
}

// One labelled section of the expanded panel: a title and a list of
// {day, text} lines, both HTML-escaped. Empty/non-array `lines` renders
// nothing (the caller concatenates section HTML, so '' just omits the
// section). Never throws on a malformed line entry.
export function ctxSection(title, lines) {
  const arr = Array.isArray(lines) ? lines : [];
  if (!arr.length) return '';
  return `<div style="margin-top:10px">
    <div style="font-size:11px;font-weight:700;color:var(--text);text-transform:uppercase;letter-spacing:.03em">${escHtml(title)}</div>
    ${arr.map(l => `<div style="font-size:12px;color:var(--text-secondary);margin-top:3px;display:flex;gap:8px">
      <span style="color:var(--text-muted);flex-shrink:0;min-width:62px">${escHtml(l && l.day)}</span>
      <span>${escHtml(l && l.text)}</span>
    </div>`).join('')}
  </div>`;
}
