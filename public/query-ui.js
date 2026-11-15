(()=>{
  'use strict';
  const el=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=String(text);return n;};
  const stages={accepted:['问题已接收','正在选择查询方式。'],metro:['正在查询地铁线网','核对城市、车站与可用换乘路径。'],annual:['正在查询年度资料','核对指标、年份与原始统计口径。'],history:['正在读取历史记录','整理本次可使用的数据记录与对话上下文。'],knowledge:['正在检索交通资料','查找与问题相关的资料依据。'],model:['正在整理分析结果','模型正在处理问题与已有查询依据。'],map:['正在查询地图服务','核对地点并获取本次出行或路况结果。'],formatting:['正在整理回答','校验结果并准备展示。']};
  function pending(onCancel){
    const element=el('div','pending-query'),line=el('div','pending-line'),spinner=el('span','pending-spinner'),title=el('span','pending-title','正在连接查询服务'),elapsed=el('span','pending-elapsed','已等待 0 秒'),cancel=el('button','pending-cancel','取消查询'),note=el('p','pending-note','正在准备查询，请稍候。');
    title.setAttribute('role','status');title.setAttribute('aria-live','polite');elapsed.setAttribute('aria-hidden','true');spinner.setAttribute('aria-hidden','true');cancel.type='button';
    let disposed=false,current='',seconds=0;const start=Date.now();
    function tick(){seconds=Math.max(0,Math.floor((Date.now()-start)/1000));elapsed.textContent='已等待 '+seconds+' 秒';if(seconds>=15)note.textContent='查询仍在处理中，可取消后修改问题或稍后重试。';}
    const timer=setInterval(tick,1000);cancel.onclick=()=>{if(disposed)return;cancel.disabled=true;cancel.textContent='正在取消…';onCancel();};line.append(spinner,title,elapsed,cancel);element.append(line,note);
    return {element,progress(stage){if(disposed||!stages[stage]||stage===current)return;current=stage;title.textContent=stages[stage][0];note.textContent=stages[stage][1];tick();},dispose(){if(disposed)return;disposed=true;clearInterval(timer);element.remove();}};
  }
  function state(kind,retry){
    const element=el('div','query-state'+(kind==='timeout'?' query-timeout':''));element.setAttribute('role','status');
    element.appendChild(el('span','',kind==='timeout'?'本次等待已超时，尚未收到完整答案。':'已取消本次等待。'));
    if(retry){const button=el('button','query-retry','重新查询');button.type='button';button.onclick=retry;element.appendChild(button);}return element;
  }
  function waitFor(promise,signal){
    return new Promise((resolve,reject)=>{let settled=false;const finish=(ok,value)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);ok?resolve(value):reject(value);};const abort=()=>finish(false,signal.reason||Object.assign(new Error('已取消查询'),{name:'AbortError'}));if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(v=>finish(true,v),e=>finish(false,e));});
  }
  function evidence(result,replay=false){
    const source=result.evidence||window.TrafficEvidence?.answerEvidence(result);if(!source||typeof source.label!=='string')return null;
    const wrapper=el('div','answer-evidence'),line=el('div','evidence-line');wrapper.setAttribute('aria-label','数据类型与日期');
    line.appendChild(el('span','evidence-type',source.label.slice(0,80)));
    if(typeof source.date_label==='string'&&typeof source.date_value==='string')line.appendChild(el('span','evidence-date',source.date_label.slice(0,40)+' · '+source.date_value.slice(0,180)));
    if(replay)line.appendChild(el('span','evidence-history','历史回答'));wrapper.appendChild(line);
    if(typeof source.note==='string'&&source.note)wrapper.appendChild(el('p','evidence-note',source.note.slice(0,500)));return wrapper;
  }
  window.TrafficQueryUI={pending,state,waitFor,evidence};
})();
