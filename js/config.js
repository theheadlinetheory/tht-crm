// ═══════════════════════════════════════════════════════════
// CONFIG — Constants, stage definitions, client palette, URLs
// ═══════════════════════════════════════════════════════════

export const API_URL = "https://script.google.com/macros/s/AKfycbwd4j6VLMVeLGJepqvSKp6Uh6UYNgma50tAx_-ILxL2jzlJWRBJoaJA57f7R_GXrlH_/exec";

// Supabase
export const SUPABASE_URL = 'https://vjwkafnlgqidftxbeqjp.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqd2thZm5sZ3FpZGZ0eGJlcWpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NTM3MzcsImV4cCI6MjA5MTQyOTczN30.27x_IdhtcJaAr0wdx6RhoWr1d6_o3zfzEPk9uneq1h8';
export const SYNC_INTERVAL = 30000;
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
  { id: "Revisit", label: "Revisit", color: "#34d399" },
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
};

export const CLIENT_SOP_DAYS = {
  "Day 1": [{type:"Text",subject:"Initial text"},{type:"Call",subject:"Call #1"},{type:"Text",subject:"Post-call text"},{type:"Email",subject:"Initial email"}],
  "Day 2": [{type:"Call",subject:"Morning call"},{type:"Text",subject:"Follow-up text"},{type:"Email",subject:"Follow-up email"}],
  "Day 3": [{type:"Call",subject:"Morning call"},{type:"Email",subject:"Follow-up email"}],
};

// ─── Default Client Portal Stages ───
export const DEFAULT_CLIENT_STAGES = [
  { id: "Positive Response", label: "Positive Response", color: "#059669" },
  { id: "Follow Up", label: "Follow Up", color: "#2563eb" },
  { id: "Quote Given", label: "Quote Given / Waiting for Signature", color: "#d97706" },
];

// ─── JustCall Dialer ───
export const JUSTCALL_NUMBERS = {
  TX: {number:'+17372997832',label:'Austin'},
  MO: {number:'+13146901022',label:'Missouri'},
  NY: {number:'+19292003285',label:'New York'},
  OH: {number:'+17407363238',label:'Ohio'}
};

// Area code → nearest JustCall region
export const AC_REGION = {
  201:'NY',202:'NY',203:'NY',205:'OH',206:'TX',207:'NY',208:'MO',209:'TX',210:'TX',212:'NY',
  213:'TX',214:'TX',215:'NY',216:'OH',217:'OH',218:'MO',219:'OH',220:'OH',223:'NY',224:'OH',
  225:'TX',228:'TX',229:'OH',231:'OH',234:'OH',239:'OH',240:'NY',248:'OH',251:'OH',252:'OH',
  253:'TX',254:'TX',256:'OH',260:'OH',262:'OH',267:'NY',269:'OH',270:'OH',272:'NY',276:'NY',
  279:'TX',281:'TX',301:'NY',302:'NY',303:'MO',304:'NY',305:'OH',307:'MO',308:'MO',309:'OH',
  310:'TX',312:'OH',313:'OH',314:'MO',315:'NY',316:'MO',317:'OH',318:'TX',319:'MO',320:'MO',
  321:'OH',323:'TX',325:'TX',326:'OH',330:'OH',331:'OH',332:'NY',334:'OH',336:'OH',337:'TX',
  339:'NY',340:'NY',346:'TX',347:'NY',351:'NY',352:'OH',360:'TX',361:'TX',364:'OH',380:'OH',
  385:'MO',386:'OH',401:'NY',402:'MO',404:'OH',405:'MO',406:'MO',407:'OH',408:'TX',409:'TX',
  410:'NY',412:'NY',413:'NY',414:'OH',415:'TX',417:'MO',419:'OH',423:'OH',424:'TX',425:'TX',
  430:'TX',432:'TX',434:'NY',435:'MO',440:'OH',442:'TX',443:'NY',458:'TX',463:'OH',469:'TX',
  470:'OH',475:'NY',478:'OH',479:'MO',480:'TX',484:'NY',501:'MO',502:'OH',503:'TX',504:'TX',
  505:'MO',507:'MO',508:'NY',509:'TX',510:'TX',512:'TX',513:'OH',515:'MO',516:'NY',517:'OH',
  518:'NY',520:'TX',530:'TX',531:'MO',534:'OH',539:'MO',540:'NY',541:'TX',551:'NY',559:'TX',
  561:'OH',562:'TX',563:'MO',564:'TX',567:'OH',570:'NY',571:'NY',572:'MO',573:'MO',574:'OH',
  575:'MO',580:'MO',585:'NY',586:'OH',601:'TX',602:'TX',603:'NY',605:'MO',606:'OH',607:'NY',
  608:'OH',609:'NY',610:'NY',612:'MO',614:'OH',615:'OH',616:'OH',617:'NY',618:'OH',619:'TX',
  620:'MO',623:'TX',626:'TX',628:'TX',629:'OH',630:'OH',631:'NY',636:'MO',641:'MO',646:'NY',
  650:'TX',651:'MO',657:'TX',660:'MO',661:'TX',662:'TX',667:'NY',669:'TX',678:'OH',681:'NY',
  682:'TX',689:'OH',701:'MO',702:'TX',703:'NY',704:'OH',706:'OH',707:'TX',708:'OH',712:'MO',
  713:'TX',714:'TX',715:'OH',716:'NY',717:'NY',718:'NY',719:'MO',720:'MO',724:'NY',725:'TX',
  726:'TX',727:'OH',731:'OH',732:'NY',734:'OH',737:'TX',740:'OH',747:'TX',754:'OH',757:'NY',
  760:'TX',762:'OH',763:'MO',765:'OH',769:'TX',770:'OH',772:'OH',773:'OH',774:'NY',775:'TX',
  779:'OH',781:'NY',785:'MO',786:'OH',801:'MO',802:'NY',803:'OH',804:'NY',805:'TX',806:'TX',
  808:'TX',810:'OH',812:'OH',813:'OH',814:'NY',815:'OH',816:'MO',817:'TX',818:'TX',820:'TX',
  828:'OH',830:'TX',831:'TX',832:'TX',839:'OH',843:'OH',845:'NY',847:'OH',848:'NY',850:'OH',
  854:'OH',856:'NY',857:'NY',858:'TX',859:'OH',860:'NY',862:'NY',863:'OH',864:'OH',865:'OH',
  870:'MO',872:'OH',901:'OH',903:'TX',904:'OH',906:'OH',907:'TX',908:'NY',909:'TX',910:'OH',
  912:'OH',913:'MO',914:'NY',915:'TX',916:'TX',917:'NY',918:'MO',919:'OH',920:'OH',925:'TX',
  928:'TX',929:'NY',930:'OH',931:'OH',934:'NY',936:'TX',937:'OH',938:'OH',940:'TX',941:'OH',
  945:'TX',947:'OH',949:'TX',951:'TX',952:'MO',954:'OH',956:'TX',959:'NY',970:'MO',971:'TX',
  972:'TX',973:'NY',978:'NY',979:'TX',980:'OH',984:'OH',985:'TX',989:'OH'
};

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

// ─── Lead Tracker & Client Info Sheet IDs ───
export const LEAD_TRACKER_SHEET_ID = '1zEfZQOuzbrE9s01gfTOoVvEJ-DgtOxkPIWNiZHaxaZ4';
export const LEAD_ENTRY_SHEET_ID = '1RAa689xwLM2fQjO0K8cpOyBCPt8bEorTErKDbdFL_fY';
export const CLIENT_INFO_SHEET_ID = '1y8AoGopplKltre5ZOP2v0tJPy6Jp0c6C8rqUBO30xFg';

// ─── Geocodio ───
export const GEOCODIO_KEY = 'c9ca6a4ab56ca94ca65ac2c66646952d69d2d6a';
export const CA_PROVINCES = /\b(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\b/;

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
