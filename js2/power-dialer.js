// ═══════════════════════════════════════════════════════════
// POWER DIALER — State, data access, CSV parsing, handlers
// ═══════════════════════════════════════════════════════════
import { supabase, showToast, sbCreateDeal, camelToSnake } from './api.js?v=20260618a';
import { state } from './app.js?v=20260618a';
import { uid, getToday } from './utils.js?v=20260618a';
import { render as _render } from './render.js?v=20260618a';
function render() { state._pdRenderRequested = true; _render(); }
import { getBestNumberForLead } from './number-health.js?v=20260618a';
import { currentUser } from './auth.js?v=20260618a';
import { JUSTCALL_USER_MAP, ACQ_CALENDLY_URLS } from './config.js?v=20260618a';
import { openCalendlyEmbed } from './calendly.js?v=20260618a';
import { renderList, renderSetup, renderDialer, renderAnalytics, STANDARD_FIELDS, DISPOSITIONS, formatPhone, fmtDuration } from './pd-views.js?v=20260618a';

const COUNTRY_CODES = [
  { code: '1', label: 'US / Canada (+1)', national: 10 },
  { code: '44', label: 'United Kingdom (+44)', national: 10 },
  { code: '61', label: 'Australia (+61)', national: 9 },
  { code: '64', label: 'New Zealand (+64)', national: 9 },
  { code: '91', label: 'India (+91)', national: 10 },
  { code: '49', label: 'Germany (+49)', national: 11 },
  { code: '33', label: 'France (+33)', national: 9 },
  { code: '52', label: 'Mexico (+52)', national: 10 },
  { code: '55', label: 'Brazil (+55)', national: 11 },
  { code: '971', label: 'UAE (+971)', national: 9 },
];

const AUTO_DETECT = {
  'phone': ['phone', 'mobile phone', 'mobile', 'phone number', 'cell', 'telephone'],
  'name': ['name', 'first name', 'firstname', 'contact', 'contact name'],
  'company': ['company', 'organization', 'org', 'company name', 'business'],
  'email': ['email', 'email address', 'email business', 'e-mail'],
  'linkedin': ['linkedin', 'linkedin url', 'profile url', 'linkedin/profile url'],
  'lead_source': ['lead source', 'source', 'mx records', 'origin'],
  'address': ['address', 'location', 'city', 'state'],
  'occupation': ['occupation', 'title', 'job title', 'role', 'position'],
  'alternate_phone': ['alternate phone', 'alt phone', 'secondary phone', 'other phone'],
};

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
  _queue = (data || []).filter(c => (c.phone || '').replace(/\D/g, '').length >= 7);
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

// ─── CSV Parsing ───

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(field.trim()); field = ''; }
      else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        if (ch === '\r') i++;
        row.push(field.trim()); field = '';
        if (row.some(c => c)) rows.push(row);
        row = [];
      } else field += ch;
    }
  }
  row.push(field.trim());
  if (row.some(c => c)) rows.push(row);
  if (rows.length < 2) return { headers: [], rows: [] };
  return { headers: rows[0], rows: rows.slice(1) };
}

function autoDetectMapping(headers) {
  const mapping = {};
  for (const field of STANDARD_FIELDS) {
    const aliases = AUTO_DETECT[field.key] || [];
    const match = headers.find(h => aliases.includes(h.toLowerCase().trim()));
    if (match) mapping[field.key] = match;
  }
  return mapping;
}

function buildContacts(headers, rows, mapping, customFields, countryCode) {
  const mappedHeaders = new Set(Object.values(mapping));
  const validCustom = (customFields || []).filter(cf => cf.label.trim() && cf.csvHeader);
  validCustom.forEach(cf => mappedHeaders.add(cf.csvHeader));
  const contacts = [];
  let skippedNoPhone = 0;
  for (const row of rows) {
    const contact = {};
    for (const [fieldKey, csvHeader] of Object.entries(mapping)) {
      const idx = headers.indexOf(csvHeader);
      if (idx >= 0) contact[fieldKey] = row[idx] || '';
    }
    const digits = (contact.phone || '').replace(/\D/g, '');
    if (digits.length < 7) { skippedNoPhone++; continue; }
    contact.phone = normalizePhone(contact.phone, countryCode);
    if (contact.alternate_phone) contact.alternate_phone = normalizePhone(contact.alternate_phone, countryCode);
    const custom = {};
    for (const cf of validCustom) {
      const idx = headers.indexOf(cf.csvHeader);
      if (idx >= 0) custom[cf.key] = row[idx] || '';
    }
    headers.forEach((h, i) => { if (!mappedHeaders.has(h) && row[i]) custom[h] = row[i]; });
    if (Object.keys(custom).length) contact.custom_fields = custom;
    contacts.push(contact);
  }
  if (skippedNoPhone) buildContacts._skippedNoPhone = skippedNoPhone;
  else buildContacts._skippedNoPhone = 0;
  return contacts;
}

function normalizePhone(phone, cc) {
  const code = cc || _activeCampaign?.field_mapping?._countryCode || '1';
  const d = (phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith(code)) return '+' + d;
  const info = COUNTRY_CODES.find(c => c.code === code);
  if (info && d.length === info.national) return '+' + code + d;
  return '+' + code + d;
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
  _showDisposition = false; _leadCreated = false;
  _queue.splice(_queueIndex, 1);
  if (_queueIndex >= _queue.length) _queueIndex = 0;
  if (!_queue.length) loadQueue(_activeCampaign.id).then(() => render());
  else render();
}

// ─── Main Render Export ───

export function isPowerDialerActive() {
  return _view === 'dialer' || _view === 'setup';
}

export function renderPowerDialer() {
  let h = '<div style="padding:16px 20px">';
  if (_view === 'list') {
    if (!_campaigns) { loadCampaigns().then(() => render()); }
    h += renderList(_campaigns);
  } else if (_view === 'setup') {
    h += renderSetup({ step: _setupStep, name: _setupName, headers: _csvHeaders, rows: _csvRows, fileName: _csvFileName, mapping: _fieldMapping, countryCode: _countryCode, countryCodes: COUNTRY_CODES, customFields: _customFields, script: _setupScript, order: _setupOrder });
  } else if (_view === 'dialer') {
    const contact = _queue[_queueIndex];
    const best = contact ? getBestNumberForLead(normalizePhone(contact.phone)) : null;
    h += renderDialer({
      campaign: _activeCampaign, queue: _queue, queueIndex: _queueIndex,
      showDisposition: _showDisposition, saving: _saving, leadCreated: _leadCreated,
      sessionDuration: _sessionDuration,
      suggestedNumber: best ? formatPhone(best.number) : 'No suggestion',
      suggestedRegion: best?.region || '',
      recordingUrl: contact?.recording_url || '',
    });
  } else if (_view === 'analytics') {
    h += renderAnalytics(_activeCampaign, _callHistory);
  }
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
    _fieldMapping = autoDetectMapping(headers); render();
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
  await loadQueue(id);
  if (!_queue.length) { showToast('No pending contacts in this campaign', 'error'); _view = 'list'; _activeCampaign = null; }
  startTimer(); render();
};

window.pdShowAnalytics = (id) => {
  const campaign = _campaigns?.find(c => c.id === id);
  if (!campaign) return;
  _activeCampaign = campaign; _view = 'analytics'; _callHistory = null; render();
};

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

window.pdDial = () => {
  const contact = _queue[_queueIndex];
  if (!contact?.phone) { showToast('No phone number', 'error'); return; }
  const phone = normalizePhone(contact.phone);
  const best = getBestNumberForLead(phone);
  let src = 'https://app.justcall.io/dialer?numbers=' + encodeURIComponent(phone);
  if (best?.number) src += '&caller_id=' + encodeURIComponent(best.number);
  const jcId = currentUser?.email ? JUSTCALL_USER_MAP[currentUser.email.toLowerCase()] : null;
  if (jcId) src += '&agent_id=' + jcId;
  src += '&medium=custom&metadata_type=json&metadata=' + encodeURIComponent(JSON.stringify({ contact_id: contact.id, campaign_id: _activeCampaign?.id }));

  const widget = document.getElementById('justcall-widget');
  const title = document.getElementById('justcall-widget-title');
  const dialerEl = document.getElementById('justcall-dialer');
  if (widget) { widget.style.display = 'flex'; widget.style.height = '90vh'; }
  if (title) title.textContent = contact.name || contact.company || formatPhone(contact.phone);
  if (dialerEl) dialerEl.style.display = '';

  const existing = document.getElementById('justcall-dialer-iframe');
  if (existing?.contentWindow) { existing.src = src; }
  else if (dialerEl) {
    dialerEl.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.id = 'justcall-dialer-iframe'; iframe.src = src;
    iframe.allow = 'microphone; autoplay; clipboard-read; clipboard-write; hid';
    iframe.style.cssText = 'width:100%;height:100%;border:none';
    dialerEl.appendChild(iframe);
  }
};

window.pdSkip = async () => { const c = _queue[_queueIndex]; if (c) { await skipContact(c); advanceToNext(); } };
window.pdShowDisp = () => { _showDisposition = true; _leadCreated = false; render(); };

window.pdSaveDisposition = async () => {
  const contact = _queue[_queueIndex]; if (!contact) return;
  _saving = true; render();
  const outcome = document.getElementById('pd-outcome')?.value || '';
  const notes = document.getElementById('pd-notes')?.value || '';
  const dnc = document.getElementById('pd-dnc')?.checked || false;
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

window.pdEditScript = () => {
  if (!_activeCampaign) return;
  const existing = document.getElementById('pd-script-editor');
  if (existing) { existing.remove(); return; }
  const div = document.createElement('div');
  div.id = 'pd-script-editor';
  div.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.5);display:flex;justify-content:center;align-items:center';
  div.onclick = (e) => { if (e.target === div) div.remove(); };
  div.innerHTML = `<div style="background:#fff;border-radius:12px;padding:24px;width:560px;max-height:80vh;overflow-y:auto;box-shadow:0 8px 30px rgba(0,0,0,.2)">
    <h3 style="margin:0 0 12px;font-size:16px">Edit Call Script</h3>
    <p style="font-size:11px;color:var(--text-muted);margin:0 0 12px">Use {name}, {company}, {address} for merge fields.</p>
    <textarea id="pd-script-edit-ta" style="width:100%;height:250px;padding:12px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:var(--font);line-height:1.6;resize:vertical;box-sizing:border-box">${_activeCampaign.script || ''}</textarea>
    <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">
      <button class="btn btn-ghost" style="font-size:12px" onclick="document.getElementById('pd-script-editor').remove()">Cancel</button>
      <button class="btn btn-primary" style="font-size:12px" onclick="pdSaveScript()">Save</button>
    </div>
  </div>`;
  document.body.appendChild(div);
};

window.pdSaveScript = async () => {
  const ta = document.getElementById('pd-script-edit-ta');
  if (!ta || !_activeCampaign) return;
  const script = ta.value;
  _activeCampaign.script = script;
  await supabase.from('dialer_campaigns').update({ script }).eq('id', _activeCampaign.id);
  document.getElementById('pd-script-editor')?.remove();
  render();
};

window.pdBookCall = (type) => {
  const contact = _queue[_queueIndex]; if (!contact) return;
  const url = ACQ_CALENDLY_URLS[type]; if (!url) return;
  openCalendlyEmbed(null, url, null, contact.name, contact.email);
};

window.pdShowStrategyPicker = () => {
  const div = document.createElement('div');
  div.id = 'strategy-call-picker';
  div.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.5);display:flex;justify-content:center;align-items:center';
  div.onclick = (e) => { if (e.target === div) div.remove(); };
  div.innerHTML = `<div style="background:#fff;border-radius:12px;padding:24px;width:320px;box-shadow:0 8px 30px rgba(0,0,0,.2)">
    <h3 style="margin:0 0 16px;font-size:16px">Who's booking the strategy call?</h3>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="btn btn-primary" style="width:100%;padding:12px;font-size:13px;background:#7c3aed;border-color:#7c3aed" onclick="document.getElementById('strategy-call-picker').remove();pdBookCall('strategy')">Aidan</button>
      <button class="btn btn-primary" style="width:100%;padding:12px;font-size:13px;background:#2563eb;border-color:#2563eb" onclick="document.getElementById('strategy-call-picker').remove();pdBookCall('strategy_ioannis')">Ioannis</button>
    </div>
    <button class="btn btn-ghost" style="width:100%;margin-top:12px;font-size:12px" onclick="document.getElementById('strategy-call-picker').remove()">Cancel</button>
  </div>`;
  document.body.appendChild(div);
};

window.pdRefreshContact = async () => {
  const contact = _queue[_queueIndex];
  if (!contact) return;
  const { data } = await supabase.from('dialer_contacts').select('recording_url, call_duration_seconds, justcall_call_id, call_outcome').eq('id', contact.id).single();
  if (data) { Object.assign(contact, data); render(); }
};

window.pdJumpTo = (idx) => { _queueIndex = idx; _showDisposition = false; _leadCreated = false; render(); };
window.pdEndDialing = () => { window.pdBackToList(); };
window._pdSetupName = '';
window._pdSetupOrder = 'lifo';
