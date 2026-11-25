// node scripts/test-sdr-pay.mjs
import assert from 'node:assert/strict';
import { mdyToIso, monthPay, prevMonth } from '../js/sdr-pay.js';

assert.equal(mdyToIso('11/6/26'), '2026-11-06');
assert.equal(mdyToIso('2026-11-06'), null);
assert.equal(mdyToIso(''), null);
assert.equal(prevMonth('2026-11'), '2026-10');
assert.equal(prevMonth('2026-01'), '2025-12');

const rates = { email: 25, coldCall: 25 };
const rows = [
  { lead_name: 'Held', appt_date: '11/10/26', date_added: '11/9/26', lead_source: 'cold_call', callback_status: '' },
  { lead_name: 'Upcoming', appt_date: '11/30/26', date_added: '11/24/26', lead_source: 'cold_call', callback_status: '' },
  { lead_name: 'Called back', appt_date: '11/12/26', date_added: '11/9/26', lead_source: 'cold_call', callback_status: 'Called Back' },
  { lead_name: 'No appt date', appt_date: '', date_added: '11/20/26', lead_source: 'email', callback_status: null },
  { lead_name: 'December', appt_date: '12/2/26', date_added: '11/24/26', lead_source: 'cold_call', callback_status: '' },
];
const p = monthPay(rows, { rates, monthlyBase: 250, ym: '2026-11', today: '2026-11-25' });
assert.equal(p.leads.length, 4);
assert.equal(p.heldCount, 2);
assert.equal(p.upcomingCount, 1);
assert.equal(p.calledBackCount, 1);
assert.equal(p.earned, 300);
assert.equal(p.onTrack, 325);
assert.deepEqual(p.leads.map((l) => l.lead_name), ['Held', 'Called back', 'No appt date', 'Upcoming']);

console.log('sdr-pay: all passed');
