(()=>{
  'use strict';
  const get=id=>document.getElementById(id),names={transit:'公交地铁',driving:'驾车',walking:'步行'};
  const node=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=String(text);return el;};
  const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
  const distance=value=>value<1?Math.round(value*1000)+'米':Number(value.toFixed(2))+'公里';
  function conditions(result){
    const m=result.metro_route;
    if(m)return {city:m.city,origin:m.origin,destination:m.destination,transport:'transit',action:'metro',...(m.origin_id?{origin_id:m.origin_id}:{}),...(m.destination_id?{destination_id:m.destination_id}:{})};
    if(!result.slots||result.slots.action==='traffic')return null;
    const route={};for(const key of ['city','origin','destination','transport','strategy','origin_id','destination_id'])if(typeof result.slots[key]==='string')route[key]=result.slots[key];route.action='route';
    return route.city&&route.origin&&route.destination&&names[route.transport]?route:null;
  }
  function canRender(result){const m=result.metro_route;return !!(result.ok&&!result.needs_input&&!result.unavailable&&(Array.isArray(m?.segments)&&typeof m.origin==='string'&&typeof m.destination==='string'&&m.segments.every(s=>s&&typeof s.line==='string')||Array.isArray(result.route_options)&&result.route_options.some(o=>o&&typeof o==='object')));}
  function summary(result){if(result.metro_route)return result.metro_route.city+'：'+result.metro_route.origin+' → '+result.metro_route.destination+'。';const r=conditions(result);return r?r.city+'：'+r.origin+' → '+r.destination+'，'+names[r.transport]+'。以下为本次查询方案。':result.answer;}
  function fact(parent,value,label){if(finite(value))parent.appendChild(node('span','journey-fact',label?value+label:value));}
  function metroStep(segment,index){
    const item=node('li','journey-step'),marker=node('span','journey-marker',index+1),content=node('div','journey-step-body'),line=node('span','journey-line',segment.line);
    if(/^#[\da-f]{6}$/i.test(segment.color||''))line.style.setProperty('--line-color',segment.color);
    const title=node('div','journey-step-title');title.append(line,node('span','journey-direction',segment.direction||''));
    content.append(title,node('p','journey-stops',segment.origin+' 上车 → '+segment.destination+' 下车'));
    if(finite(segment.stops))content.appendChild(node('p','journey-step-note','乘坐 '+segment.stops+' 站'+(index?' · 在 '+segment.origin+' 换乘':'')));
    if(Array.isArray(segment.stations)&&segment.stations.length){const details=node('details','journey-stations');details.append(node('summary','', '查看途经站点'),node('p','',segment.stations.join(' → ')));content.appendChild(details);}
    item.append(marker,content);return item;
  }
  function mapStep(step,index){
    const item=node('li','journey-step'),content=node('div','journey-step-body'),kind={walk:'步行',ride:'乘车',rail:'铁路',drive:'驾车'}[step.kind]||'出行';
    const title=node('div','journey-step-title');title.appendChild(node('span','journey-line',step.line||kind));if(step.direction)title.appendChild(node('span','journey-direction',step.direction));content.appendChild(title);
    if(step.origin||step.destination)content.appendChild(node('p','journey-stops',[step.origin,step.destination].filter(Boolean).join(' → ')));
    if(step.instruction)content.appendChild(node('p','journey-instruction',step.instruction));
    const facts=[];if(finite(step.stops))facts.push('乘坐 '+step.stops+' 站');else if(finite(step.via_stops))facts.push('途经 '+step.via_stops+' 站');if(finite(step.distance_meters))facts.push(Math.round(step.distance_meters)+'米');if(facts.length)content.appendChild(node('p','journey-step-note',facts.join(' · ')));
    if(Array.isArray(step.alternative_lines)&&step.alternative_lines.length)content.appendChild(node('p','journey-step-note','同段也可乘坐：'+step.alternative_lines.join(' / ')));
    item.append(node('span','journey-marker',index+1),content);return item;
  }
  function favoriteControl(result){
    const route=conditions(result);if(!route)return null;
    const wrap=node('div','journey-save'),button=node('button','favorite-save','收藏这条路线'),status=node('span','journey-save-status');button.type='button';status.setAttribute('role','status');
    function update(){try{const saved=window.TrafficFavorites.store.find(route);button.textContent=saved?'已收藏 · 查看':'收藏这条路线';button.setAttribute('aria-pressed',String(!!saved));}catch{button.textContent='收藏这条路线';}}
    button.onclick=()=>{try{if(window.TrafficFavorites.store.find(route)){openFavorites();return;}window.TrafficFavorites.store.add(route);status.textContent='已保存到本机，打开时重新查询。';changed();}catch(error){status.textContent=error.message;}};
    wrap.append(button,status);update();wrap.addEventListener('traffic-update',update);return wrap;
  }
  function render(result){
    const wrapper=node('div','journey-cards');
    if(result.metro_route){const route=result.metro_route,card=node('section','journey-card');card.setAttribute('aria-label','地铁路线步骤');const head=node('div','journey-head');head.appendChild(node('span','journey-kind','地铁站间参考'));const facts=node('div','journey-facts');fact(facts,route.stops,'站');facts.appendChild(node('span','journey-fact',route.transfers?'换乘 '+route.transfers+' 次':'无需换乘'));head.appendChild(facts);card.appendChild(head);
      const steps=node('ol','journey-steps');route.segments.forEach((s,i)=>steps.appendChild(metroStep(s,i)));if(!route.segments.length)card.appendChild(node('p','journey-empty','起终点为同一车站，无需乘车。'));else card.appendChild(steps);wrapper.appendChild(card);
    }else for(const [index,option]of result.route_options.filter(o=>o&&typeof o==='object').slice(0,3).entries()){
      const card=node('section','journey-card');card.setAttribute('aria-label','路线方案 '+(index+1));const head=node('div','journey-head'),facts=node('div','journey-facts');head.appendChild(node('span','journey-kind','方案 '+(index+1)));
      if(finite(option.duration_minutes))facts.appendChild(node('span','journey-fact','预计 '+Number(option.duration_minutes.toFixed(1))+' 分钟'));
      if(finite(option.distance_km))facts.appendChild(node('span','journey-fact',distance(option.distance_km)));
      if(finite(option.fare_yuan))facts.appendChild(node('span','journey-fact','票价 '+option.fare_yuan+' 元'));
      if(finite(option.walking_meters))facts.appendChild(node('span','journey-fact','步行 '+Math.round(option.walking_meters)+' 米'));
      head.appendChild(facts);card.appendChild(head);const all=Array.isArray(option.steps)?option.steps.slice(0,60):[],steps=node('ol','journey-steps');all.slice(0,6).forEach((s,i)=>steps.appendChild(mapStep(s,i)));if(all.length)card.appendChild(steps);else card.appendChild(node('p','journey-empty','接口未提供分段说明，请结合查询明细查看。'));
      if(all.length>6){const more=node('details','journey-more'),rest=node('ol','journey-steps');rest.start=7;all.slice(6).forEach((s,i)=>rest.appendChild(mapStep(s,i+6)));more.append(node('summary','','展开其余 '+(all.length-6)+' 步'),rest);card.appendChild(more);}
      if(option.steps_truncated)card.appendChild(node('p','journey-step-note','分段较多，仅展示前60步。'));wrapper.appendChild(card);
    }
    const save=favoriteControl(result);if(save)wrapper.appendChild(save);return wrapper;
  }
  function bindChoices(container,result,question){
    const c=result.clarification;if(!Array.isArray(c?.options)||!c.options.length)return;
    const section=node('section','station-choices');section.setAttribute('aria-label','请选择'+({city:'城市',origin:'起点站',destination:'终点站',station:'车站'}[c.field]||'站点'));section.appendChild(node('p','station-choice-title','请选择，确认后继续查询'));
    const choices=node('div','station-choice-list');for(const option of c.options.slice(0,48)){const button=node('button','station-choice');button.type='button';button.append(node('strong','',option.label),node('span','',option.description||''));button.onclick=()=>{if(window.TrafficChat.chooseStation(c.question||question,option.travel))section.setAttribute('data-selected','true');};choices.appendChild(button);}section.appendChild(choices);container.querySelector('.bubble').after(section);
  }
  let removed=false;
  function changed(){refreshCount();document.querySelectorAll('.journey-save').forEach(el=>el.dispatchEvent(new Event('traffic-update')));if(get('favorites-dialog').open)refreshFavorites();}
  function refreshCount(){try{get('favorites-count').textContent=window.TrafficFavorites.store.list().length||'';}catch{get('favorites-count').textContent='';}}
  function refreshFavorites(){
    const list=get('favorites-list'),q=get('favorites-search').value.trim().toLowerCase();list.replaceChildren();get('favorites-status').textContent='收藏仅保存在当前设备；打开时会重新查询，不沿用旧路线结果。';
    try{const records=window.TrafficFavorites.store.list(removed).filter(r=>[r.route.city,r.route.origin,r.route.destination].join(' ').toLowerCase().includes(q));
      if(!records.length)list.appendChild(node('p','favorites-empty',removed?'还没有移除的路线。':'暂无收藏。在路线回答下点击“收藏这条路线”即可添加。'));
      for(const record of records){const r=record.route,row=node('div','favorite-row'),info=node('div','favorite-info');info.append(node('strong','',r.origin+' → '+r.destination),node('span','',r.city+' · '+(r.action==='metro'?'地铁站间换乘':names[r.transport]||'路线')));row.appendChild(info);
        if(removed){const restore=node('button','favorite-query','恢复');restore.type='button';restore.onclick=()=>{try{window.TrafficFavorites.store.restore(record.id);changed();}catch(e){get('favorites-status').textContent=e.message;}};row.appendChild(restore);}else{
          const query=node('button','favorite-query','重新查询');query.type='button';query.onclick=()=>{if(window.TrafficChat.queryRoute(r))get('favorites-dialog').close();else get('favorites-status').textContent='正在处理上一个问题，请稍候再打开路线。';};
          const remove=node('button','favorite-remove','移除');remove.type='button';remove.setAttribute('aria-label','移除收藏：'+r.origin+'到'+r.destination);remove.onclick=()=>{try{window.TrafficFavorites.store.remove(record.id);changed();}catch(e){get('favorites-status').textContent=e.message;}};row.append(query,remove);
        }list.appendChild(row);
      }
    }catch(e){get('favorites-status').textContent=e.message;}
  }
  function openFavorites(){removed=false;get('favorites-removed').textContent='已移除';get('favorites-removed').setAttribute('aria-pressed','false');get('favorites-search').value='';refreshFavorites();get('favorites-dialog').showModal();}
  get('favorites-open').onclick=openFavorites;get('favorites-close').onclick=()=>get('favorites-dialog').close();get('favorites-search').oninput=refreshFavorites;
  get('favorites-removed').onclick=()=>{removed=!removed;get('favorites-removed').textContent=removed?'返回收藏':'已移除';get('favorites-removed').setAttribute('aria-pressed',String(removed));refreshFavorites();};
  window.addEventListener('storage',event=>{if(event.key?.startsWith('trafficqa:favorites:v1:'))changed();});refreshCount();
  window.addEventListener('traffic-device-restore',changed);
  window.TrafficRoutes={canRender,summary,render,bindChoices,conditions};
})();
