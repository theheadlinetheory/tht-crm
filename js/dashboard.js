// ═══════════════════════════════════════════════════════════
// DASHBOARD — Dashboard rendering (client fulfillment + acquisition)
// ═══════════════════════════════════════════════════════════
import { state } from './app.js';
import { ACQUISITION_STAGES, NURTURE_STAGES, DEFAULT_CLIENT_STAGES, ALL_PIPELINES } from './config.js';
import { render } from './render.js';
import { esc, fmt$, getToday } from './utils.js';
import { isAdmin, isClient, isEmployee } from './auth.js';
import { getOverdueActivities } from './activities.js';
import { getStages, getVisiblePipelines, getVisiblePipelinesWithArchive } from './search.js';

export function getStagesForPipeline(pip){
  if(pip==='Acquisition') return ACQUISITION_STAGES;
  if(pip==='Nurture') return NURTURE_STAGES;
  if(pip==='Client'){
    const clientCols=state.clients.map(c=>({id:c.name,label:c.name,color:c.color||'#6b7280'}));
    return [{id:'Client Not Distributed',label:'Not Distributed',color:'#6b7280'},...clientCols];
  }
  return DEFAULT_CLIENT_STAGES;
}

export function renderDashboard(){
  const tab=state.dashboardTab||'client_leads';
  const now=new Date();
  const thisMonth=now.toISOString().slice(0,7);
  const cs=`padding:10px 20px;font-size:13px;font-weight:600;font-family:var(--font);cursor:pointer;border:none;background:none;margin-bottom:-2px`;

  let h=`<div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin:0 20px">
    <button onclick="state.dashboardTab='client_leads';render()" style="${cs};color:${tab==='client_leads'?'var(--purple)':'var(--text-muted)'};border-bottom:2px solid ${tab==='client_leads'?'var(--purple)':'transparent'}">Client Fulfillment</button>
    <button onclick="state.dashboardTab='acquisition';render()" style="${cs};color:${tab==='acquisition'?'#2563eb':'var(--text-muted)'};border-bottom:2px solid ${tab==='acquisition'?'#2563eb':'transparent'}">Acquisition</button>
  </div>`;

  if(tab==='client_leads'){
    h+=renderClientDashboard(thisMonth);
  } else {
    h+=renderAcquisitionDashboard(thisMonth);
  }
  return h;
}

export function renderClientDashboard(thisMonth){
  const selMonth=state.dashboardMonth||thisMonth;
  const clientDeals=state.deals.filter(d=>d.pipeline==='Client');

  const monthSet=new Set();
  clientDeals.forEach(d=>{
    const cm=(d.createdDate||'').slice(0,7);
    if(cm) monthSet.add(cm);
    const pm=(d.pushedToTracker||'').slice(0,7);
    if(pm) monthSet.add(pm);
  });
  monthSet.add(thisMonth);
  const allMonths=[...monthSet].sort().reverse();

  const [sy,sm]=selMonth.split('-').map(Number);
  const prevDate=new Date(sy,sm-2,1);
  const prevMonth=prevDate.toISOString().slice(0,7);

  const monthDeals=clientDeals.filter(d=>(d.createdDate||'').slice(0,7)===selMonth);
  const delivered=clientDeals.filter(d=>d.pushedToTracker&&(d.pushedToTracker||'').slice(0,7)===selMonth).length;
  const prevDelivered=clientDeals.filter(d=>d.pushedToTracker&&(d.pushedToTracker||'').slice(0,7)===prevMonth).length;
  const prevNewLeads=clientDeals.filter(d=>(d.createdDate||'').slice(0,7)===prevMonth).length;
  const undistributed=clientDeals.filter(d=>d.stage==='Client Not Distributed').length;
  const overdueActs=getOverdueActivities().filter(a=>{
    const deal=state.deals.find(d=>d.id===a.dealId);
    return deal && deal.pipeline==='Client';
  });

  const trend=(cur,prev)=>{
    if(prev===0&&cur===0) return '';
    if(cur>prev) return `<span style="font-size:10px;color:#22c55e;margin-left:4px">+${cur-prev} vs last mo</span>`;
    if(cur<prev) return `<span style="font-size:10px;color:#ef4444;margin-left:4px">${cur-prev} vs last mo</span>`;
    return `<span style="font-size:10px;color:var(--text-muted);margin-left:4px">same as last mo</span>`;
  };

  const clientCounts={};
  state.clients.forEach(c=>{clientCounts[c.name]={total:0,month:0,delivered:0};});
  clientDeals.forEach(d=>{
    const cn=d.stage;
    if(!clientCounts[cn]) clientCounts[cn]={total:0,month:0,delivered:0};
    clientCounts[cn].total++;
    if((d.createdDate||'').slice(0,7)===selMonth) clientCounts[cn].month++;
    if(d.pushedToTracker&&(d.pushedToTracker||'').slice(0,7)===selMonth) clientCounts[cn].delivered++;
  });

  const monthNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthLabel=monthNames[sm-1]+' '+sy;
  const cardStyle='background:#fff;border-radius:10px;padding:16px;border:1px solid var(--border)';
  const labelStyle='font-size:10px;color:var(--text-muted);text-transform:uppercase;font-weight:600';
  const numStyle='font-size:28px;font-weight:800';

  return `<div style="padding:24px;max-width:960px;margin:0 auto">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div>
        <h2 style="font-size:18px;font-weight:800;margin:0 0 4px">Client Fulfillment</h2>
        <p style="font-size:12px;color:var(--text-muted);margin:0">Lead delivery and fulfillment tracking</p>
      </div>
      <select onchange="state.dashboardMonth=this.value;render()" style="padding:6px 12px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-weight:600;font-family:var(--font);background:#fff;cursor:pointer">
        ${allMonths.map(m=>{
          const [y2,m2]=m.split('-').map(Number);
          return `<option value="${m}" ${m===selMonth?'selected':''}>${monthNames[m2-1]} ${y2}</option>`;
        }).join('')}
      </select>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px">
      <div style="${cardStyle}"><div style="${labelStyle}">New Leads (${monthLabel})</div><div style="${numStyle};color:#2563eb">${monthDeals.length}</div>${trend(monthDeals.length,prevNewLeads)}</div>
      <div style="${cardStyle}"><div style="${labelStyle}">Delivered to Clients</div><div style="${numStyle};color:#22c55e">${delivered}</div>${trend(delivered,prevDelivered)}</div>
      <div style="${cardStyle}"><div style="${labelStyle}">Undistributed</div><div style="${numStyle};color:${undistributed?'#f59e0b':'#22c55e'}">${undistributed}</div></div>
      <div style="${cardStyle}"><div style="${labelStyle}">Total Client Leads</div><div style="${numStyle};color:var(--purple)">${clientDeals.length}</div></div>
      <div style="${cardStyle}"><div style="${labelStyle}">Overdue Tasks</div><div style="${numStyle};color:${overdueActs.length?'#ef4444':'#22c55e'}">${overdueActs.length}</div></div>
    </div>
    <h3 style="font-size:14px;font-weight:700;margin-bottom:10px">Leads by Client \u2014 ${monthLabel}</h3>
    <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;border:1px solid var(--border)">
      <thead><tr style="background:#f9fafb">
        <th style="text-align:left;padding:8px 12px;font-size:11px;font-weight:700;color:var(--text-muted)">Client</th>
        <th style="text-align:center;padding:8px 12px;font-size:11px;font-weight:700;color:var(--text-muted)">Total</th>
        <th style="text-align:center;padding:8px 12px;font-size:11px;font-weight:700;color:var(--text-muted)">New (${monthLabel})</th>
        <th style="text-align:center;padding:8px 12px;font-size:11px;font-weight:700;color:var(--text-muted)">Delivered</th>
      </tr></thead>
      <tbody>${Object.entries(clientCounts).filter(([n,c])=>c.total>0).sort((a,b)=>b[1].total-a[1].total).map(([name,c])=>{
        const client=state.clients.find(x=>x.name===name);
        const dot=client?`<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${client.color||'#818cf8'};margin-right:6px"></span>`:'';
        return `<tr style="border-top:1px solid #f3f4f6">
        <td style="padding:8px 12px;font-size:12px;font-weight:600">${dot}${esc(name)}</td>
        <td style="text-align:center;padding:8px 12px;font-size:12px">${c.total}</td>
        <td style="text-align:center;padding:8px 12px;font-size:12px">${c.month}</td>
        <td style="text-align:center;padding:8px 12px;font-size:12px;color:${c.delivered?'#22c55e':'var(--text-muted)'};font-weight:${c.delivered?'700':'400'}">${c.delivered}</td>
      </tr>`;}).join('')}</tbody>
    </table>
  </div>`;
}

export function renderAcquisitionDashboard(thisMonth){
  const acqDeals=state.deals.filter(d=>d.pipeline==='Acquisition');
  const thisMonthAcq=acqDeals.filter(d=>(d.createdDate||'').slice(0,7)===thisMonth);
  const closedWon=acqDeals.filter(d=>d.stage==='Closed Won').length;
  const closedLost=acqDeals.filter(d=>d.stage==='Closed Lost').length;
  const discovery=acqDeals.filter(d=>d.stage==='Discovery Scheduled').length;
  const demo=acqDeals.filter(d=>d.stage==='Demo Scheduled').length;
  const totalValue=acqDeals.reduce((s,d)=>s+(Number(d.value)||0),0);
  const wonValue=acqDeals.filter(d=>d.stage==='Closed Won').reduce((s,d)=>s+(Number(d.value)||0),0);
  const overdueActs=getOverdueActivities().filter(a=>{
    const deal=state.deals.find(d=>d.id===a.dealId);
    return deal && deal.pipeline==='Acquisition';
  });

  const totalResponses=acqDeals.length;
  const discoRate=totalResponses?(((discovery+demo+closedWon)/totalResponses)*100).toFixed(0):'0';
  const closeRate=totalResponses?((closedWon/totalResponses)*100).toFixed(0):'0';

  const cardStyle='background:#fff;border-radius:10px;padding:16px;border:1px solid var(--border)';
  const labelStyle='font-size:10px;color:var(--text-muted);text-transform:uppercase;font-weight:600';
  const numStyle='font-size:28px;font-weight:800';

  return `<div style="padding:24px;max-width:960px;margin:0 auto">
    <h2 style="font-size:18px;font-weight:800;margin-bottom:4px">Acquisition</h2>
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:16px">Sales pipeline for signing new clients</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px">
      <div style="${cardStyle}"><div style="${labelStyle}">Total Responses</div><div style="${numStyle};color:#2563eb">${acqDeals.length}</div></div>
      <div style="${cardStyle}"><div style="${labelStyle}">New This Month</div><div style="${numStyle};color:#818cf8">${thisMonthAcq.length}</div></div>
      <div style="${cardStyle}"><div style="${labelStyle}">Pipeline Value</div><div style="${numStyle};color:var(--purple)">${fmt$(totalValue)}</div></div>
      <div style="${cardStyle}"><div style="${labelStyle}">Closed Won</div><div style="${numStyle};color:#22c55e">${closedWon}</div><div style="font-size:10px;color:#059669;margin-top:2px">${fmt$(wonValue)} revenue</div></div>
      <div style="${cardStyle}"><div style="${labelStyle}">Closed Lost</div><div style="${numStyle};color:#ef4444">${closedLost}</div></div>
      <div style="${cardStyle}"><div style="${labelStyle}">Overdue Tasks</div><div style="${numStyle};color:${overdueActs.length?'#ef4444':'#22c55e'}">${overdueActs.length}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
      <div style="${cardStyle}"><div style="${labelStyle}">Meeting Rate</div><div style="${numStyle};color:#818cf8">${discoRate}%</div><div style="font-size:10px;color:var(--text-muted);margin-top:2px">Responses \u2192 Discovery/Demo/Won</div></div>
      <div style="${cardStyle}"><div style="${labelStyle}">Close Rate</div><div style="${numStyle};color:#22c55e">${closeRate}%</div><div style="font-size:10px;color:var(--text-muted);margin-top:2px">Responses \u2192 Closed Won</div></div>
    </div>
    <h3 style="font-size:14px;font-weight:700;margin-bottom:10px">Pipeline Stages</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px">
      ${getStagesForPipeline('Acquisition').map(s=>{
        const count=acqDeals.filter(d=>d.stage===s.id).length;
        const stageValue=acqDeals.filter(d=>d.stage===s.id).reduce((sum,d)=>sum+(Number(d.value)||0),0);
        return `<div style="background:#fff;border-radius:8px;padding:10px 12px;border:1px solid var(--border);border-top:3px solid ${s.color}">
          <div style="font-size:10px;color:var(--text-muted);font-weight:600">${esc(s.label)}</div>
          <div style="font-size:22px;font-weight:800;color:var(--text)">${count}</div>
          <div style="font-size:10px;color:var(--text-muted)">${fmt$(stageValue)}</div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}
