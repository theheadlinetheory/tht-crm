// ═══════════════════════════════════════════════════════════
// RETAINER BILLING — the Retainer Billing card in Settings ▸ Clients,
// plus the prepaid-term math shared with the Won modal.
// Display mirror of supabase/functions/_shared/retainer-schedule.ts:
// term = launch date → launch date + prepaidMonths months. The backend is
// the authority; this only shows the operator what it will do.
// ═══════════════════════════════════════════════════════════
import { esc, str } from './utils.js?v=20260827212923';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CURRENCIES = ['usd','aud','cad','gbp'];
const AGREEMENT_TYPES = [
  ['prepaid', 'Paid up front — no billing language'],
  ['multi_month', 'Multi-month — auto-charged monthly'],
  ['month_to_month', 'Month-to-month — 7/3/1 day renewal warnings'],
];
const FIELD = 'width:100%;box-sizing:border-box;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:var(--font);background:var(--card);color:var(--text);margin-top:3px';
const LABEL = 'font-size:10px;font-weight:600;color:var(--text-muted)';

// Add n months to an ISO date (YYYY-MM-DD), clamping the day for short months.
export function addMonths(iso, n) {
  const [y, m, d] = str(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  const idx = (m - 1) + n;
  const ty = y + Math.floor(idx / 12);
  const tm = ((idx % 12) + 12) % 12;
  const daysInTarget = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const td = Math.min(d, daysInTarget);
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(td).padStart(2, '0')}`;
}

export function prettyDate(iso) {
  const s = str(iso).slice(0, 10);
  if (s.length !== 10) return '';
  return `${MONTHS[Number(s.slice(5, 7)) - 1]} ${Number(s.slice(8, 10))}, ${s.slice(0, 4)}`;
}

// The date a prepaid term runs through — '' when not prepaid or no launch date.
export function prepaidThrough(launchDate, prepaidMonths) {
  const n = Number(prepaidMonths) || 0;
  if (n <= 0 || !str(launchDate)) return '';
  return addMonths(launchDate, n);
}

// One line of plain English about what billing will do. Used live in Settings
// and in the Won modal, so both screens say the same thing.
export function prepaidNote(launchDate, prepaidMonths) {
  const n = Number(prepaidMonths) || 0;
  if (n <= 0) return '';
  if (!str(launchDate)) return 'Set a launch date to start the term.';
  const end = prepaidThrough(launchDate, n);
  return `Prepaid through ${prettyDate(end)} — no invoices until then, billing resumes that day.`;
}

// Month-to-month clients renew on a stored day of the month that is deliberately
// NOT derivable from the launch date — Denair launched on the 23rd and renews on
// the 29th, Hammer launched on the 14th and renews on the 2nd. Without it the
// 7/3/1-day notices never fire and the client gets charged with no warning, so an
// unset day is an error rather than a blank.
export function renewalDayNote(agreementType, renewalDay) {
  const day = Number(renewalDay) || 0;
  const m2m = str(agreementType) === 'month_to_month';
  if (m2m && !day) return 'Set a renewal day — without it no renewal notices are sent.';
  if (!m2m && day) return 'Only month-to-month clients use a renewal day; this one is ignored.';
  if (m2m) return `Renews on the ${ordinal(day)} — notices go out 7, 3 and 1 days before.`;
  return '';
}

// Whether that note is a problem (amber) rather than a confirmation (green).
export function renewalDayIsProblem(agreementType, renewalDay) {
  const day = Number(renewalDay) || 0;
  return (str(agreementType) === 'month_to_month' && !day) || (str(agreementType) !== 'month_to_month' && !!day);
}

function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'}`;
}

// Live-update the note without a full re-render (typing must not be interrupted).
export function setRenewalDay(clientId, agreementType, value) {
  window.updateClientField?.(clientId, 'renewalDay', value);
  const note = document.getElementById(`renewal-note-${clientId}`);
  if (note) {
    note.textContent = renewalDayNote(agreementType, value);
    note.style.color = renewalDayIsProblem(agreementType, value) ? '#b45309' : '#16a34a';
  }
  window.debouncedAutoSave?.();
}

// Live-update the note without a full re-render (typing must not be interrupted).
export function setPrepaidMonths(clientId, launchDate, value) {
  window.updateClientField?.(clientId, 'prepaidMonths', value);
  const note = document.getElementById(`prepaid-note-${clientId}`);
  if (note) note.textContent = prepaidNote(launchDate, value);
  window.debouncedAutoSave?.();
}

export function renderRetainerBilling(c) {
  if (str(c.billingModel) !== 'retainer') return '';
  const agreement = str(c.agreementType || 'prepaid');
  const months = str(c.prepaidMonths ?? '');
  const renewalDay = str(c.renewalDay ?? '');
  const mismatch = (Number(months) || 0) > 0 && agreement !== 'prepaid';
  return `<div style="margin-bottom:8px;padding:10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px">
    <div style="font-size:10px;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Retainer Billing</div>
    <div style="display:flex;gap:8px;margin-bottom:6px">
      <div style="flex:2">
        <label style="${LABEL}">Monthly Amount</label>
        <input type="number" step="0.01" placeholder="e.g. 3000" value="${esc(str(c.monthlyRetainer ?? ''))}"
          oninput="updateClientField('${esc(c.id)}','monthlyRetainer',this.value)"
          style="${FIELD}">
      </div>
      <div style="flex:1">
        <label style="${LABEL}">Currency</label>
        <select onchange="updateClientField('${esc(c.id)}','retainerCurrency',this.value);debouncedAutoSave()"
          style="${FIELD}">
          ${CURRENCIES.map(cc => `<option value="${cc}" ${str(c.retainerCurrency || 'usd') === cc ? 'selected' : ''}>${cc.toUpperCase()}</option>`).join('')}
        </select>
      </div>
    </div>
    <div>
      <label style="${LABEL}">Launch Date (billing start) — leave blank for TBD</label>
      <input type="date" value="${esc(str(c.launchDate || ''))}"
        onchange="updateClientField('${esc(c.id)}','launchDate',this.value);debouncedAutoSave()"
        title="The first day their campaigns sent email. This is the billing anchor — its day-of-month is their billing day, and it's what the monthly update email reports against."
        style="${FIELD}">
    </div>
    <div style="margin-top:6px">
      <label style="${LABEL}">Agreement Type — sets what the monthly update email says about money</label>
      <select onchange="setAgreementType('${esc(c.id)}',this.value)"
        title="Paid up front: the email makes no mention of billing. Multi-month: auto-charged each month, the email says so. Month-to-month: gets 7/3/1-day pre-renewal warnings instead of a billing-date email."
        style="${FIELD}">
        ${AGREEMENT_TYPES.map(([v, label]) => `<option value="${v}" ${agreement === v ? 'selected' : ''}>${esc(label)}</option>`).join('')}
      </select>
    </div>
    <div style="margin-top:6px">
      <label style="${LABEL}">Renewal Day — month-to-month only, not derived from the launch date</label>
      <input type="number" min="1" max="31" step="1" placeholder="e.g. 25" value="${esc(renewalDay)}"
        oninput="setRenewalDay('${esc(c.id)}','${esc(agreement)}',this.value)"
        title="The day of the month a month-to-month client renews. Stored, not calculated: Denair launched on the 23rd but renews on the 29th. Drives the 7/3/1-day pre-renewal notices; a day past the end of a short month is clamped (31 renews Feb 28)."
        style="${FIELD}">
      <div id="renewal-note-${esc(c.id)}" style="font-size:10px;color:${renewalDayIsProblem(agreement, renewalDay) ? '#b45309' : '#16a34a'};margin-top:4px">${esc(renewalDayNote(agreement, renewalDay))}</div>
    </div>
    <div style="margin-top:6px">
      <label style="${LABEL}">Prepaid Months — blank or 0 = invoiced every month</label>
      <input type="number" min="0" step="1" placeholder="e.g. 3" value="${esc(months)}"
        oninput="setPrepaidMonths('${esc(c.id)}','${esc(str(c.launchDate || ''))}',this.value)"
        title="Months the client paid for up front, counted from the launch date. No invoice is created until the term ends; the #client-payments card then appears ~7 days before billing resumes."
        style="${FIELD}">
      <div id="prepaid-note-${esc(c.id)}" style="font-size:10px;color:#16a34a;margin-top:4px">${esc(prepaidNote(c.launchDate, c.prepaidMonths))}</div>
      ${mismatch ? '<div style="font-size:10px;color:#b45309;margin-top:2px">Heads up: prepaid months are set but the agreement type isn\'t "Paid up front".</div>' : ''}
    </div>
  </div>`;
}

// Changing the agreement type changes whether a renewal day is required, so the
// note has to be re-evaluated against the new type — the card is not re-rendered.
export function setAgreementType(clientId, value) {
  window.updateClientField?.(clientId, 'agreementType', value);
  const input = document.querySelector(`#renewal-note-${clientId}`)?.previousElementSibling;
  const day = input ? input.value : '';
  const note = document.getElementById(`renewal-note-${clientId}`);
  if (note) {
    note.textContent = renewalDayNote(value, day);
    note.style.color = renewalDayIsProblem(value, day) ? '#b45309' : '#16a34a';
  }
  // Keep the renewal-day input's own handler pointed at the new type.
  if (input) input.setAttribute('oninput', `setRenewalDay('${clientId}','${value}',this.value)`);
  window.debouncedAutoSave?.();
}

window.setPrepaidMonths = setPrepaidMonths;
window.setRenewalDay = setRenewalDay;
window.setAgreementType = setAgreementType;
