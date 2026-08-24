// ═══════════════════════════════════════════════════════════
// ANALYSIS — Why did a client miss their weekly KPI?
//
// Lists every campaign belonging to the clients that fell short of their
// weekly target and puts the week's sending diagnostics next to each other in
// one spreadsheet-style grid: how much went out, on how many days, what
// bounced, what replied and in which category, and the copy that was used.
//
// Stats come from the fulfillment-dashboard `smartlead-proxy`
// (`client_week_breakdown`) — the same proxy and the same date-ranged
// /sequence-analytics endpoint the Weekly Updates tab uses, so the two tabs
// can never report different numbers for the same week.
// ═══════════════════════════════════════════════════════════
import { state } from './app.js?v=20260825022410';
import { render } from './render.js?v=20260825022410';
import { esc, str } from './utils.js?v=20260825022410';
import { isAdmin } from './auth.js?v=20260825022410';
import { showToast } from './api.js?v=20260825022410';
import {
  currentWeekKey, weekLabel, shiftWeeks, ymd, weekStartOf,
  getWeeklyKpiStatus, getPpmClients, getRetainerClients,
  PPM_WEEKLY_TARGET, RETAINER_WEEKLY_TARGET,
} from './dashboard.js?v=20260825022410';

// Lives on the fulfillment-dashboard Supabase project (verify_jwt=false),
// same as the Weekly Updates stats proxy.
const STATS_PROXY_URL = 'https://zrmobsgcfcloufajemxj.supabase.co/functions/v1/smartlead-proxy';

// Smartlead's own campaign URL. Clicking the campaign name lands on its
// analytics page.
const SMARTLEAD_CAMPAIGN_URL = id => `https://app.smartlead.ai/app/email-campaign/${id}/analytics`;

// Categories Smartlead counts as a positive reply (mirrors the proxy).
const POSITIVE_CATEGORIES = new Set(['Interested', 'Meeting Request', 'Information Request']);

function getA() {
  if (!state.analysis) {
    state.analysis = { step: 'idle', week: null, rows: [], errors: [], progress: '', scope: 'missed', copy: null, showDormant: false, hydratedKey: null, pulledAt: null };
  }
  return state.analysis;
}

// ─── Run cache (localStorage) ────────────────────────────────
// A run costs a minute of live Smartlead calls, so losing it to a closed tab,
// a reload, or the deploy auto-reload means paying that again. Completed runs
// are cached per week + scope and restored on the way back in; the header
// shows how old the restored numbers are, with Refresh to re-pull.
const RUNS_KEY = 'tht_analysis_runs';
const MAX_CACHED_RUNS = 6;
const runKey = (week, scope) => `${week}|${scope}`;

function readRuns() {
  try { return JSON.parse(localStorage.getItem(RUNS_KEY) || '{}') || {}; }
  catch { return {}; }
}

// A cached run outlives the code that wrote it: a deploy that adds a column
// leaves rows in localStorage without it, and reading `.daily.forEach` on one
// of those throws — which aborts the whole render and leaves the previous
// screen up. Every row is coerced back to the current shape on the way in, so
// an older (or hand-corrupted) cache degrades to blanks instead of breaking
// the tab.
function normalizeRow(r) {
  return {
    ...r,
    clientName: str(r && r.clientName),
    campaignName: str(r && r.campaignName),
    industry: str(r && r.industry) || '—',
    dataSource: str(r && r.dataSource) || '—',
    dmType: str(r && r.dmType) || '—',
    sent: Number(r && r.sent) || 0,
    firstTouch: Number(r && r.firstTouch) || 0,
    followUp: Number(r && r.followUp) || 0,
    replies: Number(r && r.replies) || 0,
    positives: Number(r && r.positives) || 0,
    bounces: Number(r && r.bounces) || 0,
    daily: (Array.isArray(r && r.daily) ? r.daily : [])
      .filter(d => d && typeof d === 'object')
      .map(d => ({ date: str(d.date), sent: Number(d.sent) || 0, replies: Number(d.replies) || 0, bounces: Number(d.bounces) || 0 })),
    sendingDays: Number(r && r.sendingDays) || 0,
    daysInRange: Number(r && r.daysInRange) || 7,
    categories: (r && r.categories && typeof r.categories === 'object') ? r.categories : {},
    kpiTarget: Number(r && r.kpiTarget) || 0,
    kpiActual: Number(r && r.kpiActual) || 0,
  };
}

function saveRun(week, scope, rows, errors) {
  try {
    const runs = readRuns();
    runs[runKey(week, scope)] = { at: new Date().toISOString(), rows, errors };
    // Keep only the newest few so a season of weekly runs can't fill the quota.
    const keys = Object.keys(runs).sort((a, b) => new Date(runs[b].at) - new Date(runs[a].at));
    const trimmed = {};
    for (const k of keys.slice(0, MAX_CACHED_RUNS)) trimmed[k] = runs[k];
    localStorage.setItem(RUNS_KEY, JSON.stringify(trimmed));
  } catch (e) {
    // Quota or serialize failure is non-fatal — the tab still holds the live run.
    console.warn('Could not cache the analysis run:', e);
  }
}

// Pull a cached run into state when the tab is opened on a week/scope we've
// already analysed. Guarded by hydratedKey so it runs once per key, not on
// every render.
function hydrate(a, week) {
  const key = runKey(week, a.scope);
  if (a.hydratedKey === key) return;
  a.hydratedKey = key;
  if (a.step === 'loading') return;
  const cached = readRuns()[key];
  if (cached && Array.isArray(cached.rows) && cached.rows.length) {
    a.rows = cached.rows.map(normalizeRow);
    a.errors = Array.isArray(cached.errors) ? cached.errors : [];
    a.pulledAt = cached.at;
    a.step = 'done';
  } else {
    a.rows = [];
    a.errors = [];
    a.pulledAt = null;
    a.step = 'idle';
  }
}

function agoLabel(iso) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// Most of a client's campaigns are paused or finished and sent nothing this
// week — showing all of them buries the ones that actually ran. Dormant rows
// are collapsed behind a toggle, EXCEPT for a client whose campaigns all sent
// nothing: there, "nothing went out" is the entire finding and must stay
// visible.
function visibleRows(a) {
  if (a.showDormant) return a.rows;
  const sentByClient = {};
  for (const r of a.rows) sentByClient[r.clientName] = (sentByClient[r.clientName] || 0) + r.sent;
  return a.rows.filter(r => r.sent > 0 || !sentByClient[r.clientName]);
}

// ─── Campaign-name parsing ───────────────────────────────────
// Convention: "<Client> #N - <Industries> - <DM type> - client [- suffix]".
// Older campaigns put "client" before the DM type or omit parts entirely, so
// every piece is located by what it looks like rather than by position.

const DM_RE = /\bDM\s*(?:Match(?:es)?|Different|Diff)\b/i;
const NOISE_RE = /^(client|clients|copy|generic|specific|specific email|generic email|test)$/i;

// Ordered: first hit wins, so "non GMaps" beats the "Google Maps" default.
const DATA_SOURCES = [
  { re: /\bnon[\s-]*g\s*maps\b/i, label: 'Non-GMaps list' },
  { re: /\boutscraper\b/i, label: 'Outscraper' },
  { re: /\bapollo\b/i, label: 'Apollo' },
  { re: /\bai[\s-]*ark\b/i, label: 'AI ARK' },
  { re: /\bpublic data\b/i, label: 'Public data' },
  { re: /\bll\d{2}\b/i, label: 'NYC LL filing data' },
];

function splitSegments(name) {
  // Campaign names use both hyphen and en-dash as separators, and the space
  // before the dash is often missing ("… Nashville TN- DM Matches - client").
  // Only the space AFTER the dash is required, which keeps hyphenated words
  // like "Big-Box" and "AI-ark" intact.
  return str(name).split(/\s*[-–]\s+/).map(s => s.trim()).filter(Boolean);
}

export function parseCampaignName(name) {
  const raw = str(name);
  const segs = splitSegments(raw);

  const src = DATA_SOURCES.find(s => s.re.test(raw));
  // No explicit source in the name means it came off Google Maps — that's the
  // default list everything is built from.
  const dataSource = src ? src.label : 'Google Maps';

  const dmMatch = raw.match(DM_RE);
  // "DM Match/DM Different" and "DM Matches/DM Diff" are single segments.
  const dmSeg = segs.find(s => DM_RE.test(s));
  const dmType = dmSeg ? dmSeg.replace(/\s*-\s*client.*$/i, '').trim() : (dmMatch ? dmMatch[0] : '');

  // Industry = the descriptive segments: drop the leading "<Client> #N" chunk,
  // the DM-type segment, and boilerplate like "client" / "Generic".
  const industryParts = segs.slice(1).filter(s => {
    if (DM_RE.test(s)) return false;
    if (NOISE_RE.test(s)) return false;
    if (/^retarget/i.test(s)) return false;
    return true;
  });
  let industry = industryParts.join(' / ');
  // Strip the source words out of the industry when they share a segment,
  // e.g. "non GMaps Housing leads Tampa FL" → "Housing Tampa FL".
  if (src) {
    industry = industry
      .replace(src.re, ' ')
      .replace(/\bleads?\b/gi, ' ')
      .replace(/\(\s*\)|\[\s*\]/g, ' ') // "Commercial Property (AI ARK)" → no empty parens left
      .replace(/\(\s+/g, '(').replace(/\s+\)/g, ')') // "( with public data)" → "(with public data)"
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  industry = industry.replace(/^[\s/,-]+|[\s/,-]+$/g, '');

  return { industry: industry || '—', dataSource, dmType: dmType || '—' };
}

// ─── Week helpers ────────────────────────────────────────────
function weekBounds(weekKey) {
  const start = weekKey;
  const d = new Date(weekKey + 'T00:00:00');
  d.setDate(d.getDate() + 6);
  return { start, end: ymd(d) };
}

function selectedWeek() {
  const a = getA();
  return a.week || currentWeekKey();
}

// ─── Campaign → client matching ──────────────────────────────
// Word-boundary match, longest keyword wins — same rule as
// client-info.js findClientForDeal, so the Analysis tab attributes a campaign
// to exactly the client the board would.
function keywordHits(campaign, kw) {
  let i = campaign.indexOf(kw);
  while (i !== -1) {
    const before = i > 0 ? campaign[i - 1] : ' ';
    const after = campaign[i + kw.length] || ' ';
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    i = campaign.indexOf(kw, i + 1);
  }
  return false;
}

function clientKeywords(c) {
  return (str(c.campaignKeywords) + ',' + str(c.campaignName))
    .toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
}

export function matchClientForCampaign(campaignName, clients) {
  const cn = str(campaignName).toLowerCase();
  if (!cn) return null;
  let best = null, bestLen = 0;
  for (const c of clients) {
    for (const kw of clientKeywords(c)) {
      if (kw.length > bestLen && keywordHits(cn, kw)) { best = c; bestLen = kw.length; }
    }
  }
  return best;
}

// One call to the stats proxy. Smartlead's 800/min cap (we self-cap at 780 via
// the dashboard's app_settings.smartlead_rate_limit) is shared with the
// dashboard's cache-sync crons, which burst around :00/:30, so a collision is
// routine rather than exceptional — retry once after the window clears before
// giving up. Same treatment the Weekly Updates tab gives its stats pull.
async function proxyCall(body, label, onRetry) {
  const attempt = async () => {
    const resp = await fetch(STATS_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await resp.json().catch(() => ({ error: `${label} returned a non-JSON response (${resp.status})` }));
    if (!resp.ok || payload.error) throw new Error(payload.error || `${label} failed (${resp.status})`);
    return payload;
  };
  try {
    return await attempt();
  } catch (e) {
    if (onRetry) onRetry(e);
    await new Promise(r => setTimeout(r, 20000));
    return attempt();
  }
}

// ─── Run the analysis ────────────────────────────────────────
export async function runAnalysis() {
  const a = getA();
  const week = selectedWeek();
  const { start, end } = weekBounds(week);
  const runId = (a.runId || 0) + 1;
  a.runId = runId;
  a.step = 'loading';
  a.rows = [];
  a.errors = [];
  a.week = week;
  a.progress = 'Finding campaigns…';
  render();
  const stale = () => state.analysis !== a || a.runId !== runId;

  try {
    // 1. Who missed their target this week?
    const kpi = getWeeklyKpiStatus(week);
    const targets = a.scope === 'all'
      ? [...kpi.ppm, ...kpi.retainer]
      : [...kpi.ppm, ...kpi.retainer].filter(r => !r.hit);
    if (!targets.length) {
      a.step = 'done';
      a.progress = '';
      render();
      return;
    }
    const retainerNames = new Set(getRetainerClients().map(c => c.name));
    const targetClients = targets
      .map(t => ({ ...t, client: state.clients.find(c => c.name === t.name), isRetainer: retainerNames.has(t.name) }))
      .filter(t => t.client);

    // 2. Which campaigns belong to them? DRAFTED campaigns have never sent.
    // NOTE: the CRM's own `list-campaigns` edge function is NOT usable here —
    // it returns only acquisition campaigns (it backs Settings → Acquisition
    // Campaign Assignments), so every client campaign is missing from it. The
    // fulfillment proxy returns the full Smartlead account list.
    const campPayload = await proxyCall({ action: 'list_campaigns' }, 'Campaign list', () => {
      a.progress = 'Smartlead rate-limit collision — retrying in 20s…';
      render();
    });
    if (stale()) return;
    const campaigns = campPayload.data;
    if (!Array.isArray(campaigns)) throw new Error('Could not load the campaign list from Smartlead.');

    const owned = [];
    let considered = 0;
    for (const camp of campaigns) {
      if (String(camp.status || '').toUpperCase() === 'DRAFTED') continue;
      if (/acquisi?tion/i.test(camp.name || '')) continue; // our own outreach, not a client's
      considered++;
      const owner = matchClientForCampaign(camp.name, targetClients.map(t => t.client));
      if (!owner) continue;
      const t = targetClients.find(x => x.client.name === owner.name);
      owned.push({ ...camp, clientName: owner.name, target: t });
    }

    if (!owned.length) {
      a.step = 'done';
      a.rows = [];
      // Say what was actually searched — "no match" reads identically whether
      // the keywords are wrong or the campaign list came back the wrong shape.
      a.errors.push(`None of the ${considered} client campaigns in Smartlead (${campaigns.length} total) matched ${targetClients.length} client${targetClients.length === 1 ? '' : 's'}: ${targetClients.map(t => t.client.name).join(', ')}. Check Settings → Clients → campaign keywords.`);
      render();
      return;
    }

    // 3. Pull the week's breakdown for exactly those campaigns.
    a.progress = `Pulling Smartlead stats for ${owned.length} campaign${owned.length === 1 ? '' : 's'}… (up to a minute)`;
    render();

    const payload = await proxyCall({
      action: 'client_week_breakdown',
      campaign_ids: owned.map(c => Number(c.id)),
      start_date: start,
      end_date: end,
    }, 'Stats pull', () => {
      a.progress = 'Smartlead rate-limit collision — retrying in 20s…';
      render();
    });
    if (stale()) return;

    const byId = {};
    for (const row of (payload.data || [])) byId[String(row.id)] = row;

    a.rows = owned.map(c => {
      const b = byId[String(c.id)] || {};
      const parsed = parseCampaignName(c.name);
      if (b.error) a.errors.push(`${c.name}: ${b.error}`);
      return {
        clientName: c.clientName,
        isRetainer: c.target.isRetainer,
        kpiTarget: c.target.target,
        kpiActual: c.target.count,
        kpiHit: c.target.hit,
        campaignId: c.id,
        campaignName: c.name,
        status: c.status,
        ...parsed,
        sent: Number(b.sent) || 0,
        firstTouch: Number(b.first_touch_sent) || 0,
        followUp: Number(b.follow_up_sent) || 0,
        replies: Number(b.replies) || 0,
        positives: Number(b.positives) || 0,
        bounces: Number(b.bounces) || 0,
        daily: b.daily || [],
        sendingDays: Number(b.sending_days) || 0,
        daysInRange: Number(b.days_in_range) || 7,
        categories: b.categories || {},
        truncated: !!b.truncated,
        error: b.error || '',
      };
    }).sort((x, y) =>
      x.clientName.localeCompare(y.clientName) || y.sent - x.sent || x.campaignName.localeCompare(y.campaignName)
    );

    a.step = 'done';
    a.progress = '';
    a.pulledAt = new Date().toISOString();
    a.hydratedKey = runKey(week, a.scope);
    saveRun(week, a.scope, a.rows, a.errors);
  } catch (e) {
    if (stale()) return;
    a.step = 'idle';
    showToast('Analysis failed: ' + e.message, 'error');
  }
  render();
}

// ─── Copy viewer ─────────────────────────────────────────────
export async function loadCopy(campaignId, campaignName) {
  const a = getA();
  a.copy = { campaignId, campaignName, loading: true, sequences: null, error: '' };
  render();
  try {
    const payload = await proxyCall({ action: 'get_sequences', campaign_id: Number(campaignId) }, 'Copy fetch');
    const seqs = payload.data?.data ?? payload.data ?? [];
    if (!a.copy || a.copy.campaignId !== campaignId) return; // user moved on
    a.copy.sequences = Array.isArray(seqs) ? seqs : [];
    a.copy.loading = false;
  } catch (e) {
    if (!a.copy || a.copy.campaignId !== campaignId) return;
    a.copy.loading = false;
    a.copy.error = str(e.message);
  }
  render();
}

// Smartlead stores bodies as HTML. Show them as readable plain text.
function htmlToText(html) {
  return str(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderCopyModal() {
  const a = getA();
  const c = a.copy;
  if (!c) return '';
  let body;
  if (c.loading) {
    body = `<div style="padding:40px;text-align:center;color:var(--text-muted);font-size:13px">Loading copy from Smartlead…</div>`;
  } else if (c.error) {
    body = `<div style="padding:24px;color:#dc2626;font-size:13px">${esc(c.error)}</div>`;
  } else if (!c.sequences || !c.sequences.length) {
    body = `<div style="padding:24px;color:var(--text-muted);font-size:13px">This campaign has no sequence steps.</div>`;
  } else {
    body = c.sequences.map(seq => {
      const variants = (seq.sequence_variants || []).filter(v => !v.is_deleted);
      const steps = variants.length
        ? variants.map(v => ({ label: `Variant ${str(v.variant_label) || '?'}`, subject: v.subject, body: v.email_body, pct: v.variant_distribution_percentage }))
        : [{ label: 'Single copy', subject: seq.subject, body: seq.email_body, pct: null }];
      return `<div style="margin-bottom:18px">
        <div style="font-size:12px;font-weight:800;color:var(--purple);margin-bottom:6px">Step ${esc(str(seq.seq_number))}${seq.seq_delay_details?.delay_in_days ? ` · +${esc(str(seq.seq_delay_details.delay_in_days))} day wait` : ''}</div>
        ${steps.map(s => `<div style="border:1px solid var(--border);border-radius:8px;margin-bottom:8px;overflow:hidden">
          <div style="background:#f9fafb;padding:6px 10px;font-size:11px;font-weight:700;display:flex;justify-content:space-between;gap:8px">
            <span>${esc(s.label)}${s.pct != null ? ` · ${esc(str(s.pct))}% of sends` : ''}</span>
          </div>
          <div style="padding:8px 10px;font-size:12px;border-bottom:1px dashed var(--border)"><b>Subject:</b> ${esc(str(s.subject) || '(follow-up in thread — no subject)')}</div>
          <pre style="padding:10px;margin:0;font-size:12px;font-family:var(--font);white-space:pre-wrap;line-height:1.5">${esc(htmlToText(s.body))}</pre>
        </div>`).join('')}
      </div>`;
    }).join('');
  }
  return `<div class="modal-overlay" onclick="analysisCloseCopy()">
    <div class="modal" style="width:760px;max-height:84vh" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3 style="font-size:14px">Copy — ${esc(c.campaignName)}</h3>
        <button class="modal-close" onclick="analysisCloseCopy()">×</button>
      </div>
      <div class="modal-body" style="max-height:70vh;overflow-y:auto">
        <div style="margin-bottom:12px"><a href="${SMARTLEAD_CAMPAIGN_URL(c.campaignId)}" target="_blank" rel="noopener" style="font-size:11px;color:var(--purple);font-weight:600">Open this campaign in Smartlead ↗</a></div>
        ${body}
      </div>
    </div>
  </div>`;
}

// ─── Grid ────────────────────────────────────────────────────
const pct = (n, d) => (d > 0 ? (n / d * 100) : 0);
const fmtPct = (n, d, digits = 2) => (d > 0 ? `${(n / d * 100).toFixed(digits)}%` : '—');

function dayStrip(row) {
  const daily = (row && Array.isArray(row.daily)) ? row.daily : [];
  if (!daily.length) return '';
  const max = Math.max(...daily.map(d => d.sent), 1);
  return `<span style="display:inline-flex;gap:2px;margin-left:6px;vertical-align:middle">${daily.map(d => {
    const h = d.sent > 0 ? Math.max(4, Math.round(d.sent / max * 14)) : 2;
    const bg = d.sent > 0 ? '#6366f1' : '#e5e7eb';
    return `<span title="${esc(d.date)}: ${d.sent} sent, ${d.replies} replies, ${d.bounces} bounced" style="display:inline-block;width:5px;height:${h}px;background:${bg};border-radius:1px"></span>`;
  }).join('')}</span>`;
}

function categoryChips(categories) {
  const entries = Object.entries(categories || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '<span style="color:var(--text-muted)">—</span>';
  return entries.map(([cat, n]) => {
    const good = POSITIVE_CATEGORIES.has(cat);
    return `<span style="display:inline-block;background:${good ? '#dcfce7' : '#f3f4f6'};color:${good ? '#166534' : '#4b5563'};font-size:10px;font-weight:600;padding:1px 6px;border-radius:999px;margin:1px 2px 1px 0;white-space:nowrap">${esc(cat)} ${n}</span>`;
  }).join('');
}

const TH = 'padding:6px 8px;font-size:10px;font-weight:700;color:#495057;background:#e9ecef;border:1px solid #d0d5dd;white-space:nowrap;position:sticky;top:0;z-index:2';
const TD = 'padding:4px 8px;font-size:12px;border:1px solid #e2e5e9;white-space:nowrap';

export function renderAnalysis() {
  const a = getA();
  const week = selectedWeek();
  hydrate(a, week); // restore a previous run for this week/scope, if there is one
  const { start, end } = weekBounds(week);
  const thisWeek = currentWeekKey();
  const weeks = [];
  for (let i = 0; i < 12; i++) weeks.push(shiftWeeks(thisWeek, -i));
  if (!weeks.includes(week)) weeks.unshift(week);

  const kpi = getWeeklyKpiStatus(week);
  const missed = [...kpi.ppm, ...kpi.retainer].filter(r => !r.hit);

  let h = `<div class="tracker-container">`;

  // ── Header ──
  h += `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:0 0 10px">
    <div>
      <div style="font-size:15px;font-weight:800">Analysis — why the KPI was missed</div>
      <div style="font-size:11.5px;color:var(--text-muted);margin-top:3px;max-width:760px">
        Every campaign belonging to a client who fell short this week, with the week's sending diagnostics side by side.
        The bar is ≥ ${RETAINER_WEEKLY_TARGET} positive replies per week for retainer clients, ≥ ${PPM_WEEKLY_TARGET} booked meeting per week for pay-per-meeting.
        Sent / replies / positives come from the same Smartlead endpoint as the Weekly Updates tab.
        Bounce rate is bounces ÷ emails sent in the week; reply categories cover replies to those sends.
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
      <select onchange="analysisSetWeek(this.value)" style="padding:5px 10px;border:1px solid var(--border);border-radius:6px;font-size:11px;font-family:var(--font);background:#fff;cursor:pointer">
        ${weeks.map(w => `<option value="${w}" ${w === week ? 'selected' : ''}>${weekLabel(w)}${w === thisWeek ? ' (this week)' : ''}</option>`).join('')}
      </select>
      <select onchange="analysisSetScope(this.value)" style="padding:5px 10px;border:1px solid var(--border);border-radius:6px;font-size:11px;font-family:var(--font);background:#fff;cursor:pointer">
        <option value="missed" ${a.scope === 'missed' ? 'selected' : ''}>Clients below KPI (${missed.length})</option>
        <option value="all" ${a.scope === 'all' ? 'selected' : ''}>All active clients (${kpi.ppm.length + kpi.retainer.length})</option>
      </select>
      <button class="btn btn-primary" style="font-size:11px;padding:5px 14px" onclick="analysisRun()" ${a.step === 'loading' ? 'disabled' : ''}>${a.step === 'loading' ? 'Pulling…' : a.rows.length ? 'Refresh' : 'Run analysis'}</button>
      ${a.rows.length ? `<button class="btn btn-ghost" style="font-size:11px;padding:5px 12px" onclick="analysisExportCsv()" title="Exports every matched campaign, including ones that sent nothing">Export CSV (${a.rows.length})</button>` : ''}
    </div>
  </div>`;

  if (a.step === 'loading') {
    h += `<div style="padding:50px;text-align:center;color:var(--text-muted)">
      <div class="loading-spinner"></div>
      <div style="margin-top:12px;font-size:12.5px">${esc(a.progress || 'Working…')}</div>
    </div></div>`;
    return h;
  }

  if (a.step === 'idle') {
    h += `<div style="padding:40px;text-align:center;color:var(--text-muted);font-size:13px">
      ${missed.length
        ? `<div style="font-size:14px;color:var(--text);font-weight:600;margin-bottom:6px">${missed.length} client${missed.length === 1 ? '' : 's'} below target for ${esc(weekLabel(week))}</div>
           <div style="margin-bottom:14px">${missed.map(m => esc(m.name) + ` (${m.count}/${m.target})`).join(' · ')}</div>`
        : `<div style="margin-bottom:14px">Every client hit their target for ${esc(weekLabel(week))}. Switch to "All active clients" to analyse anyway.</div>`}
      <button class="btn btn-primary" style="font-size:12px;padding:7px 18px" onclick="analysisRun()">Run analysis</button>
      <div style="font-size:11px;margin-top:10px">Pulls live Smartlead stats for the matching campaigns — usually 10–60 seconds.</div>
    </div></div>`;
    return h;
  }

  // ── Results ──
  if (a.errors.length) {
    h += `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px 12px;margin-bottom:8px;font-size:11px;color:#991b1b">
      ${a.errors.map(e => esc(e)).join('<br>')}
    </div>`;
  }

  if (!a.rows.length) {
    h += `<div style="padding:40px;text-align:center;color:var(--text-muted);font-size:13px">Nothing to analyse for ${esc(weekLabel(week))}.</div></div>`;
    return h;
  }

  const rows = visibleRows(a);
  const hidden = a.rows.length - rows.length;
  const clientCount = new Set(rows.map(r => r.clientName)).size;

  h += `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--text-muted);padding:0 0 6px">
    <span>${rows.length} campaign${rows.length === 1 ? '' : 's'} across ${clientCount} client${clientCount === 1 ? '' : 's'} · week of ${esc(weekLabel(week))} (${esc(start)} → ${esc(end)}, America/New_York)</span>
    ${a.pulledAt ? `<span style="background:#f3f4f6;padding:1px 8px;border-radius:999px;font-weight:600" title="Saved in this browser — reopening the tab restores it instead of re-pulling. Hit Refresh for live numbers.">Pulled ${esc(agoLabel(a.pulledAt))}</span>` : ''}
    ${hidden ? `<button class="btn btn-ghost" style="font-size:10px;padding:2px 8px" onclick="analysisToggleDormant()">Show ${hidden} campaign${hidden === 1 ? '' : 's'} that sent nothing</button>`
      : a.showDormant ? `<button class="btn btn-ghost" style="font-size:10px;padding:2px 8px" onclick="analysisToggleDormant()">Hide campaigns that sent nothing</button>` : ''}
  </div>`;

  h += `<div class="tracker-table-wrap"><table class="tracker-table" style="min-width:2060px">
    <thead><tr>
      <th style="${TH}">Client</th>
      <th style="${TH}">Type</th>
      <th style="${TH}">KPI</th>
      <th style="${TH}">Campaign</th>
      <th style="${TH}">Status</th>
      <th style="${TH}">Industry</th>
      <th style="${TH}">Data source</th>
      <th style="${TH}">DM type</th>
      <th style="${TH};text-align:right">Emails sent</th>
      <th style="${TH};text-align:right" title="Sequence step 1 — the first email to a lead">New leads</th>
      <th style="${TH};text-align:right" title="Sequence steps 2+ — follow-ups to leads already emailed">Follow-ups</th>
      <th style="${TH}">Days sending</th>
      <th style="${TH};text-align:right">Total replies</th>
      <th style="${TH};text-align:right">Reply rate</th>
      <th style="${TH};text-align:right">Positive replies</th>
      <th style="${TH};text-align:right">Positive / send</th>
      <th style="${TH};text-align:right">Bounces</th>
      <th style="${TH};text-align:right">Bounce rate</th>
      <th style="${TH}">Reply categories</th>
      <th style="${TH}">Copy</th>
    </tr></thead><tbody>`;

  let prevClient = null;
  for (const r of rows) {
    const newClient = r.clientName !== prevClient;
    if (newClient) {
      // Subtotals span EVERY campaign for the client, including any hidden
      // dormant ones, so the client-level numbers don't shift with the toggle.
      const clientRows = a.rows.filter(x => x.clientName === r.clientName);
      const t = {
        sent: clientRows.reduce((s, x) => s + x.sent, 0),
        firstTouch: clientRows.reduce((s, x) => s + (x.firstTouch || 0), 0),
        followUp: clientRows.reduce((s, x) => s + (x.followUp || 0), 0),
        replies: clientRows.reduce((s, x) => s + x.replies, 0),
        positives: clientRows.reduce((s, x) => s + x.positives, 0),
        bounces: clientRows.reduce((s, x) => s + x.bounces, 0),
      };
      const days = new Set();
      clientRows.forEach(x => (x.daily || []).forEach(d => { if (d && d.sent > 0) days.add(d.date); }));
      const client = state.clients.find(c => c.name === r.clientName);
      h += `<tr style="background:#f5f3ff">
        <td style="${TD};font-weight:800" colspan="8">
          ${client ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${client.color || '#818cf8'};margin-right:6px"></span>` : ''}${esc(r.clientName)}
          <span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:999px;margin-left:6px;background:${r.isRetainer ? '#ede9fe' : '#dbeafe'};color:${r.isRetainer ? '#6d28d9' : '#1d4ed8'}">${r.isRetainer ? 'RETAINER' : 'PPM'}</span>
          <span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:999px;margin-left:4px;background:${r.kpiHit ? '#dcfce7' : '#fee2e2'};color:${r.kpiHit ? '#166534' : '#991b1b'}">${r.kpiActual}/${r.kpiTarget} ${r.isRetainer ? 'positive replies' : 'booked meetings'}</span>
          <span style="font-size:11px;color:var(--text-muted);margin-left:8px">${clientRows.length} campaign${clientRows.length === 1 ? '' : 's'}</span>
        </td>
        <td style="${TD};text-align:right;font-weight:800">${t.sent.toLocaleString()}</td>
        <td style="${TD};text-align:right;font-weight:700">${t.firstTouch.toLocaleString()}<span style="color:var(--text-muted);font-weight:400;font-size:10px"> ${fmtPct(t.firstTouch, t.sent, 0)}</span></td>
        <td style="${TD};text-align:right;font-weight:700">${t.followUp.toLocaleString()}<span style="color:var(--text-muted);font-weight:400;font-size:10px"> ${fmtPct(t.followUp, t.sent, 0)}</span></td>
        <td style="${TD};font-weight:700">${days.size}/${r.daysInRange} days</td>
        <td style="${TD};text-align:right;font-weight:800">${t.replies}</td>
        <td style="${TD};text-align:right;font-weight:700">${fmtPct(t.replies, t.sent)}</td>
        <td style="${TD};text-align:right;font-weight:800">${t.positives}</td>
        <td style="${TD};text-align:right;font-weight:800;color:${pct(t.positives, t.sent) < 0.5 ? '#b91c1c' : '#166534'}">${fmtPct(t.positives, t.sent)}</td>
        <td style="${TD};text-align:right;font-weight:700">${t.bounces}</td>
        <td style="${TD};text-align:right;font-weight:800;color:${pct(t.bounces, t.sent) >= 5 ? '#b91c1c' : pct(t.bounces, t.sent) >= 3 ? '#b45309' : '#166534'}">${fmtPct(t.bounces, t.sent)}</td>
        <td style="${TD}" colspan="2"></td>
      </tr>`;
      prevClient = r.clientName;
    }

    const posRate = pct(r.positives, r.sent);
    const bounceRate = pct(r.bounces, r.sent);
    h += `<tr>
      <td style="${TD};color:var(--text-muted)">${esc(r.clientName)}</td>
      <td style="${TD};color:var(--text-muted)">${r.isRetainer ? 'Retainer' : 'PPM'}</td>
      <td style="${TD};color:var(--text-muted)">${r.kpiActual}/${r.kpiTarget}</td>
      <td style="${TD};max-width:340px;overflow:hidden;text-overflow:ellipsis">
        <a href="${SMARTLEAD_CAMPAIGN_URL(r.campaignId)}" target="_blank" rel="noopener" title="${esc(r.campaignName)} — open in Smartlead" style="color:var(--purple);text-decoration:none;font-weight:600">${esc(r.campaignName)}</a>
      </td>
      <td style="${TD};font-size:10px;color:var(--text-muted)">${esc(str(r.status))}</td>
      <td style="${TD};max-width:220px;overflow:hidden;text-overflow:ellipsis" title="${esc(r.industry)}">${esc(r.industry)}</td>
      <td style="${TD}">${esc(r.dataSource)}</td>
      <td style="${TD};font-size:11px;color:var(--text-muted)">${esc(r.dmType)}</td>
      <td style="${TD};text-align:right;font-weight:600">${r.sent.toLocaleString()}</td>
      <td style="${TD};text-align:right">${(r.firstTouch || 0).toLocaleString()}<span style="color:var(--text-muted);font-size:10px"> ${fmtPct(r.firstTouch || 0, r.sent, 0)}</span></td>
      <td style="${TD};text-align:right">${(r.followUp || 0).toLocaleString()}<span style="color:var(--text-muted);font-size:10px"> ${fmtPct(r.followUp || 0, r.sent, 0)}</span></td>
      <td style="${TD};color:${r.sendingDays === 0 ? '#b91c1c' : r.sendingDays <= 2 ? '#b45309' : 'inherit'};font-weight:${r.sendingDays <= 2 ? '700' : '400'}">${r.sendingDays}/${r.daysInRange}${dayStrip(r)}</td>
      <td style="${TD};text-align:right">${r.replies}</td>
      <td style="${TD};text-align:right;color:var(--text-muted)">${fmtPct(r.replies, r.sent)}</td>
      <td style="${TD};text-align:right;font-weight:600;color:${r.positives ? '#166534' : '#b91c1c'}">${r.positives}</td>
      <td style="${TD};text-align:right;font-weight:700;color:${r.sent === 0 ? 'var(--text-muted)' : posRate < 0.5 ? '#b91c1c' : '#166534'}">${fmtPct(r.positives, r.sent)}</td>
      <td style="${TD};text-align:right">${r.bounces}</td>
      <td style="${TD};text-align:right;font-weight:700;color:${r.sent === 0 ? 'var(--text-muted)' : bounceRate >= 5 ? '#b91c1c' : bounceRate >= 3 ? '#b45309' : '#166534'}">${fmtPct(r.bounces, r.sent)}</td>
      <td style="${TD};white-space:normal;max-width:280px">${categoryChips(r.categories)}</td>
      <td style="${TD}"><button class="tracker-action-btn" onclick="analysisShowCopy('${esc(str(r.campaignId))}','${esc(r.campaignName).replace(/'/g, "\\'")}')">View copy</button></td>
    </tr>`;
  }

  h += `</tbody></table></div>`;
  h += renderCopyModal();
  h += `</div>`;
  return h;
}

// ─── CSV export ──────────────────────────────────────────────
const CSV_HEADERS = ['Client', 'Type', 'KPI actual', 'KPI target', 'Campaign', 'Smartlead URL', 'Status',
  'Industry', 'Data source', 'DM type', 'Emails sent', 'New leads (step 1)', 'Follow-ups (step 2+)',
  'New lead %', 'Days sending', 'Days in week', 'Per-day sends',
  'Total replies', 'Reply rate %', 'Positive replies', 'Positive per send %', 'Bounces', 'Bounce rate %',
  'Reply categories'];

export function buildCsv(rows) {
  const cell = v => {
    const s = str(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [CSV_HEADERS.join(',')];
  for (const r of rows) {
    lines.push([
      r.clientName,
      r.isRetainer ? 'Retainer' : 'PPM',
      r.kpiActual, r.kpiTarget,
      r.campaignName,
      SMARTLEAD_CAMPAIGN_URL(r.campaignId),
      r.status,
      r.industry, r.dataSource, r.dmType,
      r.sent,
      r.firstTouch || 0,
      r.followUp || 0,
      r.sent ? ((r.firstTouch || 0) / r.sent * 100).toFixed(1) : '',
      r.sendingDays, r.daysInRange,
      r.daily.map(d => `${d.date}:${d.sent}`).join(' '),
      r.replies,
      r.sent ? (r.replies / r.sent * 100).toFixed(2) : '',
      r.positives,
      r.sent ? (r.positives / r.sent * 100).toFixed(2) : '',
      r.bounces,
      r.sent ? (r.bounces / r.sent * 100).toFixed(2) : '',
      Object.entries(r.categories).map(([k, v]) => `${k}: ${v}`).join('; '),
    ].map(cell).join(','));
  }
  return lines.join('\n');
}

// ─── Window handlers ─────────────────────────────────────────
window.analysisRun = () => runAnalysis();
// Switching week or scope re-hydrates from the cache for that key, so flipping
// between two already-analysed weeks is instant instead of two fresh pulls.
window.analysisSetWeek = (w) => { const a = getA(); a.week = w; a.hydratedKey = null; render(); };
window.analysisSetScope = (s) => { const a = getA(); a.scope = s; a.hydratedKey = null; render(); };
// Escape hatch behind the in-tab error panel: bin every cached run and the
// in-memory state so a bad payload can't keep breaking the tab on every visit.
window.analysisReset = () => {
  try { localStorage.removeItem(RUNS_KEY); } catch (e) { /* nothing to clear */ }
  state.analysis = null;
  render();
};
window.analysisToggleDormant = () => { const a = getA(); a.showDormant = !a.showDormant; render(); };
window.analysisShowCopy = (id, name) => loadCopy(id, name);
window.analysisCloseCopy = () => { getA().copy = null; render(); };
window.analysisExportCsv = () => {
  const a = getA();
  if (!a.rows.length) return;
  const csv = buildCsv(a.rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `client-analysis-${selectedWeek()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
