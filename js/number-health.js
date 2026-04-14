// js/number-health.js — Dialer number health tracking and smart number selection

import { supabase } from './api.js';
import { sbCall } from './api.js';
import { esc, svgIcon } from './utils.js';

/* ── Constants ─────────────────────────────────────────────── */
const ANSWER_THRESHOLD = 0.30;
const MIN_CALLS_FOR_DISABLE = 20;

/* ── Area Code → US State (reference data) ─────────────────── */
const AC_TO_STATE = {
  201:'NJ',202:'DC',203:'CT',205:'AL',206:'WA',207:'ME',208:'ID',209:'CA',210:'TX',212:'NY',
  213:'CA',214:'TX',215:'PA',216:'OH',217:'IL',218:'MN',219:'IN',220:'OH',223:'PA',224:'IL',
  225:'LA',228:'MS',229:'GA',231:'MI',234:'OH',239:'FL',240:'MD',248:'MI',251:'AL',252:'NC',
  253:'WA',254:'TX',256:'AL',260:'IN',262:'WI',267:'PA',269:'MI',270:'KY',272:'PA',276:'VA',
  279:'CA',281:'TX',301:'MD',302:'DE',303:'CO',304:'WV',305:'FL',307:'WY',308:'NE',309:'IL',
  310:'CA',312:'IL',313:'MI',314:'MO',315:'NY',316:'KS',317:'IN',318:'LA',319:'IA',320:'MN',
  321:'FL',323:'CA',325:'TX',326:'OH',330:'OH',331:'IL',332:'NY',334:'AL',336:'NC',337:'LA',
  339:'MA',340:'VI',346:'TX',347:'NY',351:'MA',352:'FL',360:'WA',361:'TX',364:'KY',380:'OH',
  385:'UT',386:'FL',401:'RI',402:'NE',404:'GA',405:'OK',406:'MT',407:'FL',408:'CA',409:'TX',
  410:'MD',412:'PA',413:'MA',414:'WI',415:'CA',417:'MO',419:'OH',423:'TN',424:'CA',425:'WA',
  430:'TX',432:'TX',434:'VA',435:'UT',440:'OH',442:'CA',443:'MD',458:'OR',463:'IN',469:'TX',
  470:'GA',475:'CT',478:'GA',479:'AR',480:'AZ',484:'PA',501:'AR',502:'KY',503:'OR',504:'LA',
  505:'NM',507:'MN',508:'MA',509:'WA',510:'CA',512:'TX',513:'OH',515:'IA',516:'NY',517:'MI',
  518:'NY',520:'AZ',530:'CA',531:'NE',534:'WI',539:'OK',540:'VA',541:'OR',551:'NJ',559:'CA',
  561:'FL',562:'CA',563:'IA',564:'WA',567:'OH',570:'PA',571:'VA',572:'OK',573:'MO',574:'IN',
  575:'NM',580:'OK',585:'NY',586:'MI',601:'MS',602:'AZ',603:'NH',605:'SD',606:'KY',607:'NY',
  608:'WI',609:'NJ',610:'PA',612:'MN',614:'OH',615:'TN',616:'MI',617:'MA',618:'IL',619:'CA',
  620:'KS',623:'AZ',626:'CA',628:'CA',629:'TN',630:'IL',631:'NY',636:'MO',641:'IA',646:'NY',
  650:'CA',651:'MN',657:'CA',660:'MO',661:'CA',662:'MS',667:'MD',669:'CA',678:'GA',681:'WV',
  682:'TX',689:'FL',701:'ND',702:'NV',703:'VA',704:'NC',706:'GA',707:'CA',708:'IL',712:'IA',
  713:'TX',714:'CA',715:'WI',716:'NY',717:'PA',718:'NY',719:'CO',720:'CO',724:'PA',725:'NV',
  726:'TX',727:'FL',731:'TN',732:'NJ',734:'MI',737:'TX',740:'OH',747:'CA',754:'FL',757:'VA',
  760:'CA',762:'GA',763:'MN',765:'IN',769:'MS',770:'GA',772:'FL',773:'IL',774:'MA',775:'NV',
  779:'IL',781:'MA',785:'KS',786:'FL',801:'UT',802:'VT',803:'SC',804:'VA',805:'CA',806:'TX',
  808:'HI',810:'MI',812:'IN',813:'FL',814:'PA',815:'IL',816:'MO',817:'TX',818:'CA',820:'TX',
  828:'NC',830:'TX',831:'CA',832:'TX',839:'SC',843:'SC',845:'NY',847:'IL',848:'NJ',850:'FL',
  854:'SC',856:'NJ',857:'MA',858:'CA',859:'KY',860:'CT',862:'NJ',863:'FL',864:'SC',865:'TN',
  870:'AR',872:'IL',901:'TN',903:'TX',904:'FL',906:'MI',907:'AK',908:'NJ',909:'CA',910:'NC',
  912:'GA',913:'KS',914:'NY',915:'TX',916:'CA',917:'NY',918:'OK',919:'NC',920:'WI',925:'CA',
  928:'AZ',929:'NY',930:'IN',931:'TN',934:'NY',936:'TX',937:'OH',938:'AL',940:'TX',941:'FL',
  945:'TX',947:'MI',949:'CA',951:'CA',952:'MN',954:'FL',956:'TX',959:'CT',970:'CO',971:'OR',
  972:'TX',973:'NJ',978:'MA',979:'TX',980:'NC',984:'NC',985:'LA',989:'MI'
};

/* ── State → Timezone Group ────────────────────────────────── */
const STATE_TO_TZ = {
  CT:'ET',DE:'ET',DC:'ET',FL:'ET',GA:'ET',IN:'ET',KY:'ET',ME:'ET',MD:'ET',MA:'ET',
  MI:'ET',NH:'ET',NJ:'ET',NY:'ET',NC:'ET',OH:'ET',PA:'ET',RI:'ET',SC:'ET',TN:'ET',
  VT:'ET',VA:'ET',WV:'ET',VI:'ET',
  AL:'CT',AR:'CT',IL:'CT',IA:'CT',KS:'CT',LA:'CT',MN:'CT',MS:'CT',MO:'CT',NE:'CT',
  ND:'CT',OK:'CT',SD:'CT',TX:'CT',WI:'CT',
  AZ:'MT',CO:'MT',ID:'MT',MT:'MT',NM:'MT',UT:'MT',WY:'MT',
  AK:'PT',CA:'PT',HI:'PT',NV:'PT',OR:'PT',WA:'PT',
};

/* ── State ─────────────────────────────────────────────────── */
let healthData = {}; // keyed by number string, e.g. '+17372997832'

/* ── Data Loading ──────────────────────────────────────────── */

export async function loadNumberHealth() {
  const rows = await sbCall(async () => {
    const { data, error } = await supabase
      .from('number_health')
      .select('*');
    if (error) throw error;
    return data;
  }, { label: 'Load number health' });

  healthData = {};
  for (const row of (rows || [])) {
    healthData[row.number] = row;
  }
}

/* ── Helpers ───────────────────────────────────────────────── */

function extractAreaCode(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') return parseInt(digits.substring(1, 4), 10);
  if (digits.length === 10) return parseInt(digits.substring(0, 3), 10);
  return null;
}

function getStateForPhone(phone) {
  const ac = extractAreaCode(phone);
  return ac ? (AC_TO_STATE[ac] || null) : null;
}

function getTzForState(st) {
  return st ? (STATE_TO_TZ[st] || null) : null;
}

function answerRate(entry) {
  if (!entry || !entry.total_calls) return 0;
  return entry.answered / entry.total_calls;
}

/* ── Smart Number Selection (fully dynamic from DB) ────────── */

export function getBestNumberForLead(leadPhone) {
  const entries = Object.values(healthData).filter(e => !e.disabled);
  if (!entries.length) return null;

  const leadState = getStateForPhone(leadPhone);
  const leadTz = leadState ? getTzForState(leadState) : null;

  // Derive each number's state/tz from its own area code
  const scored = entries.map(e => {
    const numState = getStateForPhone(e.number);
    const numTz = numState ? getTzForState(numState) : null;
    let tier = 3; // fallback: any healthy number
    if (leadState && numState === leadState) tier = 1;       // same state = best
    else if (leadTz && numTz === leadTz) tier = 2;           // same timezone
    return { entry: e, tier, rate: answerRate(e) };
  });

  // Sort: best tier first, then highest answer rate
  scored.sort((a, b) => a.tier - b.tier || b.rate - a.rate);
  return scored[0].entry;
}

/* ── Legacy exports (still used by dialer.js onCallEnded) ── */

export function getRegionForPhone(phone) {
  const st = getStateForPhone(phone);
  return st || 'Unknown';
}

export function getHealthyNumber(region) {
  // Fallback: find any healthy number matching region label
  const entry = Object.values(healthData).find(e => !e.disabled && e.region === region);
  return entry ? entry.number : null;
}

/* ── Call Outcome Tracking ─────────────────────────────────── */

export async function recordCallOutcome(number, wasAnswered) {
  const entry = healthData[number];
  if (!entry) return;

  entry.total_calls = (entry.total_calls || 0) + 1;
  if (wasAnswered) entry.answered = (entry.answered || 0) + 1;
  entry.last_used = new Date().toISOString();

  // Auto-disable check
  if (
    entry.total_calls >= MIN_CALLS_FOR_DISABLE &&
    entry.answered / entry.total_calls < ANSWER_THRESHOLD
  ) {
    entry.disabled = true;
    entry.disabled_at = new Date().toISOString();
  }

  await sbCall(async () => {
    const { error } = await supabase
      .from('number_health')
      .update({
        total_calls: entry.total_calls,
        answered: entry.answered,
        last_used: entry.last_used,
        disabled: entry.disabled,
        disabled_at: entry.disabled_at,
      })
      .eq('number', number);
    if (error) throw error;
  }, { label: 'Record call outcome' });
}

/* ── Toggle Disabled ───────────────────────────────────────── */

export async function toggleNumberDisabled(number) {
  const entry = healthData[number];
  if (!entry) return;

  entry.disabled = !entry.disabled;
  entry.disabled_at = entry.disabled ? new Date().toISOString() : null;

  await sbCall(async () => {
    const { error } = await supabase
      .from('number_health')
      .update({
        disabled: entry.disabled,
        disabled_at: entry.disabled_at,
      })
      .eq('number', number);
    if (error) throw error;
  }, { label: 'Toggle number disabled' });
}

/* ── Stats Access ──────────────────────────────────────────── */

export function getNumberStats() {
  return { ...healthData };
}

/* ── Settings Panel Render ─────────────────────────────────── */

export function renderNumberHealthSettings() {
  const numbers = Object.values(healthData);
  numbers.sort((a, b) => (a.region || '').localeCompare(b.region || ''));

  const rows = numbers.map(n => {
    const total = n.total_calls || 0;
    const answered = n.answered || 0;
    const rate = total > 0 ? answered / total : 0;
    const pct = Math.round(rate * 100);

    // Color logic: gray if <5 calls, green ≥50%, yellow ≥30%, red <30%
    let rateColor, rateLabel;
    if (total < 5) {
      rateColor = '#999';
      rateLabel = `${pct}%`;
    } else if (rate >= 0.5) {
      rateColor = '#22c55e';
      rateLabel = `${pct}%`;
    } else if (rate >= ANSWER_THRESHOLD) {
      rateColor = '#eab308';
      rateLabel = `${pct}%`;
    } else {
      rateColor = '#ef4444';
      rateLabel = `${pct}%`;
    }

    const statusBadge = n.disabled
      ? `<span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:9999px;font-size:12px;font-weight:600;">Burned</span>`
      : `<span style="background:#dcfce7;color:#16a34a;padding:2px 8px;border-radius:9999px;font-size:12px;font-weight:600;">Active</span>`;

    const reEnableLink = n.disabled
      ? ` <a href="#" onclick="reEnableNumber('${esc(n.number)}');return false;" style="color:#3b82f6;font-size:12px;text-decoration:underline;margin-left:6px;">Re-enable</a>`
      : '';

    return `<tr>
      <td style="font-family:monospace;font-size:13px;padding:8px 12px;">${esc(n.number)}</td>
      <td style="padding:8px 12px;">${esc(n.region || '—')} <span style="color:#888;font-size:12px;">(${esc(n.label || '')})</span></td>
      <td style="padding:8px 12px;text-align:center;">${total}</td>
      <td style="padding:8px 12px;text-align:center;color:${rateColor};font-weight:600;">${rateLabel}</td>
      <td style="padding:8px 12px;text-align:center;">${statusBadge}${reEnableLink}</td>
    </tr>`;
  }).join('');

  return `
    <div style="margin-top:16px;">
      <h3 style="margin:0 0 12px;font-size:16px;font-weight:600;">
        ${svgIcon('phone', 16)} Dialer Number Health
      </h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="border-bottom:2px solid #e5e7eb;text-align:left;">
            <th style="padding:8px 12px;font-weight:600;">Number</th>
            <th style="padding:8px 12px;font-weight:600;">Region</th>
            <th style="padding:8px 12px;text-align:center;font-weight:600;">Calls</th>
            <th style="padding:8px 12px;text-align:center;font-weight:600;">Answer %</th>
            <th style="padding:8px 12px;text-align:center;font-weight:600;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="5" style="padding:16px;text-align:center;color:#999;">No numbers configured</td></tr>'}
        </tbody>
      </table>
      <p style="margin:12px 0 0;font-size:12px;color:#888;">
        Numbers are auto-disabled when answer rate drops below 30% after 20+ calls.
      </p>
    </div>`;
}

/* ── Global Hooks ──────────────────────────────────────────── */

window.__numberHealthModule = { renderNumberHealthSettings };
window.reEnableNumber = async function(number) {
  await toggleNumberDisabled(number);
  const { render } = await import('./render.js');
  render();
};
