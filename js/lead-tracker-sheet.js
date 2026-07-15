// ═══════════════════════════════════════════════════════════
// LEAD-TRACKER-SHEET — UI-free helper for creating/linking sheets
// ═══════════════════════════════════════════════════════════
import { invokeEdgeFunction, sbUpdateClient } from './api.js?v=20260715b';
import { state } from './app.js?v=20260715b';

// Create + link a client's Lead Tracker sheet if it doesn't have one yet.
// Idempotent: returns the existing sheetId when already present (ONE sheet per client).
// UI-free: no DOM or `event` access — safe to call from any flow.
// Returns the sheetId, or null on failure.
export async function ensureLeadTrackerSheet(clientId, clientName, useInboxColumns) {
  const client = state.clients.find(x => String(x.id) === String(clientId));
  const existing = client && client.clientSheetId ? String(client.clientSheetId).trim() : '';
  if (existing) return existing;

  const result = await invokeEdgeFunction('client-sheet-setup', {
    action: 'create_sheet',
    clientName,
    hasInboxMgmt: !!useInboxColumns,
  });
  if (!result || !result.sheetId) {
    throw new Error(result && result.error ? result.error : 'No sheet ID returned');
  }

  if (client) client.clientSheetId = result.sheetId;
  await sbUpdateClient(clientId, { client_sheet_id: result.sheetId });
  return result.sheetId;
}
