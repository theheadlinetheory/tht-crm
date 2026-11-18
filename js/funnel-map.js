// ═══════════════════════════════════════════════════════════
// FUNNEL MAP — every funnel statistic on one picture (Aidan, 2026-11-17)
// ═══════════════════════════════════════════════════════════
//
// The Funnel tab's "Map" view: the seven levels left to right, and under each
// one every statistic it tracks: the live all-time figure, where it is
// captured, when it happens and who owns it. It also lists what we do NOT
// track yet, so each gap has an owner too.
//
// Rows live in `funnel_metric_map` (staff read, admins write). A tracked row
// carries the `key` of a metric on that level's pipeline_latest card, and its
// figure is read from there. A live metric with no row yet still shows,
// marked "where / when not filled in", so a new metric never goes missing.

import { esc } from './utils.js?v=20261119020523';
import { supabase } from './supabase-client.js?v=20261119020523';
import { isAdmin } from './auth.js?v=20261119020523';
import { showToast } from './api.js?v=20261119020523';

const STAGES = { '01': 'Outreach → positive reply', '02': 'Positive → disco booked', '03': 'Disco held', '04': 'Demo booked', '05': 'Demo held', '06': 'Closed', '07': 'Retained' };
const UNITS = { median_minutes_to_first_call: ' min' };
const NONE = '__none';

let _rows = null;        // null = not loaded
let _people = [];        // owner choices: staff names (SDR logins excluded)
let _loading = false;
let _error = null;
let _ownerFilter = '';   // '' = everyone, NONE = unassigned, else a name
let _adding = null;      // the level whose "add a gap" form is open
let _levels = [];        // the cards last rendered, for an owner set on a metric with no row yet

const rerender = () => import('./render.js?v=20261119020523').then(m => m.render());
const fmt = (n) => (n === null || n === undefined) ? '—' : Number(n).toLocaleString('en-US');

async function load() {
  _loading = true;
  const [m, p] = await Promise.all([
    supabase.from('funnel_metric_map').select('*').order('level').order('sort'),
    supabase.from('profiles').select('name, role').neq('role', 'sdr').order('created_at'),
  ]);
  _loading = false;
  if (m.error) _error = m.error.message; else { _rows = m.data || []; _error = null; }
  _people = (p.data || []).map(x => x.name).filter(Boolean);
  rerender();
}

function liveMetrics(levels, level) {
  const l = (levels || []).find(x => x.level === level);
  return (l && l.detail && l.detail.metrics) || [];
}

/** The level's map rows, plus any live metric nobody has described yet. */
function rowsFor(levels, level) {
  const mine = _rows.filter(r => r.level === level);
  const orphans = liveMetrics(levels, level).filter(m => m.key && !mine.some(r => r.metric_key === m.key))
    .map(m => ({ id: null, level, metric_key: m.key, label: m.label, source: '', happens: '', owner: null }));
  return [...mine.filter(r => r.metric_key), ...orphans, ...mine.filter(r => !r.metric_key)];
}

function liveValue(levels, r) {
  const m = liveMetrics(levels, r.level).find(x => x.key === r.metric_key);
  if (!m) return null;
  if (m.count_only) return { big: fmt(m.numerator) + (UNITS[r.metric_key] || ''), small: '' };
  return { big: m.rate === null || m.rate === undefined ? '—' : `${Number(m.rate).toFixed(m.rate < 1 ? 2 : 1)}%`, small: `${fmt(m.numerator)} / ${fmt(m.denominator)}` };
}

const matchesFilter = (r) => !_ownerFilter || (_ownerFilter === NONE ? !r.owner : r.owner === _ownerFilter);
const line = (k, v) => `<div style="font-size:11px;color:#6b7280;margin-top:4px;line-height:1.35"><strong style="color:#374151">${k}:</strong> ${v ? esc(v) : '<em>not filled in</em>'}</div>`;
const rowRef = (r) => r.id ? String(r.id) : `${r.level}|${r.metric_key}`;

function ownerControl(r) {
  const unassigned = !r.owner;
  if (!isAdmin()) return `<span style="font-size:11px;font-weight:600;color:${unassigned ? '#b45309' : '#1e1b4b'}">👤 ${unassigned ? 'Unassigned' : esc(r.owner)}</span>`;
  const names = r.owner && !_people.includes(r.owner) ? [..._people, r.owner] : _people;
  const opts = [`<option value="">Unassigned</option>`, ...names.map(n => `<option value="${esc(n)}" ${n === r.owner ? 'selected' : ''}>${esc(n)}</option>`)].join('');
  return `<select onchange="funnelMapOwner('${esc(rowRef(r))}', this.value)" style="font-size:11px;padding:3px 6px;border:1px solid ${unassigned ? '#f59e0b' : 'var(--border)'};border-radius:6px;background:var(--card);color:var(--text);max-width:150px">${opts}</select>`;
}

function item(levels, r) {
  const tracked = !!r.metric_key;
  const v = tracked ? liveValue(levels, r) : null;
  const badge = tracked
    ? (v ? `<div style="text-align:right;white-space:nowrap"><div style="font-size:14px;font-weight:800;color:#1e1b4b">${v.big}</div>${v.small ? `<div style="font-size:10px;color:#9ca3af">${v.small}</div>` : ''}</div>` : '')
    : `<span style="font-size:10px;font-weight:700;color:#b45309;background:#fef3c7;border-radius:999px;padding:2px 7px;white-space:nowrap">Not tracked</span>`;
  const remove = isAdmin() && !tracked && r.id ? `<button onclick="funnelMapRemove(${r.id})" title="Remove" style="border:none;background:none;color:#9ca3af;cursor:pointer;font-size:13px">✕</button>` : '';
  return `<div style="border:1px ${tracked ? 'solid var(--border)' : 'dashed #d1d5db'};border-radius:8px;padding:9px 10px;background:${tracked ? 'var(--card)' : 'transparent'}">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
      <div style="font-size:12px;font-weight:700;color:${tracked ? '#1e1b4b' : '#6b7280'};line-height:1.3">${esc(r.label)}</div>${badge}
    </div>
    ${line('Where', r.source)}${line('When', r.happens)}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:7px;gap:6px">${ownerControl(r)}${remove}</div>
  </div>`;
}

function addForm(level) {
  if (!isAdmin()) return '';
  if (_adding !== level) return `<button onclick="funnelMapAddOpen('${level}')" style="border:1px dashed #d1d5db;border-radius:8px;background:none;color:#6b7280;font-size:11px;padding:7px;cursor:pointer">+ Add something we don't track</button>`;
  const input = (id, ph) => `<input id="${id}" placeholder="${ph}" style="width:100%;box-sizing:border-box;font-size:12px;padding:5px 7px;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--text);margin-top:5px">`;
  return `<div style="border:1px dashed #6366f1;border-radius:8px;padding:8px">
    ${input('fmap-label', 'What should we measure?')}${input('fmap-source', 'Where would it come from?')}${input('fmap-happens', 'When does it happen?')}
    <div style="display:flex;gap:6px;margin-top:7px"><button onclick="funnelMapAddSave('${level}')" style="padding:4px 10px;border:none;border-radius:6px;background:#1e1b4b;color:#fff;font-size:11px;cursor:pointer">Add</button>
    <button onclick="funnelMapAddOpen(null)" style="padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--text);font-size:11px;cursor:pointer">Cancel</button></div></div>`;
}

function column(levels, level) {
  const rows = rowsFor(levels, level).filter(matchesFilter);
  return `<div style="flex:0 0 250px;display:flex;flex-direction:column;gap:7px">
    <div style="display:flex;align-items:center;gap:8px;padding-bottom:4px;border-bottom:2px solid #1e1b4b">
      <div style="width:26px;height:26px;border-radius:7px;background:#1e1b4b;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px">${level}</div>
      <div style="font-size:13px;font-weight:800;color:#1e1b4b">${esc(STAGES[level])}</div>
    </div>
    ${rows.map(r => item(levels, r)).join('') || `<div style="font-size:11px;color:#9ca3af">Nothing here for this owner.</div>`}
    ${addForm(level)}
  </div>`;
}

function ownerChips(all) {
  const count = (f) => all.filter(f).length;
  const chip = (key, label, n) => { const on = _ownerFilter === key; return `<button onclick="funnelMapFilter('${esc(key)}')" style="padding:4px 11px;border:1px solid ${on ? '#1e1b4b' : 'var(--border)'};border-radius:999px;background:${on ? '#1e1b4b' : 'var(--card)'};color:${on ? '#fff' : 'var(--text)'};font-size:12px;font-weight:600;cursor:pointer">${esc(label)} <span style="opacity:.7">${n}</span></button>`; };
  const owners = [...new Set([..._people, ...all.map(r => r.owner).filter(Boolean)])];
  return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">${chip('', 'Everyone', all.length)}${owners.map(o => chip(o, o, count(r => r.owner === o))).join('')}${chip(NONE, 'Unassigned', count(r => !r.owner))}</div>`;
}

export function renderFunnelMap(levels) {
  _levels = levels || [];
  if (_error) return `<div style="padding:16px 0;color:#b91c1c;font-size:13px">Could not load the map: ${esc(_error)}</div>`;
  if (_rows === null) { if (!_loading) load(); return `<div style="padding:16px 0;color:#9ca3af;font-size:13px">Loading the map…</div>`; }
  const levelKeys = Object.keys(STAGES);
  const all = levelKeys.flatMap(l => rowsFor(levels, l));
  const tracked = all.filter(r => r.metric_key).length;
  let h = `<div style="margin-top:12px;font-size:12px;color:#6b7280"><strong style="color:#1e1b4b">${tracked} tracked</strong> · <strong style="color:#b45309">${all.length - tracked} not tracked</strong> · ${all.filter(r => !r.owner).length} without an owner · figures are all-time, refreshed hourly</div>`;
  h += ownerChips(all);
  h += `<div style="display:flex;gap:10px;align-items:flex-start;overflow-x:auto;padding:14px 2px 10px;margin-top:6px">`;
  h += levelKeys.map(l => column(levels, l)).join(`<div style="flex:0 0 auto;align-self:center;color:#c7d2fe;font-size:20px">→</div>`);
  return h + `</div>`;
}

// ── Admin edits (RLS: only admins can write) ──
async function save(query, okMsg) {
  const { error } = await query;
  if (error) { showToast('Could not save: ' + error.message, 'error'); return false; }
  if (okMsg) showToast(okMsg);
  return true;
}

window.funnelMapOwner = async (ref, owner) => {
  const value = owner || null;
  const byId = !ref.includes('|');
  const [level, key] = byId ? [] : ref.split('|');
  const row = byId ? _rows.find(r => String(r.id) === ref) : null;
  const q = byId
    ? supabase.from('funnel_metric_map').update({ owner: value, updated_at: new Date().toISOString() }).eq('id', row.id).select().single()
    : supabase.from('funnel_metric_map').insert({ level, metric_key: key, label: (liveMetrics(_levels, level).find(m => m.key === key) || {}).label || key, owner: value }).select().single();
  const { data, error } = await q;
  if (error) { showToast('Could not save: ' + error.message, 'error'); return; }
  _rows = byId ? _rows.map(r => r.id === data.id ? data : r) : [..._rows, data];
  rerender();
};
window.funnelMapAddOpen = (level) => { _adding = level; rerender(); };
window.funnelMapAddSave = async (level) => {
  const val = (id) => (document.getElementById(id) || {}).value?.trim() || '';
  const label = val('fmap-label');
  if (!label) { showToast('Say what we should measure first', 'error'); return; }
  const { data, error } = await supabase.from('funnel_metric_map').insert({ level, label, source: val('fmap-source'), happens: val('fmap-happens'), sort: 900 }).select().single();
  if (error) { showToast('Could not save: ' + error.message, 'error'); return; }
  _rows = [..._rows, data]; _adding = null; rerender();
};
window.funnelMapRemove = async (id) => {
  if (await save(supabase.from('funnel_metric_map').delete().eq('id', id), 'Removed')) { _rows = _rows.filter(r => r.id !== id); rerender(); }
};
window.funnelMapFilter = (owner) => { _ownerFilter = owner; rerender(); };
