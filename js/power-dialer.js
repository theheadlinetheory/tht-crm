// ═══════════════════════════════════════════════════════════
// POWER DIALER — State, data access, CSV parsing, handlers
// ═══════════════════════════════════════════════════════════
import { supabase, showToast, sbCreateDeal, camelToSnake } from './api.js?v=20260703f';
import { state } from './app.js?v=20260703f';
import { uid, getToday } from './utils.js?v=20260703f';
import { render as _render } from './render.js?v=20260703f';
function render() { state._pdRenderRequested = true; _render(); }
import { getBestNumberForLead, loadNumberHealth } from './number-health.js?v=20260703f';
import { currentUser } from './auth.js?v=20260703f';
import { JUSTCALL_USER_MAP } from './config.js?v=20260703f';
import { renderList, renderSetup, renderDialer, renderAnalytics, STANDARD_FIELDS, DISPOSITIONS, formatPhone, fmtDuration } from './pd-views.js?v=20260703f';
import { initMiniMap, cleanupMaps, showCampaignSettings, showScriptEditor, bookCall, showStrategyPicker } from './pd-actions.js?v=20260703f';
import { COUNTRY_CODES, parseCSV, autoDetectMapping, normalizePhone, splitPhones, buildContacts } from './pd-csv.js?v=20260703f';

// ─── Module State ───
let _campaigns = null;
let _view = 'list';
let _setupStep = 1;
let _setupName = '';
let _csvHeaders = [];
let _csvRows = [];
let _csvFileName = '';
let _fieldMapping = {};
let _countryCode = '1';
let _customFields = [];
let _setupScript = '';
let _setupOrder = 'lifo';
let _activeCampaign = null;
let _queue = [];
let _queueIndex = 0;
let _sessionStart = null;
let _sessionDuration = 0;
let _durationTimer = null;
let _showDisposition = false;
let _leadCreated = false;
let _saving = false;
let _callHistory = null;
let _dialingAlt = false;

// ─── Data Access ───

async function loadCampaigns() {
  const { data, error } = await supabase.from('dialer_campaigns')
    .select('*').order('created_at', { ascending: false });
  if (error) { showToast('Failed to load campaigns: ' + error.message, 'error'); return; }
  _campaigns = data || [];
}

async function loadQueue(campaignId) {
  const { data, error } = await supabase.from('dialer_contacts')
    .select('*').eq('campaign_id', campaignId).eq('status', 'pending')
    .order('position', { ascending: _activeCampaign?.dialing_order === 'fifo' })
    .range(0, 49);
  if (error) { showToast('Failed to load contacts: ' + error.message, 'error'); return; }
  _queue = (data || []).filter(c => (c.phone || '').replace(/\D/g, '').length >= 7 || (c.alternate_phone || '').replace(/\D/g, '').length >= 7);
  for (const c of _queue) {
    if (c.phone && c.phone.includes(',')) {
      const parts = c.phone.split(',').map(p => p.trim()).filter(Boolean);
      const cc = _activeCampaign?.field_mapping?._countryCode;
      c.phone = normalizePhone(parts[0], cc);
      if (!c.alternate_phone && parts.length > 1) c.alternate_phone = normalizePhone(parts[1], cc);
    }
    if ((c.phone || '').replace(/\D/g, '').length < 7 && (c.alternate_phone || '').replace(/\D/g, '').length >= 7) {
      c.phone = c.alternate_phone;
      c.alternate_phone = '';
    }
  }
  _queueIndex = 0;
}

async function saveCampaign(name, script, order, fieldMapping, customFieldsMeta, contacts) {
  const meta = { ...fieldMapping };
  if (customFieldsMeta.length) meta._customFields = customFieldsMeta;
  const { data: campaign, error: cErr } = await supabase.from('dialer_campaigns')
    .insert({ name, script, dialing_order: order, field_mapping: meta, total_contacts: contacts.length, created_by: currentUser?.email || '' })
    .select().single();
  if (cErr) throw cErr;
  for (let i = 0; i < contacts.length; i += 200) {
    const batch = contacts.slice(i, i + 200).map((c, idx) => ({ ...c, campaign_id: campaign.id, position: i + idx }));
    const { error: bErr } = await supabase.from('dialer_contacts').insert(batch);
    if (bErr) throw bErr;
  }
  return campaign;
}

async function saveDisposition(contact, outcome, notes, doNotCall) {
  const status = doNotCall ? 'do_not_call' : 'completed';
  const { error } = await supabase.from('dialer_contacts')
    .update({ status, call_outcome: outcome, call_notes: notes, do_not_call: doNotCall, called_at: new Date().toISOString() })
    .eq('id', contact.id);
  if (error) console.warn('Disposition save failed:', error.message);

  const isAnswered = outcome && !['No Answer', 'Wrong Number', 'Disconnected Number'].includes(outcome);
  await supabase.from('dialer_campaigns').update({
    completed_contacts: (_activeCampaign.completed_contacts || 0) + 1,
    answered_calls: (_activeCampaign.answered_calls || 0) + (isAnswered ? 1 : 0),
  }).eq('id', _activeCampaign.id);
  _activeCampaign.completed_contacts = (_activeCampaign.completed_contacts || 0) + 1;
  if (isAnswered) _activeCampaign.answered_calls = (_activeCampaign.answered_calls || 0) + 1;
}

async function skipContact(contact) {
  await supabase.from('dialer_contacts').update({ status: 'skipped' }).eq('id', contact.id);
  await supabase.from('dialer_campaigns').update({
    skipped_contacts: (_activeCampaign.skipped_contacts || 0) + 1,
  }).eq('id', _activeCampaign.id);
  _activeCampaign.skipped_contacts = (_activeCampaign.skipped_contacts || 0) + 1;
}

// ─── Duration Timer ───

function startTimer() {
  _sessionStart = Date.now(); _sessionDuration = 0;
  clearInterval(_durationTimer);
  _durationTimer = setInterval(() => {
    _sessionDuration = Math.floor((Date.now() - _sessionStart) / 1000);
    const el = document.getElementById('pd-duration');
    if (el) el.textContent = fmtDuration(_sessionDuration);
  }, 1000);
}

function stopTimer() {
  clearInterval(_durationTimer);
  if (_activeCampaign && _sessionDuration > 0) {
    supabase.from('dialer_campaigns').update({
      total_duration_seconds: (_activeCampaign.total_duration_seconds || 0) + _sessionDuration,
    }).eq('id', _activeCampaign.id);
  }
}

function advanceToNext() {
  _showDisposition = false; _leadCreated = false; _dialingAlt = false;
  cleanupMaps();
  _queue.splice(_queueIndex, 1);
  if (_queueIndex >= _queue.length) _queueIndex = 0;
  if (!_queue.length) loadQueue(_activeCampaign.id).then(() => render());
  else render();
}

function buildDialerSrc(contact, best, phoneOverride) {
  const phone = phoneOverride || normalizePhone(contact.phone);
  if (!phone) return '';
  let src = 'https://app.justcall.io/dialer?numbers=' + encodeURIComponent(phone);
  if (best?.number) src += '&caller_id=' + encodeURIComponent(best.number);
  const jcId = currentUser?.email ? JUSTCALL_USER_MAP[currentUser.email.toLowerCase()] : null;
  if (jcId) src += '&agent_id=' + jcId;
  src += '&medium=custom&metadata_type=json&metadata=' + encodeURIComponent(JSON.stringify({ contact_id: contact.id, campaign_id: _activeCampaign?.id }));
  return src;
}

// ─── Main Render Export ───

export function isPowerDialerActive() {
  return _view === 'dialer' || _view === 'setup';
}

export function renderPowerDialer() {
  const isDialer = _view === 'dialer';
  let h = isDialer ? '<div>' : '<div style="padding:16px 20px">';
  if (_view === 'list') {
    if (!_campaigns) { loadCampaigns().then(() => render()); }
    h += renderList(_campaigns);
  } else if (_view === 'setup') {
    h += renderSetup({ step: _setupStep, name: _setupName, headers: _csvHeaders, rows: _csvRows, fileName: _csvFileName, mapping: _fieldMapping, countryCode: _countryCode, countryCodes: COUNTRY_CODES, customFields: _customFields, script: _setupScript, order: _setupOrder });
  } else if (isDialer) {
    const contact = _queue[_queueIndex];
    const best = contact ? getBestNumberForLead(normalizePhone(contact.phone)) : null;
    h += renderDialer({
      campaign: _activeCampaign, queue: _queue, queueIndex: _queueIndex,
      showDisposition: _showDisposition, saving: _saving, leadCreated: _leadCreated,
      sessionDuration: _sessionDuration,
      suggestedNumber: best ? formatPhone(best.number) : 'No suggestion',
      suggestedRegion: best?.region || '',
      recordingUrl: contact?.recording_url || '',
      dialerSrc: contact ? buildDialerSrc(contact, best, _dialingAlt ? normalizePhone(contact.alternate_phone) : null) : '',
      dialingAlt: _dialingAlt,
    });
  } else if (_view === 'analytics') {
    h += renderAnalytics(_activeCampaign, _callHistory);
  }
  if (isDialer) requestAnimationFrame(initMiniMap);
  return h + '</div>';
}

// ─── Window Handlers ───

window.pdStartSetup = async () => {
  _view = 'setup'; _setupStep = 1; _setupName = ''; _csvHeaders = []; _csvRows = []; _csvFileName = '';
  _fieldMapping = {}; _countryCode = '1'; _customFields = []; _setupScript = ''; _setupOrder = 'lifo';
  if (!window._dialerDefaultFields) {
    const { data } = await supabase.from('crm_settings').select('value').eq('key','dialer_default_fields').single();
    window._dialerDefaultFields = data?.value ? JSON.parse(data.value) : [];
  }
  _customFields = (window._dialerDefaultFields || []).map(f => ({ key: f.key, label: f.label, csvHeader: '' }));
  render();
};

window.pdBackToList = () => {
  stopTimer(); _view = 'list'; _activeCampaign = null; _queue = []; _showDisposition = false; _leadCreated = false;
  loadCampaigns().then(() => render());
};

window.pdSetupNext = () => {
  if (_setupStep === 1) {
    const el = document.getElementById('pd-campaign-name');
    if (el) _setupName = el.value.trim();
    if (!_setupName) { showToast('Enter a campaign name', 'error'); return; }
    if (!_csvHeaders.length) { showToast('Upload a CSV first', 'error'); return; }
    _setupStep = 2;
  } else if (_setupStep === 2) {
    if (!_fieldMapping.phone) { showToast('Phone Number mapping is required', 'error'); return; }
    _setupStep = 3;
  }
  render();
};

window.pdSetupBack = () => { _setupStep = Math.max(1, _setupStep - 1); render(); };

window.pdSetMapping = (fieldKey, csvHeader) => {
  if (csvHeader) _fieldMapping[fieldKey] = csvHeader; else delete _fieldMapping[fieldKey]; render();
};

window.pdNameChanged = (val) => { _setupName = val; };
window.pdScriptChanged = (val) => { _setupScript = val; };

window.pdAddCustomField = () => {
  _customFields.push({ key: 'custom_' + Date.now(), label: '', csvHeader: '' });
  render();
};

window.pdSetCustomLabel = (idx, label) => { _customFields[idx].label = label; };

window.pdSetCustomMapping = (idx, csvHeader) => {
  _customFields[idx].csvHeader = csvHeader;
  const label = _customFields[idx].label.trim();
  if (!label && csvHeader) _customFields[idx].label = csvHeader;
  render();
};

window.pdRemoveCustomField = (idx) => { _customFields.splice(idx, 1); render(); };

window.pdInsertToken = (token) => {
  const ta = document.getElementById('pd-script');
  if (!ta) return;
  const start = ta.selectionStart, end = ta.selectionEnd;
  ta.value = ta.value.substring(0, start) + token + ta.value.substring(end);
  ta.selectionStart = ta.selectionEnd = start + token.length; ta.focus();
};

window.pdHandleFile = (file) => {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const { headers, rows } = parseCSV(e.target.result);
    if (!headers.length) { showToast('CSV appears empty', 'error'); return; }
    _csvHeaders = headers; _csvRows = rows; _csvFileName = file.name;
    _fieldMapping = autoDetectMapping(headers, STANDARD_FIELDS); render();
  };
  reader.readAsText(file);
};

window.pdClearCsv = () => {
  _csvHeaders = []; _csvRows = []; _csvFileName = ''; _fieldMapping = {}; render();
};

window.pdSetCountryCode = (code) => { _countryCode = code; };

window.pdFinishSetup = async () => {
  const scriptEl = document.getElementById('pd-script');
  if (scriptEl) _setupScript = scriptEl.value;
  const orderRadio = document.querySelector('input[name="pd-order"]:checked');
  if (orderRadio) _setupOrder = orderRadio.value;
  const contacts = buildContacts(_csvHeaders, _csvRows, _fieldMapping, _customFields, _countryCode);
  const skipped = buildContacts._skippedNoPhone || 0;
  if (!contacts.length) { showToast('No contacts with valid phone numbers', 'error'); return; }
  try {
    showToast(`Creating campaign...${skipped ? ` (${skipped} rows skipped — no phone)` : ''}`, 'success');
    _fieldMapping._countryCode = _countryCode;
    const cfMeta = _customFields.filter(cf => cf.label.trim() && cf.csvHeader).map(cf => ({ key: cf.key, label: cf.label }));
    await saveCampaign(_setupName, _setupScript, _setupOrder, _fieldMapping, cfMeta, contacts);
    showToast(`Campaign "${_setupName}" created with ${contacts.length} contacts${skipped ? ` (${skipped} skipped — no phone)` : ''}`, 'success');
    _view = 'list'; _campaigns = null; render();
  } catch (e) { showToast('Failed to create campaign: ' + e.message, 'error'); }
};

window.pdPlayCampaign = async (id) => {
  const campaign = _campaigns?.find(c => c.id === id);
  if (!campaign) return;
  _activeCampaign = campaign; _view = 'dialer'; _showDisposition = false; _leadCreated = false;
  render();
  await Promise.all([loadQueue(id), loadNumberHealth().catch(() => {})]);
  if (!_queue.length) { showToast('No pending contacts in this campaign', 'error'); _view = 'list'; _activeCampaign = null; }
  startTimer(); render();
};

window.pdShowAnalytics = (id) => {
  const campaign = _campaigns?.find(c => c.id === id);
  if (!campaign) return;
  _activeCampaign = campaign; _view = 'analytics'; _callHistory = null; render();
};

window.pdCampaignSettings = (id) => showCampaignSettings(id, _campaigns, render);

window.pdLoadHistory = async (campaignId) => {
  const { data } = await supabase.from('dialer_contacts')
    .select('name, phone, call_outcome, call_duration_seconds, recording_url, called_at')
    .eq('campaign_id', campaignId).in('status', ['completed', 'do_not_call'])
    .order('called_at', { ascending: false }).range(0, 49);
  _callHistory = data || []; render();
};

window.pdDeleteCampaign = (id) => {
  if (!confirm('Delete this campaign and all its contacts?')) return;
  supabase.from('dialer_campaigns').delete().eq('id', id).then(({ error }) => {
    if (error) { showToast('Delete failed: ' + error.message, 'error'); return; }
    _campaigns = _campaigns.filter(c => c.id !== id); showToast('Campaign deleted', 'success'); render();
  });
};

window.pdDial = (phoneType) => {
  const contact = _queue[_queueIndex];
  if (phoneType === 'alt') _dialingAlt = true;
  else if (phoneType === 'mobile') _dialingAlt = false;
  const rawPhone = _dialingAlt ? contact?.alternate_phone : contact?.phone;
  if (!rawPhone) { showToast('No phone number', 'error'); _dialingAlt = false; return; }
  const phone = normalizePhone(rawPhone);
  const best = getBestNumberForLead(phone);
  const src = buildDialerSrc(contact, best, phone);
  const iframe = document.getElementById('pd-dialer-iframe');
  if (iframe) iframe.src = src;
  render();
};

window.pdSkip = async () => { const c = _queue[_queueIndex]; if (c) { await skipContact(c); advanceToNext(); } };
window.pdShowDisp = () => { _showDisposition = true; _leadCreated = false; render(); };

window.pdSaveDisposition = async () => {
  const contact = _queue[_queueIndex]; if (!contact) return;
  const outcome = document.getElementById('pd-outcome')?.value || '';
  const notes = document.getElementById('pd-notes')?.value || '';
  const dnc = document.getElementById('pd-dnc')?.checked || false;
  _saving = true; render();
  await saveDisposition(contact, outcome, notes, dnc);
  _saving = false; advanceToNext();
};

window.pdCreateLead = async () => {
  const contact = _queue[_queueIndex];
  if (!contact || _leadCreated) return;
  try {
    await sbCreateDeal(camelToSnake({
      id: uid(), company: contact.company || '', contact: contact.name || '',
      phone: contact.phone || '', email: contact.email || '', location: contact.address || '',
      stage: 'Cold Email Response', pipeline: 'acquisition',
      createdDate: getToday(), lastUpdated: new Date().toISOString(),
    }));
    _leadCreated = true; showToast('Lead created in Acquisition pipeline', 'success'); render();
  } catch (e) { showToast('Failed to create lead: ' + e.message, 'error'); }
};

window.pdEditScript = () => showScriptEditor(_activeCampaign, render);
window.pdBookCall = (type) => bookCall(type, _queue, _queueIndex);
window.pdShowStrategyPicker = () => showStrategyPicker(_queue, _queueIndex);

window.pdRefreshContact = async () => {
  const contact = _queue[_queueIndex];
  if (!contact) return;
  const { data } = await supabase.from('dialer_contacts').select('recording_url, call_duration_seconds, justcall_call_id, call_outcome').eq('id', contact.id).single();
  if (data) { Object.assign(contact, data); render(); }
};

window.pdJumpTo = (idx) => { _queueIndex = idx; _showDisposition = false; _leadCreated = false; _dialingAlt = false; cleanupMaps(); render(); };
window.pdEndDialing = () => { window.pdBackToList(); };
window._pdSetupName = '';
window._pdSetupOrder = 'lifo';
