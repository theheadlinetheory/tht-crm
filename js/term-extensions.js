// ═══════════════════════════════════════════════════════════
// TERM EXTENSIONS — client_term_extensions rows and the Extend popup on the
// Renewals tab. Each extension is a history row (how long, who, when, note);
// the term end itself is derived in client-terms.js, never stored.
// Admin-only, like the Renewals tab that hosts it.
// ═══════════════════════════════════════════════════════════
import { supabase } from './supabase-client.js?v=20260923101551';
import { render } from './render.js?v=20260923101551';
import { showToast } from './api.js?v=20260923101551';
import { esc, str } from './utils.js?v=20260923101551';
import { currentUser, isAdmin } from './auth.js?v=20260923101551';
import { TERM_UNITS } from './client-terms.js?v=20260923101551';

const PAGE = 1000; // PostgREST caps a response at 1000 rows
let _byClient = null; // { [clientId]: row[] } once loaded
let _status = 'idle'; // idle | loading | loaded | error

export const extensionsStatus = () => _status;
export const extensionsFor = (clientId) => (_byClient && _byClient[clientId]) || [];

// Loads once. A failure stays failed (no retry loop from render); the popup's
// Save reloads, and a page reload retries.
export async function loadTermExtensions() {
  if (_status === 'loading' || _status === 'loaded') return;
  _status = 'loading';
  try {
    const rows = [];
    for (let off = 0; ; off += PAGE) {
      const { data, error } = await supabase.from('client_term_extensions')
        .select('*').order('created_at').range(off, off + PAGE - 1);
      if (error) throw new Error(error.message);
      rows.push(...data);
      if (data.length < PAGE) break;
    }
    _byClient = {};
    for (const r of rows) (_byClient[r.client_id] ||= []).push(r);
    _status = 'loaded';
  } catch (e) {
    _status = 'error';
    showToast('Could not load term extensions: ' + e.message, 'error');
  }
  render();
}

const FIELD = 'box-sizing:border-box;padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px';

function historyHtml(clientId) {
  const rows = extensionsFor(clientId);
  if (!rows.length) return '<div style="font-size:12px;color:#94a3b8">No extensions yet.</div>';
  return rows.map((r) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid #f1f5f9;font-size:12px">
      <div><strong>+${esc(str(r.length))} ${esc(str(r.unit))}</strong>
        <span style="color:#64748b"> · ${esc(str(r.created_at).slice(0, 10))}${r.created_by ? ' · ' + esc(str(r.created_by).split('@')[0]) : ''}</span>
        ${r.note ? `<div style="color:#475569;margin-top:2px">${esc(str(r.note))}</div>` : ''}</div>
      <button onclick="removeTermExtension('${esc(str(r.id))}','${esc(clientId)}')" title="Remove this extension" style="background:none;border:none;color:#b91c1c;font-size:16px;cursor:pointer">&times;</button>
    </div>`).join('');
}

export function openExtendTerm(clientId, clientName) {
  if (!isAdmin()) return;
  closeExtendTerm();
  document.body.insertAdjacentHTML('beforeend', `<div id="extend-overlay" style="position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.5);display:flex;justify-content:center;align-items:flex-start;padding:60px 20px" onclick="if(event.target===this)closeExtendTerm()">
    <div style="background:#fff;border-radius:12px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div style="padding:16px 20px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">
        <h2 style="margin:0;font-size:16px;color:#1e293b">Extend term — ${esc(clientName)}</h2>
        <button onclick="closeExtendTerm()" style="background:none;border:none;font-size:22px;color:#94a3b8;cursor:pointer">&times;</button>
      </div>
      <div style="padding:16px 20px">
        <label style="font-size:11px;font-weight:600;color:#64748b">Extend by</label>
        <div style="display:flex;gap:6px;margin:3px 0 10px">
          <input type="number" id="extend-length" min="1" step="1" placeholder="e.g. 3" style="${FIELD};flex:1;min-width:0">
          <select id="extend-unit" style="${FIELD};flex:1">${TERM_UNITS.map((u) => `<option value="${u}">${u}</option>`).join('')}</select>
        </div>
        <label style="font-size:11px;font-weight:600;color:#64748b">Note (optional)</label>
        <input id="extend-note" placeholder="e.g. renewed on call, same rate" style="${FIELD};width:100%;margin-top:3px">
        <div style="margin-top:14px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.04em">History</div>
        <div id="extend-history">${historyHtml(clientId)}</div>
      </div>
      <div style="padding:12px 20px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:8px">
        <button onclick="closeExtendTerm()" style="padding:8px 14px;background:#f1f5f9;color:#475569;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Cancel</button>
        <button id="extend-save" onclick="saveTermExtension('${esc(clientId)}')" style="padding:8px 16px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">Add extension</button>
      </div>
    </div>
  </div>`);
  document.getElementById('extend-length')?.focus();
}

export function closeExtendTerm() {
  document.getElementById('extend-overlay')?.remove();
}

export async function saveTermExtension(clientId) {
  const length = parseInt(document.getElementById('extend-length')?.value, 10);
  if (!(length > 0)) { showToast('Enter how long to extend by', 'error'); return; }
  const btn = document.getElementById('extend-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  const row = {
    client_id: clientId,
    length,
    unit: document.getElementById('extend-unit')?.value || 'months',
    note: (document.getElementById('extend-note')?.value || '').trim() || null,
    created_by: currentUser?.email || null,
  };
  const { data, error } = await supabase.from('client_term_extensions').insert(row).select().single();
  if (error) {
    showToast('Extension not saved: ' + error.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Add extension'; }
    return;
  }
  (_byClient ||= {});
  (_byClient[clientId] ||= []).push(data);
  closeExtendTerm();
  showToast(`Term extended by ${length} ${row.unit}`, 'success');
  render();
}

export async function removeTermExtension(id, clientId) {
  if (!confirm('Remove this extension? The term end date moves back.')) return;
  const { error } = await supabase.from('client_term_extensions').delete().eq('id', id);
  if (error) { showToast('Could not remove: ' + error.message, 'error'); return; }
  if (_byClient?.[clientId]) _byClient[clientId] = _byClient[clientId].filter((r) => r.id !== id);
  const hist = document.getElementById('extend-history');
  if (hist) hist.innerHTML = historyHtml(clientId);
  render();
}

window.openExtendTerm = openExtendTerm;
window.closeExtendTerm = closeExtendTerm;
window.saveTermExtension = saveTermExtension;
window.removeTermExtension = removeTermExtension;
