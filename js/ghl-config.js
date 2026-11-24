// Is this client set up for GoHighLevel, judged without the API key?
// clients_visible() hides ghl_api_key from every non-admin (money lock, 2026-11-14), so a check on the key made
// employees' pass-offs skip GHL silently. push-to-ghl holds the key itself and errors if it is missing.
export function ghlSetUp(c) {
  return ['ghlLocationId', 'ghlPipelineId', 'ghlStageId'].every(k => String(c?.[k] ?? '').trim() !== '');
}
