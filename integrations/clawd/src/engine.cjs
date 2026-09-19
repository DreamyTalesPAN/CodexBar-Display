// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const http=require('node:http');
const path=require('node:path');
const fs=require('node:fs');
const {randomUUID,timingSafeEqual}=require('node:crypto');
const {observe,project}=require('./lifecycle.cjs');
const upstream=name=>require(path.join(__dirname,'../upstream',name));
const lock=require('../upstream.lock.json');
const {getAllAgents}=upstream('agents/registry');
const {classifyPermissionInteraction}=upstream('src/permission-automation-policy');
const {resolveSessionIdentity}=upstream('src/session-key');
const {resolveHookAgentId}=upstream('src/server-agent-id');
const initState=upstream('src/state');
const createRuntime=upstream('src/agent-runtime-main');
const {handleStatePost}=upstream('src/server-route-state');
const {createTranslator}=upstream('src/i18n');
const noop=()=>{};
const priority=['waiting_for_permission','waiting_for_answer','waiting_for_review','error','compacting','tool_use','thinking','working','done','stale','idle','unavailable'];
async function createEngine({token,port=0,codexSessionsDir=null,now=Date.now}={}) {
 if(typeof token!=='string'||token.length<32) throw Error('engine-token-required');
 const instance=randomUUID();
 const ctx={lang:'en',theme:{hitBoxes:{default:{}},states:Object.fromEntries(['idle',...new Set(getAllAgents().flatMap(agent=>Object.values(agent.eventMap||{})))].map(state=>[state,['']])),timings:{minDisplay:{},autoReturn:{}}},
  doNotDisturb:false,miniTransitioning:false,miniMode:false,mouseOverPet:false,idlePaused:true,
  forceEyeResend:false,eyePauseUntil:0,mouseStillSince:now(),miniSleepPeeked:false,
  pendingPermissions:[],hideBubbles:true,PASSTHROUGH_TOOLS:new Set(),
  claudeQuotaCollectionEnabled:false,kimiQuotaCollectionEnabled:false,
  playSound:noop,sendToRenderer:noop,syncHitWin:noop,sendToHitWin:noop,miniPeekIn:noop,miniPeekOut:noop,
  buildContextMenu:noop,buildTrayMenu:noop,dismissPermissionsForDnd:noop,focusTerminalWindow:noop,
  getCursorScreenPoint:()=>({x:0,y:0}),isAgentEnabled:()=>true,
  isAgentPermissionsEnabled:()=>false,isAgentSubagentPermissionsEnabled:()=>false,
  isCodexPermissionInterceptEnabled:()=>false,permLog:noop,
  resolvePermissionEntry:()=>{throw Error('observation-cannot-decide');},
 };
 ctx.t=createTranslator(()=>ctx.lang);
 const state=initState(ctx);Object.assign(ctx,state);
 // Keep account quota out of this engine, including unsolicited hook metadata.
 state.updateAccountQuota=noop;ctx.updateAccountQuota=noop;
 const update=(id,value,event,opts={})=>{
  const previous=state.sessions.get(id);
  const accepted=state.updateSession(id,value,event,opts);
  const session=state.sessions.get(id);
  if(accepted!==false&&session) {
   observe(session,previous,event,value,opts,now());
   if(String(event).toLowerCase()==='pretooluse') {
    const interaction=classifyPermissionInteraction({agentId:session.agentId,toolName:opts.toolName});
    if(['human-question','plan-review'].includes(interaction.intent)) session.observation.wait={intent:interaction.intent,at:now()};
   }
  }
  return accepted;
 };
 const runtime=createRuntime({getStateRuntime:()=>state,updateSession:update,isAgentEnabled:()=>true,logWarn:noop,
  loadCodexAgent:()=>{const config=upstream('agents/codex');return {...config,logConfig:{...config.logConfig,sessionDir:codexSessionsDir,pollIntervalMs:1000}};},
  showCodexUserInputBubble:input=>{
   const session=state.sessions.get(input.sessionId);
   if(session?.observation) session.observation.wait={intent:'human-question',at:now(),callId:input.callId};
   return false;
  },
  clearCodexUserInputBubbles:(id,callId)=>{
   const session=state.sessions.get(id);
   if(session?.observation?.wait&&(!callId||session.observation.wait.callId===callId)) {
    observe(session,null,'UserInputResolved','working',{},now());
   }
  },
 });
 ctx.updateSession=runtime.updateSessionFromServer;
 ctx.updateSessionMetadata=runtime.updateSessionMetadataFromServer;
 const recorder=()=>({accepted:noop,acceptedUnlessDnd:noop,droppedByDisabled:noop,droppedByDnd:noop,droppedInvalidAgent:noop,droppedUnsupported:noop});
 const options={dshStateSequenceFence:upstream('src/dsh-state-sequence').createDshStateSequenceFence(),grokTurnFence:upstream('src/grok-turn-fence')(),ctx,createRequestHookRecorder:recorder,shouldDropForDnd:()=>false,codexOfficialTurns:new Map(),isClaudeStatuslineMetadataAllowed:()=>false};
 function snapshot() {
  const generatedAt=now();
  const sessions=[...state.sessions].map(([id,session])=>project(id,session,{now:generatedAt})).sort((a,b)=>a.id.localeCompare(b.id));
  const phase=priority.find(value=>sessions.some(session=>session.phase===value))||'unavailable';
  return {schemaVersion:1,engineVersion:lock.engineVersion,upstreamRevision:lock.clawd.commit,instance,generatedAt,health:'ready',phase,sessions,
   sources:getAllAgents().map(agent=>({id:agent.id,name:agent.name,transport:agent.eventSource,capabilityLevel:'declared',explicitThinking:false}))};
 }
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const auth=Buffer.from(req.headers.authorization||'');const expected=Buffer.from('Bearer '+token);
  if(auth.length!==expected.length||!timingSafeEqual(auth,expected)) {res.writeHead(401);res.end();return;}
  if(req.method==='GET'&&req.url==='/snapshot') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(snapshot()));return;}
  if(req.method!=='POST'||!['/state','/permission'].includes(req.url)) {res.writeHead(404);res.end();return;}
  let body=Buffer.alloc(0);
  try {
   for await(const chunk of req) {if(body.length+chunk.length>16384){res.writeHead(413);res.end();return;}body=Buffer.concat([body,chunk]);}
   const data=JSON.parse(body.toString());
   if(!data||typeof data.session_id!=='string'||!data.session_id.trim()||data.session_id.length>256||data.session_id==='default') {res.writeHead(422);res.end();return;}
   const identity=resolveHookAgentId(data,{allowDefaultAgent:false});
   if(identity.rejected||!getAllAgents().some(agent=>agent.id===identity.agentId)){res.writeHead(422);res.end();return;}
   // Native Codex JSONL uses canonical raw IDs; namespace other clients at ingress.
   if(identity.agentId!=='codex') data.session_id=identity.agentId+':'+data.session_id;
   if(req.url==='/permission') {
    const id=resolveSessionIdentity(data.session_id).sessionId;
    const session=state.sessions.get(id);
    if(session?.observation) session.observation.wait={intent:classifyPermissionInteraction({agentId:identity.agentId,toolName:data.tool_name}).intent,at:now()};
    res.writeHead(204);res.end();return;
   }
   // Replay the bounded body to the unmodified Clawd ingress parser.
   const {Readable}=require('node:stream');const incoming=Readable.from([Buffer.from(JSON.stringify(data))]);
   incoming.headers=req.headers;
   handleStatePost(incoming,res,options);
  } catch {if(!res.headersSent)res.writeHead(400);res.end();}
 });
 server.requestTimeout=3000;server.headersTimeout=3000;server.maxConnections=32;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 if(codexSessionsDir) runtime.startCodexLogMonitor();
 return {snapshot,url:`http://127.0.0.1:${server.address().port}`,state,runtime,
  async close(){runtime.cleanup();state.cleanup();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));},
 };
}
module.exports={createEngine};
