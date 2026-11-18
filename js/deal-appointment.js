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

// Upcoming meetings for a client = appointments rows + live cards booked on the board with no row.
// Only the CRM's Book button / Calendly write appointments; a date typed into the card's Booked Date
// field (how the cold-call reps book, e.g. Marcell's Greenblock bookings, 2026-11-18) never did, so
// those meetings were missing from the deal card's Upcoming Appointments and the column header.
// Same rule as the client_appointments RPC's `bd` branch: pipeline Client, stage = client, booked.
// Card-derived entries carry fromDeal:true and no id (nothing to delete in appointments).
export function upcomingClientAppointments(appts, deals, clientName, today) {
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  const rows = (appts || []).filter(a => a.clientName === clientName && isDate(a.apptDate) && a.apptDate >= today);
  const linked = new Set((appts || []).filter(a => a.dealId).map(a => String(a.dealId)));
  const key = (name, date) => String(name || '').trim().toLowerCase() + '|' + date;
  const named = new Set(rows.map(a => key(a.leadName, a.apptDate)));
  for (const d of deals || []) {
    if (d.pipeline !== 'Client' || d.stage !== clientName || !isDate(d.bookedDate) || d.bookedDate < today) continue;
    if (d.leadStatus && d.leadStatus !== 'active') continue;
    if (linked.has(String(d.id))) continue;
    const leadName = d.company || d.contact || 'Unknown';
    if (named.has(key(leadName, d.bookedDate))) continue;
    rows.push({ fromDeal: true, dealId: d.id, clientName, leadName, apptDate: d.bookedDate,
      apptTime: String(d.bookedTime || '').slice(0, 5), address: (d.location || d.address || '').trim() });
  }
  return rows.sort((a, b) => (a.apptDate + (a.apptTime || '')).localeCompare(b.apptDate + (b.apptTime || '')));
}
