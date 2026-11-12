export const dashboardHtml = `<!doctype html>
<!-- THESIS: An honest operational ledger, not simulated agent progress.
OWN-WORLD: Daylight desktop, cool white workspace, navy text and restrained blue selection.
STORY: Scan service health, inspect an issue, read actual phase evidence.
FIRST VIEWPORT: Service rows above a split issue list and detail pane; timeline below.
FORM: Brief-pinned compact Operate table; no concept tournament. -->
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sandcastle activity</title><link rel="stylesheet" href="/dashboard.css"><script defer src="/dashboard.js"></script></head>
<body><header><div><h1>Sandcastle activity</h1><p>Local orchestration · read-only</p></div><div class="refresh"><span id="updated" role="status">Loading canonical journals…</span><button id="refresh">Refresh now</button></div></header>
<main><div id="error" role="alert" hidden></div><section aria-labelledby="services-title"><div class="section-head"><h2 id="services-title">Services</h2><label>Project <select id="project"><option value="">All projects</option></select></label></div><div id="services" aria-live="polite"><div class="loading">Reading service controls and retained evidence…</div></div></section>
<section aria-labelledby="work-title"><div class="section-head"><h2 id="work-title">Issue activity</h2><label><input id="history" type="checkbox"> Include historical revisions</label></div><p class="hint">Retained observations, not a live eligibility count. Select an issue for evidence and results.</p><div class="work"><div id="issues"></div><aside id="detail" aria-label="Issue detail">Select an issue to inspect its retained evidence.</aside></div></section>
<section aria-labelledby="timeline-title"><div class="section-head"><h2 id="timeline-title">Recent journal events</h2><span class="hint">Newest first · bounded history</span></div><div id="timeline"></div></section>
<footer>Native DevSquad workers run as CLI subprocesses, not separate app sessions. No model reasoning is exposed. Local validation is not independent review. This dashboard cannot start, stop, approve or execute work.</footer></main></body></html>`;
export const dashboardCss = `
:root{font-family:"Segoe UI",system-ui,sans-serif;color:#182b45;background:#f2f5f9;font-size:15px;line-height:1.5;color-scheme:light}
*{box-sizing:border-box}body{margin:0}header{background:#fff;border-bottom:1px solid #cbd5e1;padding:24px 32px;display:flex;justify-content:space-between;align-items:center;gap:20px}h1{font-size:1.6rem;line-height:1.2;margin:0 0 6px;font-weight:650}p{margin:0;max-width:75ch}header p,.hint,footer{color:#506078}main{max-width:1440px;margin:auto;padding:28px 32px}section{margin-bottom:32px}.section-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:12px}h2{font-size:1.15rem;margin:0;font-weight:650}h3{font-size:1.05rem;margin:0 0 12px}.refresh{display:flex;gap:14px;align-items:center;font-size:.85rem}button,select{font:inherit;border:1px solid #93a2b8;border-radius:4px;padding:8px 12px;background:#fff;color:#182b45}button{cursor:pointer}button:hover,select:hover{background:#edf3fc}button:active{background:#dce7f8}button:disabled{opacity:.6;cursor:wait}button:focus-visible,select:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid #2467c9;outline-offset:3px}label{font-size:.9rem;display:flex;gap:8px;align-items:center}table{width:100%;border-collapse:collapse;background:#fff;text-align:left}th,td{padding:13px 16px;border-bottom:1px solid #dce3ed;vertical-align:top}th{font-size:.8rem;color:#506078;font-weight:600;background:#e9eef5}td small{display:block;color:#506078;margin-top:3px}a{color:#1555a5;text-underline-offset:3px}a:hover{color:#0c3671}.pill{display:inline-block;font-size:.8rem;font-weight:600;padding:2px 8px;border-radius:4px;background:#e7edf5;white-space:nowrap}.online{background:#dcefe5;color:#205436}.offline,.error,.unknown,.blocked{background:#fbe2df;color:#8f2922}.stale,.observed,.superseded{background:#fff0d0;color:#78540d}.work{display:grid;grid-template-columns:1.1fr 1fr;min-height:230px;border:1px solid #cbd5e1;background:#fff;margin-top:14px}.issue{display:block;width:100%;border:0;border-bottom:1px solid #dce3ed;border-radius:0;text-align:left;padding:16px;background:#fff}.issue.selected{background:#e8f0fc;box-shadow:inset 0 0 0 2px #2467c9}.issue strong{display:block;margin:6px 0;font-weight:600}.issue small{color:#506078}aside{padding:22px;border-left:1px solid #dce3ed;min-width:0}aside p{margin-bottom:12px}aside h4{margin:22px 0 8px;font-size:.95rem}aside ul{padding-left:20px;margin-top:6px}.hint{font-size:.85rem}.empty,.loading{padding:24px;color:#506078;background:#fff}.loading{min-height:90px;background:#e9eef5}.blockers{margin:0;padding:14px 20px 14px 36px;background:#fff6e5;color:#704b0b;border-bottom:1px solid #dce3ed}.blockers li+li{margin-top:8px}#error{background:#fbe2df;color:#8f2922;padding:16px;margin-bottom:24px}footer{font-size:.85rem;max-width:95ch;margin:36px 0 12px}time{font-variant-numeric:tabular-nums}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:.9rem;max-width:75ch}.table-scroll{overflow:auto}#timeline td{font-size:.85rem}.scope{max-width:70ch;overflow-wrap:anywhere}
.work{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)}.blockers,.issue,aside{overflow-wrap:anywhere}#issues{min-width:0;max-height:520px;overflow-y:auto}
@media(max-width:720px){header{padding:20px;align-items:flex-start;flex-direction:column;gap:16px}main{padding:20px}.refresh{align-items:flex-start;flex-direction:column;gap:8px}.section-head{align-items:flex-start;flex-wrap:wrap}.work{grid-template-columns:1fr}#issues{max-height:360px}aside{border-left:0;border-top:1px solid #cbd5e1}th,td{padding:10px}#services table,#services tbody,#services tr,#services td{display:block}#services thead{display:none}#services td::before{content:attr(data-label);display:block;font-size:.8rem;color:#506078;margin-bottom:4px}#services td:first-child{padding-top:16px}#services td:last-child{padding-bottom:18px}h1{font-size:1.4rem}}
`;
export const dashboardJs = `
'use strict';
const $=id=>document.getElementById(id);
let data,selection='',busy=false;
const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n};
const badge=(text)=>el('span',text,'pill '+text);
const stamp=value=>value?new Date(value).toLocaleString(): 'No successful poll recorded';
const selectedProjects=()=>data.projects.filter(p=>!$('project').value||p.name===$('project').value);
function table(headings,rows){const wrap=el('div',undefined,'table-scroll'),t=el('table'),h=el('thead'),r=el('tr');headings.forEach(x=>r.append(el('th',x)));h.append(r);t.append(h);const b=el('tbody');rows.forEach(cells=>{const row=el('tr');cells.forEach((cell,index)=>{const td=el('td');td.dataset.label=headings[index];if(cell instanceof Node)td.append(cell);else td.textContent=cell;row.append(td)});b.append(row)});t.append(b);wrap.append(t);return wrap}
function render(){
 const projects=selectedProjects();$('services').replaceChildren();$('issues').replaceChildren();$('timeline').replaceChildren();
 for(const p of projects){
  if(p.error){$('services').append(el('p',p.name+': '+p.error,'empty'));continue}
  const health=el('div');health.append(badge(p.health),el('small',p.serviceState+' · '+p.mode));if(p.phases.length)health.append(el('small','Latest phase: '+p.phases[0].stage+' / '+p.phases[0].outcome));
  const poll=el('div',stamp(p.lastSuccessfulPoll));poll.append(el('small',p.evaluatedSources+' source(s) evaluated · revision '+p.revision));
  const scope=el('div',p.scope.map(s=>s.project+' · '+s.eligibility+(s.workItemTypes.length?' · '+s.workItemTypes.join(', '):'')+(s.team?' · team '+s.team:'')+(s.iteration?' · iteration '+s.iteration:'')+(s.query?' · query '+s.query:'')).join('; '),'scope');
  $('services').append(table(['Project','Service','Last successful poll','Configured scope'],[[p.name,health,poll,scope]]));
  const note=el('div',p.activity+' · '+p.currentObservations+' current-revision observations / '+p.retainedCount+' historical total.','empty');$('services').append(note);
  if(p.blockers.length){const list=el('ul',undefined,'blockers');p.blockers.forEach(b=>list.append(el('li',b)));$('services').append(list)}
 }
 const issues=projects.flatMap(p=>(p.proposals||[]).filter(q=>$('history').checked||(q.currentConfiguration&&q.state!=='superseded')).map(q=>({p,q})));
 if(!issues.length)$('issues').append(el('div','No retained issues in this view. This is not a fresh remote eligibility check.','empty'));
 for(const {p,q} of issues){const button=el('button',undefined,'issue'+(selection===q.id?' selected':''));button.append(el('small',p.name+' · #'+q.issue),el('strong',q.title),badge(q.effectiveState||q.state));button.onclick=()=>{selection=q.id;render()};$('issues').append(button)}
 const chosen=issues.find(x=>x.q.id===selection);
 $('detail').replaceChildren();
 if(chosen){
  const {p,q}=chosen;$('detail').append(el('h3',q.title));
  if(q.url){const a=el('a','Open source #'+q.issue);a.href=q.url;a.target='_blank';a.rel='noopener noreferrer';$('detail').append(a)}
  $('detail').append(el('p','Proposal '+q.id.slice(0,12)+' · '+q.state+' · configuration revision '+q.revision,'hint'));
  if(q.diagnostic)$('detail').append(el('p',q.diagnostic));
  if(q.effectiveState!==q.state)$('detail').append(el('p','Effective state: '+q.effectiveState+' · stored observation: '+q.state));
  if(q.stageOwner)$('detail').append(el('p','Stage owner: '+q.stageOwner+' · hub synchronization: '+q.workflowSync));
  if(q.review){$('detail').append(el('h4','Review / fix cycle'),el('p','Iteration '+q.review.iteration+' of '+q.review.limit+' · commit '+q.review.revision),el('p',q.review.trust,'hint'));q.review.findings.forEach(f=>$('detail').append(el('p',f)));if(q.review.reason)$('detail').append(el('p',q.review.reason))}
  $('detail').append(el('h4','Agent phase evidence'));
  if(!p.phases.length)$('detail').append(el('p','No native worker launch recorded for this workspace.'));
  for(const phase of p.phases)$('detail').append(el('p',phase.agent+' · '+phase.stage+' · '+phase.outcome+' · '+stamp(phase.at)+' (workspace launch history; not necessarily this issue)'));
  $('detail').append(el('h4','Local validation'));
  if(!p.validations.length)$('detail').append(el('p','No live local validation recorded. Isolated fixture proofs are not shown as task progress.'));
  p.validations.forEach(v=>$('detail').append(el('p',v.state+' · '+v.evaluatedScope+' test evaluations · '+stamp(v.at))));
  if(q.artifacts)$('detail').append(el('h4','Planning artifacts'),el('p',Object.keys(q.artifacts).join(', ')+' retained. Full contents remain in the canonical journal, not the dashboard payload.'));
  $('detail').append(el('h4','Writable scope'),el('pre',p.writableScopes.join('\\n')||'No implementation scope configured.'),el('p',p.proofBoundary,'hint'));
 }else $('detail').append(el('p','Select an issue to inspect its retained evidence, agent phases and validation results.'));
 const events=projects.flatMap(p=>(p.events||[]).map(e=>({...e,project:p.name}))).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,60);
 $('timeline').append(events.length?table(['Time','Project','Event','Sequence'],events.map(e=>[stamp(e.at),e.project,e.kind,String(e.sequence)])):el('p','No journal events available.','empty'));
}
async function refresh(){if(busy)return;busy=true;$('refresh').disabled=true;try{
 const response=await fetch('/api/state',{cache:'no-store',signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Status request failed ('+response.status+').');data=await response.json();
 const current=$('project').value;$('project').replaceChildren(el('option','All projects'));$('project').firstChild.value='';
 data.projects.forEach(p=>{const option=el('option',p.name);option.value=p.name;$('project').append(option)});$('project').value=current;
 $('error').hidden=true;$('updated').textContent='Updated '+stamp(data.updatedAt)+' · refreshes every 15s';render();
 }catch(error){$('error').hidden=false;$('error').textContent='Cannot refresh: '+error.message+' Last successful view, if any, is retained and may be stale.';$('updated').textContent='Refresh failed · '+new Date().toLocaleTimeString();if(!data)$('services').replaceChildren(el('div','No status loaded. Check the local dashboard process and canonical journal availability.','empty'))}finally{busy=false;$('refresh').disabled=false}}
$('project').onchange=render;$('history').onchange=render;$('refresh').onclick=refresh;refresh();setInterval(refresh,15000);
`;
