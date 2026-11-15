const stages=new Set(['accepted','metro','annual','history','knowledge','model','map','formatting']);
export function checkRequest(env){env?.REQUEST_SIGNAL?.throwIfAborted();}
export function requestProgress(env,stage){
  checkRequest(env);
  if(stages.has(stage))env?.REQUEST_PROGRESS?.(stage);
  checkRequest(env);
}
export function upstreamSignal(env,timeout){
  checkRequest(env);const local=AbortSignal.timeout(timeout);
  return env?.REQUEST_SIGNAL?AbortSignal.any([env.REQUEST_SIGNAL,local]):local;
}
export function requestDelay(env,milliseconds){
  checkRequest(env);
  return new Promise((resolve,reject)=>{
    const signal=env?.REQUEST_SIGNAL,cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);},abort=()=>{cleanup();reject(signal.reason);};
    const timer=setTimeout(()=>{cleanup();resolve();},milliseconds);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
}
const cancelled=()=>Object.assign(new Error('查询已取消。'),{name:'AbortError',status:499});
function publicFailure(error){
  if(error?.name==='AbortError')return {error:'查询已取消。',status:499};
  if(error?.name==='TimeoutError')return {error:'本次查询等待超时，请稍后重试。',status:504};
  return {error:error?.status?String(error.message):'服务暂时无法完成查询，请稍后重试。',status:Number.isInteger(error?.status)&&error.status>=400&&error.status<=599?error.status:500};
}
/* Streaming is opt-in; old clients keep exactly one JSON response. */
export async function queryResponse(execute,{signal,stream=false,timeoutMs=120000,pingMs=15000}={}){
  const aborter=new AbortController();let timer,ping,lastStage='',closed=false,streamController;
  const forward=()=>aborter.abort(signal?.reason||cancelled());
  signal?.addEventListener('abort',forward,{once:true});if(signal?.aborted)forward();
  timer=setTimeout(()=>aborter.abort(Object.assign(new Error('本次查询等待超时，请稍后重试。'),{name:'TimeoutError',status:504})),timeoutMs);
  const encoder=new TextEncoder();
  function cleanup(){clearTimeout(timer);clearInterval(ping);signal?.removeEventListener('abort',forward);}
  function write(frame){if(closed||!streamController)return;try{streamController.enqueue(encoder.encode(JSON.stringify(frame)+'\n'));}catch(error){closed=true;aborter.abort(error);cleanup();try{streamController.error(error);}catch{}}}
  const context={REQUEST_SIGNAL:aborter.signal,REQUEST_PROGRESS(stage){if(stages.has(stage)&&stage!==lastStage){lastStage=stage;write({type:'progress',stage});}}};
  function finish(){if(closed)return;closed=true;cleanup();streamController?.close();}
  async function run(){
    let onAbort;
    try{
      checkRequest(context);requestProgress(context,'accepted');
      const aborted=new Promise((_,reject)=>{onAbort=()=>reject(aborter.signal.reason);aborter.signal.addEventListener('abort',onAbort,{once:true});if(aborter.signal.aborted)onAbort();});
      const result=await Promise.race([Promise.resolve().then(()=>{checkRequest(context);return execute(context);}),aborted]);
      checkRequest(context);requestProgress(context,'formatting');return result;
    }finally{if(onAbort)aborter.signal.removeEventListener('abort',onAbort);}
  }
  if(!stream){
    try{return Response.json(await run(),{headers:{'cache-control':'no-store'}});}
    catch(error){const failure=publicFailure(error);return Response.json(failure,{status:failure.status,headers:{'cache-control':'no-store'}});}
    finally{closed=true;cleanup();}
  }
  const body=new ReadableStream({
    start(controller){
      streamController=controller;
      ping=setInterval(()=>write({type:'ping'}),pingMs);ping.unref?.();
      run().then(result=>{write({type:'result',result});finish();},error=>{write({type:'error',...publicFailure(error)});finish();});
    },
    cancel(){if(!closed){closed=true;aborter.abort(cancelled());cleanup();}}
  });
  return new Response(body,{headers:{'content-type':'application/x-ndjson; charset=utf-8','cache-control':'private, no-store','x-accel-buffering':'no'}});
}
