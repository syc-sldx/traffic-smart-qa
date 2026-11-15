const compact=value=>String(value||'').replace(/\s/g,'');
export function isTravelFollowup(question){
  const q=compact(question);
  return /^(?:(?:那|再|请|帮我|还是|换成|改成|改为|改用|用|坐|乘|乘坐))*?(?:步行|走路|驾车|开车|自驾|公交|地铁|公交地铁)(?:呢|吧|路线)?[？?。]?$/.test(q)
    ||/^(?:那|再|请|尽量|帮我)?(?:少换乘|换乘少|少步行|步行少|少走路|最快|快一点|最省钱|便宜一点|重新查询|再试一次|重试)(?:一点|一些|点|的|吧|呢)?[？?。]?$/.test(q)
    ||/^(?:那)?(?:改去|换到|到|去).{1,60}(?:呢|吧)?[？?。]?$/.test(q)
    ||/^(?:把)?(?:起点|终点)(?:改为|改成|换成|设为|[：:]).{1,60}$/.test(q)
    ||/^(?:那)?从.{1,60}(?:出发|上车)[？?。]?$/.test(q);
}
export function explicitTravel(question,cities=[]){
  const q=compact(question),slots={};
  const c=q.match(/(?:城市[：:]|^)([\u4e00-\u9fff]{2,8}?)(?:市)?(?:[，,:：]|从)/);
  if(c)slots.city=c[1];else{const found=cities.filter(city=>q.includes(city));const prefix=q.replace(/^(?:(?:请问|查一下|现在|实时|当前|今天|帮我查|查询|在))+/,'');const leading=found.filter(city=>prefix.startsWith(city));if(leading.length)slots.city=leading.sort((a,b)=>b.length-a.length)[0];else if(found.length===1)slots.city=found[0];}
  let pair=q.match(/从(.+?)(?:到|去)(.+?)(?=怎么|如何|驾车|开车|步行|走路|坐|乘|[，。？?]|$)/);
  if(!pair&&!isTravelFollowup(q))pair=q.match(/^(.+?)(?:怎么去|如何去|怎么到|如何到|到|去)(.+?)(?=怎么|如何|坐|乘|[，。？?]|$)/);
  if(pair)Object.assign(slots,{origin:pair[1],destination:pair[2],action:'route'});
  const destination=q.match(/^(?:那)?(?:改去|换到|到|去)(.+?)(?:呢|吧)?[？?。]?$/)||q.match(/^(?:把)?终点(?:改为|改成|换成|设为|[：:])(.+?)[？?。]?$/);
  if(destination)Object.assign(slots,{destination:destination[1],action:'route'});
  const origin=q.match(/^(?:把)?起点(?:改为|改成|换成|设为|[：:])(.+?)[？?。]?$/)||q.match(/^(?:那)?从(.+?)(?:出发|上车)[？?。]?$/);
  if(origin)Object.assign(slots,{origin:origin[1],action:'route'});
  if(/少换乘|换乘少/.test(q))slots.strategy='2';else if(/少步行|步行少|少走路/.test(q))slots.strategy='3';else if(/最快|快一点/.test(q))slots.strategy='0';else if(/最省钱|便宜一点/.test(q))slots.strategy='1';
  if(/步行|走路/.test(q)&&slots.strategy!=='3')slots.transport='walking';else if(/地铁|公交/.test(q))slots.transport='transit';else if(/驾车|开车|自驾/.test(q))slots.transport='driving';
  const road=q.match(/(?:道路|路名)[：:](.+?)(?=[，。？?]|$)/);
  if(road)Object.assign(slots,{road:road[1],action:'traffic'});
  else if(/实时|现在|当前|今天/.test(q)&&/路况|堵不堵|拥堵/.test(q)){slots.action='traffic';if(slots.city){const rest=q.split(slots.city)[1]?.replace(/^市/,'')||'',street=rest.match(/^(.+?(?:大道|高速|公路|路|街|桥))(?:现在|实时|当前|今天|的|交通|路况|拥堵|堵不堵|怎么样|如何|[？?]|$)/);if(street)slots.road=street[1];}}
  return slots;
}
export function parseTravelContext(question,history=[],cities=[]){
  let previous={};
  for(const entry of history.slice(-24)){if(entry.role!=='user')continue;const next=explicitTravel(entry.content,cities);if(isTravelFollowup(entry.content)||previous.action&&next.city&&compact(entry.content).replace(/市$/,'')===next.city)previous={...previous,...next};else previous=next;}
  const explicit=explicitTravel(question,cities),last=[...history].reverse().find(h=>h.role==='assistant')?.content||'';
  const inherit=isTravelFollowup(question)||last.includes('请补充')&&last.includes('出行服务');
  const result=inherit?{...previous,...explicit}:explicit;
  if(inherit&&last.includes('请补充')&&compact(question).length<=60&&!isTravelFollowup(question)&&!explicit.action){
    const missing=['city','origin','destination'].filter(key=>!result[key]);
    if(missing.length===1)result[missing[0]]=compact(question).replace(/[？?。]$/,'');
  }
  return result;
}
export function resolveTravel(question,history=[],details={},cities=[]){
  const parsed=parseTravelContext(question,history,cities),keys=['city','origin','destination','transport','action','road','strategy','origin_id','destination_id','station_id'];
  const fallback={};for(const key of keys)if(typeof details[key]==='string'&&details[key].trim())fallback[key]=details[key].trim();
  if(details.contextual==='true'){
    const slots={...(isTravelFollowup(question)?fallback:{}),...parsed};
    if(details.located==='true'&&!slots.city)slots.city=fallback.city;
    const cityName=value=>compact(value).replace(/市$/,''),stationName=value=>{let name=compact(value).normalize('NFKC').replace(/\([^)]*\)|（[^）]*）/g,'');const city=cityName(fallback.city);if(city&&name.startsWith(city))name=name.slice(city.length).replace(/^市/,'');return name.replace(/(?:地铁站|站)$/,'');};
    if(cityName(slots.city)!==cityName(fallback.city)){delete slots.origin_id;delete slots.destination_id;delete slots.station_id;}
    for(const endpoint of ['origin','destination'])if(stationName(slots[endpoint])!==stationName(fallback[endpoint]))delete slots[endpoint+'_id'];
    const explicit=explicitTravel(question,cities);
    for(const endpoint of ['origin','destination'])if(explicit[endpoint]&&compact(explicit[endpoint])!==compact(fallback[endpoint]))delete slots[endpoint+'_id'];
    if(explicit.origin||explicit.destination||explicit.action==='route')delete slots.station_id;
    return slots;
  }
  return {...parsed,...fallback};
}
