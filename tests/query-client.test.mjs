import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile('public/query-client.js','utf8'),encoder=new TextEncoder();
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function streamResponse(chunks,{closed=true,onCancel=()=>{}}={}){
  const stream=new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(typeof chunk==='string'?encoder.encode(chunk):chunk);if(closed)controller.close();},cancel:onCancel});
  return new Response(stream,{headers:{'content-type':'application/x-ndjson; charset=utf-8'}});
}
function harness(request){
  const window={},timers=new Map();let next=0;
  vm.runInNewContext(source,{window,fetch:request,AbortController,TextDecoder,setTimeout(fn,ms){const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}});
  return {run:window.TrafficQuery.run,create:window.TrafficQuery.create,timers};
}

test('fragmented UTF-8 progress arrives before the final answer, including CRLF and a final line without newline',async()=>{
  let wire,fetchOptions,cancelled=0;const stages=[];
  const response=new Response(new ReadableStream({start(controller){wire=controller;},cancel(){cancelled++;}}),{headers:{'content-type':'application/x-ndjson'}});
  const h=harness(async(path,options)=>{assert.equal(path,'/api/chat');fetchOptions=options;return response;});let settled=false;
  const result=h.run({message:'南京怎么走'},{onProgress:stage=>stages.push(stage)}).then(value=>{settled=true;return value;});
  await tick();wire.enqueue(encoder.encode('{"type":"progress","stage":"accepted"}\r\n'));await tick();
  assert.deepEqual(stages,['accepted']);assert.equal(settled,false);assert.equal(fetchOptions.method,'POST');assert.equal(fetchOptions.headers.Accept,'application/x-ndjson');assert.equal(JSON.parse(fetchOptions.body).message,'南京怎么走');
  const final=encoder.encode('{"type":"result","result":{"ok":true,"answer":"南京南站到新街口"}}');
  // Single bytes deliberately split every Chinese UTF-8 sequence.
  for(const byte of final)wire.enqueue(Uint8Array.of(byte));wire.close();
  const answer=await result;assert.equal(answer.answer,'南京南站到新街口');assert.equal(answer.ok,true);assert.equal(h.timers.size,0);assert.equal(response.body.locked,false);assert.equal(fetchOptions.signal.aborted,false);assert.equal(cancelled,0);
});

test('unknown stages and frames are ignored, callback errors do not break the result, and a terminal result closes the stream',async()=>{
  let cancelled=0;const stages=[];
  const response=streamResponse(['{"type":"ping"}\n{"type":"progress","stage":"private_sql"}\n{"type":"future","answer":"not final"}\n{"type":"progress","stage":"model"}\n{"type":"result","result":{"ok":true,"answer":"答案"}}\n'],{closed:false,onCancel(){cancelled++;}});
  const h=harness(async()=>response),result=await h.run({},{onProgress:stage=>{stages.push(stage);throw Error('UI callback failed');}});
  assert.equal(result.answer,'答案');assert.deepEqual(stages,['model']);assert.equal(cancelled,1);assert.equal(response.body.locked,false);assert.equal(h.timers.size,0);
});

test('old JSON responses remain compatible, including an ok:false result, and success removes listeners and timers',async()=>{
  let adds=0,removes=0,requestSignal;const external=new AbortController(),watch={get aborted(){return external.signal.aborted;},addEventListener(...args){adds++;external.signal.addEventListener(...args);},removeEventListener(...args){removes++;external.signal.removeEventListener(...args);}};
  const h=harness(async(_path,options)=>{requestSignal=options.signal;return Response.json({ok:false,error:'已有接口的业务错误'});});
  const result=await h.run({},{signal:watch});assert.equal(result.ok,false);assert.equal(result.error,'已有接口的业务错误');assert.equal(adds,1);assert.equal(removes,1);assert.equal(h.timers.size,0);
  external.abort();assert.equal(requestSignal.aborted,false);assert.equal((await h.create(async()=>Response.json({ok:true,answer:'factory'})).run({})).answer,'factory');
});

test('HTTP and stream errors preserve 401 and 429 semantics without retrying or exposing HTML',async()=>{
  for(const [response,status,message,retry]of [
    [Response.json({error:'登录失效'},{status:401}),401,'登录失效',undefined],
    [Response.json({error:'稍后再试'},{status:429,headers:{'retry-after':'15'}}),429,'稍后再试',15],
    [new Response('{broken',{status:401,headers:{'content-type':'application/json'}}),401,null,undefined],
    [streamResponse(['{"type":"error","error":"流中登录失效","status":401}\n']),401,'流中登录失效',undefined],
    [new Response('<html>do not display</html>',{status:502,headers:{'content-type':'text/html'}}),502,null,undefined]
  ]){
    let calls=0;const h=harness(async()=>{calls++;return response;});
    await assert.rejects(h.run({}),error=>{assert.equal(error.code,'HTTP_ERROR');assert.equal(error.status,status);if(message)assert.equal(error.message,message);assert.equal(error.retryAfter,retry);assert.ok(!error.message.includes('<html>'));return true;});
    assert.equal(calls,1);assert.equal(h.timers.size,0);
  }
});

test('pre-cancelled and zero-timeout queries never fetch',async()=>{
  let calls=0;const h=harness(async()=>{calls++;return Response.json({ok:true});}),external=new AbortController();external.abort('private reason');
  await assert.rejects(h.run({},{signal:external.signal}),error=>error.name==='AbortError'&&error.code==='REQUEST_ABORTED'&&!error.message.includes('private'));
  await assert.rejects(h.run({},{timeoutMs:0}),error=>error.name==='TimeoutError'&&error.code==='REQUEST_TIMEOUT');
  assert.equal(calls,0);assert.equal(h.timers.size,0);
});

test('cancelling a pending read aborts fetch, cancels the reader and cannot deliver a late result',async()=>{
  let wire,requestSignal,cancelled=0;const stages=[],external=new AbortController();
  const response=new Response(new ReadableStream({start(controller){wire=controller;},cancel(){cancelled++;}}),{headers:{'content-type':'application/x-ndjson'}});
  const h=harness(async(_path,options)=>{requestSignal=options.signal;return response;});
  const pending=h.run({},{signal:external.signal,onProgress:stage=>stages.push(stage)});await tick();wire.enqueue(encoder.encode('{"type":"progress","stage":"map"}\n'));await tick();external.abort();
  await assert.rejects(pending,error=>error.name==='AbortError'&&error.code==='REQUEST_ABORTED');await tick();
  assert.equal(requestSignal.aborted,true);assert.equal(cancelled,1);assert.deepEqual(stages,['map']);assert.equal(h.timers.size,0);assert.equal(response.body.locked,false);
});

test('total timeout promptly aborts a non-cooperating fetch and cancels a late response',async()=>{
  let resolveFetch,requestSignal,cancelled=0;const stages=[];
  const h=harness((_path,options)=>{requestSignal=options.signal;return new Promise(resolve=>{resolveFetch=resolve;});});
  const pending=h.run({},{onProgress:stage=>stages.push(stage)});assert.equal(h.timers.size,1);const timer=[...h.timers.values()][0];assert.equal(timer.ms,125000);timer.fn();
  await assert.rejects(pending,error=>error.name==='TimeoutError'&&error.code==='REQUEST_TIMEOUT');assert.equal(requestSignal.aborted,true);assert.equal(h.timers.size,0);
  resolveFetch(streamResponse(['{"type":"progress","stage":"model"}\n{"type":"result","result":{"ok":true,"answer":"too late"}}\n'],{closed:false,onCancel(){cancelled++;}}));await tick();
  assert.deepEqual(stages,[]);assert.equal(cancelled,1);
});

test('malformed, invalid UTF-8 and incomplete responses fail clearly and release the reader',async()=>{
  for(const chunks of [
    ['{broken}\n'],['{"type":"progress","stage":"accepted"}\n'],['{"type":"result","result":null}\n'],['"not an object"\n'],[Uint8Array.of(255)]
  ]){
    const response=streamResponse(chunks),h=harness(async()=>response);
    await assert.rejects(h.run({}),error=>error.code==='PROTOCOL_ERROR');assert.equal(response.body.locked,false);assert.equal(h.timers.size,0);
  }
  const badJSON=harness(async()=>new Response('{bad',{headers:{'content-type':'application/json'}}));await assert.rejects(badJSON.run({}),error=>error.code==='PROTOCOL_ERROR');
  const html=harness(async()=>new Response('<html>not a result</html>',{headers:{'content-type':'text/html'}}));await assert.rejects(html.run({}),error=>error.code==='PROTOCOL_ERROR');
});

test('overlong frames, aggregate data and raw network errors are bounded without retries',async()=>{
  for(const response of [streamResponse(['x'.repeat(2*1024*1024+1)]),streamResponse(['{"type":"ping"}\n'.repeat(300000)])]){
    const h=harness(async()=>response);await assert.rejects(h.run({}),error=>error.code==='RESPONSE_TOO_LARGE');assert.equal(response.body.locked,false);assert.equal(h.timers.size,0);
  }
  let calls=0;const h=harness(async()=>{calls++;throw Object.assign(new Error('private upstream connection detail'),{code:'ECONNRESET'});});
  await assert.rejects(h.run({}),error=>error.code==='NETWORK_ERROR'&&!error.message.includes('private'));assert.equal(calls,1);assert.equal(h.timers.size,0);
});
