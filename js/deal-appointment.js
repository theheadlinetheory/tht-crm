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
