// Client Triage scoring — the browser half of the "Run this week" button.
//
// A direct port of fulfillment-dashboard/client-triage/score.py + build.py, kept
// here rather than in the edge function so the bands can be read next to the
// table they produce and changed without a function redeploy. The Python and
// this file must stay in step; both are exercised against the same snapshots.
//
// What it cannot compute, and why that is correct:
// OBJECTION buckets (dimension 4) come from the reply-mining pass over reply
// bodies, which is a separate exercise producing CSVs on someone's disk. They
// are a property of THAT pass, not of this week, so a live run carries the last
// known buckets forward and keeps reporting their real date. Re-running triage
// does not silently re-date stale objection data.

export const VERTICALS = ['Landscaping', 'HVAC', 'Snow Removal', 'Holiday Lighting'];
export const RETAINER_WEEKLY_TARGET = 5;   // positive replies  — mirrors dashboard.js
export const PPM_WEEKLY_TARGET = 1;        // booked meetings   — mirrors dashboard.js

const TOUCHED = new Set(['completed', 'running', 'cleaned', 'scraped', 'uploaded']);

// CRM name -> fulfillment-dashboard name. The systems disagree on spelling, most
// dashboard rows carry no smartlead_client_id, and McFarlane has two different
// ids — so a key join is impossible.
const NAMEMAP = {
  'Airlast': 'AirLast', 'Clear Heating & Air, Inc.': 'Clear Heating & Air',
  'Denair Hvac, Inc.': 'Denair HVAC Inc.', 'Galaxy Plumbing Inc.': 'Galaxy Plumbing',
  'Gm Landscaping & Design': 'GM Landscaping & Design',
  "Mary & Brite's Christmas Lights Installation": "Mary & Brite's Christmas Lights",
  'Mcfarlane Douglass': 'McFarlane Douglass & Companies',
  'Mighty Oak Landscaping': 'Mighty Oak Landscaping Inc.',
  'Northstar Hvac & Refrigeration Inc.': 'Northstar HVAC & Refrigeration',
  'Peak Services Colorado, Inc.': 'Peak Services Colorado',
  'Quantum Heating & Air Conditioning Inc.': 'Quantum HVAC',
  'Timesavers': 'Timesavers Landscaping Inc.',
  "Woody's Landcare LLC": "Woody's Land Care",
  // CRM writes "Of", the dashboard "of" — that one character once excluded a
  // live client from an entire run.
  'Wonderly Lights Of Birmingham': 'Wonderly Lights of Birmingham',
};

// Archived clients still worth scoring, with the offer they carry. Vandenberg is
// the only client that has ever sent a Holiday Lighting campaign; without it
// that vertical has no data at all.
const KEEP_ARCHIVED = { 'Vandenberg Landscapes': ['Holiday Lighting'] };

const SNOW = /\bsnow\b|\bplow|\bde-?ic|salting/i;
// Word boundaries matter: "Lightning Lawn Care" contains "light" and
// "Food Service" contains "ice".
const HOL = /\bholiday\b|\bchristmas\b|\bxmas\b/i;

export const offerOf = (name) =>
  HOL.test(name || '') ? 'Holiday Lighting' : (SNOW.test(name || '') ? 'Snow Removal' : 'BASE');

const monday = (d) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const addDays = (isoStr, n) => { const d = new Date(isoStr); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Campaign name -> client, anchored to the START of the name.
 *  Substring matching once gave From The Ground Up another client's campaign
 *  through the keyword 'from', inventing ~1,400 sends and a false launch date. */
export function makeAttributor(crmClients) {
  const kw = crmClients.map(c => [c.name, String(c.campaign_keywords || '').trim().toLowerCase()])
    .filter(([, k]) => k);
  return (name) => {
    const s = String(name || '').toLowerCase().replace(/^\s+/, '');
    const hits = kw.filter(([, k]) => s.startsWith(k));
    if (!hits.length) return null;
    hits.sort((a, b) => b[1].length - a[1].length);   // longest keyword wins
    return hits[0][0];
  };
}

/** FLOOR: the 20th percentile of active weekly rates — "on a bad week, how bad
 *  does this get?". Not the single worst week: one dead week dragged min() to
 *  0.000%, a 100% gap and the top band, which made the dimension binary. */
export function floorOf(rates) {
  const r = rates.filter(v => v !== null && v !== undefined).sort((a, b) => a - b);
  if (!r.length) return null;
  if (r.length < 4) return r[0];          // no meaningful percentile
  const k = 0.20 * (r.length - 1), lo = Math.floor(k);
  return r[lo] + (r[Math.min(lo + 1, r.length - 1)] - r[lo]) * (k - lo);
}

export function d1FixRecurrence(changes, tenureWeeks) {
  // Bands continue past 5 — the old "5+ = 10" ceiling put 5, 8, 11, 12 and 14
  // changes all on the same score.
  let s = 10;
  for (const [lim, sc] of [[0,0],[1,1],[2,2],[3,3],[4,4],[6,5],[8,6],[10,7],[12,8],[14,9]]) {
    if (changes <= lim) { s = sc; break; }
  }
  let capped = false;
  if (tenureWeeks < 6 && s > 4) { s = 4; capped = true; }
  return [s, capped];
}

export function d2FloorGap(floor, medianFloor, last3Pos, last3Active) {
  if (floor === null || medianFloor === null) return [null, 'no send history'];
  if (last3Active && last3Pos === 0) return [10, 'zero positive replies in last 3 active weeks'];
  if (medianFloor === 0) return [0, 'vertical median floor is 0'];
  const gap = (medianFloor - floor) / medianFloor * 100;
  if (Math.abs(gap) < 0.05) return [0, 'at the vertical median floor'];
  if (gap < 0) return [0, `${(-gap).toFixed(1)}% ABOVE vertical median floor`];
  const s = gap <= 15 ? 2 : gap <= 30 ? 4 : gap <= 50 ? 6 : gap <= 70 ? 8 : 10;
  return [s, `${gap.toFixed(1)}% below vertical median floor`];
}

export function d3ListRunway(unt12, customUnused, t34Left, retargets) {
  const total = unt12 + customUnused;
  if (total === 0 && retargets.length)
    return [10, `t1/2+custom exhausted; ${retargets.length} retarget campaign(s) re-running used segments`, total];
  if (total >= 3) return [0, `${unt12} untouched t1/2 + ${customUnused} unused custom`, total];
  if (total === 2) return [3, `${unt12} untouched t1/2 + ${customUnused} unused custom`, total];
  if (total === 1) return [5, `${unt12} untouched t1/2 + ${customUnused} unused custom`, total];
  if (t34Left > 0) return [8, `t1/2+custom exhausted; ${t34Left} t3/t4 available, no proven copy`, total];
  return [8, 't1/2+custom exhausted; no t3/t4 left and no retarget campaign detected', total];
}

export function d4Objections(buckets) {
  const entries = Object.entries(buckets || {});
  const total = entries.reduce((a, [, n]) => a + n, 0);
  if (total < 10) return [0, `${total} negatives in window (insufficient data)`, total];
  const [top, n] = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
  const share = n / total * 100;
  const s = share < 25 ? 2 : share < 40 ? 4 : share < 55 ? 6 : share < 70 ? 8 : 10;
  return [s, `${top} ${Math.round(share)}% of ${total}`, total];
}

/** Mirrors retainers.py: anchored on clients.renewal_day, never launch_date and
 *  never retainer_last_billed (that records when payment LANDED). */
export function nextRenewal(renewalDay, today) {
  if (!renewalDay) return null;
  let [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  for (let i = 0; i < 15; i++) {
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cand = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(renewalDay, dim)).padStart(2, '0')}`;
    if (cand >= today) return cand;
    m++; if (m > 12) { m = 1; y++; }
  }
  return null;
}

export function d5Commercial(status, billing, activated, crmLaunch, renewalDay, today) {
  if (status !== 'active') return [0, 'inactive client — no live retainer at risk'];
  if (billing === 'per_lead') return [0, 'pay-per-lead'];
  const signed = activated || crmLaunch;
  if (signed) {
    const days = Math.round((Date.parse(today) - Date.parse(String(signed).slice(0, 10))) / 86400000);
    if (days <= 60) return [2, `retainer signed ${days}d ago`];
  }
  const rn = nextRenewal(renewalDay, today);
  if (!rn) return [null, 'no renewal_day set'];
  const d = Math.round((Date.parse(rn) - Date.parse(today)) / 86400000);
  if (d <= 45) return [10, `renewal in ${d}d (${rn})`];
  if (d <= 90) return [8, `renewal in ${d}d (${rn})`];
  if (d <= 182) return [6, `renewal in ${d}d (${rn})`];
  return [4, `renewal in ${d}d (${rn})`];
}

export function healthScore(rate4, medianRate4, underperf, d3) {
  if (rate4 === null || medianRate4 === null || !medianRate4) return [null, null, null, null];
  const perf = rate4 >= medianRate4 ? 50
    : Math.max(0, 50 * (1 - ((medianRate4 - rate4) / medianRate4) / 0.70));
  const hist = underperf === 0 ? 20 : underperf <= 2 ? 13 : underperf <= 4 ? 7 : 0;
  const run = { 0: 30, 3: 20, 5: 12, 8: 5, 10: 0 }[d3];
  return [Math.round((perf + hist + run) * 10) / 10, Math.round(perf * 10) / 10, hist, run];
}

export const bandOf = (h) => h === null ? null : (h >= 70 ? 'green' : h >= 40 ? 'yellow' : 'red');

// ── assembly ────────────────────────────────────────────────────────────────
// Port of build.py. Produces exactly the row shape js/triage/<date>.js holds,
// so a snapshot computed here and one computed by the Python pipeline render
// identically.
export function buildSnapshot({ boot, weeks, sheetBookings, prior, today }) {
  const warnings = [];
  const dashByName = new Map(boot.dashClients.map(c => [c.name, c]));
  const dashById = new Map(boot.dashClients.map(c => [c.id, c]));
  const inds = new Map(boot.industries.map(i => [i.id, i]));
  const sets = new Map(boot.sets.map(s => [s.id, s.name]));
  const campById = new Map(boot.campaigns.map(c => [c.id, c]));
  const attribute = makeAttributor(boot.crmClients);

  // Resolve a CRM name to its dashboard row: map, then exact, then
  // case-insensitive. The two have drifted on capitalisation before.
  const dashCi = new Map(boot.dashClients.map(c => [c.name.toLowerCase(), c.name]));
  const resolve = (crmName) => {
    const cand = NAMEMAP[crmName] || crmName;
    if (dashByName.has(cand)) return cand;
    return dashCi.get(cand.toLowerCase()) || dashCi.get(crmName.toLowerCase()) || cand;
  };

  // offers per dashboard client — the vertical IS industry_batches.offer
  const offers = new Map();
  for (const b of boot.batches) {
    const dc = dashById.get(b.client_id);
    if (!dc) continue;
    if (!offers.has(dc.name)) offers.set(dc.name, new Map());
    const m = offers.get(dc.name);
    if (!m.has(b.offer)) m.set(b.offer, []);
    m.get(b.offer).push(b);
  }

  const active = boot.crmClients.filter(c => c.status === 'active');
  const scope = active.slice();
  for (const c of boot.crmClients) {
    if (KEEP_ARCHIVED[c.name] && c.status !== 'active') scope.push(c);
  }

  const dashActive = new Set(boot.dashClients.filter(c => c.status === 'active').map(c => c.name));
  const mappedActive = new Set(active.map(c => resolve(c.name)));
  const onlyDash = [...dashActive].filter(n => !mappedActive.has(n));
  const onlyCrm = [...mappedActive].filter(n => !dashActive.has(n));
  if (onlyDash.length) warnings.push(`Active in the fulfillment dashboard but NOT active in the CRM (excluded — CRM is the roster of record): ${onlyDash.join(', ')}`);
  if (onlyCrm.length) warnings.push(`Active in the CRM but not in the dashboard (no offers/batches, so unscoreable): ${onlyCrm.join(', ')}`);

  // weekly sends, keyed client|offer
  const key = (c, o) => c + '|' + o;
  const sent = new Map(), posw = new Map(), mtgw = new Map();
  const bump = (m, k, w, n) => { if (!m.has(k)) m.set(k, new Map()); const x = m.get(k); x.set(w, (x.get(w) || 0) + n); };

  for (const r of weeks) {
    const cm = campById.get(r.campaign_id);
    if (!cm) continue;
    const who = attribute(cm.name);
    if (!who) continue;
    bump(sent, key(who, offerOf(cm.name)), r.week, r.sent);
  }

  const firstPos = new Map();
  const launchWeeks = new Map(), retargets = new Map(), nCamps = new Map();
  for (const cm of boot.campaigns) {
    if (cm.status === 'DRAFTED') continue;
    const who = attribute(cm.name);
    if (!who) continue;
    const k = key(who, offerOf(cm.name));
    if (!launchWeeks.has(k)) launchWeeks.set(k, new Set());
    launchWeeks.get(k).add(monday(cm.created_at));
    nCamps.set(k, (nCamps.get(k) || 0) + 1);
    if (/retarget/i.test(cm.name || '')) {
      if (!retargets.has(k)) retargets.set(k, []);
      retargets.get(k).push(cm.name);
    }
  }

  for (const d of boot.deals) {
    const who = attribute(d.campaign_name);
    if (!who) continue;
    const k = key(who, offerOf(d.campaign_name));
    const w = monday(d.created_at);
    bump(posw, k, w, 1);
    if (d.booked_date) bump(mtgw, k, w, 1);   // meeting_status is 'booked' on ALL rows
    const day = String(d.created_at).slice(0, 10);
    if (!firstPos.has(k) || day < firstPos.get(k)) firstPos.set(k, day);
  }

  // client-level totals — the weekly KPI is a client commitment, and the sheet
  // does not record which offer a booking belongs to
  const clSent = new Map(), clPos = new Map(), clMtg = new Map();
  const roll = (src, dst) => { for (const [k, m] of src) { const c = k.split('|')[0]; for (const [w, n] of m) bump(dst, c, w, n); } };
  roll(sent, clSent); roll(posw, clPos); roll(mtgw, clMtg);
  for (const [c, dates] of Object.entries(sheetBookings || {})) {
    for (const ds of dates) bump(clMtg, c, monday(ds), 1);
  }

  // objections carried forward — see the note at the top of this file
  const priorObj = new Map();
  if (prior && prior.ROWS) {
    for (const r of prior.ROWS) {
      const o = {}; for (const b of (r.negBuckets || [])) o[b.b] = b.n;
      priorObj.set(r.client + '|' + r.vertical, o);
    }
  }

  const rows = [];
  for (const c of scope) {
    const dn = resolve(c.name);
    const dc = dashByName.get(dn);
    let my = [...(offers.get(dn) || new Map()).keys()].filter(v => VERTICALS.includes(v));
    if (KEEP_ARCHIVED[c.name]) my = my.filter(v => KEEP_ARCHIVED[c.name].includes(v));
    if (!my.length) continue;
    const base = (my.includes('HVAC') && !my.includes('Landscaping')) ? 'HVAC'
      : (my.includes('Landscaping') ? 'Landscaping' : null);

    let clientUnt = 0;
    for (const [, bl] of (offers.get(dn) || new Map())) {
      for (const b of bl) {
        const ind = inds.get(b.industry_id);
        if (!TOUCHED.has(b.stage) && ind && (ind.tier === 1 || ind.tier === 2)) clientUnt++;
      }
    }

    for (const V of my) {
      const ok = V === base ? 'BASE' : V;
      const k = key(c.name, ok);
      const S = sent.get(k) || new Map(), P = posw.get(k) || new Map();
      const activeWeeks = [...S.entries()].filter(([, v]) => v > 0).map(([w]) => w).sort();
      const launch = activeWeeks[0] || null;

      const series = [];
      if (launch) {
        for (let w = launch; w <= monday(today); w = addDays(w, 7)) {
          const s_ = S.get(w) || 0, p_ = P.get(w) || 0;
          series.push({ week: w, sent: s_, pos: p_, rate: s_ ? p_ / s_ * 100 : null });
        }
      }
      const last8 = series.slice(-8), act8 = last8.filter(x => x.sent > 0);
      const s8 = last8.reduce((a, x) => a + x.sent, 0), p8 = last8.reduce((a, x) => a + x.pos, 0);
      const last4 = series.slice(-4);
      const s4 = last4.reduce((a, x) => a + x.sent, 0), p4 = last4.reduce((a, x) => a + x.pos, 0);
      const rates8 = act8.map(x => x.rate);
      const fl = floorOf(rates8);
      const worstSingle = rates8.length ? Math.min(...rates8) : null;
      const l3 = series.slice(-3).filter(x => x.sent > 0);

      const bl = (offers.get(dn) || new Map()).get(V) || [];
      const pick = (t) => bl.filter(b => !TOUCHED.has(b.stage) && inds.get(b.industry_id) &&
        inds.get(b.industry_id).tier === t).map(b => inds.get(b.industry_id).name);
      const unt12 = [...pick(1), ...pick(2)], unt3 = pick(3), unt4 = pick(4);
      const customUnused = boot.slots.filter(s => dc && s.client_id === dc.id && !s.pushed_at).length;

      const changes = Math.max(0, (launchWeeks.get(k)?.size || 0) - 1);
      const [s1, capped] = d1FixRecurrence(changes, series.length);
      const [s3, g3, runway] = d3ListRunway(unt12.length, customUnused, unt3.length + unt4.length, retargets.get(k) || []);
      const objections = priorObj.get(c.name + '|' + V) || {};
      const [s4v, g4, negTotal] = d4Objections(objections);
      const [s5, g5] = d5Commercial(c.status, c.billing_model, c.activated_date, c.launch_date, c.renewal_day, today);

      rows.push({
        _cn: c.name, vertical: V, client: c.name, status: c.status,
        launch, tenure: series.length, sent8: s8, pos8: p8,
        rate8: s8 ? p8 / s8 * 100 : null, rate4: s4 ? p4 / s4 * 100 : null,
        floor: fl, worstSingle, _act8: act8.length, _l3pos: l3.reduce((a, x) => a + x.pos, 0), _l3act: l3.length,
        untT12: unt12.length, untT12names: unt12, untT3: unt3.length, untT4: unt4.length,
        clientUntT12: clientUnt, _customUnused: customUnused,
        d1: s1, d1raw: changes, d1cap: capped, d3: s3, d3raw: g3, _runway: runway,
        d4: s4v, d4raw: g4, negTotal,
        negBuckets: Object.entries(objections).sort((a, b) => b[1] - a[1]).map(([b, n]) => ({ b, n })),
        d5: s5, d5raw: g5, billing: c.billing_model, retainer: c.monthly_retainer,
        currency: c.retainer_currency, leadCost: c.lead_cost, renewal: null,
        set: dc ? sets.get(dc.industry_set_id) : null, nCamps: nCamps.get(k) || 0,
        isBase: V === base, firstPos: firstPos.get(k) || null,
      });
    }
  }

  // vertical medians, then the dimensions that depend on them
  const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const medFloor = {}, medRate4 = {};
  for (const V of VERTICALS) {
    medFloor[V] = median(rows.filter(r => r.vertical === V && r.floor !== null).map(r => r.floor));
    medRate4[V] = median(rows.filter(r => r.vertical === V && r.rate4 !== null).map(r => r.rate4));
  }

  for (const r of rows) {
    const [s2, g2] = d2FloorGap(r.floor, medFloor[r.vertical], r._l3pos, r._l3act);
    const aw = [...(clSent.get(r._cn) || new Map()).entries()].filter(([, v]) => v > 0).map(([w]) => w).sort().slice(-8);
    const flags = r.billing === 'retainer'
      ? aw.filter(w => ((clPos.get(r._cn)?.get(w)) || 0) < RETAINER_WEEKLY_TARGET)
      : aw.filter(w => ((clMtg.get(r._cn)?.get(w)) || 0) < PPM_WEEKLY_TARGET);
    const [h, hp, hh, hr] = healthScore(r.rate4, medRate4[r.vertical], flags.length, r.d3);
    const round = (v, n = 3) => v === null || v === undefined ? null : Math.round(v * 10 ** n) / 10 ** n;
    Object.assign(r, {
      // Denominator must be the CLIENT's active weeks, matching the numerator:
      // underperformance is a client commitment, not a per-offer one.
      d2: s2, d2raw: g2, up: flags.length, act8: aw.length,
      upDef: r.billing === 'retainer'
        ? `<${RETAINER_WEEKLY_TARGET} positive replies/wk`
        : `<${PPM_WEEKLY_TARGET} meeting booked/wk (CRM or client sheet)`,
      triage: s1x2(r.d1) + (s2 || 0) + s1x2(r.d3) + r.d4 + (r.d5 || 0),
      health: h, hp, hh, hr, band: bandOf(h),
      medFloor: round(medFloor[r.vertical]), medRate4: round(medRate4[r.vertical]),
      rate8: round(r.rate8), rate4: round(r.rate4), floor: round(r.floor),
      worstSingle: round(r.worstSingle),
      daysToFirstPos: (r.launch && r.firstPos)
        ? Math.round((Date.parse(r.firstPos) - Date.parse(r.launch)) / 86400000) : null,
    });
    delete r._cn; delete r._act8; delete r._l3pos; delete r._l3act; delete r._customUnused; delete r._runway; delete r.firstPos;
  }
  function s1x2(v) { return v * 2; }

  rows.sort((a, b) => VERTICALS.indexOf(a.vertical) - VERTICALS.indexOf(b.vertical) ||
    b.triage - a.triage || (a.health ?? 999) - (b.health ?? 999) || a.client.localeCompare(b.client));

  const priorMeta = prior?.META || {};
  return {
    META: {
      asOf: today, generated: new Date().toISOString().slice(0, 19),
      verticals: VERTICALS,
      replyMiningDate: priorMeta.replyMiningDate || null,
      sheetMeetingsAsOf: today,
      underperfDef: `Retainer: a week with fewer than ${RETAINER_WEEKLY_TARGET} positive replies. Pay-per-lead: a week with fewer than ${PPM_WEEKLY_TARGET} booked meeting, counting only meetings logged in the CRM (deals.booked_date) or the client's Google Sheet. Scored per client, since the weekly KPI is a client commitment.`,
      tierNote: priorMeta.tierNote || 'Vertical = industry_batches.offer in the fulfillment dashboard, not the client\'s trade.',
      floorNote: priorMeta.floorNote || 'FLOOR is the 20th percentile of a client\'s active weekly positive-reply rates over the last 8 weeks.',
      warnings, tier34: priorMeta.tier34 || null,
    },
    ROWS: rows,
  };
}
