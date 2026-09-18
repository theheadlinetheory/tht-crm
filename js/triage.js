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
// The numbers are weekly SNAPSHOTS, not live. Computing them needs the CRM and
// fulfillment-dashboard databases, the Smartlead API and the client sheets —
// none of which this frontend may reach. They are produced by
// `fulfillment-dashboard/client-triage/run_triage.py`, which writes one file per
// week into js/triage/ and refreshes js/triage-index.js. Never hand-edit those.
//
// Each week is lazy-loaded only when selected, so history costs nothing on first
// paint, and a churned client simply stops appearing in new snapshots while the
// weeks it was present keep it unchanged.
//
// Underperforming week uses the SAME bar as the Weekly KPI:
// RETAINER_WEEKLY_TARGET = 5 positive replies, PPM_WEEKLY_TARGET = 1 meeting.
// ═══════════════════════════════════════════════════════════
import { state } from './app.js?v=20260918073113';
import { render } from './render.js?v=20260918073113';
import { esc, str } from './utils.js?v=20260918073113';
import { isAdmin } from './auth.js?v=20260918073113';
import { WEEKS, LATEST } from './triage-index.js?v=20260918073113';
import { runTriage, listSavedWeeks, getSavedWeek } from './triage-run.js?v=20260918073113';

const BAND_COLOR = { green: '#16a34a', yellow: '#ca8a04', red: '#dc2626' };
const BAND_BG    = { green: '#dcfce7', yellow: '#fef9c3', red: '#fee2e2' };

// ── week selection ──────────────────────────────────────────────────────────
// Each week is a separate module under js/triage/ and is fetched only when it is
// selected, so history can grow indefinitely without slowing first paint.
// Churn falls out of this for free: a client that has left stops appearing in
// new snapshots, while older ones keep it exactly as it was that week.
const CACHE = {};          // week -> {META, ROWS} | {error}
const PENDING = {};        // week -> true while its import is in flight

function weekState() {
  if (!state.triage) {
    state.triage = { week: LATEST, compare: true, saved: null, running: false, progress: '', error: null };
  }
  if (!state.triage.week) state.triage.week = LATEST;
  return state.triage;
}

// Weeks bundled with the deploy, plus any saved server-side since. A run writes
// to the server, so a new week appears here WITHOUT a deploy — that is the whole
// point of the button.
function allWeeks() {
  const ws = weekState();
  const merged = new Set([...(WEEKS || []), ...(ws.saved || [])]);
  return [...merged].sort().reverse();
}

// Fetch the saved-week list once per screen visit.
function ensureSavedList() {
  const ws = weekState();
  if (ws.saved !== null || ws._listing) return;
  ws._listing = true;
  listSavedWeeks()
    .then(list => { ws.saved = list; ws._listing = false; render(); })
    .catch(() => { ws.saved = []; ws._listing = false; });   // bundled weeks still work
}

function loadWeek(week) {
  if (!week || CACHE[week] || PENDING[week]) return;
  PENDING[week] = true;
  import(`./triage/${week}.js?v=20260918073113`)
    .then(m => ({ META: m.META, ROWS: m.ROWS }))
    // Not bundled — it was produced by a Run and lives server-side only.
    .catch(() => getSavedWeek(week))
    .then(snap => { CACHE[week] = snap; delete PENDING[week]; render(); })
    .catch(err => {
      console.error('Client Triage: failed to load week', week, err);
      CACHE[week] = { error: String((err && err.message) || err) };
      delete PENDING[week];
      render();
    });
}

function priorWeek(week) {
  const w = allWeeks();
  const i = w.indexOf(week);
  return (i >= 0 && i + 1 < w.length) ? w[i + 1] : null;
}

// Δ vs the prior snapshot. Returns null when there is nothing to compare against
// — a brand-new client, or the oldest week we hold.
function deltaFor(row, prevSnap) {
  if (!prevSnap || !prevSnap.ROWS) return null;
  const was = prevSnap.ROWS.find(p => p.client === row.client && p.vertical === row.vertical);
  if (!was) return { isNew: true };
  return { triage: row.triage - was.triage,
           health: (row.health != null && was.health != null) ? +(row.health - was.health).toFixed(1) : null };
}

function deltaCell(d) {
  if (!d) return '';
  if (d.isNew) return `<span style="font-size:9px;font-weight:700;color:#2563eb">NEW</span>`;
  if (!d.triage) return `<span style="font-size:10px;color:var(--text-muted)">—</span>`;
  // triage UP = more urgent = worse, so red for a rise
  const up = d.triage > 0;
  return `<span style="font-size:10px;font-weight:700;color:${up ? '#dc2626' : '#16a34a'}">${up ? '+' : ''}${d.triage}</span>`;
}

window.triageSetWeek = w => { weekState().week = w; render(); };

window.triageRun = () => {
  const ws = weekState();
  if (ws.running) return;
  const today = new Date().toISOString().slice(0, 10);
  ws.running = true; ws.error = null; ws.progress = 'Starting…'; render();
  const prior = CACHE[ws.week] && CACHE[ws.week].ROWS ? CACHE[ws.week] : null;
  runTriage({ today, prior, onProgress: m => { ws.progress = m; render(); } })
    .then(({ snap }) => {
      CACHE[today] = snap;                       // show it immediately
      ws.saved = [...new Set([...(ws.saved || []), today])].sort().reverse();
      ws.week = today; ws.running = false; ws.progress = '';
      render();
    })
    .catch(err => {
      console.error('Client Triage run failed:', err);
      ws.running = false; ws.progress = '';
      ws.error = String((err && err.message) || err);
      render();
    });
};
window.triageToggleCompare = () => { const s = weekState(); s.compare = !s.compare; render(); };

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

function sectionFor(vertical, SNAP, PREV) {
  const rows = SNAP.ROWS.filter(r => r.vertical === vertical);
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
      <th style="text-align:center">&Delta;<br><span style="font-weight:400;opacity:.6">vs prior</span></th>
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
      <td style="text-align:center">${deltaCell(deltaFor(r, PREV))}</td>
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
  ensureSavedList();
  const ws = weekState();
  const WKS = allWeeks();
  if (!WKS.length) {
    return `<div class="tracker-container"><div style="padding:32px;text-align:center;font-size:13px;color:var(--text-muted)">
      No triage snapshots yet. Press <b>Run this week</b> to build the first one.
      <div style="margin-top:12px"><button class="btn btn-primary" onclick="triageRun()" ${ws && ws.running ? 'disabled' : ''}>Run this week</button></div>
      </div></div>`;
  }
  const week = ws.week;
  const prev = priorWeek(week);
  loadWeek(week);
  if (ws.compare && prev) loadWeek(prev);

  const SNAP = CACHE[week];
  const PREV = (ws.compare && prev) ? CACHE[prev] : null;

  // Week picker renders even while the data is still in flight, so switching
  // weeks never leaves an empty screen.
  const newest = WKS[0];
  const picker = `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end">
      <label style="font-size:11px;color:var(--text-muted)">Week</label>
      <select onchange="triageSetWeek(this.value)" style="font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:5px;font-family:var(--font)">
        ${WKS.map(w => `<option value="${w}"${w === week ? ' selected' : ''}>${w}${w === newest ? ' (latest)' : ''}</option>`).join('')}
      </select>
      ${prev ? `<label style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:4px;cursor:pointer">
        <input type="checkbox" ${ws.compare ? 'checked' : ''} onchange="triageToggleCompare()"> vs ${prev}</label>` : ''}
      <button class="btn" style="font-size:11px;padding:4px 10px" onclick="triageExportCsv()">Export CSV</button>
      <button class="btn btn-primary" style="font-size:11px;padding:4px 12px" onclick="triageRun()" ${ws.running ? 'disabled' : ''}>
        ${ws.running ? 'Running…' : 'Run this week'}</button>
    </div>
    ${ws.running ? `<div style="margin-top:6px;font-size:11px;color:var(--purple);text-align:right">
        ${esc(ws.progress || 'Working…')}
        <div style="font-size:10px;color:var(--text-muted);margin-top:2px">Pulls the CRM, the dashboard, the client sheets and live Smartlead volume — usually 2–5 minutes. Leave this tab open.</div>
      </div>` : ''}
    ${ws.error ? `<div style="margin-top:6px;font-size:11px;color:#b91c1c;text-align:right;max-width:520px">
        Run failed: ${esc(ws.error)}</div>` : ''}`;

  if (!SNAP) {
    return `<div class="tracker-container"><div style="padding:20px 18px">${picker}
      <div style="padding:40px;text-align:center;color:var(--text-muted);font-size:12px">Loading week ${esc(week)}…</div></div></div>`;
  }
  if (SNAP.error) {
    return `<div class="tracker-container"><div style="padding:20px 18px">${picker}
      <div style="padding:30px;text-align:center">
        <div style="font-size:14px;font-weight:700;color:#b91c1c;margin-bottom:6px">Could not load the ${esc(week)} snapshot</div>
        <div style="font-size:12px;color:var(--text-muted)">${esc(SNAP.error)}</div>
      </div></div></div>`;
  }

  const META = SNAP.META;
  const t34 = META.tier34;
  let h = `<div class="tracker-container" style="overflow-y:auto"><div style="padding:14px 18px 26px">`;

  h += `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:14px">
    <div>
      <div style="font-size:16px;font-weight:800">Client Triage &amp; Health Scores</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:3px;max-width:760px;line-height:1.5">
        Triage 0–70, higher = more urgent. Health 0–100, higher = healthier (green 70+, yellow 40–69, red under 40).
        ${esc(META.tierNote)}
      </div>
    </div>
    <div style="text-align:right">${picker}
      <div style="font-size:10px;color:var(--text-muted);margin-top:5px">
        objections ${esc(META.replyMiningDate || 'n/a')} · sheets ${esc(META.sheetMeetingsAsOf || 'never')}
      </div>
    </div>
  </div>`;

  if (PREV && PREV.ROWS) {
    const gone = PREV.ROWS.filter(p => !SNAP.ROWS.some(r => r.client === p.client && r.vertical === p.vertical));
    const added = SNAP.ROWS.filter(r => !PREV.ROWS.some(p => p.client === r.client && p.vertical === r.vertical));
    if (gone.length || added.length) {
      h += `<div style="margin-bottom:10px;padding:8px 14px;background:#eff6ff;border-left:3px solid #2563eb;border-radius:4px;font-size:11px;line-height:1.6">
        <b>Roster change since ${esc(prev)}:</b>
        ${added.length ? ` added ${added.map(r => esc(r.client) + ' (' + esc(r.vertical) + ')').join(', ')}.` : ''}
        ${gone.length ? ` no longer scored ${gone.map(r => esc(r.client) + ' (' + esc(r.vertical) + ')').join(', ')} — churned or offer stopped. Their ${esc(prev)} rows remain under that week.` : ''}
      </div>`;
    }
  }

  // What the two scores actually MEAN, in plain language and always visible.
  // The mechanics live in the collapsible below; this answers "what am I
  // looking at", which is the question people actually arrive with.
  h += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
    <div style="padding:11px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px">
      <div style="font-size:12px;font-weight:800;color:#b91c1c;margin-bottom:4px">TRIAGE &nbsp;0&ndash;70 &nbsp;&middot;&nbsp; higher = more urgent</div>
      <div style="font-size:11px;line-height:1.6">
        <b>&ldquo;How badly does this client need a decision from us right now?&rdquo;</b><br>
        It measures <b>risk and runway</b>, not output: how many times we have already rebuilt their
        campaigns, how far their bad weeks fall below their peers&rsquo;, whether they have run out of
        list to send to, whether their rejections point at one systematic cause, and how much
        contract revenue is exposed.<br>
        <span style="color:var(--text-muted)">A high triage score does <b>not</b> mean a client is
        performing badly. It means something about their situation needs attention &mdash; most often
        that we are out of road with them.</span>
      </div>
    </div>
    <div style="padding:11px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px">
      <div style="font-size:12px;font-weight:800;color:#15803d;margin-bottom:4px">HEALTH &nbsp;0&ndash;100 &nbsp;&middot;&nbsp; higher = healthier</div>
      <div style="font-size:11px;line-height:1.6">
        <b>&ldquo;How well is this client actually doing right now?&rdquo;</b><br>
        It measures <b>output</b>: their positive-reply rate over the last 4 weeks against the typical
        client in their category, how many of their recent weeks missed the weekly KPI, and how much
        untouched list they still have.
        <span style="white-space:nowrap"><b style="color:#15803d">green 70+</b>,
        <b style="color:#ca8a04">yellow 40&ndash;69</b>, <b style="color:#dc2626">red under 40</b>.</span><br>
        <span style="color:var(--text-muted)">This is the number to quote when someone asks how a
        client is doing.</span>
      </div>
    </div>
  </div>
  <div style="margin-bottom:10px;padding:9px 14px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:4px;font-size:11px;line-height:1.6">
    <b>They are allowed to disagree, and the disagreement is the useful part.</b>
    <b>High triage + healthy</b> = performing well but out of list; the work is finding new people to
    contact, not fixing the campaign.
    <b>High triage + red</b> = failing now, and we have already spent the obvious fixes.
    <b>Low triage + red</b> = a bad patch, but there is still list and runway to work with.
  </div>`;

  h += `<div style="margin-bottom:10px;padding:10px 14px;background:#f8fafc;border-left:3px solid var(--purple);border-radius:4px;font-size:11px;line-height:1.55">
    <b>Underperforming week:</b> ${esc(META.underperfDef)}
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
  if (META.warnings && META.warnings.length) {
    h += `<div style="margin-bottom:16px;padding:10px 14px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:4px;font-size:11px;line-height:1.6">
      <b>Read these before trusting a score:</b><ul style="margin:5px 0 0;padding-left:18px">${
        META.warnings.map(c => `<li style="margin-bottom:3px">${esc(c)}</li>`).join('')}</ul></div>`;
  }

  META.verticals.forEach(v => { h += sectionFor(v, SNAP, PREV); });

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
    ${esc(META.floorNote)}<br>
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
  const wk = weekState().week;
  const snap = CACHE[wk];
  if (!snap || !snap.ROWS) return;
  const csv = [cols.join(',')].concat(snap.ROWS.map(r => cols.map(c => q(r[c])).join(','))).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `client-triage-${wk}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
