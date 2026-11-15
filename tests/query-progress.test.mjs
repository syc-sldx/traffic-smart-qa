import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,cpSync,rmSync} from 'node:fs';
import {resolve,join,dirname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {queryResponse,requestProgress,requestDelay} from '../server/request-context.mjs';

const directory=mkdtempSync(join(tmpdir(),'traffic-query-test-'));
cpSync('drizzle',join(directory,'drizzle'),{recursive:true});
await build({entryPoints:['src/http.mjs'],bundle:true,platform:'node',format:'esm',target:'node24',loader:{'.html':'text'},outfile:join(directory,'runtime.mjs')});
await build({stdin:{contents:'export {ask} from "./server/agent.ts";export {travelAnswer} from "./server/travel.ts";export {ensureSeed} from "./server/database.ts";export {openDatabase} from "./src/sqlite.mjs";',resolveDir:resolve('.')},bundle:true,platform:'node',format:'esm',target:'node24',outfile:join(directory,'support.mjs')});
const {ask,travelAnswer,ensureSeed,openDatabase}=await import(pathToFileURL(join(directory,'support.mjs')).href);
after(()=>{const target=resolve(directory);assert.equal(dirname(target),resolve(tmpdir()));assert.ok(basename(target).startsWith('traffic-query-test-'));rmSync(target,{recursive:true,force:true});});
const deferred=()=>{let resolveValue;const promise=new Promise(resolve=>resolveValue=resolve);return {promise,resolve:resolveValue};};
async function* frames(response){
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  try{while(true){const {done,value}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(line)yield JSON.parse(line);}if(done)break;}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

test('query streams real phases before completion and keeps error statuses and deadlines',async()=>{
  const gate=deferred(),response=await queryResponse(async context=>{requestProgress(context,'knowledge');await gate.promise;return {ok:true,answer:'fixture'};},{stream:true,timeoutMs:2000});
  const iterator=frames(response);assert.deepEqual((await iterator.next()).value,{type:'progress',stage:'accepted'});assert.deepEqual((await iterator.next()).value,{type:'progress',stage:'knowledge'});
  gate.resolve();const rest=[];for await(const frame of iterator)rest.push(frame);assert.equal(rest[0].stage,'formatting');assert.equal(rest[1].type,'result');assert.equal(rest[1].result.answer,'fixture');
  const failed=await queryResponse(async()=>{throw Object.assign(Error('登录已过期'),{status:401});},{stream:true});const errors=[];for await(const frame of frames(failed))errors.push(frame);assert.equal(errors.at(-1).type,'error');assert.equal(errors.at(-1).status,401);
  const json=await queryResponse(async()=>({ok:true,answer:'compatible'}));assert.match(json.headers.get('content-type'),/application\/json/);assert.equal((await json.json()).answer,'compatible');
  let continued=false;const timed=await queryResponse(async context=>{await requestDelay(context,1000);continued=true;return {};},{stream:true,timeoutMs:20});const timeout=[];for await(const frame of frames(timed))timeout.push(frame);assert.equal(timeout.at(-1).status,504);assert.equal(continued,false);
});

test('HTTP negotiation streams before the model completes and disconnect aborts upstream without saving a turn',async()=>{
  let release,started=deferred(),closed=deferred(),hold=true,child;
  const upstream=createServer(async(request,response)=>{
    for await(const chunk of request){};
    response.on('close',()=>{if(!response.writableEnded)closed.resolve();});
    const complete=()=>{if(!response.destroyed){response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({choices:[{message:{content:'仅供测试的知识回答。'}}]}));}};
    if(hold){release=complete;started.resolve();}else complete();
  });
  await new Promise(resolveServer=>upstream.listen(0,'127.0.0.1',resolveServer));
  const dbPath=join(directory,'stream.db');let errors='';
  try{
    child=spawn(process.execPath,[join(directory,'runtime.mjs')],{cwd:directory,env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATABASE_PATH:dbPath,AUTH_ENABLED:'true',COOKIE_SECURE:'false',PUBLIC_ORIGIN:'http://fixture.test',AMAP_API_KEY:'',LLM_API_KEY:'fixture-only',LLM_BASE_URL:'http://127.0.0.1:'+upstream.address().port},stdio:['ignore','pipe','pipe']});
    child.stderr.on('data',chunk=>errors+=chunk.toString());
    const port=await new Promise((resolvePort,reject)=>{let output='';const timer=setTimeout(()=>reject(Error(errors||'Server timeout')),15000);child.stdout.on('data',chunk=>{output+=chunk;const found=output.match(/端口 (\d+)/);if(found){clearTimeout(timer);resolvePort(found[1]);}});child.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code+errors));});});
    const base='http://127.0.0.1:'+port,post=(body,{stream=false,cookie='',signal}={})=>fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json',...(stream?{Accept:'application/x-ndjson'}:{}),...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body),signal:signal||AbortSignal.timeout(6000)});
    const body={message:'什么是智慧交通？',mode:'knowledge',history:[]};
    const response=await post(body,{stream:true});assert.match(response.headers.get('content-type'),/application\/x-ndjson/);const iterator=frames(response);let frame;
    while((frame=(await iterator.next()).value)?.stage!=='model'){assert.ok(frame);assert.notEqual(frame.type,'result');}await started.promise;
    release();const finished=[];for await(const next of iterator)finished.push(next);assert.equal(finished.at(-1).type,'result');assert.ok(finished.at(-1).result.evidence);
    hold=false;const plain=await post(body);assert.match(plain.headers.get('content-type'),/application\/json/);assert.equal((await plain.json()).answer,'仅供测试的知识回答。');
    const malformed=await post({...body,history:[{role:'system',content:'bad'}]},{stream:true});assert.equal(malformed.status,400);assert.match(malformed.headers.get('content-type'),/application\/json/);
    const expired=await post({...body,account_required:true},{stream:true});assert.equal(expired.status,401);assert.match(expired.headers.get('content-type'),/application\/json/);
    const register=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'cancel_fixture',password:'fixture-password-only'})});assert.equal(register.status,200);const cookie=register.headers.get('set-cookie').split(';')[0];
    const badId=await post({...body,request_id:'bad'},{stream:true,cookie});assert.equal(badId.status,200);const badFrames=[];for await(const item of frames(badId))badFrames.push(item);assert.equal(badFrames.at(-1).type,'error');assert.equal(badFrames.at(-1).status,400);
    hold=true;started=deferred();closed=deferred();const aborter=new AbortController();const pending=await post({...body,request_id:'cancel_model_001'},{stream:true,cookie,signal:aborter.signal});const cancelling=frames(pending);
    while((frame=(await cancelling.next()).value)?.stage!=='model'){assert.ok(frame);assert.notEqual(frame.type,'result');}await started.promise;aborter.abort();await cancelling.return().catch(()=>{});
    let closeTimer;try{await Promise.race([closed.promise,new Promise((_,reject)=>closeTimer=setTimeout(()=>reject(Error('Upstream did not close after cancellation')),2000))]);}finally{clearTimeout(closeTimer);}
    const native=new DatabaseSync(dbPath);assert.equal(native.prepare('SELECT count(*) AS n FROM qa_turns').get().n,0);native.prepare('UPDATE public_request_limits SET count=30').run();native.close();
    const limited=await post(body,{stream:true});assert.equal(limited.status,429);assert.match(limited.headers.get('content-type'),/application\/json/);assert.ok(Number(limited.headers.get('retry-after'))>0);
  }finally{
    if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done;}
    upstream.closeAllConnections();await new Promise(resolveClose=>upstream.close(resolveClose));
  }
});

test('cancellation before report export stops the write and prevents another model round',async()=>{
  const db=openDatabase(':memory:',resolve('drizzle'));await ensureSeed(db);const aborter=new AbortController(),original=globalThis.fetch;let requests=0;
  globalThis.fetch=async()=>{requests++;return Response.json({choices:[{message:{content:'',tool_calls:[{id:'tool_'+requests,function:{name:requests===1?'run_sql':'export_report',arguments:JSON.stringify(requests===1?{query:'SELECT city FROM flow LIMIT 1'}:{title:'fixture',conclusion:'fixture'})}}]}}]});};
  try{
    await assert.rejects(ask({DB:db,LLM_API_KEY:'fixture-only',LLM_BASE_URL:'https://fixture.invalid',REQUEST_SIGNAL:aborter.signal,REQUEST_PROGRESS:stage=>{if(stage==='formatting')aborter.abort();}},null,'请完成自定义分析并导出报告',[],'data'),{name:'AbortError'});
    assert.equal(requests,2);assert.equal((await db.prepare('SELECT count(*) AS n FROM reports').first()).n,0);
  }finally{globalThis.fetch=original;db.close();}
});

test('cancellation interrupts the map retry delay instead of starting a second upstream attempt',async()=>{
  const aborter=new AbortController();let routeCalls=0;
  const request=async url=>{if(url.pathname.endsWith('/geo'))return Response.json({status:'1',geocodes:[{level:'兴趣点',location:'118.78,32.04'}]});routeCalls++;setTimeout(()=>aborter.abort(),10);return Response.json({status:'0',infocode:'30001'});};
  await assert.rejects(travelAnswer({AMAP_API_KEY:'fixture-only',REQUEST_SIGNAL:aborter.signal},'从当前位置到新街口步行',[],{city:'南京',origin:'当前位置',destination:'新街口',transport:'walking',action:'route',origin_location:'118.802063,31.966917'},request),{name:'AbortError'});assert.equal(routeCalls,1);
});
