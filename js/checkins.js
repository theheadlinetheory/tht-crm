// ═══════════════════════════════════════════════════════════
// CHECKINS — Client Leads → Check-ins: the brief to open one minute before a
// client check-in call
// ═══════════════════════════════════════════════════════════
//
// Left: the check-ins on lars@'s calendar for the next week (the same calendar
// the Slack brief in #client-correspondence is built from — its "Open pre-call
// brief" link lands here, on #client_leads/checkins/<client>). Right: the
// brief for the selected client — who is on the call, the account (renewal),
// what they have been emailing Tim / Aidan / Lars about with disputes flagged,
// the numbers, and the recent leads.
//
// Admin-only: it shows retainer amounts and reads three founder inboxes.
// Data and caches live in checkins-data.js.

import { state } from './app.js?v=20261023110227';
import { esc, str, getToday, svgIcon } from './utils.js?v=20261023110227';
import { buildRenewalRow, money } from './renewals.js?v=20261023110227';
import { prettyDate } from './retainer-billing.js?v=20261023110227';
import { extensionsFor, extensionsStatus, loadTermExtensions } from './term-extensions.js?v=20261023110227';
import {
  CALL_DAYS, callsState, statsState, emailsState, loadCalls, loadStats, loadEmails,
  callClientName, defaultCall, knownContacts, lastHeardFrom, recentLeads,
} from './checkins-data.js?v=20261023110227';

const paint = () => window.render && window.render();
// esc() leaves quotes alone, so anything inside an attribute or an inline handler needs these.
const attr = (v) => esc(str(v)).replace(/"/g, '&quot;');
const b64 = (v) => btoa(unescape(encodeURIComponent(str(v))));
const openThreads = new Set();   // thread subjects left expanded, so a repaint keeps them open

const card = (title, body, extra = '') => `<section style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:14px">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
    <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px">${title}</div>${extra}
  </div>${body}</section>`;
const muted = (t) => `<div style="font-size:12px;color:var(--text-muted)">${t}</div>`;
const errBox = (t) => `<div style="font-size:12px;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:8px 10px">${esc(t)}</div>`;
const chip = (t, bg, fg) => `<span style="display:inline-block;font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;background:${bg};color:${fg};margin:0 4px 2px 0">${esc(t)}</span>`;
const refreshBtn = (fn, arg = '') => `<button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;display:inline-flex;gap:4px;align-items:center" onclick="${fn}(${arg ? `atob('${b64(arg)}')` : ''})">${svgIcon('refresh-cw', 11)} Refresh</button>`;

const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const dayOf = (iso) => {
  const d = new Date(iso), today = new Date(), tmr = new Date(Date.now() + 864e5);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tmr.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
};
const relative = (iso) => {
  const min = Math.round((Date.parse(iso) - Date.now()) / 60000);
  if (min < -45) return 'done';
  if (min <= 0) return 'now';
  if (min < 60) return `in ${min} min`;
  if (min < 24 * 60) return `in ${Math.round(min / 60)} h`;
  return '';
};
const shortDate = (ts) => (ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const isoDaysAgo = (n) => { const d = new Date(Date.now() - n * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

// ─── Left: the calls ───

function callsList(clientNames, selected) {
  const s = callsState();
  if (s.error) return errBox(s.error);
  if (!s.data) return muted('Reading the calendar…');
  const calls = s.data.calls || [];
  if (!calls.length) return muted(`No check-ins on Lars's calendar in the next ${CALL_DAYS} days.`);
  let html = '', lastDay = '';
  for (const c of calls) {
    const day = dayOf(c.start);
    if (day !== lastDay) { html += `<div style="font-size:11px;font-weight:700;color:#64748b;margin:12px 0 6px">${esc(day)}</div>`; lastDay = day; }
    const name = callClientName(c, clientNames);
    const rel = relative(c.start);
    const on = name && name === selected;
    const people = (c.attendees || []).filter(a => !a.internal).length;
    html += `<div onclick="${name ? `ciSelect(atob('${b64(name)}'))` : ''}" style="cursor:${name ? 'pointer' : 'default'};padding:8px 10px;border-radius:8px;margin-bottom:4px;border:1px solid ${on ? 'var(--purple)' : 'transparent'};background:${on ? '#f5f3ff' : rel === 'done' ? 'transparent' : '#f8fafc'};opacity:${rel === 'done' ? .55 : 1}">
      <div style="display:flex;justify-content:space-between;font-size:12px"><span style="font-weight:700;color:#1e293b">${esc(timeOf(c.start))}</span><span style="color:${rel === 'now' ? '#dc2626' : '#64748b'};font-weight:600">${esc(rel)}</span></div>
      <div style="font-size:13px;color:#1e293b;margin-top:2px">${esc(name || c.client)}</div>
      <div style="font-size:11px;color:#94a3b8">${name ? `${people} from the client invited` : 'Not matched to a CRM client'}</div>
    </div>`;
  }
  return html;
}

// ─── Right: the brief ───

function peopleCard(cl, call, emails) {
  const known = knownContacts(cl);
  const heard = lastHeardFrom(emails?.threads);
  const isKnown = (email) => known.some(k => k.email && k.email === email);
  let body = '';
  if (call) {
    const ext = (call.attendees || []).filter(a => !a.internal);
    const ours = (call.attendees || []).filter(a => a.internal).map(a => a.email.split('@')[0]);
    body += `<div style="font-size:12px;font-weight:700;color:#1e293b;margin-bottom:6px">On the invite</div>`;
    if (!ext.length) body += muted('Nobody from the client is on the invite — check who is joining.');
    for (const a of ext) {
      const k = known.find(x => x.email === a.email);
      const h = heard[a.email];
      body += `<div style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
        <div><strong>${esc(a.name || k?.name || a.email)}</strong> ${a.name || k?.name ? `<span style="color:#64748b;font-size:12px">${esc(a.email)}</span>` : ''}</div>
        <div style="margin-top:3px">${k ? k.roles.map(r => chip(r, '#eef2ff', '#3730a3')).join('') : chip('Not in our records', '#fef3c7', '#92400e')}
          ${a.response === 'declined' ? chip('Declined', '#fee2e2', '#991b1b') : a.response === 'accepted' ? chip('Accepted', '#dcfce7', '#166534') : ''}
          ${h ? `<span style="font-size:11px;color:#64748b">last emailed us ${esc(shortDate(h.ts))}: “${esc(h.subject)}”</span>` : ''}</div>
      </div>`;
    }
    if (ours.length) body += `<div style="font-size:11px;color:#64748b;margin-top:6px">Us: ${esc(ours.join(', '))}</div>`;
  }
  const rest = known.filter(k => !call || !(call.attendees || []).some(a => a.email === k.email));
  if (rest.length) {
    body += `<div style="font-size:12px;font-weight:700;color:#1e293b;margin:${call ? 12 : 0}px 0 6px">${call ? 'Other contacts on file' : 'Contacts on file'}</div>`;
    body += rest.map(k => `<div style="font-size:12px;padding:3px 0">${esc(k.name || k.email)} ${k.name && k.email ? `<span style="color:#64748b">${esc(k.email)}</span>` : ''} ${k.roles.map(r => chip(r, '#f1f5f9', '#475569')).join('')}</div>`).join('');
  }
  if (str(cl.clientPhone)) body += `<div style="font-size:12px;margin-top:6px">Phone: <a href="tel:${attr(cl.clientPhone)}">${esc(cl.clientPhone)}</a></div>`;
  if (emails?.threads) {
    const strangers = Object.entries(heard).filter(([e]) => !e.endsWith('@theheadlinetheory.com') && !isKnown(e) && !(call?.attendees || []).some(a => a.email === e));
    if (strangers.length) body += `<div style="font-size:11px;color:#64748b;margin-top:8px">Also emailing us: ${strangers.map(([e, h]) => esc(h.name ? `${h.name} <${e}>` : e)).join(', ')}</div>`;
  }
  return card('Who’s on the call', body || muted('No contacts recorded for this client.'));
}

function accountCard(cl) {
  const rows = [];
  const add = (k, v) => v && rows.push(`<div style="display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:4px 0;border-bottom:1px solid #f1f5f9"><span style="color:#64748b">${k}</span><span style="text-align:right;color:#1e293b">${v}</span></div>`);
  const model = str(cl.billingModel);
  if (model === 'retainer') {
    if (extensionsStatus() === 'idle') loadTermExtensions().then(paint).catch(() => {});
    const r = buildRenewalRow(cl, getToday(), extensionsFor(str(cl.id)));
    const color = r.urgency === 'crit' ? '#dc2626' : r.urgency === 'warn' ? '#b45309' : '#1e293b';
    add('Next renewal', r.renewal ? `<strong style="color:${color}">${esc(prettyDate(r.renewal))}</strong> · ${r.daysUntil === 0 ? 'today' : `in ${r.daysUntil} days`}${r.basis ? ` <span style="color:#94a3b8">(${esc(r.basis)})</span>` : ''}` : '<span style="color:#b91c1c">not set</span>');
    add('Retainer', r.amount ? esc(money(r.amount, r.currency)) + (r.cadence ? ` · ${esc(r.cadence)}` : '') : '');
    add('Agreement', esc(r.agreement.replace(/_/g, ' ')));
    if (r.hasTerm) add('Contract term ends', esc(prettyDate(r.termEnd)) + (r.termLeft != null ? ` · ${r.termLeft} days left` : ''));
    add('Client since', r.launch ? esc(prettyDate(r.launch)) + (r.monthNumber ? ` · month ${r.monthNumber}` : '') : '');
    add('Last paid', r.lastPaid ? esc(prettyDate(r.lastPaid)) : '');
    const bad = r.flags.filter(f => f.bad);
    if (bad.length) rows.push(`<div style="margin-top:6px">${bad.map(f => chip(f.text, '#fee2e2', '#991b1b')).join('')}</div>`);
  } else {
    add('Billing', model === 'per_lead' ? 'Pay per meeting' + (str(cl.leadCost) ? ` · ${esc(money(cl.leadCost, cl.retainerCurrency))}/meeting` : '') : esc(model || 'not set'));
    add('Client since', str(cl.launchDate) ? esc(prettyDate(cl.launchDate)) : '');
  }
  const standing = str(cl.clientStanding).toLowerCase();
  if (standing) add('Standing', standing === 'unhappy' ? chip('Unhappy', '#fee2e2', '#991b1b') : standing === 'happy' ? chip('Happy', '#dcfce7', '#166534') : chip('Neutral', '#fef9c3', '#854d0e'));
  if (str(cl.timeZone)) add('Their time zone', esc(cl.timeZone));
  return card('Account', rows.join('') || muted('No billing details recorded.'));
}

const FLAG_STYLE = {
  dispute: ['Dispute', '#fee2e2', '#991b1b'], billing: ['Billing', '#ffedd5', '#9a3412'],
  complaint: ['Complaint', '#fef3c7', '#92400e'], request: ['Open ask', '#dbeafe', '#1e40af'],
  positive: ['Win', '#dcfce7', '#166534'],
};

function emailCard(cl) {
  const s = emailsState(str(cl.id));
  const extra = refreshBtn('ciRefreshEmails', str(cl.id));
  if (s.loading || (!s.data && !s.error)) return card('Email · Tim, Aidan, Lars', muted('Reading the three inboxes and summarising… (about 20 seconds)'), extra);
  if (s.error) return card('Email · Tim, Aidan, Lars', errBox(s.error), extra);
  const d = s.data;
  if (d.reason === 'no-addresses') return card('Email · Tim, Aidan, Lars', muted('This client has no email address on file, so there is nothing to search. Add one under Settings → Clients.'), extra);
  let body = '';
  const failed = (d.mailboxes || []).filter(m => m.error);
  if (failed.length) body += errBox('Could not read: ' + failed.map(m => `${m.mailbox.split('@')[0]} (${m.error})`).join(', '));
  if (!(d.threads || []).length) return card(`Email · last ${d.windowDays || 90} days`, body + muted('No email with this client in the last ' + (d.windowDays || 90) + ' days.'), extra);
  if (d.summary) body += `<div style="font-size:13px;line-height:1.5;color:#1e293b;margin:${failed.length ? 8 : 0}px 0 10px">${esc(d.summary)}</div>`;
  if (d.summaryError) body += errBox('Summary unavailable: ' + d.summaryError);
  for (const f of d.flags || []) {
    const [label, bg, fg] = FLAG_STYLE[f.type] || FLAG_STYLE.request;
    body += `<div style="display:flex;gap:8px;align-items:baseline;font-size:13px;padding:4px 0">${chip(label, bg, fg)}<span>${esc(f.text)}${f.date ? ` <span style="color:#94a3b8;font-size:11px">${esc(f.date)}</span>` : ''}</span></div>`;
  }
  body += `<div style="font-size:11px;font-weight:700;color:#64748b;margin:12px 0 4px">${d.threads.length} conversation${d.threads.length === 1 ? '' : 's'}</div>`;
  for (const t of d.threads) {
    const key = t.subject + '|' + t.lastTs;
    body += `<details data-key="${attr(key)}" ontoggle="ciToggle(this)" ${openThreads.has(key) ? 'open' : ''} style="border-top:1px solid #f1f5f9;padding:6px 0">
      <summary style="cursor:pointer;font-size:13px;list-style:none;display:flex;justify-content:space-between;gap:8px">
        <span><strong>${esc(t.subject)}</strong> <span style="color:#94a3b8">(${t.messages.length})</span></span>
        <span style="white-space:nowrap;font-size:11px;color:#64748b">${t.mailboxes.map(m => esc(m.split('@')[0])).join(' · ')} · ${esc(shortDate(t.lastTs))}</span>
      </summary>
      ${t.messages.map(m => `<div style="margin:8px 0 0 10px;padding-left:10px;border-left:2px solid #e2e8f0">
        <div style="font-size:11px;color:#64748b">${esc(m.fromName || m.from)} · ${esc(new Date(m.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</div>
        <div style="font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;color:#1e293b">${esc(m.body)}</div></div>`).join('')}
    </details>`;
  }
  return card(`Email · Tim, Aidan, Lars · last ${d.windowDays || 90} days`, body, extra);
}

function numbersCard(name) {
  const s = statsState(name);
  const extra = refreshBtn('ciRefreshStats', name);
  if (s.loading || (!s.data && !s.error)) return card('Numbers', muted('Pulling Smartlead and JustCall…'), extra);
  if (s.error) return card('Numbers', errBox(s.error), extra);
  const { two, month } = s.data;
  const sum = (st, k) => (st.campaigns || []).reduce((a, c) => a + (c[k] || 0), 0);
  const pos = (st) => Object.values(st.positives || {}).reduce((a, b) => a + b, 0);
  const n = (x) => Number(x || 0).toLocaleString('en-US');
  const rows = [
    ['Emails sent', sum(two, 'sent'), sum(month, 'sent')],
    ['Replies', sum(two, 'replies'), sum(month, 'replies')],
    ['Positive replies', pos(two), pos(month)],
    [two.ppm ? 'Meetings booked' : 'Leads passed off', (two.meetings || []).length, (month.meetings || []).length],
  ];
  if (two.coldCalls || month.coldCalls) {
    rows.push(['Cold-call dials', two.coldCalls?.dials, month.coldCalls?.dials], ['Conversations 30s+', two.coldCalls?.conversations, month.coldCalls?.conversations]);
  }
  const errs = [...new Set([...(two.errors || []), ...(month.errors || [])])];
  const table = `<table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="color:#64748b;font-size:11px"><th style="text-align:left;font-weight:600"></th><th style="text-align:right;font-weight:600">Last 2 weeks</th><th style="text-align:right;font-weight:600">Last 30 days</th></tr>
    ${rows.map(r => `<tr style="border-top:1px solid #f1f5f9"><td style="padding:5px 0">${r[0]}</td><td style="text-align:right">${n(r[1])}</td><td style="text-align:right">${n(r[2])}</td></tr>`).join('')}</table>`;
  const open = two.coldCalls?.open || [];
  return card('Numbers', table
    + (open.length ? `<div style="font-size:12px;margin-top:8px">Open cold-call call-backs: ${esc(open.map(o => o.company).join(', '))}</div>` : '')
    + (errs.length ? `<div style="font-size:11px;color:#b45309;margin-top:8px">Could not read: ${esc(errs.join('; '))}</div>` : ''), extra);
}

function leadsCard(name) {
  const leads = recentLeads({
    clientName: name, sinceIso: isoDaysAgo(30), passOffs: state.passOffs, trackerEntries: state.trackerEntries,
    deals: state.deals, clientNames: (state.clients || []).map(c => c.name),
  });
  if (!leads.length) return card('Recent leads · 30 days', muted('No leads passed off or meetings booked in the last 30 days.'));
  const body = leads.map(l => {
    const reply = str(l.deal?.emailBody || l.deal?.replySnippet).replace(/\s+/g, ' ').trim();
    return `<div style="padding:8px 0;border-top:1px solid #f1f5f9;font-size:13px">
      <div style="display:flex;justify-content:space-between;gap:8px">
        <span><strong>${esc(l.company || l.contact || l.email || 'Unknown')}</strong>${l.company && l.contact ? ` · ${esc(l.contact)}` : ''}</span>
        <span style="white-space:nowrap;font-size:11px;color:#64748b">${chip(l.kind, l.kind === 'Meeting booked' ? '#dcfce7' : '#eef2ff', l.kind === 'Meeting booked' ? '#166534' : '#3730a3')}${esc(prettyDate(l.date))}</span>
      </div>
      ${l.appt || l.status ? `<div style="font-size:12px;color:#475569">${l.appt ? `Appointment ${esc(l.appt)}` : ''}${l.appt && l.status ? ' · ' : ''}${l.status ? esc(l.status) : ''}</div>` : ''}
      ${reply ? `<div style="font-size:12px;color:#64748b;margin-top:2px">“${esc(reply.slice(0, 220))}${reply.length > 220 ? '…' : ''}”</div>` : ''}
      ${l.deal ? `<button class="btn btn-ghost" style="font-size:11px;padding:2px 8px;margin-top:4px" onclick="openDeal(atob('${b64(l.deal.id)}'))">Open card</button>` : ''}
    </div>`;
  }).join('');
  return card(`Recent leads · 30 days · ${leads.length}`, body);
}

function brief(name, call) {
  const cl = (state.clients || []).find(c => c.name === name);
  if (!cl) return `<div style="padding:40px;text-align:center;color:var(--text-muted)">Pick a check-in on the left, or any client from the list.</div>`;
  setTimeout(() => { loadStats(name, paint); loadEmails(str(cl.id), paint); }, 0);
  const s = emailsState(str(cl.id));
  const header = `<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
    <div><h2 style="margin:0;font-size:20px;color:#1e293b">${esc(name)}</h2>
      <div style="font-size:12px;color:#64748b;margin-top:3px">${call ? `${esc(dayOf(call.start))} · ${esc(timeOf(call.start))} · ${esc(call.title)}` : 'No check-in on the calendar this week'}</div></div>
    <div style="display:flex;gap:6px">
      ${call?.link ? `<a class="btn btn-ghost" style="font-size:12px" href="${attr(call.link)}" target="_blank" rel="noopener">${svgIcon('calendar', 12)} Event</a>` : ''}
      <button class="btn btn-ghost" style="font-size:12px" onclick="openClientInfoPanel(atob('${b64(name)}'))">Client info</button>
    </div></div>`;
  return header
    + `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:0 14px;align-items:start">
        <div>${peopleCard(cl, call, s.data)}${accountCard(cl)}${numbersCard(name)}</div>
        <div>${emailCard(cl)}${leadsCard(name)}</div>
      </div>`;
}

export function renderCheckins() {
  setTimeout(() => loadCalls(paint), 0);
  const clients = (state.clients || []).filter(c => !str(c.endedOn));
  const clientNames = (state.clients || []).map(c => c.name);
  const calls = callsState().data?.calls || [];
  let selected = state.checkinClient && clientNames.includes(state.checkinClient) ? state.checkinClient : '';
  if (!selected && callsState().data) {
    const def = defaultCall(calls.filter(c => callClientName(c, clientNames)));
    if (def) selected = callClientName(def, clientNames);
  }
  const call = calls.filter(c => callClientName(c, clientNames) === selected);
  const theCall = defaultCall(call);

  return `<div style="display:flex;gap:16px;padding:0 20px 20px;height:calc(100vh - 104px)">
    <aside style="width:280px;flex-shrink:0;overflow-y:auto;background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px">
      <div style="display:flex;justify-content:space-between;align-items:center"><div style="font-size:13px;font-weight:700;color:#1e293b">Check-ins · next ${CALL_DAYS} days</div>${refreshBtn('ciRefreshCalls')}</div>
      ${callsList(clientNames, selected)}
      <div style="font-size:11px;font-weight:700;color:#64748b;margin:16px 0 6px">Any client</div>
      <select onchange="ciSelect(this.value)" style="width:100%;font-size:12px;padding:6px;border:1px solid var(--border);border-radius:6px">
        <option value="">Choose a client…</option>
        ${clients.map(c => `<option value="${attr(c.name)}" ${c.name === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
    </aside>
    <main id="ci-main" style="flex:1;overflow-y:auto;min-width:0">${brief(selected, theCall)}</main>
  </div>`;
}

// ─── Handlers (inline onclick) ───

window.ciSelect = (name) => {
  if (!name) return;
  state.checkinClient = name;
  location.hash = 'client_leads/checkins/' + encodeURIComponent(name);
  paint();
};
window.ciToggle = (el) => { const k = el.dataset.key; if (el.open) openThreads.add(k); else openThreads.delete(k); };
window.ciRefreshCalls = () => loadCalls(paint, true);
window.ciRefreshStats = (name) => loadStats(name, paint, true);
window.ciRefreshEmails = (id) => loadEmails(id, paint, true);
