// ═══════════════════════════════════════════════════════════
// PASSED OFF — delivered client leads, and bringing one back into the pipeline
// ═══════════════════════════════════════════════════════════
// Lead Tracker → Passed off (Ioannis, 2026-11-18) lists every Client lead that was delivered (Meeting Booked /
// Passed Off; optionally removed / lost too). Cold Calling → Passed off (Marcell, 2026-11-17) is the same idea
// for cold-call leads; both use bringBackDeal() below.
//
// Delivering a lead archives it: an `archive` row, and the deal soft-cancelled (lead_status 'cancelled', same id).
// bringBackDeal re-activates that SAME row, so the card keeps its Timeline, notes and activities — unlike
// Archive → Restore, which deletes and re-inserts the deal (crm-restore-wipes-timeline) and lands it in Not
// Distributed. It then adds a reminder + note and deletes the archive row (a later archive re-inserts it).
//   email lead     → back in its client's column (Not Distributed if the client is no longer active)
//   cold-call lead → Cold Calling → Callbacks under its client (it never shows on Client Leads)
// The meeting it was delivered for stays counted; a new booking counts again (Tim, 2026-11-17).
// A few old archives have no deal row left: those fall back to the normal Restore.
import { state } from './app.js?v=20261124052057';
import { render } from './render.js?v=20261124052057';
import { supabase } from './supabase-client.js?v=20261124052057';
import { esc, str, getToday } from './utils.js?v=20261124052057';
import { currentUser } from './auth.js?v=20261124052057';
import { registerActions } from './delegate.js?v=20261124052057';
import { selectAllPages } from './paging.js?v=20261124052057';

export const CALLBACK_STAGE = 'Cold Call Callback';
export const DELIVERED = new Set(['Meeting Booked', 'Passed Off']);

/** r: { id, client, archive_status, company, contact, coldCall }. Returns true when the lead is back. */
export async function bringBackDeal(r) {
  const today = getToday();
  const where = r.coldCall ? 'Cold Calling → Callbacks' : 'the ' + (r.client || 'client') + ' column on Client Leads';
  const due = (prompt(`Bring ${r.company || r.contact || 'this lead'} (${r.client || '?'}) back into the pipeline?\n\nIt goes to ${where}. ${r.coldCall ? 'Call back' : 'Follow up'} on (YYYY-MM-DD):`, today) || '').trim();
  if (!due) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || isNaN(new Date(due + 'T12:00:00'))) { alert('Use a date like ' + today + '.'); return false; }
  const who = (currentUser && (currentUser.name || currentUser.email)) || 'CRM';
  const { deletedDealIds } = await import('./app.js?v=20261124052057');
  deletedDealIds.delete(String(r.id));
  try { localStorage.setItem('tht_deletedDeals', JSON.stringify([...deletedDealIds])); } catch {}
  const api = await import('./api.js?v=20261124052057');

  const { data: row, error: readErr } = await supabase.from('deals').select('id').eq('id', r.id).maybeSingle();
  if (readErr) { alert('Could not bring it back: ' + readErr.message); return false; }
  const active = state.clients.some(c => c.name === r.client && c.status !== 'inactive');
  const stage = r.coldCall ? CALLBACK_STAGE : active ? r.client : 'Client Not Distributed';
  if (!row) {
    // No deal row left (archived before soft-delete): the normal Restore re-creates it in Not Distributed.
    try { await api.sbRestoreFromArchive(r.id); } catch (e) { return false; }
    if (stage !== 'Client Not Distributed') await supabase.from('deals').update({ stage, ...(r.coldCall ? { cold_call_client: r.client || null } : {}) }).eq('id', r.id);
  } else {
    // 1. Re-activate the deal first: if this fails the lead is still archived and still listed, to retry.
    const { error } = await supabase.from('deals').update({
      lead_status: 'active', stage, ...(r.coldCall ? { cold_call_client: r.client || null } : {}),
      pushed_to_tracker: null, pushed_to_client_sheet: null, forwarded_at: null,
    }).eq('id', r.id);
    if (error) { alert('Could not bring it back: ' + error.message); return false; }
  }
  // 2. The reminder and note are best effort; 3. the archive row must go, or the lead shows in both places.
  const after = r.archive_status === 'Meeting Booked' || r.archive_status === 'Passed Off' ? 'pass-off' : str(r.archive_status).toLowerCase();
  try { await api.sbCreateActivity({ id: crypto.randomUUID(), deal_id: r.id, type: r.coldCall ? 'Call' : 'Follow-up', subject: `${r.coldCall ? 'Call back' : 'Follow up'} — brought back after ${after}`, due_date: due, done: false }); }
  catch (e) { console.warn('[bringBack] reminder not saved', e && e.message); }
  try { await api.sbCreateInteraction({ deal_id: r.id, type: 'Note', content: `Brought back into the pipeline from Passed off (${r.archive_status}) · ${who} · ${r.coldCall ? 'call back' : 'follow up'} ${due}` }); }
  catch (e) { console.warn('[bringBack] note not saved', e && e.message); }
  if (row) {
    const { error: archErr } = await supabase.from('archive').delete().eq('id', r.id);
    if (archErr) alert('It is back on the board, but its archive row could not be removed: ' + archErr.message);
  }
  if (!r.coldCall && !active) alert(`${r.client || 'Its client'} is not an active client, so the lead went to Not Distributed.`);
  await api.initialSync();
  return true;
}

// ─── Lead Tracker → Passed off ───
const po = { rows: null, loading: false, search: '', client: '', showRemoved: false, limit: 200 };

async function load() {
  po.loading = true;
  try {
    const arch = await selectAllPages(() => supabase.from('archive_list')
      .select('id,archived_at,archive_status,company,contact,email,pipeline,stage,client_name,location').ilike('pipeline', 'client').order('id'));
    const ids = arch.map(a => a.id);
    const deals = new Map();
    const chunks = [];
    for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));
    const results = await Promise.all(chunks.map(c => supabase.from('deals').select('id,lead_source,phone,booked_date,booked_time,cold_call_client').in('id', c)));
    for (const { data, error } of results) { if (error) throw error; for (const d of data || []) deals.set(d.id, d); }
    po.rows = arch.map(a => {
      const d = deals.get(a.id) || {};
      return { ...a, ...d, client: d.cold_call_client || a.client_name || a.stage, coldCall: d.lead_source === 'cold_call' };
    }).sort((a, b) => str(b.archived_at).localeCompare(str(a.archived_at)));
  } catch (e) { po.rows = { error: e.message || String(e) }; }
  po.loading = false;
  render();
}

const th = 'padding:6px 8px;text-align:left;font-weight:600;color:#64748b;font-size:11px;white-space:nowrap';
const td = 'padding:7px 8px;border-top:1px solid #e2e8f0;font-size:12px;vertical-align:top';

export function renderPassedOff() {
  if (!po.rows && !po.loading) load();
  const wrap = body => `<div style="padding:12px 20px 40px;max-width:1300px">${body}</div>`;
  if (po.loading || !po.rows) return wrap('<div style="text-align:center;padding:40px;color:var(--text-muted)">Loading passed-off leads…</div>');
  if (po.rows.error) return wrap(`<div style="font-size:12px;color:#dc2626">Couldn't load: ${esc(po.rows.error)}</div>`);
  const pool = po.rows.filter(r => po.showRemoved || DELIVERED.has(r.archive_status));
  const clients = [...new Set(pool.map(r => r.client).filter(Boolean))].sort();
  const q = po.search.toLowerCase().trim();
  const rows = pool.filter(r => (!po.client || r.client === po.client) &&
    (!q || [r.client, r.company, r.contact, r.email, r.phone, r.location].some(v => str(v).toLowerCase().includes(q))));
  const removedN = po.rows.filter(r => !DELIVERED.has(r.archive_status)).length;
  const when = r => r.archived_at ? new Date(r.archived_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const shown = rows.slice(0, po.limit);
  return wrap(`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
      <select data-action="poClient" style="padding:5px 8px;font-size:12px;border:1px solid var(--border);border-radius:6px">
        <option value="">All clients</option>${clients.map(n => `<option value="${esc(n)}" ${po.client === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <input id="po-search" data-action="poSearch" placeholder="Search client, company, contact, email, phone…" value="${esc(po.search)}" style="flex:1;min-width:220px;padding:5px 10px;font-size:12px;border:1px solid var(--border);border-radius:6px">
      <label style="font-size:12px;color:#475569;display:flex;align-items:center;gap:5px;cursor:pointer"><input type="checkbox" data-action="poRemoved" ${po.showRemoved ? 'checked' : ''}> Show removed / lost too (${removedN})</label>
    </div>
    <div style="font-size:12px;color:#475569;margin-bottom:10px">Every client lead already passed off (${rows.length}). <b>Bring back</b> puts it back on the board with a follow-up reminder: email leads in their client's column, cold-call leads in Cold Calling → Callbacks. Its notes and history stay on the card.</div>
    ${shown.length ? `<table style="width:100%;border-collapse:collapse;background:#fff"><thead><tr><th style="${th}">Passed off</th><th style="${th}">Client</th><th style="${th}">Company / contact</th><th style="${th}">Email / phone</th><th style="${th}">Source</th><th style="${th}">Status</th><th style="${th}"></th></tr></thead><tbody>
      ${shown.map(r => `<tr>
        <td style="${td};white-space:nowrap">${esc(when(r))}</td><td style="${td}">${esc(r.client || '?')}</td>
        <td style="${td}"><b>${esc(r.company || '')}</b>${r.contact ? '<br><span style="color:#64748b">' + esc(r.contact) + '</span>' : ''}</td>
        <td style="${td}">${esc(r.email || '')}${r.phone ? '<br><span style="color:#64748b">' + esc(r.phone) + '</span>' : ''}</td>
        <td style="${td};color:#64748b">${r.coldCall ? 'Cold call' : 'Email'}</td>
        <td style="${td};color:${DELIVERED.has(r.archive_status) ? '#15803d' : '#b45309'}">${esc(r.archive_status || '')}</td>
        <td style="${td};text-align:right"><button data-action="poBringBack" data-id="${esc(r.id)}" style="font-size:11px;padding:4px 10px;border:1px solid var(--purple);background:#f3e8ff;color:var(--purple);border-radius:6px;cursor:pointer;font-weight:600;white-space:nowrap">Bring back</button></td></tr>`).join('')}</tbody></table>
      ${rows.length > shown.length ? `<div style="text-align:center;margin-top:10px"><button class="btn btn-ghost" data-action="poMore" style="font-size:12px">Show more (${rows.length - shown.length} left)</button></div>` : ''}`
    : `<div style="font-size:12px;color:#94a3b8">${q || po.client ? 'Nothing matches.' : 'No passed-off leads.'}</div>`}`);
}

registerActions({
  poSearch(el, e) { if (e.type !== 'input') return; po.search = el.value; po.limit = 200; render(); },
  poClient(el, e) { if (e.type !== 'change') return; po.client = el.value; po.limit = 200; render(); },
  poRemoved(el, e) { if (e.type !== 'change') return; po.showRemoved = el.checked; render(); },
  poMore(el, e) { if (e.type !== 'click') return; po.limit += 200; render(); },
  async poBringBack(el, e) {
    if (e.type !== 'click') return;
    const r = Array.isArray(po.rows) && po.rows.find(x => x.id === el.dataset.id);
    if (!r) return;
    el.disabled = true;
    if (await bringBackDeal(r)) po.rows = po.rows.filter(x => x.id !== r.id);
    el.disabled = false;
    render();
  },
});
