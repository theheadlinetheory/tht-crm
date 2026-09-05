// ═══════════════════════════════════════════════════════════
// CONFIG — Constants, stage definitions, client palette, URLs
// ═══════════════════════════════════════════════════════════

export const API_URL = "https://script.google.com/macros/s/AKfycbwd4j6VLMVeLGJepqvSKp6Uh6UYNgma50tAx_-ILxL2jzlJWRBJoaJA57f7R_GXrlH_/exec";

// Supabase
export const SUPABASE_URL = 'https://api.theheadlinetheory.com';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqd2thZm5sZ3FpZGZ0eGJlcWpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NTM3MzcsImV4cCI6MjA5MTQyOTczN30.27x_IdhtcJaAr0wdx6RhoWr1d6_o3zfzEPk9uneq1h8';
export const CRM_BASE_URL = 'https://theheadlinetheory.github.io/tht-crm';
export const SYNC_INTERVAL = 120000; // 2 min (Realtime handles live updates)
export const REPLY_CHECK_INTERVAL = 15000;
export const REPLY_BACKEND_POLL_INTERVAL = 300000; // 5 min

// ─── Role Definitions ───
export const ROLES = {
  admin: { label: 'Admin', pipelines: 'all', settings: true, manageUsers: true },
  employee: { label: 'Employee', pipelines: ['acquisition', 'client_leads'], settings: false, manageUsers: false }
};

// ─── Pipeline & Stage Definitions ───
export const ACQUISITION_STAGES = [
  { id: "Cold Email Response", label: "Cold Email Response", color: "#059669" },
  { id: "Follow-up", label: "Follow-up", color: "#10b981" },
  { id: "Discovery Scheduled", label: "Discovery Scheduled", color: "#2563eb" },
  { id: "Demo Scheduled", label: "Demo Scheduled", color: "#0891b2" },
  { id: "Under Review", label: "Under Review", color: "#8b5cf6" },
  { id: "No Show", label: "No Show", color: "#ef4444" },
  { id: "Reactivating", label: "Reactivating", color: "#f59e0b" },
  { id: "Waiting for Payment/Contract", label: "Waiting for Payment/Contract", color: "#d97706" },
  { id: "Closed Won", label: "Closed Won", color: "#059669" },
  { id: "Closed Lost", label: "Closed Lost", color: "#6b7280" },
];

export const NURTURE_STAGES = [
  { id: "Not Now", label: "Not Now", color: "#34d399" },
  { id: "Service Area Taken", label: "Service Area Taken", color: "#f97316" },
];

export const ALL_PIPELINES = [
  { id: "dashboard", label: "Dashboard" },
  { id: "funnel", label: "Funnel" },
  { id: "acquisition", label: "Acquisition" },
  { id: "client_leads", label: "Client Leads" },
  { id: "renewals", label: "Renewals" },
];

// ─── Retargeting Config ───
export const RETARGET_ELIGIBLE_STAGES = ['No Show', 'Closed Lost', 'Not Now', 'Service Area Taken'];
export const RETARGET_SPOKE_BEFORE_STAGES = ['Closed Lost', 'Not Now'];
export const RETARGET_NEVER_CONNECTED_STAGES = ['No Show', 'Service Area Taken'];
export const RETARGET_MIN_STALE_DAYS = 90;
export const RETARGET_MAX_ATTEMPTS = 3;

// ─── Activity Types & Icons ───
export const ACTIVITY_TYPES = ["Call", "Text", "Email", "Discovery Call", "Demo", "Follow-up", "Meeting", "Task"];
export const ACTIVITY_ICONS = { Call: "\u{1F4DE}", Text: "\u{1F4AC}", Email: "\u2709\uFE0F", "Discovery Call": "\u{1F50D}", Demo: "\u{1F5A5}\uFE0F", "Follow-up": "\u21A9\uFE0F", Meeting: "\u{1F4C5}", Task: "\u2713" };

export const FLAG_COLORS = { green: "#22c55e", yellow: "#eab308", red: "#ef4444", none: "transparent" };
export const FLAG_CYCLE = ["none", "green", "yellow", "red"];

export const CLIENT_PALETTE = ["#2563eb","#059669","#0891b2","#10b981","#d97706","#dc2626","#0d9488","#34d399","#b45309","#047857","#be185d","#15803d"];

// ─── SOP Sequences ───
export const SOP_DAYS = {
  "Day 1": [
    {type:"Call",subject:"Call #1 — immediate"},
    {type:"Email",subject:"Manual email — SmartLead template (Mechanism, Meeting, Price, or Custom)"},
    {type:"Text",subject:"Day 1 text"},
    {type:"Call",subject:"Call #2 — end of day"},
    {type:"Task",subject:"Start auto follow-up sequence"}
  ],
  "Day 2": [
    {type:"Call",subject:"Morning call"},
    {type:"Text",subject:"Text if no answer"},
    {type:"Call",subject:"Afternoon call"},
  ],
  "Day 3": [
    {type:"Call",subject:"Call"},
  ],
  "Day 4": [
    {type:"Call",subject:"Call"},
    {type:"Text",subject:"Text if no answer"}
  ],
  "Day 5": [
    {type:"Call",subject:"Call"},
  ],
  "Day 7": [
    {type:"Call",subject:"Call"},
    {type:"Text",subject:"Text if no answer"}
  ],
  "Day 9": [
    {type:"Call",subject:"Call"}
  ],
};

export const REACTIVATION_DAYS = {
  "Day 1": [
    {type:"Email",subject:"Reactivation email — SmartLead template"},
    {type:"Call",subject:"Call #1"},
  ],
  "Day 2": [
    {type:"Call",subject:"Call #2"},
    {type:"Text",subject:"Text if no answer"},
  ],
  "Day 3": [
    {type:"Call",subject:"Final call"},
  ],
};

export const CLIENT_SOP_DAYS = {
  "Follow-Up": [{type:"Call",subject:"Morning call"},{type:"Email",subject:"Email follow-up"},{type:"Call",subject:"Afternoon call"}],
};

export const NURTURE_NOT_NOW_SEQUENCE = [
  { dayOffset: 0, type: 'Call', subject: 'Re-engagement call' },
  { dayOffset: 3, type: 'Email', subject: 'Follow-up email' },
  { dayOffset: 7, type: 'Call', subject: 'Final follow-up attempt' },
];

export const NO_SHOW_SEQUENCE = [
  { dayOffset: 0, type: 'Email', subject: 'No Show Email #1 — Phone Disco or Google Meet Demo (SmartLead)' },
  { dayOffset: 2, type: 'Email', subject: 'No Show Email #2 (SmartLead)' },
  { dayOffset: 5, type: 'Email', subject: 'No Show Email #3 (SmartLead)' },
];

export const PRE_CALL_SEQUENCE = [
  { offset: 'scheduling_day', type: 'Text', subject: '{type}: Post-booking confirmation text' },
  { offset: -3, type: 'Text', subject: '{type}: Quick reminder text' },
  { offset: -1, type: 'Call', subject: '{type}: Confirm attendance' },
  { offset: -1, type: 'Text', subject: '{type}: Confirmation text' },
  { offset: 0, type: 'Text', subject: '{type}: Day-of reminder text' },
];

// ─── Sequence Templates (text-only for Blooio, grouped by sequence) ───
export const SEQUENCE_TEMPLATES = [
  {
    id: 'follow-up-founder',
    label: 'Follow-Up (Founder)',
    templates: [
      { name: 'Day 1 — No Pickup Intro', body: `Hey {FIRST_NAME}, Aidan with The Headline Theory here. We were just emailing about {INDUSTRY} opportunities around {MAJOR_CITY}. Figured it would be easier to give you a breakdown and learn more about your business over the phone rather than email.\n\nWould today at TIME or tomorrow at TIME be a good time for me to give you a call?` },
      { name: 'Day 2 — Voicemail Follow-Up', body: `Hey {FIRST_NAME}, just tried giving you a ring but it went to voicemail. Does DAY at TIME or DAY at TIME work for me to give you a call back?` },
      { name: 'Day 4 — Circle Back', body: `Hey {FIRST_NAME}, Aidan here. Just wanted to check in on this. Are you still interested in chatting about how we can consistently get your business in front of commercial decision makers in {MAJOR_CITY}?` },
    ]
  },
  {
    id: 'follow-up',
    label: 'Follow-Up (SDR)',
    templates: [
      { name: 'Day 1 — No Pickup Intro', body: `Hi {FIRST_NAME}, David with The Headline Theory here. You were just emailing with our founder Aidan about growing your business around {CITY}. Figured it would be easier to give you a breakdown and learn more about your business over the phone rather than email.\n\nWould today at TIME or tomorrow at TIME be a good time for me to give you a call?` },
      { name: 'Day 2 — Voicemail Follow-Up', body: `Hey {FIRST_NAME}, just tried giving you a ring but it went to voicemail. Does DAY at TIME or DAY at TIME work for me to give you a call back?` },
      { name: 'Day 4 — Circle Back', body: `Hey {FIRST_NAME}, David here. Just wanted to check in on this. Are you still interested in chatting about how we can consistently get your business in front of commercial decision makers in {CITY}?` },
      { name: 'Day 7 — Final Check-In', body: `Hey {FIRST_NAME}, checking back on this. I can stop reaching out if this is no longer relevant for you. Let me know.` },
    ]
  },
  {
    id: 'pre-call-nurture',
    label: 'Pre-Call Nurture',
    templates: [
      { name: 'Post-Booking Confirmation', body: `Hey {FIRST_NAME}, David with The Headline Theory here. It was great chatting with you just now. Looking forward to our call {MEETING_TIME}.\n\nIf you have any questions before then, please give me a text, call, or email and I will get back to you ASAP.\n\nIn the meantime, feel free to check out the results we've brought our clients at theheadlinetheory.com\n\nTalk soon!` },
      { name: '3-Day Reminder', body: `Hey {FIRST_NAME}, just a quick reminder about your upcoming call with Aidan on {MEETING_TIME}. Looking forward to it!` },
      { name: '1-Day Confirmation', body: `Hey {FIRST_NAME}, quick reminder about your meeting with Aidan, one of our founders, {MEETING_TIME}. Let me know if you have any questions before then.` },
      { name: 'Day-Of Reminder (30 min)', body: `Hey {FIRST_NAME}, here's the link for the call in 30 minutes.\n\n[Paste meeting link here]` },
    ]
  },
];

// ─── Client Lead Templates (text-only for Blooio, client pipeline) ───
export const CLIENT_LEAD_TEMPLATES = [
  {
    id: 'client-lead-outreach',
    label: 'Client Lead Outreach',
    templates: [
      { name: 'Initial Text', body: `Hey {FIRST_NAME}, this is Sean with {CLIENT_NAME}. Saw you responded to an email of ours and figured I'd shoot you a quick text. We'd love to learn more about your project and see how we can help.\n\nWould today at TIME or tomorrow at TIME work for a quick call?` },
    ]
  },
];

// ─── Default Client Portal Stages ───
export const DEFAULT_CLIENT_STAGES = [
  { id: "Positive Response", label: "Positive Response", color: "#059669" },
  { id: "Follow Up", label: "Follow Up", color: "#2563eb" },
  { id: "Quote Given", label: "Quote Given / Waiting for Signature", color: "#d97706" },
];

// ─── Country Detection from Campaign Name / Location / Website / Phone ───
// Signals are ranked by how far they can be trusted, NOT by country, because
// the weakest evidence there is is a bare city name: Birmingham, London,
// Manchester, Melbourne, Vancouver and Wellington are all US cities too.
// Testing those first is what filed "Wonderly Lights of Birmingham" — of
// Birmingham, ALABAMA, on a 205 number at wonderlylights.com — under the UK
// flag, and then had maps.js geocode it as "Birmingham, Alabama USA, UK".
//
//   strong  a national domain, a spelled-out country, a national postal
//           format. Decisive on its own.
//   weak    city names, and bare "uk"/"nz". Believed only when nothing above
//           contradicts them.
//
// The US signals sit between the two passes. A spelled-out state, "USA", or a
// state code anchored to a ZIP settles it outright. A valid North American
// phone number — the second signal, and the one that needs no address at all —
// rules out the overseas rules but NOT Canada, which shares the +1 plan and is
// decided on its own rules.
const COUNTRY_RULES = [
  {
    code: 'AU', flag: '\u{1F1E6}\u{1F1FA}', label: 'Australia',
    strong: [/\baustralia\b/,/\.com\.au\b(?!\.)/,/\.au\b(?!\.)/,/\bnew south wales\b/,/\bqueensland\b/,
             /\b(nsw|qld|vic|tas|act|wa|nt)\s+\d{4}\b/,/\bsa\s+5\d{3}\b/],
    weak: [/\bsydney\b/,/\bmelbourne\b/,/\bbrisbane\b/,/\bperth\b/,/\badelaide\b/,/\bcanberra\b/,
           /\bgold coast\b/,/\bhobart\b/,/\bdarwin\b/,/\bnewcastle nsw\b/,/\bwollongong\b/,
           /\bgeelong\b/,/\bcairns\b/,/\btownsville\b/,/\btoowoomba\b/],
  },
  // The postal code (A1A 1A1) and a comma-anchored province code are the two
  // unambiguous Canadian signals — bare province codes are not usable here
  // because this text is lowercased, and "on"/"ab"/"sk" match ordinary prose.
  {
    code: 'CA', flag: '\u{1F1E8}\u{1F1E6}', label: 'Canada',
    // The lookahead keeps a national domain from matching mid-host: US
    // municipalities sit on ".ca.us" ("marysville.ca.us"), which is California.
    strong: [/\bcanada\b/,/\.ca\b(?!\.)/,/\b[a-z]\d[a-z]\s?\d[a-z]\d\b/,
             /,\s*(ab|bc|mb|nb|nl|ns|nt|nu|on|pe|qc|sk|yt)\b/],
    weak: [/\btoronto\b/,/\bmontreal\b/,/\bvancouver\b/,/\bcalgary\b/,/\bottawa\b/,
           /\bedmonton\b/,/\bwinnipeg\b/],
  },
  {
    code: 'GB', flag: '\u{1F1EC}\u{1F1E7}', label: 'UK',
    strong: [/\.co\.uk\b(?!\.)/,/\.uk\b(?!\.)/,/\bunited kingdom\b/],
    weak: [/\blondon\b/,/\bmanchester\b/,/\bbirmingham\b/,/\bleeds\b/,/\bglasgow\b/,
           /\bbristol\b/,/\bliverpool\b/,/\buk\b/],
  },
  {
    code: 'NZ', flag: '\u{1F1F3}\u{1F1FF}', label: 'New Zealand',
    strong: [/\.co\.nz\b(?!\.)/,/\.nz\b(?!\.)/,/\bnew zealand\b/],
    weak: [/\bauckland\b/,/\bwellington\b/,/\bchristchurch\b/,/\bnz\b/],
  },
];
const US_DEFAULT = { code: 'US', flag: '\u{1F1FA}\u{1F1F8}', label: 'United States' };

const US_STATE = /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/;
// A state code is only usable anchored to a 5-digit ZIP. This text is
// lowercased, so bare "al", "in", "or", "ok", "me" and "hi" are ordinary words.
const US_STATE_ZIP = /,\s*(a[klrz]|c[aot]|d[ce]|fl|ga|hi|i[adln]|k[sy]|la|m[adeinost]|n[cdehjmvy]|o[hkr]|pa|ri|s[cd]|t[nx]|ut|v[at]|w[aivy])\s+\d{5}\b/;
const USA_WORD = /\b(usa|u\.s\.a|united states)\b/;

// A North American number: area code AND exchange code both start 2-9. Both
// halves matter — a UK mobile written without its leading zero (7761209166)
// is ten digits, but its exchange code starts with a 1, so it is not NANP.
const NANP = /^1?[2-9]\d{2}[2-9]\d{6}$/;
const isNanpPhone = (...nums) => nums.some(n => NANP.test(String(n || '').replace(/\D/g, '')));

// The path is not a location. "https://wonderlylights.com/birmingham/" is a US
// company whose URL happens to name a UK city, and reading that path as a
// signal is half of why this deal flew a Union Jack. Only the host votes.
const hostOf = (url) => String(url || '')
  .replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0];

// The email's DOMAIN, never its local part, for the same reason — "london@" and
// "manchester@" are names, not countries.
const countryText = (deal) => [
  deal.campaignName, deal.location, deal.address,
  String(deal.email || '').split('@')[1] || '', hostOf(deal.website),
].filter(Boolean).join(' ').toLowerCase();

export function detectCountry(deal) {
  const text = countryText(deal);
  for (const rule of COUNTRY_RULES) {
    if (rule.strong.some(p => p.test(text))) return rule;
  }
  if (US_STATE.test(text) || US_STATE_ZIP.test(text) || USA_WORD.test(text)) return US_DEFAULT;
  // +1 rules out the overseas rules. It does not rule out Canada.
  const nanp = isNanpPhone(deal.phone, deal.mobilePhone);
  for (const rule of COUNTRY_RULES) {
    if (nanp && rule.code !== 'CA') continue;
    if (rule.weak.some(p => p.test(text))) return rule;
  }
  return US_DEFAULT;
}

// Which geocoder an address goes to. Same ladder, so an address the board flags
// US is never sent to the international provider — "Wellington, FL 33449" used
// to be, on the strength of the word "Wellington" alone. Canada is excluded
// because batchGeocode has already routed Canadian addresses by this point.
export function isInternationalAddress(addr) {
  const code = detectCountry({ address: addr }).code;
  return code !== 'US' && code !== 'CA';
}

// ─── Acquisition Pipeline Calendly URLs ───
// Acquisition booking links, keyed by <call type>_<who takes it>.
// Ioannis is "David" on his client-facing booking pages; the CRM calls him
// Ioannis so the team recognises him.
export const ACQ_CALENDLY_URLS = {
  demo:'https://calendly.com/aidan-theheadlinetheory/demo-call-with-the-headline-theory',
  demo_ioannis:'https://calendly.com/contact-theheadlinetheory/30min',
  demo_lars:'https://calendly.com/aidan-theheadlinetheory/30-min-with-lars',
  strategy:'https://calendly.com/aidan-theheadlinetheory/discovery-call-with-the-headline-theory-clone',
  strategy_ioannis:'https://calendly.com/contact-theheadlinetheory/strategy-call-with-the-headline-theory'
};

// Who can take each acquisition call. One list per call type, used by BOTH
// pickers (deal modal + power dialer) so adding a person is a one-line change
// here instead of the same edit in two files. One colour per person throughout.
const BOOKER_COLOR = { aidan:'#7c3aed', ioannis:'#2563eb', lars:'#059669' };

export const ACQ_STRATEGY_BOOKERS = [
  { label:'Aidan',   color:BOOKER_COLOR.aidan,   type:'strategy' },
  { label:'Ioannis', color:BOOKER_COLOR.ioannis, type:'strategy_ioannis' },
];

export const ACQ_DEMO_BOOKERS = [
  { label:'Aidan',   color:BOOKER_COLOR.aidan,   type:'demo' },
  { label:'Ioannis', color:BOOKER_COLOR.ioannis, type:'demo_ioannis' },
  { label:'Lars',    color:BOOKER_COLOR.lars,    type:'demo_lars' },
];

// ─── Timezone mapping for Calendly ───
export const TZ_TO_IANA = {
  'EST':'America/New_York','EDT':'America/New_York',
  'CST':'America/Chicago','CDT':'America/Chicago',
  'MST':'America/Denver','MDT':'America/Denver',
  'PST':'America/Los_Angeles','PDT':'America/Los_Angeles',
  'AST':'America/Halifax','HST':'Pacific/Honolulu',
  'AKST':'America/Anchorage','AKDT':'America/Anchorage'
};

// ─── Owner Colors Map ───
export const OWNER_COLORS_MAP = { 'aidan': { cls: 'owner-tag-blue', label: 'Aidan' }, 'lars': { cls: 'owner-tag-yellow', label: 'Lars' } };

// ─── JustCall User ID Mapping (Firebase email → JustCall agent ID) ───
export const JUSTCALL_USER_MAP = {
  'aidan@theheadlinetheory.com': 492591,
  'lars@theheadlinetheory.com': 492589,
  'contact@theheadlinetheory.com': 493398,
};

// ─── Client Info Sheet ID ───
export const CLIENT_INFO_SHEET_ID = '1y8AoGopplKltre5ZOP2v0tJPy6Jp0c6C8rqUBO30xFg';

// ─── Geocodio ───
export const GEOCODIO_KEY = 'c9ca6a4ab56ca94ca65ac2c66646952d69d2d6a';
export const GOOGLE_MAPS_API_KEY = 'AIzaSyDeVLh36Ms4R7WaHZA0mIT8fXIHylk1eKk';
export const CA_PROVINCES = /\b(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\b/;
export const CA_POSTAL = /\b[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d\b/;
// Routing hint only — decides which geocoder an address goes to, not the flag
// shown in the UI. GTA boroughs and Metro Vancouver municipalities are here
// because those leads often arrive with no province code at all ("601 Magnetic
// Drive, Unit 34, North York"). Names that collide with common US cities
// (Aurora, Cambridge, Windsor, London) are deliberately left out.
export const CA_CITIES = /\b(Vancouver|Toronto|Montreal|Ottawa|Calgary|Edmonton|Winnipeg|Halifax|Victoria|Surrey|Burnaby|Richmond|Mississauga|Brampton|Hamilton|Saskatoon|Regina|Kelowna|Nanaimo|Kamloops|Kitchener|Waterloo|Markham|Vaughan|Mount Albert|Quebec City|North York|Scarborough|Etobicoke|East York|Woodbridge|Thornhill|Oakville|Whitby|Pickering|Oshawa|Barrie|Guelph|Niagara Falls|Abbotsford|Langley|Coquitlam|Maple Ridge|Pitt Meadows|New Westminster|Chilliwack|White Rock|Laval|Longueuil|Gatineau|Brantford)\b/i;

// ─── Blooio ───
export const BLOOIO_BASE_URL = 'https://backend.blooio.com/v2/api';
export const BLOOIO_API_KEY = 'api_8EpbWHdYWa1Vh7wrDQmW0';

// ─── Test Data ───
export function getTestData() {
  const TODAY = getToday();
  const YESTERDAY = new Date(Date.now()-86400000).toISOString().split("T")[0];
  const TOMORROW = new Date(Date.now()+86400000).toISOString().split("T")[0];

  const TEST_DEALS = [
    {id:"t1",company:"Southern Cutz Lawn & Landscape",contact:"Marcus Johnson",email:"marcus@southerncutz.com",phone:"(321) 555-0142",value:1057,stage:"Cold Email Response",pipeline:"Client",flag:"green",notes:"",website:"southerncutz.com",location:"Brevard, FL",campaignName:"FL Landscaping",leadCategory:"Interested",slLeadId:"",slCampaignId:"",smartleadUrl:"",createdDate:TODAY,lastUpdated:TODAY},
    {id:"t2",company:"Hill's Lawn & Grounds Care",contact:"David Hill",email:"info@hillslawn.com",phone:"(303) 555-0198",value:1057,stage:"Follow-up",pipeline:"Client",flag:"green",notes:"",website:"hillslawn.com",location:"Denver, CO",campaignName:"CO Landscaping",leadCategory:"Information Request",slLeadId:"",slCampaignId:"",smartleadUrl:"",createdDate:YESTERDAY,lastUpdated:TODAY},
    {id:"t3",company:"Denver Landscaping & Design",contact:"Sarah Chen",email:"sarah@denverld.com",phone:"",value:1057,stage:"Follow-up",pipeline:"Client",flag:"",notes:"Waiting on callback",website:"denverld.com",location:"Denver, CO",campaignName:"CO Landscaping",leadCategory:"Interested",slLeadId:"",slCampaignId:"",smartleadUrl:"",createdDate:YESTERDAY,lastUpdated:TODAY},
    {id:"t4",company:"All Proscape LLC",contact:"Tony Rivera",email:"tony@allproscape.com",phone:"(512) 555-0167",value:1057,stage:"Discovery Scheduled",pipeline:"Acquisition",flag:"red",notes:"Missed last call",website:"allproscape.com",location:"Austin, TX",campaignName:"TX Acquisition",leadCategory:"Meeting Request",slLeadId:"",slCampaignId:"",smartleadUrl:"",createdDate:YESTERDAY,lastUpdated:TODAY},
    {id:"t5",company:"Prestonwood Landscape Services",contact:"Mike Preston",email:"mike@prestonwood.com",phone:"(214) 555-0233",value:0,stage:"Demo Scheduled",pipeline:"Client",flag:"red",notes:"",website:"prestonwood.com",location:"Dallas, TX",campaignName:"TX Landscaping",leadCategory:"Meeting Booked",slLeadId:"",slCampaignId:"",smartleadUrl:"",createdDate:YESTERDAY,lastUpdated:TODAY},
    {id:"t6",company:"Sapphire Property Maintenance",contact:"Jade Williams",email:"jade@sapphirepm.com",phone:"",value:1057,stage:"Waiting for Payment/Contract",pipeline:"Client",flag:"green",notes:"Contract sent 2/7",website:"sapphirepm.com",location:"Houston, TX",campaignName:"TX Landscaping",leadCategory:"Interested",slLeadId:"",slCampaignId:"",smartleadUrl:"",createdDate:"2025-02-05",lastUpdated:TODAY},
    {id:"t7",company:"GreenEdge Landscaping",contact:"Pat O'Brien",email:"pat@greenedge.com",phone:"(720) 555-0189",value:1057,stage:"Closed Won",pipeline:"Client",flag:"green",notes:"Signed!",website:"greenedge.com",location:"Boulder, CO",campaignName:"CO Landscaping",leadCategory:"Interested",slLeadId:"",slCampaignId:"",smartleadUrl:"",createdDate:"2025-01-28",lastUpdated:TODAY},
  ];

  const TEST_ACTIVITIES = [
    {id:"a1",dealId:"t1",type:"Call",subject:"Call #1 - immediate",dueDate:TODAY,done:false,dayLabel:"Day 1"},
    {id:"a2",dealId:"t1",type:"Text",subject:"Initial text",dueDate:TODAY,done:true,dayLabel:"Day 1"},
    {id:"a3",dealId:"t1",type:"Email",subject:"Initial email",dueDate:TODAY,done:false,dayLabel:"Day 1"},
    {id:"a4",dealId:"t2",type:"Call",subject:"Morning call",dueDate:YESTERDAY,done:false,dayLabel:"Day 2"},
    {id:"a5",dealId:"t2",type:"Email",subject:"Follow-up email",dueDate:TOMORROW,done:false,dayLabel:"Day 2"},
    {id:"a6",dealId:"t4",type:"Discovery Call",subject:"Discovery call",dueDate:TOMORROW,done:false,dayLabel:""},
  ];

  const TEST_CLIENTS = [
    {id:"c1",name:"GreenScapes Tampa",color:"#2563eb"},
    {id:"c2",name:"Premier Lawns Austin",color:"#059669"},
    {id:"c3",name:"Elite Grounds Denver",color:"#059669"},
  ];

  return { TEST_DEALS, TEST_ACTIVITIES, TEST_CLIENTS };
}

// Helper used by getTestData
function getToday(){
  const d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
