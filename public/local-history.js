(()=>{
  'use strict';
  const prefix='trafficqa:local:v1:',threadPrefix=prefix+'thread:',settingsKey=prefix+'settings';
  function create(storage,makeId=()=>globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),now=()=>Date.now()){
    function entries(){const out=[];for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key?.startsWith(threadPrefix))out.push([key,storage.getItem(key)]);}return out;}
    function decode(raw){const value=JSON.parse(raw);if(value.schema!==1||typeof value.id!=='string'||!Array.isArray(value.turns))throw Error('本机记录格式异常，请先备份；不会覆盖已有记录。');return value;}
    function enabled(value){if(typeof value==='boolean')storage.setItem(settingsKey,JSON.stringify({save:value}));const raw=storage.getItem(settingsKey);return !raw||JSON.parse(raw).save!==false;}
    function safeReply(reply){
      const out={};for(const key of ['ok','answer','error','domain','engine','notice','columns','rows','chart','images','sources','sql','queried_at','metro_route','route_options','clarification','retrieved_at','needs_input','unavailable','map_error'])if(reply[key]!==undefined)out[key]=reply[key];
      if(reply.slots){out.slots={};for(const key of ['city','origin','destination','transport','action','road','strategy','origin_id','destination_id','station_id'])if(typeof reply.slots[key]==='string')out.slots[key]=reply.slots[key].slice(0,200);}
      if(JSON.stringify(out).length>120000){delete out.chart;if(out.rows)out.rows=out.rows.slice(0,50);out.notice=(out.notice?out.notice+'\n':'')+'本机历史保存摘要，部分图表或明细未保存。';}
      return JSON.parse(JSON.stringify(out));
    }
    function get(id){const raw=storage.getItem(threadPrefix+id);return raw?decode(raw):null;}
    function list(query='',trash=false){const q=query.trim().toLowerCase();return entries().map(([,raw])=>decode(raw)).filter(t=>!!t.deleted_at===trash&&(!q||t.title.toLowerCase().includes(q)||t.turns.some(x=>(x.question+' '+(x.reply.answer||x.reply.error||'')).toLowerCase().includes(q)))).sort((a,b)=>b.updated_at-a.updated_at).map(t=>({...t,turns:t.turns.length}));}
    function save(thread){const key=threadPrefix+thread.id,raw=JSON.stringify(thread),all=entries();if(all.length>=100&&!all.some(([k])=>k===key))throw Error('本机已保存100段对话，请先备份并整理记录；本轮仍可查看。');
      const size=all.filter(([k])=>k!==key).reduce((n,[k,v])=>n+k.length+v.length,0)+key.length+raw.length;
      if(size>1500000)throw Error('本机记录空间已满，请先备份并整理；本轮未保存，旧记录仍保留。');
      try{storage.setItem(key,raw);}catch{throw Error('设备未允许保存或存储空间不足，本轮未保存；旧记录仍保留。');}
    }
    function append(id,question,reply,mode='auto'){
      if(!enabled())return null;
      const stamp=now(),thread=id?get(id):null;
      if(id&&(!thread||thread.deleted_at))throw Error('这段本机对话已被移除，请开启新对话。');
      const next=thread||{schema:1,id:makeId(),title:question.replace(/\s+/g,' ').slice(0,60),created_at:stamp,updated_at:stamp,mode,turns:[]};
      if(next.turns.length>=200)throw Error('本段对话已保存200轮，请开启新对话；已有记录仍保留。');
      next.turns.push({id:makeId(),question,reply:safeReply(reply),created_at:stamp});next.updated_at=stamp;next.mode=mode;save(next);return next;
    }
    function move(id,deleted){const thread=get(id);if(!thread)throw Error('本机对话不存在。');thread.deleted_at=deleted?now():null;save(thread);}
    return {enabled,get,list,append,trash:id=>move(id,true),restore:id=>move(id,false),
      backup(){return JSON.stringify({schema:1,kind:'trafficqa-local-backup',exported_at:new Date(now()).toISOString(),records:entries().map(([key,value])=>({key,value}))},null,2);},
      clear(){for(const [key]of entries())storage.removeItem(key);},
      count(){return entries().length;}
    };
  }
  const unavailable=()=>{throw Error('当前设备未允许本机存储，问答仍可使用；可尝试在系统浏览器打开。');};
  let storage;try{storage=localStorage;}catch{storage={get length(){return unavailable();},getItem:unavailable,setItem:unavailable,removeItem:unavailable};}
  window.TrafficLocalHistory={create,store:create(storage)};
})();
