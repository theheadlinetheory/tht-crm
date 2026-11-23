// ═══════════════════════════════════════════════════════════
// SDR METRICS — the SDR Scorecard math. Import-free and pure (tested by
// scripts/test-sdr-metrics.mjs).
//
// calls    { agentId, calledAt (ISO UTC), durationS, disposition (cold_calls.outcome), day? (ET) } ← cold_calls
// seats    { agentId, setter, targetHours, targetDials }              ← sdr_seats
// bookings { setter, day: 'YYYY-MM-DD' }                              ← Lead Tracker cold calls
//
// Active time: calls whose gap (next start − previous end) is ≤ GAP_MIN form one stretch;
// a stretch runs from its first call's start to its last call's end. Longer gaps are breaks
// (shown for context only — the scorecard is judged on dials, connects and bookings).
// ═══════════════════════════════════════════════════════════

export const GAP_MIN = 15;
// Same rule as the Cold Calling tab: someone picked up (cold_calls.outcome codes).
const NOT_CONNECTED = new Set(['no_answer', 'voicemail', 'bad_number', 'desk_dq']);
const HOUR_MS = 36e5;
const MIN_MS = 6e4;

const ET_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
export const etDay = (isoUtc) => ET_DAY.format(new Date(isoUtc));
// Callers may set `day` once per call (it is the hot path on every render).
const dayOf = (c) => c.day || etDay(c.calledAt);

const ratio = (a, b) => (b ? a / b : 0);

export function dayStats(calls) {
  const sorted = calls.map((c) => ({ ...c, t: Date.parse(c.calledAt) })).sort((a, b) => a.t - b.t);
  const breaks = { count: 0, minutes: 0, longestMin: 0 };
  let activeMs = 0, stretchStart = null, stretchEnd = null;
  for (const c of sorted) {
    const end = c.t + (c.durationS || 0) * 1000;
    const gapMin = stretchEnd === null ? 0 : (c.t - stretchEnd) / MIN_MS;
    if (stretchStart === null || gapMin > GAP_MIN) {
      if (stretchStart !== null) {
        activeMs += stretchEnd - stretchStart;
        breaks.count++;
        breaks.minutes += Math.round(gapMin);
        breaks.longestMin = Math.max(breaks.longestMin, Math.round(gapMin));
      }
      stretchStart = c.t;
      stretchEnd = end;
    } else {
      stretchEnd = Math.max(stretchEnd, end);
    }
  }
  if (stretchStart !== null) activeMs += stretchEnd - stretchStart;
  return {
    dials: sorted.length,
    firstAt: sorted.length ? sorted[0].calledAt : null,
    lastAt: sorted.length ? sorted[sorted.length - 1].calledAt : null,
    activeH: activeMs / HOUR_MS,
    breaks,
    talkH: sorted.reduce((s, c) => s + (c.durationS || 0), 0) / 3600,
    connects: sorted.filter((c) => !NOT_CONNECTED.has(c.disposition || '')).length,
  };
}

// Rates shared by a day row and the totals row.
function rates({ dials, connects, booked, activeH }) {
  return {
    dialsPerActiveH: ratio(dials, activeH),
    connectRate: ratio(connects, dials),
    dialsPerBooking: booked ? dials / booked : null,
    connToBook: ratio(booked, connects),
  };
}

function dayRow(day, calls, booked, seat) {
  const s = dayStats(calls);
  return { day, ...s, booked, utilization: ratio(s.activeH, seat.targetHours), underTarget: s.dials < seat.targetDials, ...rates({ ...s, booked }) };
}

function totalsOf(days, seat) {
  const sum = (k) => days.reduce((s, d) => s + d[k], 0);
  const dialDays = days.filter((d) => d.dials > 0).length;
  const t = {
    dialDays,
    dials: sum('dials'), connects: sum('connects'), booked: sum('booked'),
    activeH: sum('activeH'), talkH: sum('talkH'),
    breakCount: days.reduce((s, d) => s + d.breaks.count, 0),
    breakMin: days.reduce((s, d) => s + d.breaks.minutes, 0),
  };
  t.dialsPerDay = ratio(t.dials, dialDays);
  t.activeHPerDay = ratio(t.activeH, dialDays);
  t.utilization = ratio(t.activeHPerDay, seat.targetHours);
  return { ...t, ...rates(t) };
}

// Group values by key into a Map of arrays.
function groupBy(items, keyOf) {
  const m = new Map();
  items.forEach((x) => { const k = keyOf(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
  return m;
}

export function scorecard({ calls, seats, bookings, from, to }) {
  const inRange = (day) => day >= from && day <= to;
  return seats.map((seat) => {
    const mine = calls.filter((c) => String(c.agentId) === String(seat.agentId));
    const callsByDay = groupBy(mine.filter((c) => inRange(dayOf(c))), dayOf);
    const booked = groupBy(bookings.filter((b) => b.setter === seat.setter && inRange(b.day)), (b) => b.day);
    const days = [...new Set([...callsByDay.keys(), ...booked.keys()])].sort()
      .map((day) => dayRow(day, callsByDay.get(day) || [], (booked.get(day) || []).length, seat));
    return { setter: seat.setter, targetHours: seat.targetHours, targetDials: seat.targetDials, days, totals: totalsOf(days, seat) };
  });
}
