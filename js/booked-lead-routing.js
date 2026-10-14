// ═══════════════════════════════════════════════════════════
// BOOKED LEAD ROUTING — where a client lead goes once it's delivered
// ═══════════════════════════════════════════════════════════
// PPM (per-lead) clients: Lead Tracker → PPM Meetings, deal archived Meeting Booked
// ("Closed Won" is acquisition-only — a client we signed).
// Retainer clients: the Pass Off flow → Retainer Leads (pass_offs, with a
// "Booked appt" badge when the deal has a booking), deal archived Passed Off.
import { isRetainerClient } from './client-info.js?v=20261014150146';

export async function deliverBookedLead(deal, clientName) {
  if (isRetainerClient(deal)) {
    const { openPassOffPreview } = await import('./email.js?v=20261014150146');
    return openPassOffPreview(deal.id, clientName);
  }
  const { autoPushToTracker } = await import('./email.js?v=20261014150146');
  await autoPushToTracker(deal);
  const { deleteDeal } = await import('./deals.js?v=20261014150146');
  deleteDeal(deal.id, 'Meeting Booked', clientName);
}
