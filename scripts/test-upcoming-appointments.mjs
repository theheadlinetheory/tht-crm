// node scripts/test-upcoming-appointments.mjs — cold-call bookings (date field only) show under Upcoming Appointments.
import assert from 'node:assert/strict';
import { upcomingClientAppointments as up } from '../js/deal-appointment.js';
const C = 'Greenblock Property Services LTD', T = '2026-11-18';
const appts = [
  { id: 'mwji', clientName: C, leadName: 'Courtice Flea Market', apptDate: '2026-11-18', apptTime: '11:30', dealId: 'ea64' },
  { id: 'old', clientName: C, leadName: 'Kashaneh Guest House', apptDate: '2026-11-10', apptTime: '11:30', dealId: 'b467' },
  { id: 'hand', clientName: C, leadName: 'Hand Entered', apptDate: '2026-11-25', apptTime: '' },
  { id: 'other', clientName: 'Airlast', leadName: 'X', apptDate: '2026-11-19' },
];
const deals = [
  { id: 'ea64', pipeline: 'Client', stage: C, company: 'Courtice Flea Market', bookedDate: '2026-11-18', bookedTime: '11:30:00' },
  { id: 'c795', pipeline: 'Client', stage: C, company: '205 & 207 Morningside Ave - Signet Group', bookedDate: '2026-11-23', bookedTime: '13:30:00', leadSource: 'cold_call' },
  { id: '5e20', pipeline: 'Client', stage: C, company: 'Alexis Lodge', bookedDate: '2026-11-20', bookedTime: '13:30:00', leadSource: 'cold_call' },
  { id: 'hx', pipeline: 'Client', stage: C, company: 'Hand Entered', bookedDate: '2026-11-25' },
  { id: 'past', pipeline: 'Client', stage: C, company: 'Past', bookedDate: '2026-11-10' },
  { id: 'gone', pipeline: 'Client', stage: C, company: 'Gone', bookedDate: '2026-11-21', leadStatus: 'cancelled' },
  { id: 'acq', pipeline: 'Acquisition', stage: C, company: 'Acq', bookedDate: '2026-11-21' },
  { id: 'bad', pipeline: 'Client', stage: C, company: 'Bad', bookedDate: 'next week' },
];
const r = up(appts, deals, C, T);
assert.deepEqual(r.map(a => a.leadName), ['Courtice Flea Market', 'Alexis Lodge', '205 & 207 Morningside Ave - Signet Group', 'Hand Entered']);
const signet = r.find(a => a.dealId === 'c795');
assert.equal(signet.fromDeal, true); assert.equal(signet.apptTime, '13:30'); assert.equal(signet.id, undefined);
assert.equal(r.find(a => a.leadName === 'Courtice Flea Market').fromDeal, undefined);
assert.deepEqual(up(null, null, C, T), []);
console.log('upcoming-appointments: ok');
