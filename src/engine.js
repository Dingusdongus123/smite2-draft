/* Crystal Draft engine. Pure transitions; transport and rendering are deliberately separate. */
(function(root){
'use strict';
const make=(type,teams)=>teams.split('').map(x=>({type,side:x==='O'?'Order':'Chaos'}));
const OPEN_BANS=make('ban','OCOCOC');
const FIRST_PICKS=make('pick','OCCOOC');
// Cross-checked against SMITE 2 Companion's public standard/extended sequences.
const DRAFT_ORDERS={
 standard:[...OPEN_BANS,...make('pick','OCCOOCCOOC')],
 extended:[...OPEN_BANS,...FIRST_PICKS,...make('ban','COCO'),...make('pick','COOC')]
};
const ROLES=['Solo','Jungle','Mid','Carry','Support'];
const copy=x=>JSON.parse(JSON.stringify(x));
function create(config={}){return{version:1,rev:0,phase:'lobby',step:0,actions:[],history:[],config:{format:'standard',pickSeconds:40,banSeconds:18,bankSeconds:90,timeout:'random',...config},names:{Order:'Order captain',Chaos:'Chaos captain'},bank:{Order:config.bankSeconds??90,Chaos:config.bankSeconds??90},deadline:0,remaining:0};}
function current(s){return DRAFT_ORDERS[s.config.format][s.step]||null;}
function base(s){return current(s)?.type==='ban'?s.config.banSeconds:s.config.pickSeconds;}
function arm(n,now){const s=Number(base(n))||0;n.deadline=s>0?now+s*1000:0;}
function clamp(v,min,max,fb){const x=Number(v);return Number.isFinite(x)?Math.max(min,Math.min(max,Math.round(x))):fb;}
function used(s){return new Set(s.actions.filter(a=>a.god).map(a=>a.god));}
function apply(s,a,roster,now=Date.now()){
 if(!a||typeof a.type!=='string')throw Error('Invalid action');
 if(a.rev!==undefined&&a.rev!==s.rev)throw Error('The turn changed; please select again.');
 let n=copy(s);const turn=current(n);
 if(a.type==='start'){
  if(n.phase!=='lobby')throw Error('Draft already started');n.phase='draft';arm(n,now);
 }else if(a.type==='commit'){
  if(n.phase!=='draft'||!turn)throw Error('No active turn');
  if(a.side!==turn.side)throw Error('It is not your turn');
  if(a.god!==null&&(!roster.some(g=>g.id===a.god)||used(n).has(a.god)))throw Error('God unavailable');
  if(a.god===null&&!a.timeout)throw Error('Only a timeout may pass');
  n.history.push({actions:copy(n.actions),step:n.step,bank:copy(n.bank)});
  const overtime=n.deadline?Math.max(0,(now-n.deadline)/1000):0;
  n.bank[turn.side]=Math.max(0,n.bank[turn.side]-overtime);
  n.actions.push({...turn,god:a.god,timeout:!!a.timeout});n.step++;
  n.phase=current(n)?'draft':'summary';if(current(n))arm(n,now);else n.deadline=0;
 }else if(a.type==='pause'){
  if(n.phase!=='draft')throw Error('Not running');n.remaining=n.deadline?n.deadline-now:0;n.phase='paused';
 }else if(a.type==='resume'){
  if(n.phase!=='paused')throw Error('Not paused');n.phase='draft';n.deadline=(Number(base(n))||0)>0?now+n.remaining:0;
 }else if(a.type==='aspect'){
  if(!['draft','paused','summary'].includes(n.phase))throw Error('No active draft');
  if(a.side!=='Order'&&a.side!=='Chaos')throw Error('Unknown side');
  const pick=n.actions.find(x=>x.type==='pick'&&x.side===a.side&&x.god===a.god);
  if(!pick)throw Error('That pick is not on this team');
  const god=(roster||[]).find(g=>g.id===a.god);
  if(!god||!god.aspect)throw Error('That god has no aspect');
  pick.aspect=!!a.on;
 }else if(a.type==='roles'){
  if(n.phase!=='summary')throw Error('Roles are assigned after the draft');
  if(a.side!=='Order'&&a.side!=='Chaos')throw Error('Unknown side');
  const picks=n.actions.filter(x=>x.type==='pick'&&x.side===a.side);
  if(!Array.isArray(a.roles)||a.roles.length!==picks.length)throw Error('Each team assigns five roles');
  const seen={};
  a.roles.forEach(entry=>{
    const role=entry&&entry.role||'';
    if(!role)return;
    if(ROLES.indexOf(role)<0)throw Error('Unknown role');
    if(seen[role])throw Error('Each role is used once');
    seen[role]=true;
  });
  picks.forEach((pick,i)=>{
    const entry=a.roles[i]||{};
    pick.role=entry.role||'';
    pick.roleConfirmed=!!(entry.role&&entry.confirmed);
  });
 }else if(a.type==='clock'){
  if(n.phase!=='lobby')throw Error('The clock locks when the draft starts');
  const c=a.config||{};
  n.config.pickSeconds=clamp(c.pickSeconds,0,300,n.config.pickSeconds);
  n.config.banSeconds=clamp(c.banSeconds,0,300,n.config.banSeconds);
  n.config.bankSeconds=clamp(c.bankSeconds,0,600,n.config.bankSeconds);
  n.config.timeout=c.timeout==='skip'?'skip':'random';
  n.bank.Order=n.config.bankSeconds;n.bank.Chaos=n.config.bankSeconds;
 }else if(a.type==='undo'){
  if(!n.history.length)throw Error('Nothing to undo');
  const kept=new Map(n.actions.filter(x=>x.aspect&&x.god).map(x=>[x.side+'\0'+x.god,true]));
  let h=n.history.pop();n.actions=h.actions;n.step=h.step;n.bank=h.bank;n.phase='draft';arm(n,now);
  n.actions.forEach(x=>{if(x.god&&kept.get(x.side+'\0'+x.god))x.aspect=true;});
 }else if(a.type==='restart'){
  n=create(n.config);n.names=copy(s.names);
 }else throw Error('Unknown action');
 n.rev=s.rev+1;return n;
}
const api={DRAFT_ORDERS,ROLES,create,current,used,apply,base};
if(typeof module!=='undefined')module.exports=api;root.DraftEngine=api;
})(typeof window==='undefined'?globalThis:window);
