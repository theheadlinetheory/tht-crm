#!/usr/bin/env node
// Unit tests for js/client-acquisition.js — the pure half of the client panel:
// turning an archived Closed Won acquisition deal into a contact roster, and
// deciding whether a warm-call question has a real answer behind it.
// Import-free so node can load it. Run: node scripts/test-client-panel.mjs
import assert from 'node:assert/strict';
import { buildAcquisitionCard, indexWonCards, matchCardForClient, answeredQuestions } from '../js/client-acquisition.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1; }
};

// ── buildAcquisitionCard: contacts ────────────────────────
test('primary contact carries its email and phone', () => {
  const card = buildAcquisitionCard({
    contact: 'Dennis Caruso', email: 'dennisc@denairhvac.com', phone: '(718) 791-5074',
  });
  assert.deepEqual(card.contacts, [
    { name: 'Dennis Caruso', title: '', emails: ['dennisc@denairhvac.com'], phones: ['(718) 791-5074'] },
  ]);
});
test('contact2 and contact3 come through with titles (the Galaxy Plumbing case)', () => {
  const card = buildAcquisitionCard({
    contact: 'Rob', phone: '416-727-5810',
    contact2: 'Sandra', title2: 'Office Manager', email2: 's@galaxy.com', phone2: '416-555-0100',
    contact3: 'Ed', title3: 'Owner',
  });
  assert.equal(card.contacts.length, 3);
  assert.deepEqual(card.contacts[1], { name: 'Sandra', title: 'Office Manager', emails: ['s@galaxy.com'], phones: ['416-555-0100'] });
  assert.deepEqual(card.contacts[2], { name: 'Ed', title: 'Owner', emails: [], phones: [] });
});
test('a titled contact with no name is dropped, not rendered blank', () => {
  const card = buildAcquisitionCard({ contact: 'Rob', contact2: '   ', title2: 'Owner' });
  assert.equal(card.contacts.length, 1);
});
test('email4 is attached to the primary contact', () => {
  const card = buildAcquisitionCard({ contact: 'Rob', email: 'a@x.com', email4: 'billing@x.com' });
  assert.deepEqual(card.contacts[0].emails, ['a@x.com', 'billing@x.com']);
});
test('duplicate emails and phones are collapsed', () => {
  const card = buildAcquisitionCard({ contact: 'Rob', email: 'a@x.com', email4: 'a@x.com', phone: '555', mobilePhone: '555' });
  assert.deepEqual(card.contacts[0].emails, ['a@x.com']);
  assert.deepEqual(card.contacts[0].phones, ['555']);
});
test('mobilePhone rides with the primary contact alongside the main line', () => {
  const card = buildAcquisitionCard({ contact: 'Rob', phone: '555-1111', mobilePhone: '555-2222' });
  assert.deepEqual(card.contacts[0].phones, ['555-1111', '555-2222']);
});
test('an unnamed primary still surfaces its email and phone as a contact', () => {
  const card = buildAcquisitionCard({ email: 'info@x.com', phone: '555' });
  assert.equal(card.contacts.length, 1);
  assert.equal(card.contacts[0].name, '');
  assert.deepEqual(card.contacts[0].emails, ['info@x.com']);
});
test('a deal with no people at all yields no contacts', () => {
  assert.deepEqual(buildAcquisitionCard({ website: 'x.com' }).contacts, []);
});

// ── buildAcquisitionCard: sites and address ───────────────
test('website, linkedin and address are picked up', () => {
  const card = buildAcquisitionCard({ website: 'denairhvac.com', linkedinUrl: 'https://linkedin.com/in/x', address: '12 Main St' });
  assert.equal(card.website, 'denairhvac.com');
  assert.equal(card.linkedinUrl, 'https://linkedin.com/in/x');
  assert.equal(card.address, '12 Main St');
});
test('acquisition notes are deliberately NOT carried over', () => {
  const card = buildAcquisitionCard({ contact: 'Rob', notes: 'signed after 3 calls' });
  assert.equal(card.notes, undefined);
  assert.equal(JSON.stringify(card).includes('signed after 3 calls'), false);
});
test('location comes through so a blank client row can borrow it', () => {
  assert.equal(buildAcquisitionCard({ location: 'Marietta, GA' }).location, 'Marietta, GA');
});
test('whitespace-only fields are treated as empty', () => {
  const card = buildAcquisitionCard({ website: '   ', address: '\t' });
  assert.equal(card.website, '');
  assert.equal(card.address, '');
});
test('hasAnything is false for an empty deal and true once there is content', () => {
  assert.equal(buildAcquisitionCard({}).hasAnything, false);
  assert.equal(buildAcquisitionCard({ website: 'x.com' }).hasAnything, true);
  assert.equal(buildAcquisitionCard({ contact: 'Rob' }).hasAnything, true);
});
test('null/undefined deal is handled', () => {
  assert.equal(buildAcquisitionCard(null).hasAnything, false);
});

// ── indexWonCards / matchCardForClient ────────────────────
const ROWS = [
  { id: '1', original_data: JSON.stringify({ company: 'Galaxy Plumbing Inc.', contact: 'Rob', phone: '416' }) },
  { id: '2', original_data: JSON.stringify({ company: 'Mighty Oak Landscaping', location: 'Marietta, GA' }) },
  { id: '3', original_data: JSON.stringify({ company: '', clientName: "Woody's Landcare LLC", contact: 'Woody' }) },
  { id: '4', original_data: 'not json at all' },
];
test('index skips rows whose original_data will not parse', () => {
  assert.equal(indexWonCards(ROWS).size, 3);
});
test('matches a client by company name ignoring punctuation and case', () => {
  const idx = indexWonCards(ROWS);
  assert.equal(matchCardForClient(idx, 'Galaxy Plumbing Inc.').contact, 'Rob');
  assert.equal(matchCardForClient(idx, 'galaxy plumbing inc').contact, 'Rob');
});
test('falls back to clientName when the deal has no company', () => {
  const idx = indexWonCards(ROWS);
  assert.equal(matchCardForClient(idx, "Woody's Landcare LLC").contact, 'Woody');
});
test('an unmatched client returns null rather than a wrong card', () => {
  assert.equal(matchCardForClient(indexWonCards(ROWS), 'Denair Hvac, Inc.'), null);
});
test('empty index and empty name are safe', () => {
  assert.equal(matchCardForClient(new Map(), 'Anything'), null);
  assert.equal(matchCardForClient(indexWonCards(ROWS), ''), null);
});

// ── answeredQuestions ─────────────────────────────────────
test('a client with real data gets real answers (Denair)', () => {
  const qs = answeredQuestions({
    location: 'New York, NY',
    serviceAreaCities: 'Manhattan, Brooklyn',
    services: ['Emergency HVAC services', 'Rigging'],
  });
  const loc = qs.find(q => q.field === 'location');
  assert.equal(loc.answered, true);
  assert.equal(loc.a, "We're based out of New York, NY.");
  const svc = qs.find(q => q.field === 'services');
  assert.equal(svc.answered, true);
  assert.equal(svc.a, 'Emergency HVAC services, Rigging');
});
test('a starved client gets prompts, never invented answers (Mighty Oak)', () => {
  const qs = answeredQuestions({ location: '', serviceAreaCities: '', services: [] });
  const gaps = qs.filter(q => !q.answered);
  assert.equal(gaps.length, 3, 'location, service area and services should all be gaps');
  assert.deepEqual(gaps.map(q => q.field).sort(), ['location', 'serviceAreaCities', 'services']);
  for (const q of gaps) {
    assert.equal(q.a, '', 'a gap must not carry a fabricated answer');
    assert.ok(q.prompt, 'a gap must offer a prompt to fill it');
  }
});
test('the two evergreen questions always answer, they need no client data', () => {
  const qs = answeredQuestions({});
  const evergreen = qs.filter(q => q.field === null);
  assert.equal(evergreen.length, 2);
  assert.ok(evergreen.every(q => q.answered && q.a));
});
test('whitespace-only service area counts as a gap', () => {
  const q = answeredQuestions({ serviceAreaCities: '   ' }).find(x => x.field === 'serviceAreaCities');
  assert.equal(q.answered, false);
});
test('services given as a newline string is accepted, not just an array', () => {
  const q = answeredQuestions({ services: 'Mowing\nEdging' }).find(x => x.field === 'services');
  assert.equal(q.answered, true);
  assert.equal(q.a, 'Mowing, Edging');
});
test('a null client does not throw', () => {
  assert.doesNotThrow(() => answeredQuestions(null));
});

console.log(`\n${passed} passed`);
