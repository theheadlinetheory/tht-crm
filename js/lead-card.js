// ═══════════════════════════════════════════════════════════
// LEAD CARD — open a lead's deal card from the Lead Tracker tables (2026-10-06)
// ═══════════════════════════════════════════════════════════
//
// Lars, 2026-10-06: the PPM Meetings and Retainer Leads tables are too thin to
// find out more about a lead — every passed lead should open its deal card, the
// way the Funnel lists do. The deal row survives the pass-off (archived, Passed
// Off), so the card opens read-only with its banner and nothing is restored.
//
// A row finds its card by deal_id. PPM rows imported from the old sheet carry a
// placeholder ('migrated-N') and hand-added rows carry none: those are matched
// to a deal by email + company. The placeholder itself must stay — the Google
// Sheet sync (sync-lead-tracker) finds a row's sheet line by that id.

import { state } from './app.js?v=20261008153223';
import { supabase } from './api.js?v=20261008153223';
import { escAttr, str } from './utils.js?v=20261008153223';
import { render } from './render.js?v=20261008153223';
import { openDeal } from './deal-modal.js?v=20261008153223';
import { openArchivedDeal } from './archive.js?v=20261008153223';

const isRealDealId = (id) => !!id && !/^migrated-/i.test(id);

// row id → deal id, or '' when the lead has no card (it predates the CRM)
const matched = new Map();
let matching = false;
let retryAfter = 0; // a failed lookup waits a minute rather than firing again on every render

/** The deal id behind a tracker / retainer row, or '' when it has no card. */
export function leadCardId(row) {
  const id = str(row.dealId).trim();
  return isRealDealId(id) ? id : (matched.get(row.id) || '');
}

/** Match rows without a usable deal_id to a deal by email + company — once per row, then re-render.
 *  rows: [{ id, dealId, email, company }] */
export function matchLeadCards(rows) {
  if (matching || Date.now() < retryAfter) return;
  const todo = rows.filter(r => !isRealDealId(str(r.dealId).trim()) && !matched.has(r.id));
  if (!todo.length) return;
  matching = true;
  (async () => {
    const found = new Map(); // lowercased email → deals
    try {
      // deals.email is not case-normalised, so ask for the row's spelling and its lowercase
      const emails = [...new Set(todo.flatMap(r => { const e = str(r.email).trim(); return e ? [e, e.toLowerCase()] : []; }))];
      for (let i = 0; i < emails.length; i += 100) {
        const { data, error } = await supabase.from('deals').select('id,email,company,created_at').in('email', emails.slice(i, i + 100));
        if (error) throw error;
        for (const d of data || []) {
          const k = str(d.email).trim().toLowerCase();
          if (!found.has(k)) found.set(k, []);
          found.get(k).push(d);
        }
      }
    } catch (e) {
      console.warn('[lead-card] could not match rows to deals', e && e.message);
      matching = false;
      retryAfter = Date.now() + 60000;
      return; // nothing recorded — a later render tries again
    }
    let hits = 0;
    for (const r of todo) {
      const cands = (found.get(str(r.email).trim().toLowerCase()) || []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const company = str(r.company).trim().toLowerCase();
      const pick = cands.find(d => str(d.company).trim().toLowerCase() === company) || cands[0];
      matched.set(r.id, pick ? String(pick.id) : '');
      if (pick) hits++;
    }
    matching = false;
    // A cell being edited is rebuilt by render() and would lose what was typed — the links show on the next render instead.
    if (hits && !state.trackerEditingCell) render();
  })();
}

/** Small "open the card" icon for a cell whose text is itself click-to-edit. */
export function leadCardIcon(dealId) {
  if (!dealId) return '';
  return `<a href="#" onclick="event.preventDefault();event.stopPropagation();openLeadCard('${escAttr(dealId)}')" title="Open the deal card" style="display:inline-flex;vertical-align:-2px;margin-right:5px;color:#4f46e5"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg></a>`;
}

// On the board → the live card; passed off / archived → the read-only card (archive.js).
export function openLeadCard(id) {
  return state.deals.some(d => String(d.id) === String(id)) ? openDeal(id) : openArchivedDeal(id);
}
window.openLeadCard = openLeadCard;
