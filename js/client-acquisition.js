// ═══════════════════════════════════════════════════════════
// CLIENT-ACQUISITION — the acquisition card behind a client
// ═══════════════════════════════════════════════════════════
//
// When a deal is closed Won, deleteDeal() stores the WHOLE deal as JSON in the
// `archive` table and deletes the row. The clients table then keeps only a
// flattened slice of it: one contact, one email, one phone. Everything else —
// the second and third contacts, their titles, the mobile and secondary
// numbers, the extra emails, the website, LinkedIn and street address — is
// sitting in that archive row and has never been shown anywhere.
//
// This module is the pure half of surfacing it again: parse and index the Won
// rows, shape one into a contact roster, and decide whether a warm-call
// question actually has an answer. No DOM, no imports — see
// scripts/test-client-panel.mjs.
//
// Acquisition NOTES are deliberately excluded from the roster (Aidan, 2026-09-08).

const s = v => String(v ?? '').trim();

// Same shape of normalisation findClientByName() uses, so "Galaxy Plumbing
// Inc." on the client row still meets "galaxy plumbing inc" on the deal.
const norm = v => s(v).toLowerCase().replace(/[^a-z0-9]/g, '');

function uniq(list) {
  const out = [];
  for (const v of list) { const t = s(v); if (t && !out.includes(t)) out.push(t); }
  return out;
}

function contact(name, title, emails, phones) {
  const people = { name: s(name), title: s(title), emails: uniq(emails), phones: uniq(phones) };
  // A title with nobody attached is noise; a nameless primary still matters if
  // it carries a way to reach them (info@ inboxes come in that way).
  if (!people.name && !people.emails.length && !people.phones.length) return null;
  return people;
}

// One archived deal → the roster the panel renders.
export function buildAcquisitionCard(deal) {
  const d = deal || {};
  const contacts = [
    contact(d.contact, d.title, [d.email, d.email4], [d.phone, d.mobilePhone]),
    contact(d.contact2, d.title2, [d.email2], [d.phone2]),
    contact(d.contact3, d.title3, [d.email3], [d.phone3]),
  ].filter(Boolean);

  const card = {
    contacts,
    website: s(d.website),
    linkedinUrl: s(d.linkedinUrl),
    address: s(d.address),
    location: s(d.location),
  };
  card.hasAnything = contacts.length > 0 || !!card.website || !!card.linkedinUrl || !!card.address;
  return card;
}

// archive rows (id + original_data JSON string) → normalised-name → deal.
export function indexWonCards(rows) {
  const idx = new Map();
  for (const row of rows || []) {
    let deal;
    try { deal = JSON.parse(row.original_data); } catch { continue; }
    if (!deal) continue;
    for (const key of [norm(deal.company), norm(deal.clientName)]) {
      if (key && !idx.has(key)) idx.set(key, deal);
    }
  }
  return idx;
}

export function matchCardForClient(idx, clientName) {
  const key = norm(clientName);
  if (!key || !idx) return null;
  return idx.get(key) || null;
}

// ─── Warm-call questions ───
//
// The old getWarmCallQA() always produced five answers, inventing "We're based
// out of the area" and "We offer a full range of services" whenever the client
// row was blank — which is 17 of 22 active clients for services. A confident
// non-answer is worse than an obvious gap, so a question with no data behind it
// now reports answered:false and carries the prompt to go fill it.

function servicesList(v) {
  if (Array.isArray(v)) return v.map(s).filter(Boolean);
  return s(v).split('\n').map(s).filter(Boolean);
}

export function answeredQuestions(client) {
  const c = client || {};
  const svcs = servicesList(c.services);
  const area = s(c.serviceAreaCities);
  const loc = s(c.location);
  return [
    {
      q: 'Where are you guys located?', field: 'location',
      answered: !!loc, a: loc ? `We're based out of ${loc}.` : '',
      prompt: 'Add their home base',
    },
    {
      q: 'What areas do you service?', field: 'serviceAreaCities',
      answered: !!area, a: area ? `We service ${area}.` : '',
      prompt: 'Add the cities and counties they cover',
    },
    {
      q: 'What services do you offer?', field: 'services',
      answered: svcs.length > 0, a: svcs.join(', '),
      prompt: 'Add the services they sell',
    },
    // These two are true of every client we take on, so they need no data.
    {
      q: 'Can I get a quote?', field: null, answered: true,
      a: 'Absolutely! We can schedule a quick call to go over your property and get you a quote. What day works best for you?',
    },
    {
      q: 'Do you do residential or commercial?', field: null, answered: true,
      a: 'We specialize in commercial properties — HOAs, apartment complexes, retail centers, office parks, and more.',
    },
  ];
}
