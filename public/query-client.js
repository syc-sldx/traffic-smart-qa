(()=>{
  'use strict';
  const stages=new Set(['accepted','metro','annual','history','knowledge','model','map','formatting']);
  const frameLimit=2*1024*1024,responseLimit=4*1024*1024;
  const failure=(message,code,status)=>Object.assign(new Error(message),{code,...(status?{status}:{})});
  const protocol=()=>failure('查询服务返回的数据不完整或格式异常，请重新查询。','PROTOCOL_ERROR');
  const tooLarge=()=>failure('查询结果过大，请缩小城市、日期或问题范围后重试。','RESPONSE_TOO_LARGE');
  function abortFailure(timeout){const error=failure(timeout?'查询等待超时，请缩小问题范围或稍后重试。':'已取消本次等待。',timeout?'REQUEST_TIMEOUT':'REQUEST_ABORTED');error.name=timeout?'TimeoutError':'AbortError';return error;}
  function httpFailure(status,message,retryAfter){
    const error=failure(typeof message==='string'&&message.trim()?message.trim().slice(0,600):status===401?'登录已过期，请重新登录后继续。':status===429?'查询过于频繁，请稍后重试。':'查询服务暂不可用（HTTP '+status+'），请稍后重试。','HTTP_ERROR',status);
    if(retryAfter!==null&&retryAfter!==undefined){const raw=String(retryAfter).trim(),seconds=/^\d+$/.test(raw)?Number(raw):Math.ceil((Date.parse(raw)-Date.now())/1000);if(Number.isFinite(seconds)&&seconds>=0)error.retryAfter=Math.min(seconds,86400);}
    return error;
  }
  function create(request=(...args)=>fetch(...args)){
    async function run(body,{onProgress,signal,timeoutMs=125000}={}){
      if(signal?.aborted)throw abortFailure(false);
      if(typeof timeoutMs!=='number'||!Number.isFinite(timeoutMs)||timeoutMs<0)throw failure('查询等待时间设置不正确。','INVALID_TIMEOUT');
      if(timeoutMs===0)throw abortFailure(true);
      const controller=new AbortController();let reader=null,stopped=null,timer=null,complete=false,rejectAbort;
      const interrupted=new Promise((_,reject)=>{rejectAbort=reject;});
      const active=()=>{if(stopped)throw stopped;};
      const cancelReader=()=>{if(reader)try{const cancelled=reader.cancel(stopped||undefined);cancelled?.catch?.(()=>{});}catch{}};
      function stop(timeout){if(stopped||complete)return;stopped=abortFailure(timeout);controller.abort(stopped);cancelReader();rejectAbort(stopped);}
      const externalAbort=()=>stop(false);
      signal?.addEventListener('abort',externalAbort,{once:true});
      if(signal?.aborted)stop(false);
      timer=setTimeout(()=>stop(true),timeoutMs);
      async function work(){
        active();let payload;
        try{payload=JSON.stringify(body);}catch{throw failure('问题参数无法发送，请重新输入。','INVALID_REQUEST');}
        const response=await request('/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:payload,signal:controller.signal});
        if(stopped){try{response.body?.cancel()?.catch?.(()=>{});}catch{}active();}
        const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase(),streaming=mime==='application/x-ndjson'||mime==='application/ndjson',json=mime==='application/json'||mime.endsWith('+json');
        // Never put an HTML proxy error page into the answer area.
        if(!response.ok&&!json){try{response.body?.cancel()?.catch?.(()=>{});}catch{}throw httpFailure(response.status,null,response.headers.get('retry-after'));}
        if(response.ok&&!streaming&&!json){try{response.body?.cancel()?.catch?.(()=>{});}catch{}throw protocol();}
        if(!response.body?.getReader)throw response.ok?protocol():httpFailure(response.status,null,response.headers.get('retry-after'));
        reader=response.body.getReader();const decoder=new TextDecoder('utf-8',{fatal:true});let buffer='',total=0,frameBytes=0;
        function decode(value,finish=false){try{return finish?decoder.decode():decoder.decode(value,{stream:true});}catch{throw protocol();}}
        function parse(value){try{return JSON.parse(value);}catch{throw protocol();}}
        function processLine(line){
          active();if(!line.trim())return null;const frame=parse(line);
          if(!frame||typeof frame!=='object'||Array.isArray(frame))throw protocol();
          if(frame.type==='progress'&&stages.has(frame.stage)){try{onProgress?.(frame.stage);}catch{}active();}
          else if(frame.type==='error'){const status=Number.isInteger(frame.status)&&frame.status>=400&&frame.status<=599?frame.status:502;throw httpFailure(status,frame.error,frame.retry_after);}
          else if(frame.type==='result'){if(!frame.result||typeof frame.result!=='object'||Array.isArray(frame.result))throw protocol();return frame.result;}
          return null;
        }
        try{
          while(true){
            active();const chunk=await reader.read();active();
            if(chunk.done){buffer+=decode(null,true);break;}
            const value=chunk.value;if(!ArrayBuffer.isView(value)||value.BYTES_PER_ELEMENT!==1)throw protocol();total+=value.byteLength;if(total>responseLimit)throw tooLarge();
            if(streaming){let offset=0;while(offset<value.length){const newline=value.indexOf(10,offset),end=newline<0?value.length:newline;frameBytes+=end-offset;if(frameBytes>frameLimit)throw tooLarge();if(newline<0)break;frameBytes=0;offset=newline+1;}}
            buffer+=decode(value);
            if(streaming){let newline;while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);const result=processLine(line);if(result){active();return result;}}}
          }
          active();
          if(streaming){if(buffer.trim()){const result=processLine(buffer);if(result){active();return result;}}throw protocol();}
          const result=parse(buffer);
          if(!response.ok)throw httpFailure(response.status,result?.error,response.headers.get('retry-after'));
          if(!result||typeof result!=='object'||Array.isArray(result))throw protocol();return result;
        }catch(error){
          if(!response.ok&&!stopped&&error?.code!=='HTTP_ERROR')throw httpFailure(response.status,null,response.headers.get('retry-after'));
          throw error;
        }finally{
          cancelReader();try{reader.releaseLock();}catch{}reader=null;
        }
      }
      try{return await Promise.race([work(),interrupted]);}
      catch(error){if(stopped)throw stopped;if(['PROTOCOL_ERROR','RESPONSE_TOO_LARGE','INVALID_REQUEST','HTTP_ERROR'].includes(error?.code))throw error;throw failure('连接中断，请检查网络后重新查询。','NETWORK_ERROR');}
      finally{complete=true;if(timer!==null)clearTimeout(timer);signal?.removeEventListener('abort',externalAbort);cancelReader();}
    }
    return {run};
  }
  const client=create();window.TrafficQuery={run:client.run,create};
})();
