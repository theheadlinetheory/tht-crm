// ═══════════════════════════════════════════════════════════
// CLIENT-PANEL — the overlay behind a client column header
// ═══════════════════════════════════════════════════════════
//
// Split out of client-info.js (which was 345 lines and half presentation) so
// that module stays data/lookup and this one owns the panel. Two things live
// here that didn't before:
//
//   1. FROM ACQUISITION — the client's original Closed Won deal, pulled back out
//      of the archive. The clients table only ever kept one contact, one email
//      and one phone; the rest has been sitting unread in archive.original_data.
//   2. Inline editing for Services, Service Area and warm-call notes. Nothing in
//      the app could edit those, which is why 17 of 22 active clients had no
//      services and the Common Questions answered with boilerplate.
//
// The panel is appended to <body>, NOT to #app, so render() cannot destroy it
// mid-edit. Edits save straight to Supabase (debounced) and patch the affected
// DOM nodes in place — the panel is never wholesale re-rendered while open.

import { state } from './app.js?v=20260910163645';
import { esc, str, getToday, isValidDate, svgIcon } from './utils.js?v=20260910163645';
import { isAdmin } from './auth.js?v=20260910163645';
import { lookupClientInfo } from './client-info.js?v=20260910163645';
import { sbUpdateClient, sbGetWonAcquisitionCards } from './api.js?v=20260910163645';
import { registerActions } from './delegate.js?v=20260910163645';
import { buildAcquisitionCard, indexWonCards, matchCardForClient, answeredQuestions } from './client-acquisition.js?v=20260910163645';

const OVERLAY_ID = 'client-info-overlay';

// ─── Won-archive cache ───
// 200-odd rows, fetched at most once a session and only when someone actually
// opens a panel. Never on boot.
let _wonIndex = null;
let _wonPromise = null;

function loadWonCards() {
  if (_wonIndex) return Promise.resolve(_wonIndex);
  if (!_wonPromise) {
    _wonPromise = sbGetWonAcquisitionCards()
      .then(rows => { _wonIndex = indexWonCards(rows); return _wonIndex; })
      .catch(e => { _wonPromise = null; throw e; });
  }
  return _wonPromise;
}

// ─── Editable fields ───
// field → how it is stored, labelled and edited.
const EDITABLE = {
  services: {
    label: 'Services', column: 'services', multiline: true,
    placeholder: 'One service per line',
    toText: v => (Array.isArray(v) ? v : str(v).split('\n')).map(x => str(x)).filter(Boolean).join('\n'),
    toValue: text => text.split('\n').map(x => x.trim()).filter(Boolean),
    view: v => { const l = (Array.isArray(v) ? v : str(v).split('\n')).map(x => str(x)).filter(Boolean); return l.length ? l.map(x => '• ' + esc(x)).join('<br>') : ''; },
  },
  serviceAreaCities: {
    label: 'Service Area', column: 'service_area_cities', multiline: false,
    placeholder: 'Cities and counties they cover',
    toText: v => str(v),
    toValue: text => text.trim(),
    view: v => esc(str(v)),
  },
  warmCallNotesText: {
    label: 'SDR Quick Reference / Warm Call Notes', column: 'warm_call_notes_text', multiline: true,
    placeholder: 'One note per line',
    toText: v => str(v),
    toValue: text => text.replace(/\n{3,}/g, '\n\n').trim(),
    view: v => { const l = str(v).split('\n').map(x => x.trim()).filter(Boolean); return l.length ? '<ul style="margin:0;padding-left:18px">' + l.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : ''; },
  },
  location: {
    label: 'Home Base', column: 'location', multiline: false,
    placeholder: 'City, ST',
    toText: v => str(v),
    toValue: text => text.trim(),
    view: v => esc(str(v)),
  },
};

function currentClient() {
  return state.clients.find(c => c.name === _openFor) || null;
}

let _openFor = null;
const _saveTimers = {};

// ─── Editable block ───
function editableBlock(field, client, opts = {}) {
  const cfg = EDITABLE[field];
  const raw = client[field];
  const viewHtml = cfg.view(raw);
  const filled = !!viewHtml;
  const tone = opts.tone || {};
  return `<div style="margin-bottom:16px;${tone.wrap || ''}">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span style="font-size:11px;font-weight:700;color:${tone.label || '#64748b'};text-transform:uppercase;letter-spacing:.5px">${esc(cfg.label)}</span>
      <button data-action="cpEdit" data-field="${field}" id="cp-editbtn-${field}"
        style="background:none;border:none;padding:0;font-size:11px;color:#2563eb;cursor:pointer;font-weight:600">${filled ? 'Edit' : '+ Add'}</button>
      <span id="cp-saved-${field}" style="font-size:10px;color:#16a34a;opacity:0;transition:opacity .2s">Saved</span>
    </div>
    <div id="cp-view-${field}" style="font-size:13px;color:${tone.text || '#334155'};line-height:1.6">${filled ? viewHtml : `<span style="color:#94a3b8;font-style:italic">Not recorded yet</span>`}</div>
    <div id="cp-edit-${field}" hidden style="margin-top:6px">
      ${cfg.multiline
        ? `<textarea id="cp-input-${field}" data-action="cpInput" data-field="${field}" rows="5" placeholder="${esc(cfg.placeholder)}"
             style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;font-family:var(--font);resize:vertical">${esc(cfg.toText(raw))}</textarea>`
        : `<input id="cp-input-${field}" data-action="cpInput" data-field="${field}" value="${esc(cfg.toText(raw))}" placeholder="${esc(cfg.placeholder)}"
             style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;font-family:var(--font)">`}
      <button data-action="cpDone" data-field="${field}"
        style="margin-top:6px;padding:4px 12px;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;font-size:11px;cursor:pointer;font-weight:600;color:#334155">Done</button>
    </div>
  </div>`;
}

// ─── From Acquisition ───
function acquisitionHtml(card) {
  const rows = [];
  for (const p of card.contacts) {
    const bits = [];
    if (p.name) bits.push(`<span style="font-weight:600;color:#1e293b">${esc(p.name)}</span>`);
    if (p.title) bits.push(`<span style="color:#64748b">${esc(p.title)}</span>`);
    const head = bits.join(' · ');
    const mails = p.emails.map(e => `<a href="mailto:${esc(e)}" style="color:#2563eb">${esc(e)}</a>`).join(', ');
    const tels = p.phones.map(t => `<a href="tel:${esc(t.replace(/[^+0-9]/g, ''))}" style="color:#2563eb">${esc(t)}</a>`).join(' · ');
    rows.push(`<div style="padding:6px 0;border-top:1px solid #e2e8f0">
      ${head ? `<div style="font-size:12px;margin-bottom:2px">${head}</div>` : ''}
      ${mails ? `<div style="font-size:12px">${mails}</div>` : ''}
      ${tels ? `<div style="font-size:12px">${tels}</div>` : ''}
    </div>`);
  }
  const links = [];
  if (card.website) {
    const href = /^https?:/i.test(card.website) ? card.website : 'https://' + card.website;
    links.push(`<a href="${esc(href)}" target="_blank" rel="noopener" style="color:#2563eb">${esc(card.website)}</a>`);
  }
  if (card.linkedinUrl) links.push(`<a href="${esc(card.linkedinUrl)}" target="_blank" rel="noopener" style="color:#2563eb">LinkedIn ↗</a>`);
  return `<div style="padding:6px 0">
    ${rows.join('')}
    ${links.length ? `<div style="padding:6px 0;border-top:1px solid #e2e8f0;font-size:12px">${links.join(' · ')}</div>` : ''}
    ${card.address ? `<div style="padding:6px 0;border-top:1px solid #e2e8f0;font-size:12px;color:#334155">${esc(card.address)}</div>` : ''}
  </div>`;
}

function fillAcquisitionSection(clientName) {
  loadWonCards().then(idx => {
    if (_openFor !== clientName) return; // panel closed or switched while loading
    const host = document.getElementById('cp-acq');
    if (!host) return;
    const card = buildAcquisitionCard(matchCardForClient(idx, clientName));
    if (!card.hasAnything) {
      host.innerHTML = `<div style="font-size:12px;color:#94a3b8;font-style:italic">No acquisition card archived for this client.</div>`;
      return;
    }
    host.innerHTML = acquisitionHtml(card);
    // A client row with no home base can borrow the one off its acquisition card.
    const cl = currentClient();
    if (cl && !str(cl.location).trim() && card.location) {
      const hint = document.getElementById('cp-loc-hint');
      if (hint) {
        hint.innerHTML = `<button data-action="cpUseAcqLocation" data-value="${esc(card.location)}"
          style="background:none;border:none;padding:0;font-size:11px;color:#2563eb;cursor:pointer;font-weight:600;text-align:left">Use "${esc(card.location)}" from the acquisition card</button>`;
      }
    }
  }).catch(() => {
    if (_openFor !== clientName) return;
    const host = document.getElementById('cp-acq');
    if (host) host.innerHTML = `<div style="font-size:12px;color:#b91c1c">Couldn't load the acquisition card.</div>`;
  });
}

// ─── Common Questions ───
function questionsHtml(client) {
  let h = '';
  for (const item of answeredQuestions(client)) {
    const id = item.field ? ` id="cp-q-${item.field}"` : '';
    h += `<div${id} style="margin-bottom:8px;padding:8px 10px;background:${item.answered ? '#fefce8' : '#f8fafc'};border-radius:6px;border:1px solid ${item.answered ? '#fde68a' : '#e2e8f0'}">
      <div style="font-size:12px;font-weight:600;color:${item.answered ? '#92400e' : '#64748b'}">${esc(item.q)}</div>
      ${questionBody(item)}
    </div>`;
  }
  return h;
}

// A question with nothing behind it says so and offers the way to fix it —
// it never invents "We offer a full range of services".
function questionBody(item) {
  if (item.answered) return `<div style="font-size:12px;color:#78350f;margin-top:3px">${esc(item.a)}</div>`;
  return `<div style="font-size:12px;color:#94a3b8;margin-top:3px;font-style:italic">No answer yet —
    <button data-action="cpEdit" data-field="${item.field}"
      style="background:none;border:none;padding:0;font-size:12px;color:#2563eb;cursor:pointer;font-weight:600;font-style:normal">${esc(item.prompt)}</button></div>`;
}

// After a save, refresh just the view block and the question that depends on it.
function refreshField(field) {
  const client = currentClient();
  if (!client) return;
  const cfg = EDITABLE[field];
  const view = document.getElementById(`cp-view-${field}`);
  if (view) {
    const html = cfg.view(client[field]);
    view.innerHTML = html || `<span style="color:#94a3b8;font-style:italic">Not recorded yet</span>`;
  }
  const btn = document.getElementById(`cp-editbtn-${field}`);
  if (btn) btn.textContent = cfg.view(client[field]) ? 'Edit' : '+ Add';
  const qBox = document.getElementById(`cp-q-${field}`);
  if (qBox) {
    const item = answeredQuestions(client).find(q => q.field === field);
    if (item) {
      qBox.style.background = item.answered ? '#fefce8' : '#f8fafc';
      qBox.style.borderColor = item.answered ? '#fde68a' : '#e2e8f0';
      const label = qBox.firstElementChild;
      if (label) label.style.color = item.answered ? '#92400e' : '#64748b';
      const body = qBox.children[1];
      if (body) body.outerHTML = questionBody(item);
    }
  }
  if (field === 'location') {
    const sub = document.getElementById('cp-subtitle');
    if (sub) {
      const info = lookupClientInfo(_openFor) || {};
      sub.textContent = `${str(client.location)}${info.timeZone ? ' (' + info.timeZone + ')' : ''}`;
    }
  }
}

function saveField(field, text) {
  const client = currentClient();
  if (!client) return;
  const cfg = EDITABLE[field];
  const value = cfg.toValue(text);
  client[field] = value;                       // optimistic — panel reads state
  clearTimeout(_saveTimers[field]);
  _saveTimers[field] = setTimeout(() => {
    sbUpdateClient(client.id, { [cfg.column]: value })
      .then(() => {
        const tick = document.getElementById(`cp-saved-${field}`);
        if (!tick) return;
        tick.style.opacity = '1';
        setTimeout(() => { tick.style.opacity = '0'; }, 1400);
      })
      .catch(e => console.error('Client field save failed:', field, e));
  }, 600);
}

// ─── Panel ───
export function openClientInfoPanel(clientName) {
  const cl = state.clients.find(c => c.name === clientName);
  if (!cl) return;
  _openFor = clientName;
  const info = lookupClientInfo(clientName) || {};

  const now = new Date();
  const todayStr = getToday();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const scheduled = state.deals.filter(d => {
    if (!isValidDate(d.bookedDate)) return false;
    return new Date(d.bookedDate + 'T' + (d.bookedTime || '23:59')) > oneWeekAgo && d.stage === clientName;
  }).sort((a, b) => new Date(a.bookedDate + 'T' + (a.bookedTime || '00:00')) - new Date(b.bookedDate + 'T' + (b.bookedTime || '00:00')));
  const appts = (state.appointments || []).filter(a => a.clientName === clientName && a.apptDate >= todayStr)
    .sort((a, b) => (a.apptDate + (a.apptTime || '')).localeCompare(b.apptDate + (b.apptTime || '')));

  // NOTE: the card deliberately has NO onclick="event.stopPropagation()". The old
  // panel used inline handlers so it never mattered, but delegate.js listens on
  // document.body — stopping propagation here silently kills every data-action
  // inside the panel. The overlay's own `event.target === this` guard is what
  // keeps an inside click from dismissing it; stopPropagation was never needed.
  let h = `<div id="${OVERLAY_ID}" style="position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.45);display:flex;justify-content:center;align-items:start;padding:40px 20px;overflow-y:auto" onclick="if(event.target===this)closeClientInfoPanel()">
    <div style="background:#fff;border-radius:12px;max-width:640px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.2);animation:fadeIn .15s ease">
      <div style="padding:20px 24px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">
        <div>
          <h2 style="margin:0;font-size:18px;color:#1e293b">${esc(clientName)}</h2>
          <div style="font-size:12px;color:#64748b;margin-top:2px"><span id="cp-subtitle">${info.location ? esc(info.location) : ''}${info.timeZone ? ' (' + esc(info.timeZone) + ')' : ''}</span></div>
        </div>
        <button data-action="cpClose" style="background:none;border:none;font-size:20px;color:#94a3b8;cursor:pointer">&times;</button>
      </div>
      <div style="padding:20px 24px;max-height:70vh;overflow-y:auto">`;

  if (info.primaryContact || info.primaryEmail || info.phone) {
    h += `<div style="margin-bottom:16px;padding:12px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Contact</div>`;
    if (info.primaryContact) h += `<div style="font-size:13px;color:#1e293b;margin-bottom:4px">${esc(info.primaryContact)}</div>`;
    if (info.primaryEmail) h += `<div style="font-size:13px;margin-bottom:4px"><a href="mailto:${esc(info.primaryEmail)}" style="color:#2563eb">${esc(info.primaryEmail)}</a></div>`;
    if (info.phone) h += `<div style="font-size:13px"><a href="tel:${esc(info.phone)}" style="color:#2563eb">${esc(info.phone)}</a></div>`;
    h += `</div>`;
  }

  // Everything the acquisition card still remembers. Filled in asynchronously.
  h += `<details open style="margin-bottom:16px;padding:12px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
    <summary style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;cursor:pointer;list-style:none">From Acquisition</summary>
    <div id="cp-acq" style="margin-top:4px"><div style="font-size:12px;color:#94a3b8">Loading acquisition card…</div></div>
  </details>`;

  h += editableBlock('services', cl);
  h += editableBlock('serviceAreaCities', cl, { tone: { wrap: 'padding:12px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe', label: '#1e40af', text: '#1e3a5f' } });
  if (str(cl.serviceAreaUrl).trim()) {
    h += `<div style="margin:-8px 0 16px"><a href="${esc(str(cl.serviceAreaUrl))}" target="_blank" rel="noopener" style="font-size:12px;color:#2563eb;text-decoration:none;font-weight:600">Open Service Area Map ↗</a></div>`;
  }
  h += editableBlock('location', cl) + `<div id="cp-loc-hint" style="margin:-12px 0 16px"></div>`;
  h += editableBlock('warmCallNotesText', cl, { tone: { wrap: 'padding:12px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0', label: '#166534' } });

  h += `<div style="margin-bottom:16px">
    <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Common Questions</div>
    ${questionsHtml(cl)}
  </div>`;

  if (cl.calendlyUrl) {
    h += `<div style="margin-bottom:16px">
      <button class="btn btn-primary" data-action="cpCalendly" style="width:100%;justify-content:center;gap:6px;font-size:13px;background:#818cf8;border-color:#818cf8">
        ${svgIcon('calendar', 14)} Open ${esc(clientName)}'s Calendly
      </button>
    </div>`;
  }

  if (scheduled.length || appts.length) {
    h += `<div style="margin-bottom:16px;padding:12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px">
      <div style="font-size:11px;font-weight:700;color:#92400e;margin-bottom:8px">${svgIcon('calendar', 12)} Scheduled Meetings (${scheduled.length + appts.length})</div>`;
    for (const m of scheduled) {
      const d = new Date(m.bookedDate + 'T' + (m.bookedTime || '00:00'));
      const isPast = d < now;
      const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const timeStr = m.bookedTime ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
      h += `<div style="font-size:12px;color:${isPast ? '#9ca3af' : '#78350f'};padding:3px 0;display:flex;justify-content:space-between">
        <span>${esc(m.company || m.contact || 'Unknown')}${isPast ? ' <span style="font-size:9px">(past)</span>' : ''}</span>
        <span style="font-weight:600">${dateStr}${timeStr ? ' @ ' + timeStr : ''}</span>
      </div>`;
    }
    for (const a of appts) {
      const d = new Date(a.apptDate + 'T' + (a.apptTime || '00:00'));
      const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const timeStr = a.apptTime ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
      h += `<div style="font-size:12px;color:#78350f;padding:3px 0;display:flex;justify-content:space-between">
        <span>${esc(a.leadName || 'Unknown')}</span>
        <span style="font-weight:600">${dateStr}${timeStr ? ' @ ' + timeStr : ''}</span>
      </div>`;
    }
    h += `</div>`;
  }

  if (info.billingModel && isAdmin()) {
    h += `<div style="margin-bottom:16px;font-size:12px;color:#64748b"><strong>Billing:</strong> ${esc(info.billingModel)}</div>`;
  }

  h += `</div></div></div>`;
  document.body.insertAdjacentHTML('beforeend', h);
  fillAcquisitionSection(clientName);
}

export function closeClientInfoPanel() {
  // Any keystroke still inside the debounce window has to land before teardown.
  for (const field of Object.keys(_saveTimers)) {
    const input = document.getElementById(`cp-input-${field}`);
    if (input && _saveTimers[field]) {
      clearTimeout(_saveTimers[field]);
      const client = currentClient();
      if (client) {
        const cfg = EDITABLE[field];
        sbUpdateClient(client.id, { [cfg.column]: cfg.toValue(input.value) })
          .catch(e => console.error('Client field save failed on close:', field, e));
      }
    }
    delete _saveTimers[field];
  }
  document.getElementById(OVERLAY_ID)?.remove();
  _openFor = null;
}

registerActions({
  cpClose() { closeClientInfoPanel(); },
  cpEdit(el) {
    const field = el.dataset.field;
    const box = document.getElementById(`cp-edit-${field}`);
    if (!box) return;
    box.hidden = false;
    const input = document.getElementById(`cp-input-${field}`);
    if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  },
  cpInput(el) { saveField(el.dataset.field, el.value); },
  cpDone(el) {
    const field = el.dataset.field;
    const input = document.getElementById(`cp-input-${field}`);
    if (input) saveField(field, input.value);
    const box = document.getElementById(`cp-edit-${field}`);
    if (box) box.hidden = true;
    refreshField(field);
  },
  cpUseAcqLocation(el) {
    const input = document.getElementById('cp-input-location');
    if (input) input.value = el.dataset.value;
    saveField('location', el.dataset.value);
    refreshField('location');
    const hint = document.getElementById('cp-loc-hint');
    if (hint) hint.innerHTML = '';
  },
  cpCalendly() {
    const cl = currentClient();
    if (!cl) return;
    const name = _openFor, url = cl.calendlyUrl;
    closeClientInfoPanel();
    if (window.openCalendlyEmbed) window.openCalendlyEmbed(null, url, name);
  },
});

window.openClientInfoPanel = openClientInfoPanel;
window.closeClientInfoPanel = closeClientInfoPanel;
