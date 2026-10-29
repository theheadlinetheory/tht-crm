// ═══════════════════════════════════════════════════════════
// BOOKED LEAD ROUTING — where a client lead goes once it's delivered
// ═══════════════════════════════════════════════════════════
// PPM (per-lead) clients: Lead Tracker → PPM Meetings, deal archived Meeting Booked
// ("Closed Won" is acquisition-only — a client we signed).
// Retainer clients: the Pass Off flow → Retainer Leads (pass_offs, with a
// "Booked appt" badge when the deal has a booking), deal archived Passed Off.
// Exception: a retainer client we also set appointments for (Lead Tracker on,
// Pass-Off off in Settings — e.g. Kinsley) goes the PPM route at its $0 lead cost,
// so the meeting is logged without changing how the client is billed.
import { isRetainerClient, findClientForDeal } from './client-info.js?v=20261029081943';
import { str } from './utils.js?v=20261029081943';
import { state } from './app.js?v=20261029081943';

function tracksMeetings(deal) {
  const c = findClientForDeal(deal) || state.clients.find(x => x.name === deal.stage);
  const on = v => str(v).toUpperCase() === 'TRUE';
  return !!c && on(c.enableTracker) && !on(c.enablePassoff);
}

export async function deliverBookedLead(deal, clientName) {
  if (isRetainerClient(deal) && !tracksMeetings(deal)) {
    const { openPassOffPreview } = await import('./email.js?v=20261029081943');
    return openPassOffPreview(deal.id, clientName);
  }
  const { autoPushToTracker } = await import('./email.js?v=20261029081943');
  await autoPushToTracker(deal);
  const { deleteDeal } = await import('./deals.js?v=20261029081943');
  deleteDeal(deal.id, 'Meeting Booked', clientName);
}
