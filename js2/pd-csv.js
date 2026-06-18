// ═══════════════════════════════════════════════════════════
// PD-CSV — CSV parsing, phone normalization, contact building
// ═══════════════════════════════════════════════════════════

export const COUNTRY_CODES = [
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

export function parseCSV(text) {
  const rows = []; let row = [], field = '', inQuotes = false;
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

export function autoDetectMapping(headers, standardFields) {
  const mapping = {};
  for (const field of standardFields) {
    const aliases = AUTO_DETECT[field.key] || [];
    const match = headers.find(h => aliases.includes(h.toLowerCase().trim()));
    if (match) mapping[field.key] = match;
  }
  return mapping;
}

export function normalizePhone(phone, cc, fallbackCountryCode) {
  const code = cc || fallbackCountryCode || '1';
  const d = (phone || '').trim().replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith(code)) return '+' + d;
  const info = COUNTRY_CODES.find(c => c.code === code);
  if (info && d.length === info.national) return '+' + code + d;
  return '+' + code + d;
}

export function splitPhones(phone, cc, fallbackCountryCode) {
  const parts = (phone || '').split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) return null;
  return parts.slice(1).map(p => normalizePhone(p, cc, fallbackCountryCode));
}

export function buildContacts(headers, rows, mapping, customFields, countryCode) {
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
    const extraPhones = splitPhones(contact.phone, countryCode);
    if (extraPhones?.length && !contact.alternate_phone) {
      contact.alternate_phone = extraPhones[0];
    }
    contact.phone = normalizePhone(contact.phone, countryCode);
    if (contact.alternate_phone) contact.alternate_phone = normalizePhone(contact.alternate_phone, countryCode);
    const primaryDigits = (contact.phone || '').replace(/\D/g, '');
    const altDigits = (contact.alternate_phone || '').replace(/\D/g, '');
    if (primaryDigits.length < 7 && altDigits.length < 7) { skippedNoPhone++; continue; }
    if (primaryDigits.length < 7 && altDigits.length >= 7) {
      contact.phone = contact.alternate_phone;
      contact.alternate_phone = '';
    }
    const custom = {};
    for (const cf of validCustom) {
      const idx = headers.indexOf(cf.csvHeader);
      if (idx >= 0) custom[cf.key] = row[idx] || '';
    }
    headers.forEach((h, i) => { if (!mappedHeaders.has(h) && row[i]) custom[h] = row[i]; });
    if (Object.keys(custom).length) contact.custom_fields = custom;
    contacts.push(contact);
  }
  buildContacts._skippedNoPhone = skippedNoPhone;
  return contacts;
}
