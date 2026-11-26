/** Single-page web UI: "/" lists trackers, "/t/<name>" shows and edits one. No build step. */
export const PAGE = `<!doctype html><meta charset=utf-8><title>tracker</title>
<style>
body{font:15px system-ui;max-width:820px;margin:2em auto;padding:0 1em 3em}
ul{padding:0}li{list-style:none;margin:.4em 0}
.done{color:#2a7}.dropped{color:#999}.dropped .txt{text-decoration:line-through}.child{margin-left:1.6em}
small{color:#666}a{color:inherit}
.card{display:block;text-decoration:none;border:1px solid #ddd;border-radius:8px;padding:.7em 1em;margin:.6em 0}
.card:hover{background:#f6f6f6}progress{width:100%;height:8px}
button{font:inherit;border:0;background:none;cursor:pointer;padding:0 .15em;color:inherit}
.ctl{opacity:0;font-size:12px;color:#06c}.ctl button{color:#06c}li:hover .ctl{opacity:1}
form{margin-top:1.2em}.repo{margin:1.4em 0}.repo h3{margin:.2em 0}.wt{margin:.8em 0 .8em 1em;padding-left:.8em;border-left:3px solid #ddd}details{margin-top:1.5em}input{font:inherit;width:70%;padding:.3em}
</style>
<h2 id=title>tracker</h2><div id=root></div>
<script>
var TOKEN="__TOKEN__";
var parts=location.pathname.split('/');
var onTracker=parts.length===5&&parts[1]==='p'&&parts[3]==='t';
var projectKey=onTracker?decodeURIComponent(parts[2]):null;
var trackerName=onTracker?decodeURIComponent(parts[4]):null;
var filterText='';
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function sessions(list){return list.length?' <small>session: '+list.map(esc).join(', ')+'</small>':' <small>no live session</small>'}
function trackerCard(project,t){
  return '<a class=card href="/p/'+encodeURIComponent(project.key)+'/t/'+encodeURIComponent(t.name)+'"><b>'+esc(t.name)+'</b> <small>'+t.done+'/'+t.total+' done</small>'
    +sessions(t.sessions)+'<br><progress max='+Math.max(t.total,1)+' value='+t.done+'></progress></a>';
}
function projectBlock(project){
  var label=project.branch||project.cwd.split('/').pop();
  var cards=project.trackers.map(function(t){return trackerCard(project,t)}).join('')||'<small>no trackers</small>';
  return '<div class=wt><b>'+esc(label)+'</b> <small title="'+esc(project.cwd)+'">'+esc(project.cwd)+(project.cwdExists?'':' (directory gone)')+'</small>'+cards+'</div>';
}
function groupBlock(group){
  return '<div class=repo><h3>'+esc(group.repo)+'</h3>'+group.projects.map(projectBlock).join('')+'</div>';
}
function groupProjects(projects){
  var groups={};
  projects.forEach(function(p){(groups[p.repoRoot]=groups[p.repoRoot]||{repo:p.repo,projects:[]}).projects.push(p)});
  return Object.keys(groups).map(function(k){
    groups[k].projects.sort(function(a,b){return b.lastSeen-a.lastSeen});return groups[k]})
    .sort(function(a,b){return b.projects[0].lastSeen-a.projects[0].lastSeen});
}
function matches(project){
  if(!filterText)return true;
  var hay=(project.repo+' '+(project.branch||'')+' '+project.cwd+' '+project.trackers.map(function(t){return t.name}).join(' ')).toLowerCase();
  return hay.indexOf(filterText.toLowerCase())>=0;
}
async function drawIndex(){
  var all=(await (await fetch('/api/projects')).json()).filter(matches);
  var live=all.filter(function(p){return p.live}), idle=all.filter(function(p){return !p.live});
  document.getElementById('title').textContent='trackers';
  document.getElementById('root').innerHTML='<input id=filter placeholder="filter by repo, branch, tracker" value="'+esc(filterText)+'">'
    +(live.length?groupProjects(live).map(groupBlock).join(''):'<p><small>no project with a live session</small></p>')
    +(idle.length?'<details><summary>inactive ('+idle.length+')</summary>'+groupProjects(idle).map(groupBlock).join('')+'</details>':'');
  var input=document.getElementById('filter');
  input.oninput=function(){filterText=input.value;drawIndex().then(function(){var f=document.getElementById('filter');f.focus();f.setSelectionRange(f.value.length,f.value.length)})};
}
function row(i){
  var act=i.status==='open'?'tick':'reopen';
  var box=i.status==='done'?'&#9745;':i.status==='dropped'?'&#9746;':'&#9744;';
  var ctl='<span class=ctl> <button data-act=comment data-id='+i.id+'>comment</button>'
    +(i.status==='open'?' <button data-act=drop data-id='+i.id+'>drop</button>':'')
    +(i.status==='open'&&i.parent==null?' <button data-act=child data-id='+i.id+'>+child</button>':'')+'</span>';
  return '<li class="'+i.status+(i.parent!=null?' child':'')+'"><button data-act='+act+' data-id='+i.id+'>'+box+'</button> <b>#'+i.id+'</b> <span class=txt>'+esc(i.text)+'</span>'
    +(i.by==='user'?' <small>(user)</small>':'')
    +(i.evidence?' <small>('+esc(i.evidence)+')</small>':'')+(i.reason?' <small>(dropped: '+esc(i.reason)+')</small>':'')+ctl
    +i.notes.map(function(n){return '<br><small>&nbsp;&nbsp;&nbsp;&nbsp;- '+esc(n)+'</small>'}).join('')+'</li>';
}
async function drawTracker(){
  var res=await fetch('/api/p/'+encodeURIComponent(projectKey)+'/tracker/'+encodeURIComponent(trackerName));
  if(!res.ok){document.getElementById('root').innerHTML='<small>not found</small> <a href="/">all trackers</a>';return}
  var r=await res.json(), items=r.tracker.items;
  var done=items.filter(function(i){return i.status!=='open'}).length;
  var where=r.project?esc(r.project.repo)+(r.project.branch?' / '+esc(r.project.branch):'')+' / ':'';
  document.getElementById('title').innerHTML='<a href="/">&larr;</a> '+where+esc(trackerName)+' <small>'+done+'/'+items.length+' done</small>'+sessions(r.sessions);
  var ord=items.filter(function(i){return i.parent==null}).reduce(function(acc,i){
    return acc.concat([i],items.filter(function(c){return c.parent===i.id}))},[]);
  var typing=document.getElementById('addtext')?document.getElementById('addtext').value:'';
  document.getElementById('root').innerHTML='<ul>'+ord.map(row).join('')+'</ul>'
    +'<form id=addform><input id=addtext placeholder="add item (sent to the agent)"> <button>add</button></form>';
  document.getElementById('addtext').value=typing;
}
function draw(){return trackerName?drawTracker():drawIndex()}
async function act(body){
  var res=await fetch('/api/p/'+encodeURIComponent(projectKey)+'/tracker/'+encodeURIComponent(trackerName)+'/op',{method:'POST',
    headers:{'content-type':'application/json','x-tracker-token':TOKEN},body:JSON.stringify(body)});
  var out=await res.json().catch(function(){return {error:'bad response'}});
  if(!res.ok){alert(out.error||('error '+res.status));return}
  draw();
}
var root=document.getElementById('root');
root.onclick=function(e){
  var el=e.target.closest('[data-act]');if(!el)return;
  var id=Number(el.dataset.id),a=el.dataset.act,v;
  if(a==='tick')return act({kind:'tick',id:id});
  if(a==='reopen')return act({kind:'reopen',id:id});
  if(a==='drop'){v=prompt('Reason for dropping #'+id+'?');if(v)act({kind:'drop',id:id,reason:v});return}
  if(a==='comment'){v=prompt('Comment on #'+id+' (sent to the agent):');if(v)act({kind:'comment',id:id,text:v});return}
  if(a==='child'){v=prompt('New sub-item under #'+id+':');if(v)act({kind:'add',text:v,parent:id});return}
};
root.onsubmit=function(e){
  e.preventDefault();
  var input=document.getElementById('addtext');
  if(input.value.trim()){var text=input.value;input.value='';act({kind:'add',text:text})}
};
draw();
new EventSource('/events').onmessage=function(e){if(!trackerName||e.data===projectKey+'/'+trackerName||e.data===projectKey+'/*')draw()};
</script>`;
