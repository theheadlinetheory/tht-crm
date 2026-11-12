// ═══════════════════════════════════════════════════════════
// TRACKER REMOVAL — when archiving a card may take its row off the Admin Lead Tracker sheet
// ═══════════════════════════════════════════════════════════
// Audit A1#1 / A4#8 (Tim, 2026-11-13): every archive used to fire push-lead-tracker remove-lead, including
// 'Meeting Booked' — the PPM pass-off itself — and 'Passed Off'. A booked meeting's row flashed onto the sheet
// and was deleted a second later; 39 billed/delivered rows went missing that way.
// The rule is enforced server-side (push-lead-tracker/remove-lead.ts also refuses invoiced or paid rows); the
// browser just stops asking for delivered statuses. Pure + DOM-free so node tests can import it.

export const DELIVERED_ARCHIVE_STATUSES = ['Meeting Booked', 'Passed Off'];

export function shouldRequestTrackerRemoval(archiveStatus) {
  const status = String(archiveStatus || 'Deleted/Lost').trim();
  return !DELIVERED_ARCHIVE_STATUSES.includes(status);
}

// Fire-and-forget like before, but only for a real removal. A 409 (server refused: delivered, invoiced or paid)
// is expected and logged quietly.
export function requestTrackerRemoval(invoke, dealId, archiveStatus) {
  if (!shouldRequestTrackerRemoval(archiveStatus)) return Promise.resolve({ skipped: true });
  return invoke('push-lead-tracker', { action: 'remove-lead', dealId })
    .catch(e => {
      const msg = String((e && e.message) || e);
      if (/refused|not removed|409/i.test(msg)) console.info('[tracker] row kept:', dealId, msg);
      else console.warn('Sheet removal:', msg);
      return { error: msg };
    });
}
