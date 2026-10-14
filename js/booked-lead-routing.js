// ═══════════════════════════════════════════════════════════
// BOOKED LEAD ROUTING — where a client lead goes once it's delivered
// ═══════════════════════════════════════════════════════════
// PPM (per-lead) clients: Lead Tracker → PPM Meetings, deal archived Closed Won.
// Retainer clients: the Pass Off flow → Retainer Leads (pass_offs, with a
// "Booked appt" badge when the deal has a booking), deal archived Passed Off.
import { isRetainerClient } from './client-info.js?v=20261014145359';

export async function deliverBookedLead(deal, clientName) {
  if (isRetainerClient(deal)) {
    const { openPassOffPreview } = await import('./email.js?v=20261014145359');
    return openPassOffPreview(deal.id, clientName);
  }
  const { autoPushToTracker } = await import('./email.js?v=20261014145359');
  await autoPushToTracker(deal);
  const { deleteDeal } = await import('./deals.js?v=20261014145359');
  deleteDeal(deal.id, 'Closed Won', clientName);
}
