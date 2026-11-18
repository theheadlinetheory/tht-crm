// node scripts/test-upcoming-appointments.mjs — cold-call bookings (date field only) show under Upcoming Appointments.
import assert from 'node:assert/strict';
import { upcomingClientAppointments as up, trackerApptDate, trackerApptTime } from '../js/deal-appointment.js';
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
// Passed-off cold-call cards are archived (not in state.deals); their meeting is only in the Lead Tracker.
const tracker = [
  { clientName: C, leadName: '205 & 207 Morningside Ave - Signet Group', dealId: 'c795', apptDate: '11/23/26', apptTime: 'Monday, November 23, 1:30 PM' },
  { clientName: C, leadName: 'Alexis Lodge', dealId: '5e20', apptDate: '11/20/26', apptTime: 'Friday, November 20, 1:30 PM' },
  { clientName: C, leadName: 'Courtice Flea Market', dealId: 'ea64', apptDate: '11/18/26', apptTime: 'Wednesday, November 18, 11:30 AM' },
  { clientName: C, leadName: 'Old', apptDate: '11/02/26', apptTime: '10 AM' },
  { clientName: 'Airlast', leadName: 'Y', apptDate: '11/30/26' },
];
const live = deals.filter(d => !['c795', '5e20', 'ea64'].includes(d.id));
const t = up(appts.slice(0, 1), live, C, T, tracker);
assert.deepEqual(t.map(a => a.leadName + ' ' + a.apptDate + ' ' + a.apptTime),
  ['Courtice Flea Market 2026-11-18 11:30', 'Alexis Lodge 2026-11-20 13:30', '205 & 207 Morningside Ave - Signet Group 2026-11-23 13:30', 'Hand Entered 2026-11-25 ']);
assert.equal(up(appts, deals, C, T, tracker).length, 4); // no double listing when card + tracker + appointment all exist
assert.equal(trackerApptDate('2026-11-20'), '2026-11-20'); assert.equal(trackerApptDate('garbage'), '');
assert.equal(trackerApptTime('12:15 pm'), '12:15'); assert.equal(trackerApptTime('12 AM'), '00:00'); assert.equal(trackerApptTime('14:00:00'), '14:00');
console.log('upcoming-appointments: ok');
