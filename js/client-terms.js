// ═══════════════════════════════════════════════════════════
// CLIENT TERMS — pure math for a retainer's payment cadence and term.
// Term end = launch date + initial term + every extension (months summed and
// added first, then days). Summing before adding keeps a Jan 31 launch landing
// on Mar 31 after two one-month blocks, instead of clamping to the 28th.
// Import-free so scripts/test-client-terms.mjs can load it under plain node.
// ═══════════════════════════════════════════════════════════

export const PAYMENT_CADENCES = ['Monthly', 'Biweekly', 'Weekly'];
export const TERM_UNITS = ['months', 'days'];
const PAYMENTS_PER_YEAR = { Monthly: 12, Biweekly: 26, Weekly: 52 };

const s = (v) => (v == null ? '' : String(v));

// 'Bi-weekly' → 'Biweekly'. Legacy free text ('Prepaid', 'Net 1') returns '' so
// the UI asks a human instead of guessing.
export function cadenceOf(paymentTerms) {
  const t = s(paymentTerms).toLowerCase().replace(/[^a-z]/g, '');
  return PAYMENT_CADENCES.find((c) => c.toLowerCase() === t) || '';
}

// Add n months to an ISO date (YYYY-MM-DD), clamping the day for short months.
export function addMonths(iso, n) {
  const [y, m, d] = s(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  const idx = (m - 1) + n;
  const ty = y + Math.floor(idx / 12);
  const tm = ((idx % 12) + 12) % 12;
  const td = Math.min(d, new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate());
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(td).padStart(2, '0')}`;
}

function addDays(iso, n) {
  const t = Date.parse(s(iso).slice(0, 10) + 'T00:00:00Z');
  return Number.isNaN(t) ? '' : new Date(t + n * 86400000).toISOString().slice(0, 10);
}

// '' when there is no launch date or no initial term (open-ended).
export function termEnd(launchDate, initialLength, initialUnit, extensions) {
  const launch = s(launchDate).slice(0, 10);
  const blocks = [{ length: initialLength, unit: initialUnit }, ...(extensions || [])];
  if (!launch || !(Number(initialLength) > 0)) return '';
  const total = (unit) => blocks
    .filter((b) => s(b.unit) === unit)
    .reduce((sum, b) => sum + (Number(b.length) || 0), 0);
  return addDays(addMonths(launch, total('months')), total('days'));
}

// Signed whole days from today to the end date; null when there is no end.
export function daysLeft(endIso, todayIso) {
  if (!s(endIso)) return null;
  return Math.round((Date.parse(endIso + 'T00:00:00Z') - Date.parse(todayIso + 'T00:00:00Z')) / 86400000);
}

// The amount is per payment, so weekly/biweekly clients are scaled up to a
// monthly figure for totals. An unrecognized cadence is treated as monthly.
export function monthlyEquivalent(amount, cadence) {
  const perYear = PAYMENTS_PER_YEAR[cadence] || 12;
  return Math.round((Number(amount) * perYear / 12) * 100) / 100;
}
