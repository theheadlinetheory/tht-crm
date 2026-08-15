// ═══════════════════════════════════════════════════════════
// WEEKLY CONTEXT — the CRM half of the Weekly Updates context panel.
//
// Meetings booked (lead_tracker) and leads passed off (pass_offs) for one
// client in one Saturday→Friday week. Both tables are already in state from
// bootstrapData(), so none of this costs a request.
//
// Deliberately IMPORT-FREE and browser-global-free: that is what lets
// scripts/test-weekly-context.mjs load it in node. This repo has no test
// runner, so a pure module is the only testable shape available. Keep it that
// way — the moment this imports app.js it stops being verifiable.
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
