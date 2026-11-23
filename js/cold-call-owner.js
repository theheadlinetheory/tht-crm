// ═══════════════════════════════════════════════════════════
// COLD-CALL CARD OWNER — each cold-call card belongs to the rep who booked it
// ═══════════════════════════════════════════════════════════
// deals.sdr_email (2026-11-18) = the JustCall agent email of the first dial linked to the card, which is the rep's
// CRM login. The database stamps it (tht-crm-backend migration 20261118120000_cold_call_deal_owner.sql) and holds
// SDR logins to their own cards. Here: a rep sees only their own cards on Cold Calling → Pipeline; an admin sees
// everyone's, can narrow the board to one rep, and can hand a card to another rep from the card.
import { state } from './app.js?v=20261122183507';
import { currentUser, isAdmin } from './auth.js?v=20261122183507';
import { esc, str } from './utils.js?v=20261122183507';

const CALLBACK_STAGE = 'Cold Call Callback';
const myEmail = () => str(currentUser && currentUser.email).toLowerCase();
const ownerOf = d => str(d && d.sdrEmail).trim().toLowerCase();

/** A card that belongs to a rep: a cold-call lead, or anything in Callbacks. */
export const isRepCard = d => !!d && (d.leadSource === 'cold_call' || d.stage === CALLBACK_STAGE);

function repLabel(email) {
  const u = (state.assignableUsers || []).find(x => str(x.email).toLowerCase() === email);
  return (u && u.name) || email;
}

/** Everyone a card can belong to: SDR logins plus anyone who already owns a card (Ioannis dials as an employee). */
export function repOptions() {
  const emails = new Set((state.assignableUsers || []).filter(u => u.role === 'sdr').map(u => str(u.email).toLowerCase()));
  for (const d of state.deals || []) if (isRepCard(d) && ownerOf(d)) emails.add(ownerOf(d));
  return [...emails].filter(e => e && !e.startsWith('pentest-')).map(e => ({ email: e, name: repLabel(e) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Whether the signed-in user sees this card on the Cold Calling board. */
export function visibleOnColdCallBoard(d) {
  const pick = isAdmin() ? str(state.ccRepFilter) : myEmail();
  if (!pick) return true; // admin, everyone
  if (!isRepCard(d)) return !isAdmin(); // email leads (the "all leads" toggle) belong to no rep
  return pick === 'none' ? !ownerOf(d) : ownerOf(d) === pick;
}

/** Admin's rep picker next to the all-leads toggle. */
export function renderRepFilter() {
  if (!isAdmin()) return '';
  const v = str(state.ccRepFilter);
  const opts = [['', 'All reps'], ...repOptions().map(r => [r.email, r.name]), ['none', 'No rep']];
  return `<select onchange="setColdCallRepFilter(this.value)" title="Show one rep's cards" style="padding:4px 8px;font-size:11px;font-weight:600;font-family:var(--font);border:1px solid ${v ? 'var(--purple)' : 'var(--border)'};border-radius:6px;background:${v ? '#f3e8ff' : '#fff'};color:${v ? 'var(--purple)' : 'var(--text-muted)'}">
    ${opts.map(([val, label]) => `<option value="${esc(val)}" ${v === val ? 'selected' : ''}>${esc(label)}</option>`).join('')}
  </select>`;
}

/** Deal card field: who booked it. Admins can reassign; everyone else sees nothing (it is always them). */
export function renderSdrOwnerField(deal) {
  if (!isAdmin() || !isRepCard(deal)) return '';
  const cur = ownerOf(deal);
  const reps = repOptions();
  if (cur && !reps.some(r => r.email === cur)) reps.push({ email: cur, name: repLabel(cur) });
  return `<div class="form-group">
    <label title="The rep whose pipeline this card is in">Rep</label>
    <select id="deal-sdrEmail" onchange="updateDealField('sdrEmail',this.value);render()">
      <option value="" ${!cur ? 'selected' : ''}>No rep</option>
      ${reps.map(r => `<option value="${esc(r.email)}" ${cur === r.email ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
    </select>
  </div>`;
}

window.setColdCallRepFilter = async (v) => {
  state.ccRepFilter = v || '';
  const { render } = await import('./render.js?v=20261122183507');
  render();
};
