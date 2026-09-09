// ═══════════════════════════════════════════════════════════
// CLIENT TRIAGE — health-score inputs, sectioned by business category
//
// Four sections, one per category we sell into: Landscaping, HVAC,
// Snow Removal, Holiday Lighting. Each row is one CLIENT × CATEGORY pair,
// not one client: a client that sells several offers (McFarlane Douglass
// sells three) appears once in each of its categories, scored on that
// offer's own campaigns. That is deliberate — the category a lead comes
// from is `industry_batches.offer` in the fulfillment dashboard, and a
// landscaping client running a snow angle is a different funnel with a
// different list, so averaging them together hides both.
//
// The numbers are a SNAPSHOT (see TRIAGE_META.generated), not live. Computing
// them needs the fulfillment-dashboard database and the Smartlead campaign
// API, neither of which this frontend repo may reach directly — backend work
// lives in the edge-function repo. Regenerate the snapshot alongside the
// research write-up rather than hand-editing js/triage-data.js.
//
// Underperforming week uses the SAME bar as the Weekly KPI:
// RETAINER_WEEKLY_TARGET = 5 positive replies, PPM_WEEKLY_TARGET = 1 meeting.
// ═══════════════════════════════════════════════════════════
import { esc, str } from './utils.js?v=20260908175510';
import { isAdmin } from './auth.js?v=20260908175510';
import { TRIAGE_META, TRIAGE_ROWS } from './triage-data.js?v=20260908175510';

const BAND_COLOR = { green: '#16a34a', yellow: '#ca8a04', red: '#dc2626' };
const BAND_BG    = { green: '#dcfce7', yellow: '#fef9c3', red: '#fee2e2' };

const pct = v => (v === null || v === undefined) ? '—' : v.toFixed(3) + '%';
const num = v => (v === null || v === undefined) ? '—' : Number(v).toLocaleString();

function bandPill(band, health) {
  if (!band) return `<span style="font-size:11px;color:var(--text-muted)">not scoreable</span>`;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;
    background:${BAND_BG[band]};color:${BAND_COLOR[band]}">${health} ${band}</span>`;
}

// A dimension cell: the 0-10 score with the raw number that produced it, so the
// table can be audited without opening the CSV.
function dim(score, raw, weighted) {
  const s = (score === null || score === undefined) ? '—' : score;
  const w = weighted && score !== null && score !== undefined ? ` <span style="opacity:.55">x2</span>` : '';
  return `<td style="text-align:center;font-size:12px;white-space:nowrap">
    <div style="font-weight:700">${s}${w}</div>
    <div style="font-size:10px;color:var(--text-muted);max-width:190px;white-space:normal;line-height:1.3">${esc(str(raw) || '')}</div>
  </td>`;
}

function sectionFor(vertical) {
  const rows = TRIAGE_ROWS.filter(r => r.vertical === vertical);
  const scored = rows.filter(r => r.launch);
  const counts = { green: 0, yellow: 0, red: 0, none: 0 };
  rows.forEach(r => { counts[r.band || 'none']++; });

  let h = `<div style="margin:0 0 26px">
    <div style="display:flex;align-items:baseline;gap:12px;padding:10px 0 8px;border-bottom:2px solid var(--purple)">
      <div style="font-size:15px;font-weight:800">${esc(vertical)}</div>
      <div style="font-size:11px;color:var(--text-muted)">
        ${rows.length} client${rows.length === 1 ? '' : 's'} ·
        ${scored.length} with send history ·
        <span style="color:${BAND_COLOR.green};font-weight:700">${counts.green} green</span> ·
        <span style="color:${BAND_COLOR.yellow};font-weight:700">${counts.yellow} yellow</span> ·
        <span style="color:${BAND_COLOR.red};font-weight:700">${counts.red} red</span>${counts.none ? ` · ${counts.none} not scoreable` : ''}
      </div>
    </div>`;

  if (!rows.length) {
    return h + `<div style="padding:18px;font-size:12px;color:var(--text-muted)">No active client carries this offer.</div></div>`;
  }

  // A category where nobody has ever sent is a launch problem, not a
  // performance one — say so instead of showing a table of dashes.
  if (!scored.length) {
    h += `<div style="margin:10px 0;padding:12px 14px;background:#fef9c3;border-left:3px solid #ca8a04;border-radius:4px;font-size:12px;line-height:1.5">
      <b>No client in this category has ever sent.</b> Every campaign is still drafted, so there is no reply data:
      performance, floor gap and objection scores are undefined and the health score cannot be computed.
      Only commercial exposure is real. This is a launch problem, not a performance problem.
    </div>`;
  }

  h += `<div class="tracker-table-wrap" style="overflow-x:auto"><table class="tracker-table" style="min-width:1180px;font-size:12px">
    <thead><tr>
      <th style="text-align:left">Client</th>
      <th style="text-align:center">Triage<br><span style="font-weight:400;opacity:.6">/70</span></th>
      <th style="text-align:center">Health</th>
      <th style="text-align:center">1 Fix<br>recurrence</th>
      <th style="text-align:center">2 Floor<br>gap</th>
      <th style="text-align:center">3 List<br>runway</th>
      <th style="text-align:center">4 Objection<br>concentration</th>
      <th style="text-align:center">5 Commercial<br>exposure</th>
      <th style="text-align:center">Rolling 4wk<br>vs median</th>
      <th style="text-align:center">Underperf<br>weeks /8</th>
      <th style="text-align:center">Days to 1st<br>positive</th>
    </tr></thead><tbody>`;

  rows.forEach(r => {
    const rateCell = r.rate4 === null || r.rate4 === undefined
      ? '—'
      : `${pct(r.rate4)}<div style="font-size:10px;color:var(--text-muted)">med ${pct(r.medRate4)}</div>`;
    h += `<tr>
      <td style="text-align:left">
        <div style="font-weight:700">${esc(r.client)}${r.status && r.status !== 'active'
          ? ` <span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:8px;background:#e5e7eb;color:#6b7280;vertical-align:middle">${esc(r.status.toUpperCase())}</span>` : ''}</div>
        <div style="font-size:10px;color:var(--text-muted)">
          ${esc(r.billing === 'retainer' ? 'retainer' : 'pay-per-lead')}${r.retainer ? ` · ${esc(str(r.currency || '').toUpperCase())} ${num(r.retainer)}/mo` : ''}${r.leadCost ? ` · $${r.leadCost}/lead` : ''}
          ${r.launch ? ` · launched ${esc(r.launch)} · ${r.tenure}w` : ' · <b>never sent</b>'}
          ${r.isBase ? '' : ' · secondary offer'}
        </div>
      </td>
      <td style="text-align:center;font-weight:800;font-size:14px">${r.triage}</td>
      <td style="text-align:center">${bandPill(r.band, r.health)}
        ${r.health !== null && r.health !== undefined ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">${r.hp}+${r.hh}+${r.hr}</div>` : ''}</td>
      ${dim(r.d1, `${r.d1raw} change${r.d1raw === 1 ? '' : 's'}${r.d1cap ? ' (capped, <6w)' : ''}`, true)}
      ${dim(r.d2, r.d2raw || 'no send history', false)}
      ${dim(r.d3, r.d3raw, true)}
      ${dim(r.d4, r.d4raw, false)}
      ${dim(r.d5, r.d5raw, false)}
      <td style="text-align:center">${rateCell}</td>
      <td style="text-align:center">
        <div style="font-weight:700;color:${r.up >= 2 ? BAND_COLOR.red : 'inherit'}">${r.act8 ? `${r.up}/${r.act8}` : '—'}</div>
        <div style="font-size:10px;color:var(--text-muted)">${esc(r.upDef)}</div>
      </td>
      <td style="text-align:center">${r.daysToFirstPos === null || r.daysToFirstPos === undefined
        ? (r.launch ? '<span style="color:#dc2626;font-weight:700">still zero</span>' : '—')
        : r.daysToFirstPos + 'd'}</td>
    </tr>`;
  });
  h += `</tbody></table></div>`;

  // Raw inputs behind the scores — kept in a details block so the section
  // stays readable but nothing is hidden from an audit.
  h += `<details style="margin-top:8px"><summary style="cursor:pointer;font-size:11px;color:var(--text-muted);padding:4px 0">
    Raw inputs behind these scores (sends, positives, list runway, negative buckets)</summary>
    <div class="tracker-table-wrap" style="overflow-x:auto;margin-top:6px"><table class="tracker-table" style="min-width:1080px;font-size:11px">
    <thead><tr>
      <th style="text-align:left">Client</th><th>Campaigns</th><th>Sent 8w</th><th>Positives 8w</th>
      <th>Rate 8w</th><th>Floor (P20)</th><th>Worst single wk</th><th>Median floor</th>
      <th>Untouched T1/T2</th><th>T3</th><th>T4</th>
      <th>Negatives (90d)</th><th>Largest bucket</th>
      <th>Industry set</th><th>Next renewal</th>
    </tr></thead><tbody>`;
  rows.forEach(r => {
    h += `<tr>
      <td style="text-align:left">${esc(r.client)}</td>
      <td style="text-align:center">${r.nCamps}</td>
      <td style="text-align:center">${num(r.sent8)}</td>
      <td style="text-align:center">${r.pos8}</td>
      <td style="text-align:center">${pct(r.rate8)}</td>
      <td style="text-align:center">${pct(r.floor)}</td>
      <td style="text-align:center;color:var(--text-muted)">${pct(r.worstSingle)}</td>
      <td style="text-align:center">${pct(r.medFloor)}</td>
      <td style="text-align:center" title="${esc((r.untT12names || []).join(', '))}">${r.untT12}</td>
      <td style="text-align:center">${r.untT3}</td>
      <td style="text-align:center">${r.untT4}</td>
      <td style="text-align:center">${r.negTotal}</td>
      <td style="text-align:center;font-size:10px" title="${esc((r.negBuckets||[]).map(b=>b.b+': '+b.n).join(' · '))}">${
        (r.negBuckets && r.negBuckets.length)
          ? esc(r.negBuckets.reduce((a,b)=>b.n>a.n?b:a).b) + ' ' + Math.round(100*r.negBuckets.reduce((a,b)=>b.n>a.n?b:a).n/r.negTotal) + '%'
          : '—'}</td>
      <td style="text-align:center">${esc(str(r.set) || '—')}</td>
      <td style="text-align:center">${esc(str(r.renewal) || '—')}</td>
    </tr>`;
  });
  h += `</tbody></table></div></details></div>`;
  return h;
}

export function renderTriage() {
  if (!isAdmin()) {
    return `<div class="tracker-container"><div style="padding:32px;text-align:center;font-size:13px;color:var(--text-muted)">
      Client Triage is admin-only — it shows retainer amounts and renewal dates.</div></div>`;
  }
  const t34 = TRIAGE_META.tier34;
  let h = `<div class="tracker-container" style="overflow-y:auto"><div style="padding:14px 18px 26px">`;

  h += `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:14px">
    <div>
      <div style="font-size:16px;font-weight:800">Client Triage &amp; Health Scores</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:3px;max-width:760px;line-height:1.5">
        Triage 0–70, higher = more urgent. Health 0–100, higher = healthier (green 70+, yellow 40–69, red under 40).
        ${esc(TRIAGE_META.tierNote)}
      </div>
    </div>
    <div style="text-align:right;white-space:nowrap">
      <div style="font-size:11px;color:var(--text-muted)">Snapshot</div>
      <div style="font-size:13px;font-weight:700">${esc(TRIAGE_META.generated)}</div>
      <button class="btn" style="font-size:11px;padding:5px 12px;margin-top:6px" onclick="triageExportCsv()">Export CSV</button>
    </div>
  </div>`;

  h += `<div style="margin-bottom:10px;padding:10px 14px;background:#f8fafc;border-left:3px solid var(--purple);border-radius:4px;font-size:11px;line-height:1.55">
    <b>Underperforming week:</b> ${esc(TRIAGE_META.underperfDef)}
  </div>`;

  // The five dimension cells read as "9 x2 (14 changes)", which is genuinely
  // ambiguous until you know 9 is the score and x2 is the weighting. Spelled out
  // here rather than left to be guessed.
  h += `<details style="margin-bottom:12px">
    <summary style="cursor:pointer;font-size:12px;font-weight:700;color:var(--purple);padding:4px 0">
      How to read these scores &mdash; what the numbers mean</summary>
    <div style="padding:10px 14px;background:#fff;border:1px solid var(--border);border-radius:5px;font-size:11px;line-height:1.65;margin-top:4px">
      <div style="margin-bottom:7px"><b>Every number in the five dimension columns is a SCORE out of 10 &mdash; never a count of replies or meetings.</b>
      Higher always means <i>more urgent</i>. The small grey text under each score is the raw fact behind it.</div>
      <div style="margin-bottom:7px"><b>&ldquo;x2&rdquo; means that dimension counts double.</b> Fix recurrence and List runway are weighted x2,
      the other three count once &mdash; which is why the maximum is 70, not 50:
      <code style="background:#f3f4f6;padding:1px 5px;border-radius:3px">(1 x2) + 2 + (3 x2) + 4 + 5 = 20+10+20+10+10 = 70</code></div>
      <div style="margin-bottom:7px"><b>The two scores run in opposite directions.</b>
      <b>Triage 0&ndash;70, higher = more urgent</b> (risk and runway).
      <b>Health 0&ndash;100, higher = healthier</b> (green 70+, yellow 40&ndash;69, red under 40).
      A client can be urgent <i>and</i> healthy &mdash; that means it is performing but out of list.</div>
      <div style="margin-bottom:7px"><b>Positive reply rate</b> = positive replies &divide; <i>emails sent</i>, as a %. It looks small (0.1&ndash;0.7%)
      because the denominator is every email sent. 0.30% is about 3 positives per 1,000 emails.</div>
      <div style="margin-bottom:7px"><b>Floor</b> = the client&rsquo;s 20th-percentile weekly rate over its last 8 sending weeks &mdash;
      <i>on a bad week, how bad does it get?</i> Not the single worst week, so one dead week does not max it out.
      <b>Median floor</b> = the median of those floors across the vertical, i.e. <i>how bad a typical client in this category gets</i>. That is the yardstick each client is measured against.</div>
      <div><b>Underperf 4/8</b> means 4 of the last 8 sending weeks missed the weekly KPI bar.</div>
    </div></details>`;

  // Scores that are true but misleading if read at face value. Worth the space:
  // the Holiday Lighting 100 and the Lightning 4.3 both look like findings and are not.
  if (TRIAGE_META.caveats && TRIAGE_META.caveats.length) {
    h += `<div style="margin-bottom:16px;padding:10px 14px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:4px;font-size:11px;line-height:1.6">
      <b>Read these before trusting a score:</b><ul style="margin:5px 0 0;padding-left:18px">${
        TRIAGE_META.caveats.map(c => `<li style="margin-bottom:3px">${esc(c)}</li>`).join('')}</ul></div>`;
  }

  TRIAGE_META.verticals.forEach(v => { h += sectionFor(v); });

  // Fleet-wide finding — this is a property of the tier 3/4 lists, not of any
  // one client, so it sits below the four sections rather than inside one.
  h += `<div style="margin-top:8px;padding:12px 14px;background:#f8fafc;border:1px solid var(--border);border-radius:6px">
    <div style="font-size:13px;font-weight:800;margin-bottom:6px">Tier 3/4 diagnostic — across every client with tier 3/4 sends</div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">
      ${num(t34.t34sent)} tier-3/4 replies producing ${num(t34.t34neg)} classified objections,
      against ${num(t34.t12sent)} / ${num(t34.t12neg)} for tier 1/2.
      Only ${t34.clients34.length} active client${t34.clients34.length===1?'':'s'} have any tier 3/4 sends: ${esc(t34.clients34.join(', '))}.
    </div>
    <table class="tracker-table" style="font-size:11px;max-width:560px">
      <thead><tr><th style="text-align:left">Negative bucket</th><th>Tier 1/2</th><th>Tier 3/4</th><th>Shift</th></tr></thead><tbody>`;
  t34.buckets.forEach(b => {
    const d = b.p34 - b.p12;
    h += `<tr><td style="text-align:left">${esc(b.b)}</td>
      <td style="text-align:center">${b.p12.toFixed(1)}%</td>
      <td style="text-align:center">${b.p34.toFixed(1)}%</td>
      <td style="text-align:center;font-weight:700;color:${d > 0 ? '#dc2626' : '#16a34a'}">${d > 0 ? '+' : ''}${d.toFixed(1)}pp</td></tr>`;
  });
  h += `</tbody></table>
    <div style="font-size:12px;margin-top:8px;line-height:1.5"><b>Verdict:</b> ${esc(t34.verdict)}</div>
  </div>`;

  h += `<div style="margin-top:12px;font-size:10px;color:var(--text-muted);line-height:1.5">
    ${esc(TRIAGE_META.floorNote)}<br>
    ${esc(TRIAGE_META.objSource)}
    Positive replies are logged CRM pass-offs, so a reply that was never logged reads as underperformance.
    Hover a "largest bucket" cell for that client's full bucket breakdown.
  </div>`;

  return h + `</div></div>`;
}

window.triageExportCsv = () => {
  const cols = ['vertical','client','triage','health','band','d1','d1raw','d2','d2raw','d3','d3raw','d4','d4raw','d5','d5raw',
    'hp','hh','hr','launch','tenure','sent8','pos8','rate8','rate4','medRate4','worst8','medWorst','up','act8','upDef',
    'untT12','untT3','untT4','negTotal','negWrong','negNI','negHostile','billing','retainer','currency','leadCost',
    'renewal','set','nCamps','daysToFirstPos'];
  const q = v => `"${String(v === null || v === undefined ? '' : v).replace(/"/g,'""')}"`;
  const csv = [cols.join(',')].concat(TRIAGE_ROWS.map(r => cols.map(c => q(r[c])).join(','))).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `client-triage-${TRIAGE_META.generated}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
