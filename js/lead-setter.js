// ═══════════════════════════════════════════════════════════
// LEAD SETTER — who booked each Lead Tracker lead (Ioannis vs Marcell), 2026-11-10
// ═══════════════════════════════════════════════════════════
// lead_tracker.setter is stamped by the DB on insert (trigger
// lead_tracker_fill_setter, tht-crm-backend migration 20261110120000):
//   cold-call leads → the JustCall seat that booked it (contact@ = Ioannis, leads@ = Marcell)
//   every other lead → Ioannis.
// The Setter cell is a dropdown so a wrong guess can be corrected by hand.
// A new setter = add them here AND to setter_for_email() in that migration.
import { esc, str, jsArg } from './utils.js?v=20261114162507';

// paypal / biweeklyBase drive the Payout Report. null = not on file yet: the
// report still counts the leads but shows no base pay and no Send button.
export const SETTERS = [
  { name: 'Ioannis', paypal: 'ioannis.serafeim@gmail.com', biweeklyBase: 250, color: '#2563eb', bg: '#dbeafe' },
  { name: 'Marcell', paypal: null,                         biweeklyBase: null, color: '#c2410c', bg: '#ffedd5' },
  { name: 'Aidan',   paypal: null,                         biweeklyBase: null, color: '#7c3aed', bg: '#ede9fe' },
];

// Rows from before the column existed default to Ioannis, same as the backfill.
export function setterOf(entry) {
  return str(entry.setter).trim() || 'Ioannis';
}

export function setterInfo(name) {
  return SETTERS.find(s => s.name === name) || { name, paypal: null, biweeklyBase: null, color: '#475569', bg: '#f1f5f9' };
}

// Coloured dropdown for the Setter column. Called-back rows are read-only.
export function setterCellHtml(entry, readOnly) {
  const cur = setterOf(entry);
  const s = setterInfo(cur);
  const pill = `background:${s.bg};color:${s.color};font-weight:700;font-size:11px;border-radius:10px;padding:2px 8px`;
  if (readOnly) return `<td><span style="${pill}">${esc(cur)}</span></td>`;
  const names = SETTERS.some(x => x.name === cur) ? SETTERS.map(x => x.name) : [cur, ...SETTERS.map(x => x.name)];
  return `<td><select onchange="trackerSaveCell(${jsArg(entry.id)},'setter',this.value)" style="${pill};border:none;cursor:pointer;font-family:var(--font)">
    ${names.map(n => `<option value="${esc(n)}" ${n === cur ? 'selected' : ''}>${esc(n)}</option>`).join('')}
  </select></td>`;
}

export function setterFilterHtml(current) {
  return `<select onchange="trackerFilterSetter(this.value)" title="Who booked the lead" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font)">
    <option value="">All Setters</option>
    ${SETTERS.map(s => `<option value="${esc(s.name)}" ${current === s.name ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
  </select>`;
}

export function setterPickerHtml(current) {
  return `<select onchange="payoutSetSetter(this.value)" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-weight:600;font-family:var(--font)">
    ${SETTERS.map(s => `<option value="${esc(s.name)}" ${current === s.name ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
  </select>`;
}
