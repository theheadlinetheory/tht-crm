// ═══════════════════════════════════════════════════════════
// DEAL APPOINTMENT — one appointments row per deal (audit A1#4, A3#8 — Tim, 2026-11-13)
// ═══════════════════════════════════════════════════════════
// Booking through the CRM inserted a new appointments row every time, with no deal link, so a rebook (or two
// SDRs booking the same lead) left the old time on the client's Appointments list, and archiving the card
// never removed it. appointments.deal_id (+ unique index) arrived in migration 20261113000400_r2T; a booking
// for a deal now replaces that deal's previous row, and a DB trigger deletes it when the card is archived for
// a non-delivered reason. Rows without a deal (hand-entered) behave as before. DOM-free for node tests.

// Local list: drop this deal's previous appointment(s), then add the new one.
export function replaceDealAppointment(list, appt) {
  const rest = (list || []).filter(a => !(appt.dealId && String(a.dealId || '') === String(appt.dealId)));
  return [...rest, appt];
}

// DB: upsert on deal_id (insert when there is no deal). `db` is the supabase client.
export async function saveDealAppointmentRow(db, row) {
  const q = row.deal_id
    ? db.from('appointments').upsert(row, { onConflict: 'deal_id' })
    : db.from('appointments').insert(row);
  const { error } = await q;
  if (error) throw error;
}

// Upcoming meetings for a client = appointments rows + live cards booked on the board with no row
// + delivered meetings in the Lead Tracker.
// Only the CRM's Book button / Calendly write appointments; a date typed into the card's Booked Date
// field (how the cold-call reps book, e.g. Marcell's Greenblock bookings, 2026-11-18) never did, and
// once such a card is passed off it is archived and its meeting lives only in lead_tracker. Both were
// missing from the deal card's Upcoming Appointments, the column header and the Client Info panel.
// Same sources as the client_appointments RPC (lt + bd + ap). Entries not from appointments carry
// fromDeal:true and no id (nothing to delete in appointments).
const isIso = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

// lead_tracker.appt_date is "11/20/26" (or ISO); appt_time is free text like "Friday, November 20, 1:30 PM".
export function trackerApptDate(v) {
  const s = String(v || '').trim();
  if (isIso(s.slice(0, 10))) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return '';
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}
export function trackerApptTime(v) {
  const s = String(v || '');
  let m = s.match(/(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]/) || s.match(/(\d{1,2})\s*([AaPp])\.?[Mm]/);
  if (m) {
    const ap = (m.length === 4 ? m[3] : m[2]).toLowerCase(), min = m.length === 4 ? m[2] : '00';
    let h = parseInt(m[1], 10) % 12; if (ap === 'p') h += 12;
    return String(h).padStart(2, '0') + ':' + min;
  }
  m = s.match(/^(\d{2}):(\d{2})/);
  return m ? m[1] + ':' + m[2] : '';
}

export function upcomingClientAppointments(appts, deals, clientName, today, tracker) {
  const rows = (appts || []).filter(a => a.clientName === clientName && isIso(a.apptDate) && a.apptDate >= today);
  const seenDeal = new Set((appts || []).filter(a => a.dealId).map(a => String(a.dealId)));
  const key = (name, date) => String(name || '').trim().toLowerCase() + '|' + date;
  const named = new Set(rows.map(a => key(a.leadName, a.apptDate)));
  const add = (r) => {
    if (r.dealId && seenDeal.has(String(r.dealId))) return;
    if (named.has(key(r.leadName, r.apptDate))) return;
    if (r.dealId) seenDeal.add(String(r.dealId));
    named.add(key(r.leadName, r.apptDate));
    rows.push({ fromDeal: true, clientName, ...r });
  };
  for (const d of deals || []) {
    if (d.pipeline !== 'Client' || d.stage !== clientName || !isIso(d.bookedDate) || d.bookedDate < today) continue;
    if (d.leadStatus && d.leadStatus !== 'active') continue;
    add({ dealId: d.id, leadName: d.company || d.contact || 'Unknown', apptDate: d.bookedDate,
      apptTime: String(d.bookedTime || '').slice(0, 5), address: (d.location || d.address || '').trim() });
  }
  for (const t of tracker || []) {
    if (t.clientName !== clientName) continue;
    const date = trackerApptDate(t.apptDate);
    if (!date || date < today) continue;
    add({ dealId: t.dealId || null, leadName: t.leadName || 'Unknown', apptDate: date, apptTime: trackerApptTime(t.apptTime), address: '' });
  }
  return rows.sort((a, b) => (a.apptDate + (a.apptTime || '')).localeCompare(b.apptDate + (b.apptTime || '')));
}
