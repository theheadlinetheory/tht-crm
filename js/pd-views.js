// ═══════════════════════════════════════════════════════════
// PD-VIEWS — Power Dialer rendering (pure HTML generators)
// ═══════════════════════════════════════════════════════════
import { esc, svgIcon, str } from './utils.js?v=20260714f';

const IS_MX_RECORD = /mail\.protection|aspmx|mx\d|ppe-hosted|pphosted|mimecast/i;

function resolveWebsite(contact) {
  const cf = contact.custom_fields || {};
  const ls = contact.lead_source || '';
  const val = cf['Company Website'] || cf['company_website'] || cf['Website'] || cf['website'] || (IS_MX_RECORD.test(ls) ? '' : ls);
  const isUrl = val.startsWith('http://') || val.startsWith('https://');
  const isDomain = !isUrl && /^[a-z0-9-]+(\.[a-z]{2,})+$/i.test(val.trim());
  const href = isUrl ? val : isDomain ? 'https://' + val.trim() : '';
  return { val, href };
}

const DISPOSITIONS = [
  'Interested - Appointment Set', 'Interested - Needs Follow-Up', 'Qualified Lead',
  'Information Sent', 'Callback Scheduled', 'Sale Closed', 'Follow-Up Required',
  'Needs More Time', 'Left Voicemail', 'No Answer', 'Language Barrier',
  'Not Interested', 'Budget Issues', 'Product/Service Not Needed',
  'Already Using Competitor', 'Decision Maker Unavailable', 'Unqualified Lead',
  'Wrong Number', 'Disconnected Number', 'Do Not Call'
];

export { DISPOSITIONS };

const STANDARD_FIELDS = [
  { key: 'phone', label: 'Phone Number', required: true },
  { key: 'name', label: 'Name' },
  { key: 'company', label: 'Company' },
  { key: 'email', label: 'Email' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'lead_source', label: 'Lead Source' },
  { key: 'address', label: 'Address' },
  { key: 'occupation', label: 'Occupation' },
  { key: 'alternate_phone', label: 'Alternate Phone' },
];

export { STANDARD_FIELDS };

export function formatPhone(phone) {
  const d = (phone || '').replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return phone || '';
}

export function fmtDuration(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [h, m, sec].map(v => String(v).padStart(2, '0')).join(':');
}

function bestName(contact) {
  const n = (contact.name || '').trim();
  if (n && n.split(/\s+/).length <= 4 && n.length <= 40) return n;
  if (contact.company) return contact.company;
  return n || 'Unknown';
}

export function mergeScript(script, contact) {
  const cleanName = bestName(contact);
  const replacements = {
    name: cleanName !== 'Unknown' ? cleanName : 'there',
    company: str(contact.company) || 'your company',
    email: str(contact.email),
    address: str(contact.address),
    occupation: str(contact.occupation),
    lead_source: str(contact.lead_source),
  };
  let s = script;
  for (const [key, val] of Object.entries(replacements)) {
    s = s.replace(new RegExp(`\\{\\{?${key}\\}?\\}`, 'gi'), val);
  }
  s = s.replace(/\{\{?\d+%(\w+)\}?\}/gi, (_m, field) => replacements[field.toLowerCase()] || '');
  s = s.replace(/\{\{?(custom_\d+)\}?\}/g, (_m, key) => str(contact.custom_fields?.[key]) || '');
  return s;
}

function statCard(label, value, color) {
  return `<div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:16px;text-align:center">
    <div style="font-size:24px;font-weight:700;color:${color}">${value}</div>
    <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${label}</div>
  </div>`;
}

// ─── Campaign List ───

export function renderList(campaigns) {
  if (!campaigns) return '<div style="padding:40px;text-align:center;color:var(--text-muted)">Loading campaigns...</div>';

  let h = '<div style="max-width:1000px;margin:0 auto">';
  h += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
    <h3 style="margin:0;font-size:16px">Power Dialer Campaigns</h3>
    <button class="btn btn-primary" onclick="pdStartSetup()" style="font-size:12px;display:flex;align-items:center;gap:6px">${svgIcon('phone', 12, '#fff')} Create Campaign</button>
  </div>`;

  if (!campaigns.length) {
    h += '<div style="padding:40px;text-align:center;color:var(--text-muted);background:var(--card);border:1px solid var(--border);border-radius:8px">No campaigns yet. Upload a CSV to get started.</div>';
    return h + '</div>';
  }

  h += `<div style="border:1px solid var(--border);border-radius:8px;background:var(--card);overflow:hidden">
    <table style="width:100%;border-collapse:collapse;font-size:12px">
    <thead><tr style="background:#f9fafb;border-bottom:2px solid var(--border)">
      <th style="padding:8px 12px;text-align:left;font-weight:600">Name</th>
      <th style="padding:8px 12px;text-align:left;font-weight:600;width:200px">Progress</th>
      <th style="padding:8px 12px;text-align:center;font-weight:600">Status</th>
      <th style="padding:8px 12px;text-align:center;font-weight:600">Connect Rate</th>
      <th style="padding:8px 12px;text-align:center;font-weight:600">Actions</th>
    </tr></thead><tbody>`;

  for (const c of campaigns) {
    const pct = c.total_contacts > 0 ? Math.round((c.completed_contacts / c.total_contacts) * 100) : 0;
    const connectRate = c.completed_contacts > 0 ? Math.round((c.answered_calls / c.completed_contacts) * 100) : 0;
    const statusColor = c.status === 'active' ? '#16a34a' : c.status === 'completed' ? '#6b7280' : '#d97706';
    h += `<tr style="border-bottom:1px solid #f3f4f6">
      <td style="padding:8px 12px;font-weight:500">${esc(c.name)}</td>
      <td style="padding:8px 12px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden"><div style="width:${pct}%;height:100%;background:#3b82f6;border-radius:3px"></div></div>
          <span style="font-size:11px;color:var(--text-muted);white-space:nowrap">${c.completed_contacts} / ${c.total_contacts}</span>
        </div>
      </td>
      <td style="padding:8px 12px;text-align:center"><span style="font-size:10px;font-weight:600;color:${statusColor};background:${statusColor}15;padding:2px 8px;border-radius:4px;text-transform:uppercase">${c.status}</span></td>
      <td style="padding:8px 12px;text-align:center;font-weight:600;color:${connectRate >= 50 ? '#16a34a' : connectRate >= 20 ? '#d97706' : '#6b7280'}">${c.completed_contacts > 0 ? connectRate + '%' : '-'}</td>
      <td style="padding:8px 12px;text-align:center;display:flex;gap:4px;justify-content:center">
        <button class="btn btn-primary" style="font-size:11px;padding:4px 10px" onclick="pdPlayCampaign('${c.id}')" title="Start Dialing">${svgIcon('phone', 11, '#fff')}</button>
        <button class="btn btn-ghost" style="font-size:11px;padding:4px 6px" onclick="pdCampaignSettings('${c.id}')" title="Settings">${svgIcon('settings', 11)}</button>
        <button class="btn btn-ghost" style="font-size:11px;padding:4px 6px" onclick="pdShowAnalytics('${c.id}')" title="Analytics">${svgIcon('bar-chart', 11)}</button>
        <button class="btn btn-ghost" style="font-size:11px;padding:4px 6px;color:#dc2626" onclick="pdDeleteCampaign('${c.id}')" title="Delete">×</button>
      </td>
    </tr>`;
  }
  h += '</tbody></table></div></div>';
  return h;
}

// ─── Setup Wizard ───

export function renderSetup(ctx) {
  const { step, name, headers, rows, fileName, mapping, countryCode, countryCodes, script, order } = ctx;
  let h = '<div style="max-width:800px;margin:0 auto">';

  const steps = ['Upload CSV', 'Map Fields', 'Script & Settings'];
  h += `<div style="display:flex;gap:4px;margin-bottom:20px;align-items:center">
    <button class="btn btn-ghost" onclick="pdBackToList()" style="font-size:11px;margin-right:8px">← Back</button>`;
  for (let i = 0; i < steps.length; i++) {
    const active = i + 1 === step, done = i + 1 < step;
    h += `<div style="display:flex;align-items:center;gap:6px">
      <div style="width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;${done ? 'background:#16a34a;color:#fff' : active ? 'background:var(--purple);color:#fff' : 'background:#e5e7eb;color:var(--text-muted)'}">${done ? '✓' : i + 1}</div>
      <span style="font-size:12px;font-weight:${active ? '600' : '400'};color:${active ? 'var(--text-primary)' : 'var(--text-muted)'}">${steps[i]}</span>
      ${i < 2 ? '<div style="width:40px;height:1px;background:#e5e7eb;margin:0 4px"></div>' : ''}
    </div>`;
  }
  h += '</div>';

  if (step === 1) {
    h += `<div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:20px">
      <label style="font-size:13px;font-weight:600;display:block;margin-bottom:8px">Campaign Name</label>
      <input id="pd-campaign-name" value="${esc(name)}" oninput="pdNameChanged(this.value)" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font);margin-bottom:20px;box-sizing:border-box" placeholder="e.g. HVAC C-Suite US">
      <label style="font-size:13px;font-weight:600;display:block;margin-bottom:8px">Upload Contacts (CSV)</label>`;
    if (headers.length) {
      h += `<div style="border:2px solid #bbf7d0;border-radius:8px;padding:16px;background:#f0fdf4">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:8px">
            <div style="font-size:12px;font-weight:600;color:#16a34a">✓ ${esc(fileName || 'CSV')} — ${rows.length} contacts (${headers.length} columns)</div>
          </div>
          <button class="btn btn-ghost" onclick="pdClearCsv()" style="font-size:11px;padding:4px 10px;color:#dc2626">✕ Clear</button>
        </div>
      </div>`;
    } else {
      h += `<div id="pd-drop-zone" style="border:2px dashed var(--border);border-radius:8px;padding:40px;text-align:center;cursor:pointer" onclick="document.getElementById('pd-file-input').click()">
        <input type="file" id="pd-file-input" accept=".csv" style="display:none" onchange="pdHandleFile(this.files[0])">
        <div style="margin-bottom:8px">${svgIcon('upload', 24, '#9ca3af')}</div>
        <div style="color:#3b82f6;font-weight:600;font-size:13px">Click to upload</div>
        <div style="color:var(--text-muted);font-size:11px;margin-top:4px">CSV file</div>
      </div>`;
    }
    h += `<div style="margin-top:16px;text-align:right"><button class="btn btn-primary" style="font-size:12px" onclick="pdSetupNext()" ${!headers.length ? 'disabled style="font-size:12px;opacity:.5;pointer-events:none"' : ''}>Next →</button></div></div>`;
  }

  if (step === 2) {
    const cc = countryCode || '1';
    const ccList = countryCodes || [];
    h += `<div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div style="font-size:13px;font-weight:600">Map CSV Fields</div>
        <div style="display:flex;align-items:center;gap:8px">
          <label style="font-size:11px;font-weight:600;color:var(--text-muted)">Country Code</label>
          <select onchange="pdSetCountryCode(this.value)" style="padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:var(--font)">
            ${ccList.map(c => `<option value="${c.code}" ${c.code === cc ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
          </select>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#f9fafb;border-bottom:2px solid var(--border)">
        <th style="padding:8px 10px;text-align:left;font-weight:600">Dialer Field</th>
        <th style="padding:8px 10px;text-align:left;font-weight:600">CSV Column</th>
        <th style="padding:8px 10px;text-align:left;font-weight:600">Preview</th>
      </tr></thead><tbody>`;
    for (const field of STANDARD_FIELDS) {
      const mapped = mapping[field.key] || '';
      const previewIdx = mapped ? headers.indexOf(mapped) : -1;
      const preview = previewIdx >= 0 && rows[0] ? rows[0][previewIdx] || '' : '';
      h += `<tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:6px 10px;font-weight:500">${field.label}${field.required ? ' <span style="color:#dc2626">*</span>' : ''}</td>
        <td style="padding:6px 10px"><select onchange="pdSetMapping('${field.key}',this.value)" style="padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:var(--font);min-width:150px">
          <option value="">Select a field</option>
          ${headers.map(h2 => `<option value="${esc(h2)}" ${mapped === h2 ? 'selected' : ''}>${esc(h2)}</option>`).join('')}
        </select></td>
        <td style="padding:6px 10px;color:var(--text-muted);max-width:200px;overflow:hidden;text-overflow:ellipsis">${esc(preview)}</td>
      </tr>`;
    }
    const customFields = ctx.customFields || [];
    for (let i = 0; i < customFields.length; i++) {
      const cf = customFields[i];
      const cfPreviewIdx = cf.csvHeader ? headers.indexOf(cf.csvHeader) : -1;
      const cfPreview = cfPreviewIdx >= 0 && rows[0] ? rows[0][cfPreviewIdx] || '' : '';
      h += `<tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:6px 10px"><input type="text" value="${esc(cf.label)}" placeholder="Field name" onchange="pdSetCustomLabel(${i},this.value)" style="padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:var(--font);width:120px"></td>
        <td style="padding:6px 10px;display:flex;align-items:center;gap:6px"><select onchange="pdSetCustomMapping(${i},this.value)" style="padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:var(--font);min-width:150px">
          <option value="">Select a field</option>
          ${headers.map(h2 => `<option value="${esc(h2)}" ${cf.csvHeader === h2 ? 'selected' : ''}>${esc(h2)}</option>`).join('')}
        </select><button onclick="pdRemoveCustomField(${i})" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:14px;padding:2px 4px" title="Remove">×</button></td>
        <td style="padding:6px 10px;color:var(--text-muted);max-width:200px;overflow:hidden;text-overflow:ellipsis">${esc(cfPreview)}</td>
      </tr>`;
    }
    h += `</tbody></table>
      <button onclick="pdAddCustomField()" style="margin-top:10px;background:none;border:1px dashed var(--border);border-radius:6px;padding:6px 14px;font-size:12px;color:var(--text-muted);cursor:pointer;font-family:var(--font)">+ Add Custom Field</button>
      <div style="margin-top:16px;display:flex;justify-content:space-between">
        <button class="btn btn-ghost" style="font-size:12px" onclick="pdSetupBack()">← Back</button>
        <button class="btn btn-primary" style="font-size:12px" onclick="pdSetupNext()" ${!mapping.phone ? 'disabled style="font-size:12px;opacity:.5;pointer-events:none"' : ''}>Next →</button>
      </div></div>`;
  }

  if (step === 3) {
    const tokens = STANDARD_FIELDS.map(f => ({ insert: `{${f.key}}`, label: `{${f.key}}` }));
    const customFields = (ctx.customFields || []).filter(cf => cf.label.trim() && cf.csvHeader);
    customFields.forEach(cf => tokens.push({ insert: `{${cf.key}}`, label: `{${cf.label}}` }));
    h += `<div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:20px">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px">Call Script</div>
      <div style="margin-bottom:8px;display:flex;gap:4px;flex-wrap:wrap">${tokens.map(t => `<button class="btn btn-ghost" style="font-size:10px;padding:2px 6px" onclick="pdInsertToken('${esc(t.insert)}')">${esc(t.label)}</button>`).join('')}</div>
      <textarea id="pd-script" oninput="pdScriptChanged(this.value)" style="width:100%;height:120px;padding:10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font);resize:vertical;box-sizing:border-box" placeholder="Hey {name}, this is Aidan from The Headline Theory. I came across {company} while...">${esc(script)}</textarea>
      <div style="margin-top:16px;font-size:13px;font-weight:600;margin-bottom:8px">Dialing Order</div>
      <div style="display:flex;gap:12px">
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="radio" name="pd-order" value="fifo" ${order === 'fifo' ? 'checked' : ''} onchange="window._pdSetupOrder='fifo'"> First in first out</label>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="radio" name="pd-order" value="lifo" ${order === 'lifo' ? 'checked' : ''} onchange="window._pdSetupOrder='lifo'"> Last in first out</label>
      </div>
      <div style="margin-top:20px;display:flex;justify-content:space-between">
        <button class="btn btn-ghost" style="font-size:12px" onclick="pdSetupBack()">← Back</button>
        <button class="btn btn-primary" style="font-size:12px" onclick="pdFinishSetup()">Create Campaign</button>
      </div></div>`;
  }

  return h + '</div>';
}

// ─── Active Dialer ───

export function renderDialer(ctx) {
  const { campaign, queue, queueIndex, showDisposition, saving, leadCreated, sessionDuration, suggestedNumber, suggestedRegion, recordingUrl, dialingAlt } = ctx;

  if (!campaign || !queue.length) {
    return `<div style="padding:40px;text-align:center;color:var(--text-muted)">
      <div style="font-size:16px;font-weight:600;margin-bottom:8px">Campaign Complete</div>
      <div>All contacts have been dialed.</div>
      <button class="btn btn-primary" style="margin-top:16px;font-size:12px" onclick="pdBackToList()">Back to Campaigns</button>
    </div>`;
  }

  const contact = queue[queueIndex];
  if (!contact) return renderDialer(Object.assign({}, ctx, { queue: [] }));

  const completed = campaign.completed_contacts || 0, skipped = campaign.skipped_contacts || 0;
  const answered = campaign.answered_calls || 0, total = campaign.total_contacts || 0;
  let h = '';

  // Top Stats Bar
  h += `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px;background:#f9fafb;border-bottom:1px solid var(--border);font-size:12px">
    <div style="font-weight:600">${esc(campaign.name)}</div>
    <div style="display:flex;gap:20px;align-items:center">
      <div style="text-align:center"><div style="font-weight:700" id="pd-duration">${fmtDuration(sessionDuration)}</div><div style="font-size:10px;color:var(--text-muted)">Duration</div></div>
      <div style="text-align:center"><div style="font-weight:700">${completed + skipped} of ${total}</div><div style="font-size:10px;color:var(--text-muted)">Contacts</div></div>
      <div style="text-align:center"><div style="font-weight:700">${answered}</div><div style="font-size:10px;color:var(--text-muted)">Answered</div></div>
      <div style="text-align:center"><div style="font-weight:700">${skipped}</div><div style="font-size:10px;color:var(--text-muted)">Skipped</div></div>
      <button class="btn btn-ghost" style="font-size:11px;color:#dc2626;border-color:#dc2626" onclick="pdEndDialing()">End Dialing</button>
    </div>
  </div>`;

  const { val: websiteVal, href: wsHref } = resolveWebsite(contact);
  const altPhone = contact.alternate_phone || '';
  const hasAlt = altPhone.replace(/\D/g, '').length >= 7;
  const dialerSrc = ctx.dialerSrc || '';

  h += '<div style="display:flex;height:calc(100vh - 180px);overflow:hidden">';

  // Left: Embedded JustCall Dialer
  h += `<div style="width:375px;border-right:1px solid var(--border);flex-shrink:0;display:flex;flex-direction:column;background:#0f172a">
    <div style="padding:8px 12px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
      <div style="display:flex;flex-direction:column;gap:1px">
        <span style="color:#fff;font-size:12px;font-weight:600">${esc(bestName(contact))}</span>
        <span style="color:#38bdf8;font-size:11px;font-weight:700;background:rgba(56,189,248,.15);padding:1px 6px;border-radius:4px">${suggestedRegion || 'Dialer'}</span>
      </div>
      ${hasAlt ? `<button onclick="pdDial('${dialingAlt ? 'mobile' : 'alt'}')" style="background:rgba(56,189,248,.15);border:1px solid rgba(56,189,248,.3);color:#38bdf8;font-size:10px;padding:4px 10px;border-radius:4px;cursor:pointer;font-family:var(--font);font-weight:600">${dialingAlt ? 'Switch to Mobile' : 'Switch to Alt'}</button>` : ''}
    </div>
    <iframe id="pd-dialer-iframe" src="${esc(dialerSrc)}" allow="microphone; autoplay; clipboard-read; clipboard-write; hid" style="flex:1;width:100%;border:none;background:#fff"></iframe>
  </div>`;

  // Center: Contact info + script + actions
  h += '<div style="flex:1;overflow-y:auto;padding:20px">';
  if (showDisposition) {
    h += renderDisposition(contact, saving, leadCreated);
  } else {
    h += `<div style="margin-bottom:16px">
      <div style="font-size:20px;font-weight:700;margin-bottom:4px">${esc(bestName(contact))}</div>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <span style="font-size:13px;color:var(--text-muted)">${formatPhone(contact.phone)}</span>
        ${hasAlt ? `<span style="font-size:12px;color:#0369a1;background:#f0f9ff;padding:2px 8px;border-radius:4px;border:1px solid #bae6fd">Alt: ${formatPhone(altPhone)}</span>` : ''}
        ${contact.company ? `<span style="font-size:13px;color:var(--text-muted)">· ${esc(contact.company)}</span>` : ''}
        ${wsHref ? `<a href="${esc(wsHref)}" target="_blank" style="font-size:12px;color:#3b82f6;text-decoration:none;display:inline-flex;align-items:center;gap:3px">${svgIcon('external-link', 11, '#3b82f6')} ${esc(websiteVal)}</a>` : ''}
      </div>
    </div>`;
    h += `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between">
      <div>
        <div style="font-size:10px;font-weight:600;color:#16a34a;text-transform:uppercase">Calling From</div>
        <div style="font-size:16px;font-weight:700;color:#15803d">${suggestedNumber}${suggestedRegion ? ` <span style="font-size:11px;font-weight:500;color:#4d7c0f">(${suggestedRegion})</span>` : ''}</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-ghost" style="font-size:11px;padding:6px 14px" onclick="pdSkip()">Skip</button>
        <button class="btn btn-ghost" style="font-size:11px;padding:6px 14px" onclick="pdShowDisp()">Log Outcome</button>
        <button class="btn btn-ghost" style="font-size:11px;padding:6px 10px" onclick="pdRefreshContact()" title="Refresh">${svgIcon('refresh-cw', 11)}</button>
      </div>
    </div>`;
    if (campaign.script) {
      const merged = mergeScript(campaign.script, contact);
      h += `<div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:16px">
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;display:flex;align-items:center;justify-content:space-between">
          Call Script <button class="btn btn-ghost" style="font-size:10px;padding:2px 8px" onclick="pdEditScript()">Edit</button>
        </div>
        <div id="pd-script-display" style="font-size:13px;line-height:1.6;white-space:pre-wrap">${esc(merged)}</div>
      </div>`;
    } else {
      h += `<div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:16px;text-align:center">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">No call script set</div>
        <button class="btn btn-ghost" style="font-size:11px" onclick="pdEditScript()">Add Script</button>
      </div>`;
    }
  }
  h += '</div>';

  // Right: Contact Details (prominent) + Up Next (3 items, faded)
  h += `<div style="width:360px;border-left:1px solid var(--border);flex-shrink:0;background:#fafafa;display:flex;flex-direction:column;overflow:hidden">`;
  // Contact details section — takes all available space
  h += '<div style="flex:1;overflow-y:auto;padding:16px">';
  h += '<div style="font-size:12px;font-weight:700;color:var(--text-primary);text-transform:uppercase;margin-bottom:14px;letter-spacing:.5px">Contact Details</div>';
  const cf = contact.custom_fields || {};
  const { val: wsVal, href: wsLink } = resolveWebsite(contact);
  if (wsVal) {
    h += `<div style="margin-bottom:14px;padding:12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px">
      <div style="font-size:10px;color:#3b82f6;font-weight:600;margin-bottom:4px">WEBSITE</div>
      <div style="font-size:14px;font-weight:600">${wsLink ? `<a href="${esc(wsLink)}" target="_blank" style="color:#2563eb;text-decoration:none">${esc(wsVal)}</a>` : esc(wsVal)}</div>
    </div>`;
  }
  const mapAddr = contact.address || cf['Company Location'] || cf.city || cf['Company City'] || '';
  if (mapAddr) {
    h += `<div style="margin-bottom:14px">
      <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;display:flex;align-items:center;justify-content:space-between">
        LOCATION <button class="btn btn-ghost" style="font-size:9px;padding:2px 6px" onclick="pdExpandMap()">Expand</button>
      </div>
      <div id="pd-mini-map" data-addr="${esc(mapAddr)}" style="width:100%;height:180px;border:1px solid var(--border);border-radius:8px;background:#f1f5f9"></div>
    </div>`;
  }
  const fields = [['Phone', formatPhone(contact.phone)], ['Company', contact.company],
    ['Email', contact.email], ['LinkedIn', contact.linkedin],
    ['Address', contact.address], ['Occupation', contact.occupation], ['Alt Phone', formatPhone(contact.alternate_phone)]];
  for (const [label, val] of fields) {
    if (!val) continue;
    const isUrl = val.startsWith('http://') || val.startsWith('https://');
    const isDomain = !isUrl && /^[a-z0-9-]+(\.[a-z]{2,})+$/i.test(val.trim());
    const href = isUrl ? val : isDomain ? 'https://' + val.trim() : '';
    h += `<div style="margin-bottom:12px"><div style="font-size:10px;color:var(--text-muted);margin-bottom:3px">${label}</div>
      <div style="font-size:13px;font-weight:500">${href ? `<a href="${esc(href)}" target="_blank" style="color:#3b82f6">${esc(val)}</a>` : esc(val)}</div></div>`;
  }
  const cfMeta = campaign?.field_mapping?._customFields || [];
  const cfLabelMap = Object.fromEntries(cfMeta.map(cf => [cf.key, cf.label]));
  if (contact.custom_fields && typeof contact.custom_fields === 'object') {
    for (const [k, v] of Object.entries(contact.custom_fields)) {
      if (!v) continue;
      const label = cfLabelMap[k] || k;
      const isUrl = String(v).startsWith('http://') || String(v).startsWith('https://');
      const isDomain = !isUrl && /^[a-z0-9-]+(\.[a-z]{2,})+$/i.test(String(v).trim());
      const href = isUrl ? v : isDomain ? 'https://' + String(v).trim() : '';
      h += `<div style="margin-bottom:12px"><div style="font-size:10px;color:var(--text-muted);margin-bottom:3px">${esc(label)}</div>
        <div style="font-size:13px;font-weight:500">${href ? `<a href="${esc(href)}" target="_blank" style="color:#3b82f6">${esc(String(v))}</a>` : esc(String(v))}</div></div>`;
    }
  }
  if (recordingUrl) {
    h += `<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
      <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px">RECORDING</div>
      <audio controls preload="none" style="width:100%;height:32px" src="${esc(recordingUrl)}"></audio>
    </div>`;
  }
  h += '</div>';
  // Up Next — shows 3 visible, scrollable for more
  const nextItems = [];
  for (let i = 0; i < queue.length; i++) {
    if (i === queueIndex) continue;
    nextItems.push({ q: queue[i], i });
  }
  if (nextItems.length) {
    h += `<div style="flex-shrink:0;border-top:1px solid var(--border);max-height:140px;overflow-y:auto">
      <div style="padding:6px 14px;font-size:9px;font-weight:600;color:var(--text-muted);text-transform:uppercase;background:#f3f4f6;position:sticky;top:0;z-index:1">Up Next (${nextItems.length})</div>`;
    nextItems.forEach((item, idx) => {
      const opacity = idx >= 3 ? '0.4' : idx === 2 ? '0.6' : '1';
      h += `<div style="padding:5px 14px;border-top:1px solid #f3f4f6;cursor:pointer;opacity:${opacity}" onclick="pdJumpTo(${item.i})">
        <div style="font-size:11px;font-weight:500;color:var(--text-primary)">
          ${esc(bestName(item.q))} <span style="font-size:10px;color:var(--text-muted);font-weight:400">${formatPhone(item.q.phone)}</span>
        </div>
      </div>`;
    });
    h += '</div>';
  }
  h += '</div></div>';
  return h;
}

// ─── Disposition Form ───

function renderDisposition(contact, saving, leadCreated) {
  return `<div style="max-width:500px;margin:0 auto">
    <div style="font-size:16px;font-weight:700;margin-bottom:16px">Call Disposition</div>
    <div style="margin-bottom:12px">
      <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Call Outcome</label>
      <select id="pd-outcome" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font)">
        <option value="">None Selected</option>
        ${DISPOSITIONS.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}
      </select>
    </div>
    <div style="margin-bottom:12px">
      <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Call Notes</label>
      <textarea id="pd-notes" style="width:100%;height:80px;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--font);resize:vertical;box-sizing:border-box" placeholder="Optional notes..."></textarea>
    </div>
    <div style="margin-bottom:16px">
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" id="pd-dnc"> Do not call again</label>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary" style="font-size:12px" onclick="pdSaveDisposition()" ${saving ? 'disabled' : ''}>${saving ? 'Saving...' : 'Save'}</button>
      <button class="btn btn-ghost" style="font-size:12px;color:#16a34a;border-color:#16a34a" onclick="pdCreateLead()" id="pd-create-lead-btn" ${leadCreated ? 'disabled style="font-size:12px;color:#6b7280;border-color:#e5e7eb"' : ''}>
        ${leadCreated ? '✓ Lead Created' : '+ Create Lead'}
      </button>
    </div>
    <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
      <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px">Book a Call</div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" style="flex:1;font-size:12px;background:#2563eb;border-color:#2563eb;display:flex;align-items:center;justify-content:center;gap:4px" onclick="pdBookCall('demo')">
          ${svgIcon('calendar',12,'#fff')} Demo Call
        </button>
        <button class="btn btn-primary" style="flex:1;font-size:12px;background:#7c3aed;border-color:#7c3aed;display:flex;align-items:center;justify-content:center;gap:4px" onclick="pdShowStrategyPicker()">
          ${svgIcon('calendar',12,'#fff')} Strategy Call
        </button>
      </div>
    </div>
  </div>`;
}

// ─── Analytics ───

export function renderAnalytics(campaign, callHistory) {
  const c = campaign;
  const connectRate = c.completed_contacts > 0 ? Math.round((c.answered_calls / c.completed_contacts) * 100) : 0;
  const remaining = c.total_contacts - (c.completed_contacts || 0) - (c.skipped_contacts || 0);
  let h = `<div style="max-width:800px;margin:0 auto">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <button class="btn btn-ghost" onclick="pdBackToList()" style="font-size:11px">← Back</button>
      <h3 style="margin:0;font-size:16px">${esc(c.name)} — Analytics</h3>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px">
      ${statCard('Total Contacts', c.total_contacts, '#3b82f6')}
      ${statCard('Completed', c.completed_contacts || 0, '#16a34a')}
      ${statCard('Remaining', remaining, '#d97706')}
      ${statCard('Answered', c.answered_calls || 0, '#8b5cf6')}
      ${statCard('Skipped', c.skipped_contacts || 0, '#6b7280')}
      ${statCard('Connect Rate', connectRate + '%', connectRate >= 50 ? '#16a34a' : '#d97706')}
    </div>
    <div style="text-align:center;color:var(--text-muted);font-size:12px;margin-bottom:24px">Total Duration: ${fmtDuration(c.total_duration_seconds || 0)}</div>`;

  if (!callHistory) {
    h += `<div style="text-align:center;padding:16px"><button class="btn btn-ghost" style="font-size:12px" onclick="pdLoadHistory('${c.id}')">Load Call History</button></div>`;
  } else if (callHistory.length === 0) {
    h += '<div style="text-align:center;color:var(--text-muted);font-size:12px;padding:16px">No completed calls yet.</div>';
  } else {
    h += `<div style="font-size:13px;font-weight:600;margin-bottom:8px">Call History</div>
      <div style="border:1px solid var(--border);border-radius:8px;background:var(--card);overflow:hidden">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#f9fafb;border-bottom:2px solid var(--border)">
        <th style="padding:6px 10px;text-align:left;font-weight:600">Name</th>
        <th style="padding:6px 10px;text-align:left;font-weight:600">Phone</th>
        <th style="padding:6px 10px;text-align:left;font-weight:600">Outcome</th>
        <th style="padding:6px 10px;text-align:center;font-weight:600">Duration</th>
        <th style="padding:6px 10px;text-align:center;font-weight:600">Recording</th>
      </tr></thead><tbody>`;
    for (const ct of callHistory) {
      const dur = ct.call_duration_seconds ? fmtDuration(ct.call_duration_seconds) : '-';
      h += `<tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:6px 10px;font-weight:500">${esc(ct.name || '-')}</td>
        <td style="padding:6px 10px">${formatPhone(ct.phone)}</td>
        <td style="padding:6px 10px;color:var(--text-muted)">${esc(ct.call_outcome || '-')}</td>
        <td style="padding:6px 10px;text-align:center">${dur}</td>
        <td style="padding:6px 10px;text-align:center">${ct.recording_url ? `<audio controls preload="none" style="height:28px;max-width:180px" src="${esc(ct.recording_url)}"></audio>` : '<span style="color:#d1d5db">-</span>'}</td>
      </tr>`;
    }
    h += '</tbody></table></div>';
  }

  return h + '</div>';
}
