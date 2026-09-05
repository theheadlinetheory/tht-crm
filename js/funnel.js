// ═══════════════════════════════════════════════════════════
// FUNNEL — the six sales-pipeline levels, live
// ═══════════════════════════════════════════════════════════
//
// One page for the whole acquisition funnel: emails sent through to retained
// clients. Reads `pipeline_latest` in this CRM's own database, which joins the
// six level definitions to the most recent figure recorded for each.
//
// Every level is rendered, including the ones with no tracking yet. A row that
// says "not tracked" is information; a level silently missing from the page
// just looks like a bug, and this project has already lost weeks to numbers
// that looked finished and were not.
//
// Two things travel with every figure and must not be dropped:
//   source  'verified' means a hand-audited number that must NOT be recomputed
//           from thinner evidence — level 03's 61 discos were settled by
//           reading 364 call recordings, and a live count cannot reproduce it.
//   detail  the scope and caveats, stored beside the number rather than in a
//           doc, so a rate can never be read without the conditions on it.

import { esc, svgIcon } from './utils.js?v=20260904170905';
import { supabase } from './supabase-client.js?v=20260904170905';

let _levels = null;      // null = not loaded, [] = loaded and empty
const _open = new Set(); // levels whose Details section is expanded (survives re-renders)
let _loading = false;
let _error = null;

export function loadFunnel(rerender) {
  if (_levels !== null || _loading) return;
  _loading = true;
  supabase.from('pipeline_latest').select('*')
    .then(({ data, error }) => {
      _loading = false;
      if (error) { _error = error.message; _levels = []; }
      else { _levels = data || []; }
      if (rerender) rerender();
    });
}

/** Force a refetch — used by the Refresh button. */
export function reloadFunnel(rerender) {
  _levels = null; _error = null;
  loadFunnel(rerender);
}

const STATUS_STYLE = {
  live:          { bg: '#dcfce7', fg: '#166534', label: 'Live' },
  partial:       { bg: '#fef3c7', fg: '#92400e', label: 'Partial' },
  'not tracked': { bg: '#f3f4f6', fg: '#6b7280', label: 'Not tracked' },
};

function fmtRate(r) {
  if (r === null || r === undefined) return '—';
  const n = Number(r);
  // Level 01 lives below 1% (0.41% is a good day); one decimal would print
  // 0.4% for every value it will ever show.
  return `${n.toFixed(n < 1 ? 2 : 1)}%`;
}

const fmtCount = (n) => (n === null || n === undefined) ? '—' : Number(n).toLocaleString('en-US');

function ago(iso) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 48) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

/** Where a level's number comes from, and whether each feed is actually
 *  flowing. A source that quietly stopped is the failure this project exists to
 *  prevent — the Calendly refresh claimed "auto, every 30 min" in a level file
 *  and had never run once. */
function sourcesTable(sources) {
  if (!sources || !sources.length) return '';
  let h = `<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px">
    <div style="font-size:11px;font-weight:700;color:#6b7280;margin-bottom:6px">WHERE THIS NUMBER COMES FROM</div>`;
  sources.forEach(s => {
    const ok = s.live;
    const dot = ok ? '#059669' : '#f59e0b';
    h += `<div style="display:flex;gap:8px;align-items:flex-start;padding:5px 0">
      <span style="width:7px;height:7px;border-radius:50%;background:${dot};flex-shrink:0;margin-top:5px"></span>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap">
          <span style="font-size:12px;font-weight:600;color:#1f2937">${esc(s.name)}</span>
          <span style="font-size:10px;color:#9ca3af">${esc(s.feeds)}</span>
          ${s.contributes !== undefined ? `<span style="font-size:11px;color:#374151;font-variant-numeric:tabular-nums">+${s.contributes}</span>` : ''}
          ${s.awaiting ? `<span style="font-size:10px;font-weight:700;color:#92400e;background:#fef3c7;padding:1px 6px;border-radius:4px">${s.awaiting} awaiting</span>` : ''}
          ${s.last_activity ? `<span style="font-size:10px;color:#9ca3af">last ${esc(ago(s.last_activity))}</span>` : ''}
        </div>
        <div style="font-size:11px;color:#9ca3af;line-height:1.4">${esc(s.how || '')}</div>
      </div>
    </div>`;
  });
  h += `</div>`;
  return h;
}

function levelCard(l) {
  const st = STATUS_STYLE[l.status] || STATUS_STYLE['not tracked'];
  const hasNumbers = l.numerator !== null && l.denominator !== null;
  const verified = l.source === 'verified';

  let h = `<div style="border:1px solid var(--border);border-radius:10px;padding:14px 16px;background:var(--card);display:flex;gap:16px;align-items:flex-start">`;

  // Level number
  h += `<div style="flex-shrink:0;width:34px;height:34px;border-radius:8px;background:#1e1b4b;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px">${esc(l.level)}</div>`;

  h += `<div style="flex:1;min-width:0">`;
  h += `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:14px;font-weight:700;color:#1e1b4b">${esc(l.label)}</span>
          <span style="padding:1px 7px;border-radius:4px;font-size:10px;font-weight:700;background:${st.bg};color:${st.fg}">${st.label}</span>
        </div>`;
  if (l.enters) {
    h += `<div style="font-size:11px;color:#9ca3af;margin-top:2px">Enters when ${esc(l.enters)} · exits when ${esc(l.exits || '')}</div>`;
  }

  if (hasNumbers) {
    // A level can carry more than one metric on the same numerator — level 01
    // reports positives per email sent AND per unique lead contacted. The
    // tracker puts them in detail.metrics; the top-level figure is the first.
    const metrics = (l.detail && Array.isArray(l.detail.metrics) && l.detail.metrics.length)
      ? l.detail.metrics
      : [{ label: '', numerator: l.numerator, denominator: l.denominator, rate: l.rate }];
    metrics.forEach((m, i) => {
      h += `<div style="margin-top:${i ? 4 : 10}px;display:flex;align-items:baseline;gap:10px">
              <span style="font-size:24px;font-weight:800;color:#1e1b4b;font-variant-numeric:tabular-nums">${fmtRate(m.rate)}</span>
              <span style="font-size:12px;color:#6b7280;font-variant-numeric:tabular-nums">${fmtCount(m.numerator)} of ${fmtCount(m.denominator)}${m.label ? ` · ${esc(m.label)}` : ''}</span>
              ${(!i && verified) ? `<span style="font-size:10px;font-weight:700;color:#166534;background:#dcfce7;padding:1px 6px;border-radius:4px">verified baseline</span>` : ''}
            </div>`;
    });
    if (l.snapshot_date) {
      h += `<div style="font-size:10px;color:#9ca3af;margin-top:2px">as of ${esc(String(l.snapshot_date))}</div>`;
    }
    const d = l.detail || {};
    // One short line stays with the number: the window and the counting rule.
    if (d.note) h += `<div style="font-size:11px;color:#6b7280;margin-top:4px">${esc(String(d.note))}</div>`;
    // Rep removals are the most common reason a level shrinks and a signal in
    // their own right (a high desk-DQ share = list targeting), so they get their
    // own always-visible block with one tile per reason (Lars, 2026-09-04).
    if (d.removals && d.removals.items && d.removals.items.length) h += removalsBlock(d.removals);
    // Everything that explains the number — what came in, what we removed and
    // why, what is left, where the rest went, and which feed each part comes
    // from — sits behind one toggle (Lars, 2026-09-04: "the main number like it
    // is now and then a drop down with the details").
    const hasDetails = (d.breakdown && d.breakdown.length) || d.denominator_caveat || (d.sources && d.sources.length);
    if (hasDetails) {
      const open = _open.has(l.level);
      h += `<button id="funnel-toggle-${esc(l.level)}" onclick="toggleFunnelDetails('${esc(l.level)}')" style="margin-top:8px;padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:var(--card);font-size:11px;font-weight:600;color:#374151;cursor:pointer">${open ? '▾' : '▸'} Details</button>`;
      h += `<div id="funnel-details-${esc(l.level)}" ${open ? '' : 'hidden'}>`;
      if (d.breakdown && d.breakdown.length) h += breakdownTable(d.breakdown);
      if (d.denominator_caveat) {
        const warn = !/^complete/i.test(String(d.denominator_caveat));
        h += `<div style="margin-top:10px;font-size:11px;${warn ? 'color:#92400e;background:#fffbeb;border:1px solid #fde68a;' : 'color:#6b7280;background:#f9fafb;border:1px solid var(--border);'}border-radius:6px;padding:6px 8px">${esc(String(d.denominator_caveat))}</div>`;
      }
      if (d.sources && d.sources.length) h += sourcesTable(d.sources);
      h += `</div>`;
    }
  } else {
    h += `<div style="margin-top:10px;font-size:12px;color:#9ca3af">No tracking yet — this level is still measured by hand.</div>`;
  }
  h += `</div></div>`;
  return h;
}

/** What the reps removed from a level, per reason, shown big. Not losses —
 *  a lead we removed leaves the level — but the share is a targeting signal. */
function removalsBlock(r) {
  const share = r.of ? ` · ${Math.round((r.total / r.of) * 100)}% of ${fmtCount(r.of)} ${esc(r.of_label || '')}` : '';
  // Deliberately quieter than the rate above it (Lars, 2026-09-04): neutral
  // ground, small tiles, muted text — supporting data, not the headline.
  let h = `<div style="margin-top:10px;padding:8px 10px;border:1px solid var(--border);background:#f9fafb;border-radius:8px">
    <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
      <span style="font-size:10px;font-weight:700;color:#6b7280;letter-spacing:.03em">REMOVED BY REPS</span>
      <span style="font-size:11px;color:#6b7280;font-variant-numeric:tabular-nums">${fmtCount(r.total)}${share} · not losses</span>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">`;
  r.items.forEach(it => {
    h += `<div style="min-width:110px;padding:5px 10px;background:var(--card);border:1px solid var(--border);border-radius:6px">
      <div style="font-size:15px;font-weight:700;color:#92400e;font-variant-numeric:tabular-nums;line-height:1.1">${fmtCount(it.value)}</div>
      <div style="font-size:10px;color:#6b7280;margin-top:2px;line-height:1.3">${esc(String(it.label))}</div>
    </div>`;
  });
  h += `</div>`;
  if (r.note) h += `<div style="font-size:10px;color:#9ca3af;margin-top:6px;line-height:1.4">${esc(String(r.note))}</div>`;
  return h + `</div>`;
}

/** The arithmetic behind a level, as rows the tracker emits:
 *  { label, value, indent (0–2), style: 'total' | 'out' | 'loss' | 'muted' }.
 *  'out' is something WE removed from the level (shown with a minus);
 *  'loss' is something that stayed in and did not convert. */
function breakdownTable(rows) {
  let h = `<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px">
    <div style="font-size:11px;font-weight:700;color:#6b7280;margin-bottom:6px">HOW THE NUMBER BREAKS DOWN</div>
    <table style="border-collapse:collapse;width:100%;max-width:560px;font-size:12px">`;
  rows.forEach(r => {
    const indent = 8 + 18 * (r.indent || 0);
    const style = r.style || '';
    const color = style === 'out' ? '#b45309' : style === 'loss' ? '#b91c1c' : style === 'muted' ? '#9ca3af' : '#1f2937';
    const weight = style === 'total' ? 700 : (r.indent ? 400 : 600);
    const border = style === 'total' ? 'border-top:1px solid var(--border);' : '';
    const val = style === 'out' ? `−${fmtCount(r.value)}` : fmtCount(r.value);
    h += `<tr><td style="padding:3px 8px 3px ${indent}px;color:${color};font-weight:${weight};${border}">${esc(String(r.label))}</td>
          <td style="padding:3px 8px;text-align:right;font-variant-numeric:tabular-nums;color:${color};font-weight:${weight};white-space:nowrap;${border}">${val}</td></tr>`;
  });
  return h + `</table></div>`;
}

window.toggleFunnelDetails = (level) => {
  if (_open.has(level)) _open.delete(level); else _open.add(level);
  const el = document.getElementById('funnel-details-' + level);
  if (el) el.hidden = !_open.has(level);
  const btn = document.getElementById('funnel-toggle-' + level);
  if (btn) btn.textContent = (_open.has(level) ? '▾' : '▸') + ' Details';
};

export function renderFunnel() {
  if (_error) {
    return `<div style="padding:24px"><div style="color:#b91c1c;font-size:13px">Could not load the funnel: ${esc(_error)}</div></div>`;
  }
  if (_levels === null) {
    return `<div style="padding:24px;color:#9ca3af;font-size:13px">Loading the funnel…</div>`;
  }

  let h = `<div style="padding:16px;max-width:900px;margin:0 auto">`;
  h += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <div>
            <div style="font-size:18px;font-weight:800;color:#1e1b4b">Sales pipeline</div>
            <div style="font-size:12px;color:#6b7280">Every level of the acquisition funnel, from emails sent to clients retained.</div>
          </div>
          <button onclick="refreshFunnel()" style="display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border:1px solid var(--border);border-radius:7px;background:var(--card);font-size:12px;cursor:pointer">${svgIcon('refresh-cw', 12)} Refresh</button>
        </div>`;
  h += `<div style="display:flex;flex-direction:column;gap:10px;margin-top:14px">`;
  h += _levels.map(levelCard).join('');
  h += `</div>`;
  h += `<div style="margin-top:16px;font-size:11px;color:#9ca3af;line-height:1.5">
          A <strong>verified baseline</strong> was settled by hand against source evidence and is never recomputed from a live count — level 03's discovery calls were established by reading the call recordings one by one, which no automated count can reproduce. Live tracking adds to that baseline rather than replacing it.
        </div>`;
  h += `</div>`;
  return h;
}

window.refreshFunnel = () => {
  import('./render.js?v=20260904170905').then(m => reloadFunnel(m.render));
};
