// ═══════════════════════════════════════════════════════════
// CONFIG — Constants, stage definitions, client palette, URLs
// ═══════════════════════════════════════════════════════════

export const API_URL = "https://script.google.com/macros/s/AKfycbwd4j6VLMVeLGJepqvSKp6Uh6UYNgma50tAx_-ILxL2jzlJWRBJoaJA57f7R_GXrlH_/exec";

// Supabase
export const SUPABASE_URL = 'https://vjwkafnlgqidftxbeqjp.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqd2thZm5sZ3FpZGZ0eGJlcWpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NTM3MzcsImV4cCI6MjA5MTQyOTczN30.27x_IdhtcJaAr0wdx6RhoWr1d6_o3zfzEPk9uneq1h8';
export const SYNC_INTERVAL = 120000; // 2 min (Realtime handles live updates)
export const REPLY_CHECK_INTERVAL = 15000;
export const REPLY_BACKEND_POLL_INTERVAL = 300000; // 5 min

// Firebase config
export const firebaseConfig = {
  apiKey: "AIzaSyDrjU77BiVX27egzoc86jHsZCTwLbQfgVc",
  authDomain: "tht-crm.firebaseapp.com",
  projectId: "tht-crm",
  storageBucket: "tht-crm.firebasestorage.app",
  messagingSenderId: "793331537217",
  appId: "1:793331537217:web:dd85fcf13532c633f67dc0",
  measurementId: "G-7R4EQB3N3K"
};

// ─── Role Definitions ───
export const ROLES = {
  admin: { label: 'Admin', pipelines: 'all', settings: true, manageUsers: true },
  employee: { label: 'Employee', pipelines: ['client_leads'], settings: false, manageUsers: false },
  client: { label: 'Client', pipelines: ['client_leads'], settings: false, manageUsers: false }
};

// ─── Pipeline & Stage Definitions ───
export const ACQUISITION_STAGES = [
  { id: "Cold Email Response", label: "Cold Email Response", color: "#059669" },
  { id: "Follow-up", label: "Follow-up", color: "#10b981" },
  { id: "Discovery Scheduled", label: "Discovery Scheduled", color: "#2563eb" },
  { id: "Demo Scheduled", label: "Demo Scheduled", color: "#0891b2" },
  { id: "No Show", label: "No Show", color: "#ef4444" },
  { id: "Waiting for Payment/Contract", label: "Waiting for Payment/Contract", color: "#d97706" },
];

export const NURTURE_STAGES = [
  { id: "Not Now", label: "Not Now", color: "#34d399" },
  { id: "Service Area Taken", label: "Service Area Taken", color: "#f97316" },
];

export const ALL_PIPELINES = [
  { id: "dashboard", label: "Dashboard" },
  { id: "acquisition", label: "Acquisition" },
  { id: "client_leads", label: "Client Leads" },
  { id: "nurture", label: "Nurture" },
];

// ─── Activity Types & Icons ───
export const ACTIVITY_TYPES = ["Call", "Text", "Email", "Discovery Call", "Demo", "Follow-up", "Meeting", "Task"];
export const ACTIVITY_ICONS = { Call: "\u{1F4DE}", Text: "\u{1F4AC}", Email: "\u2709\uFE0F", "Discovery Call": "\u{1F50D}", Demo: "\u{1F5A5}\uFE0F", "Follow-up": "\u21A9\uFE0F", Meeting: "\u{1F4C5}", Task: "\u2713" };

export const FLAG_COLORS = { green: "#22c55e", yellow: "#eab308", red: "#ef4444", none: "transparent" };
export const FLAG_CYCLE = ["none", "green", "yellow", "red"];

export const CLIENT_PALETTE = ["#2563eb","#059669","#0891b2","#10b981","#d97706","#dc2626","#0d9488","#34d399","#b45309","#047857","#be185d","#15803d"];

// ─── SOP Sequences ───
export const SOP_DAYS = {
  "Day 1": [{type:"Text",subject:"Initial text - immediate"},{type:"Call",subject:"Call #1 - immediate"},{type:"Text",subject:"Post-call text"},{type:"Email",subject:"Initial email"},{type:"Call",subject:"Call #2 - EOD"}],
  "Day 2": [{type:"Call",subject:"Morning call"},{type:"Text",subject:"Follow-up text"},{type:"Email",subject:"Follow-up email"},{type:"Call",subject:"Evening call"}],
  "Day 3": [{type:"Call",subject:"Morning call"},{type:"Text",subject:"Follow-up text"},{type:"Email",subject:"Follow-up email"},{type:"Call",subject:"Evening call"}],
  "Day 4": [{type:"Call",subject:"Morning call"},{type:"Email",subject:"Follow-up email"},{type:"Call",subject:"Evening call"}],
  "Day 5": [{type:"Email",subject:"Follow-up email"}],
  "Day 6": [{type:"Email",subject:"Follow-up email"},{type:"Call",subject:"Check-in call"}],
  "Day 8": [{type:"Email",subject:"Follow-up email"}],
  "Day 9": [{type:"Call",subject:"Check-in call"}],
  "Day 10": [{type:"Email",subject:"Final email"}],
  "Day 30": [{type:"Email",subject:"Last attempt email"},{type:"Call",subject:"Last attempt call"}],
};

export const CLIENT_SOP_DAYS = {
  "Day 1": [{type:"Text",subject:"Initial text"},{type:"Call",subject:"Call #1"},{type:"Text",subject:"Post-call text"},{type:"Email",subject:"Initial email"}],
  "Day 2": [{type:"Call",subject:"Morning call"},{type:"Text",subject:"Follow-up text"},{type:"Email",subject:"Follow-up email"}],
  "Day 3": [{type:"Call",subject:"Morning call"},{type:"Email",subject:"Follow-up email"}],
};

export const NURTURE_NOT_NOW_SEQUENCE = [
  { dayOffset: 0, type: 'Call', subject: 'Re-engagement call' },
  { dayOffset: 3, type: 'Email', subject: 'Follow-up email' },
  { dayOffset: 7, type: 'Call', subject: 'Final follow-up attempt' },
];

// ─── Default Client Portal Stages ───
export const DEFAULT_CLIENT_STAGES = [
  { id: "Positive Response", label: "Positive Response", color: "#059669" },
  { id: "Follow Up", label: "Follow Up", color: "#2563eb" },
  { id: "Quote Given", label: "Quote Given / Waiting for Signature", color: "#d97706" },
];

// ─── Acquisition Pipeline Calendly URLs ───
export const ACQ_CALENDLY_URLS = {
  demo:'https://calendly.com/aidan-theheadlinetheory/demo-call-with-the-headline-theory',
  strategy:'https://calendly.com/aidan-theheadlinetheory/strategy-call-with-the-headline-theory-clone'
};

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
export const CA_CITIES = /\b(Vancouver|Toronto|Montreal|Ottawa|Calgary|Edmonton|Winnipeg|Halifax|Victoria|Surrey|Burnaby|Richmond|Mississauga|Brampton|Hamilton|Saskatoon|Regina|Kelowna|Nanaimo|Kamloops|Kitchener|Waterloo|Markham|Vaughan|Mount Albert|Quebec City)\b/i;

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
