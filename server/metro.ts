import dataset from "./metro-data.json";

type RawStation={id:string,name:string,aliases:string[],active:boolean,location:number[]|null};
type Line={id:string,service_id:string,name:string,color:string,loop:boolean,stations:RawStation[]};
type Network={city:string,map_url:string,data_url:string,retrieved_at:string,lines:Line[]};
type Station={id:string,name:string,aliases:Set<string>,lines:Set<string>};
type Index={network:Network,stations:Map<string,Station>,aliases:Map<string,Set<string>>,lines:Map<string,Line>,edges:Map<string,string[]>};
const networks=dataset.networks as Network[];
const cache=new Map<string,Index>();
const key=(value:string)=>value.normalize("NFKC").toLowerCase().replace(/[\s·•・⋅]/g,"");
const cleanCity=(value:string)=>value.trim().replace(/特别行政区$/," ").trim().replace(/市$/,"");
const stripNotes=(value:string)=>value.replace(/\([^)]*\)|（[^）]*）/g,"").trim();
function forms(value:string,city=""){
  const initial=value.trim().replace(/^(?:请问|请|帮我查一下|帮我查|查询|查一下|从|在)+/,"").replace(/[，,。？?]+$/,"");
  const names=new Set([initial]);
  if(city&&initial.startsWith(city))names.add(initial.slice(city.length).replace(/^(?:市)?(?:从|的)?/,""));
  for(const name of [...names]){names.add(stripNotes(name));names.add(name.replace(/^(?:地铁|轨道交通)/,""));}
  for(const name of [...names]){names.add(name.replace(/(?:地铁站|地铁车站)$/, ""));if(name.endsWith("站"))names.add(name.slice(0,-1));}
  return [...new Set([...names].map(key).filter(Boolean))];
}
function indexFor(city:string):Index|undefined{
  city=cleanCity(city);if(cache.has(city))return cache.get(city);
  const network=networks.find(n=>n.city===city);if(!network)return;
  const result:Index={network,stations:new Map(),aliases:new Map(),lines:new Map(),edges:new Map()};
  for(const line of network.lines){
    result.lines.set(line.id,line);
    for(const raw of line.stations){if(!raw.active)continue;let station=result.stations.get(raw.id);
      if(!station){station={id:raw.id,name:raw.name,aliases:new Set(),lines:new Set()};result.stations.set(raw.id,station);}
      station.lines.add(line.id);
      for(const name of [raw.name,...raw.aliases])for(const alias of forms(name))station.aliases.add(alias);
    }
    const connect=(a:RawStation,b:RawStation)=>{if(!a.active||!b.active||a.id===b.id)return;const ak=a.id+"|"+line.id,bk=b.id+"|"+line.id;result.edges.set(ak,[...new Set([...(result.edges.get(ak)||[]),b.id])]);result.edges.set(bk,[...new Set([...(result.edges.get(bk)||[]),a.id])]);};
    for(let i=1;i<line.stations.length;i++)connect(line.stations[i-1],line.stations[i]);
    if(line.loop&&line.stations.length>2)connect(line.stations.at(-1)!,line.stations[0]);
  }
  for(const station of result.stations.values())for(const alias of station.aliases){if(!result.aliases.has(alias))result.aliases.set(alias,new Set());result.aliases.get(alias)!.add(station.id);}
  cache.set(city,result);return result;
}
export function metroCatalogue(){return {retrieved_at:dataset.retrieved_at,summary:dataset.summary,limitations:dataset.limitations,cities:dataset.coverage.map(c=>{
  const n=networks.find(n=>n.city===c.city);return {...c,...(n?{map_url:n.map_url,line_count:new Set(n.lines.map(l=>l.name)).size,line_variants:n.lines.length}:{} )};
})};}
export function metroNetwork(city:string){const index=indexFor(city);if(!index)return null;return {city:index.network.city,retrieved_at:index.network.retrieved_at,map_url:index.network.map_url,station_count:index.stations.size,lines:index.network.lines.map(l=>({id:l.id,name:l.name,color:l.color,loop:l.loop,stations:l.stations.filter(s=>s.active).map(s=>({id:s.id,name:s.name,lines:[...index.stations.get(s.id)!.lines].map(id=>index.lines.get(id)!.name)}))}))};}
export function metroStations(city:string,query=""){const index=indexFor(city);if(!index)return [];const q=key(query);return [...index.stations.values()].filter(s=>!q||[...s.aliases].some(a=>a.includes(q))).map(s=>({id:s.id,name:s.name,lines:[...new Set([...s.lines].map(id=>index.lines.get(id)!.name))]}));}
export function findMetroStations(city:string,input:string){const index=indexFor(city);if(!index)return [];for(const name of forms(input,city)){const ids=index.aliases.get(name);if(ids?.size)return [...ids].map(id=>index.stations.get(id)!);}return [];}

class Heap{
  items:{state:string,cost:number}[]=[];
  push(item:{state:string,cost:number}){let i=this.items.length;this.items.push(item);while(i){const p=(i-1)>>1;if(this.items[p].cost<=item.cost)break;this.items[i]=this.items[p];i=p;}this.items[i]=item;}
  pop(){if(!this.items.length)return undefined;const result=this.items[0],last=this.items.pop()!;if(this.items.length){let i=0;while(2*i+1<this.items.length){let j=2*i+1;if(j+1<this.items.length&&this.items[j+1].cost<this.items[j].cost)j++;if(this.items[j].cost>=last.cost)break;this.items[i]=this.items[j];i=j;}this.items[i]=last;}return result;}
}
export function planMetro(city:string,originId:string,destinationId:string){
  const index=indexFor(city);if(!index?.stations.has(originId)||!index.stations.has(destinationId))return null;
  if(originId===destinationId)return {city,origin:index.stations.get(originId)!.name,destination:index.stations.get(destinationId)!.name,stops:0,transfers:0,segments:[]};
  const queue=new Heap(),dist=new Map<string,number>(),previous=new Map<string,string>();
  for(const line of index.stations.get(originId)!.lines){const state=originId+"|"+line;dist.set(state,0);queue.push({state,cost:0});}
  let goal="";
  while(queue.items.length){const current=queue.pop()!;if(dist.get(current.state)!==current.cost)continue;const split=current.state.indexOf("|"),stationId=current.state.slice(0,split),lineId=current.state.slice(split+1);
    if(stationId===destinationId){goal=current.state;break;}
    const moves=[...(index.edges.get(current.state)||[]).map(id=>({state:id+"|"+lineId,cost:1})),...[...index.stations.get(stationId)!.lines].filter(id=>id!==lineId).map(id=>({state:stationId+"|"+id,cost:10000}))];
    for(const move of moves){const cost=current.cost+move.cost;if(cost<(dist.get(move.state)??Infinity)){dist.set(move.state,cost);previous.set(move.state,current.state);queue.push({state:move.state,cost});}}
  }
  if(!goal)return null;
  const states:string[]=[];for(let s=goal;s;s=previous.get(s)||"")states.push(s);states.reverse();
  const legs:{lineId:string,ids:string[]}[]=[];
  for(const state of states){const split=state.indexOf("|"),id=state.slice(0,split),lineId=state.slice(split+1);if(!legs.length||legs.at(-1)!.lineId!==lineId)legs.push({lineId,ids:[id]});else if(legs.at(-1)!.ids.at(-1)!==id)legs.at(-1)!.ids.push(id);}
  const segments=legs.filter(leg=>leg.ids.length>1).map(leg=>{const line=index.lines.get(leg.lineId)!,active=line.stations.filter(s=>s.active),a=active.findIndex(s=>s.id===leg.ids[0]),b=active.findIndex(s=>s.id===leg.ids[1]);
    const direction=line.loop?"经"+index.stations.get(leg.ids[1])!.name+"方向（环线）":"往"+(b>a?active.at(-1)!.name:active[0].name)+"方向";
    return {line:line.name,line_id:line.id,color:line.color,direction,origin:index.stations.get(leg.ids[0])!.name,destination:index.stations.get(leg.ids.at(-1)!)!.name,stops:leg.ids.length-1,stations:leg.ids.map(id=>index.stations.get(id)!.name)};
  });
  return {city,origin:index.stations.get(originId)!.name,destination:index.stations.get(destinationId)!.name,stops:segments.reduce((sum,s)=>sum+s.stops,0),transfers:Math.max(0,segments.length-1),segments};
}

export function isMetroQuery(q:string){return /地铁图|地铁线路图|线网图|地铁站|地铁.*(?:站点|车站)|(?:\d+号线|[Ss]\d+号?线).*(?:站|图)|站.*(?:怎么|如何|到|去|哪.*线|几条线|所属|换乘)|(?:地铁|轨道交通).*(?:换乘|怎么走)/.test(q)&&!/(?:客流|客运量|走行里程|公路里程|什么是|是什么意思|是什么|定义|概念|原理|含义|政策|法规|规范|标准)/.test(q);}
function pieces(question:string){const q=question.replace(/\s/g,"").replace(/[？?。]+$/,"");const m=q.match(/^(?:请问|请|帮我查一下|帮我查|查询|查一下)?(.+?)(?:怎么去|如何去|怎么到|如何到|到|去|→|->)(.+)$/);if(!m)return null;return {origin:m[1].replace(/^从/,""),destination:m[2].replace(/(?:怎么|如何|应该|乘坐|坐地铁|地铁怎么|换乘|[，,]).*$/,"").trim()};}
function explicitCity(q:string){const leading=dataset.scope_cities.find(c=>q.startsWith(c)&&/^(?:市)?(?:从|地铁|轨道|的地铁)/.test(q.slice(c.length)));return leading||"";}
function response(city:string){const n=networks.find(n=>n.city===city);return {ok:true,domain:"travel",engine:"metro",steps:1,trace:[{tool:"metro_network",ok:true,note:"根据已导入的运营站点线网计算"}],sources:n?[{title:city+"高德地铁图（公开来源）",url:n.map_url},{title:"站点数据来源",url:n.data_url}]:[{title:"高德地铁图城市目录",url:dataset.source.viewer_url}],retrieved_at:dataset.retrieved_at};}
function clarify(city:string,label:string,choices:Station[]){const index=indexFor(city)!;return {...response(city),needs_input:true,answer:label+"对应多个不同站点，请补充线路或使用完整站名。",columns:["站点","所属线路"],rows:choices.map(s=>[s.name,[...s.lines].map(id=>index.lines.get(id)!.name).join("、")])};}
export function metroAnswer(question:string,history:any[]=[],details:Record<string,string>={}):any|null{
  if(/驾车|开车|自驾|步行|走路/.test(question)||details.action!=="metro"&&["driving","walking"].includes(details.transport))return null;
  if(details.action==="traffic"||/(?:客流|客运量|运营里程|走行里程|公路里程|平均车速|天气)/.test(question))return null;
  const requested=details.action==="metro"||isMetroQuery(question),pair=details.origin&&details.destination?{origin:details.origin,destination:details.destination}:pieces(question);
  let city=cleanCity(details.city||explicitCity(question));
  if(!city&&pair){const possible=networks.filter(n=>findMetroStations(n.city,pair.origin).length&&findMetroStations(n.city,pair.destination).length);if(possible.length===1)city=possible[0].city;else if(possible.length>1)return {...response(""),needs_input:true,answer:"这些站名在多个城市存在，请补充城市："+possible.map(n=>n.city).join("、")+"。"};}
  if(!city&&!pair){const mentioned=dataset.scope_cities.filter(c=>question.includes(c));if(mentioned.length===1)city=mentioned[0];}
  if(!city&&requested){const previous=[...history].reverse().find(h=>h.role==="user");if(previous){city=cleanCity(details.city||explicitCity(previous.content));if(!city){const names=dataset.scope_cities.filter(c=>previous.content.includes(c));if(names.length===1)city=names[0];}}}
  if(!city)return requested&&(!pair||details.action==="metro"||/地铁|轨道|线网|号线/.test(question))?{...response(""),needs_input:true,answer:"请补充城市，例如“南京南站怎么去南京新街口站”，或在出行表单选择城市和两座地铁站。"}:null;
  const index=indexFor(city);
  if(!index)return requested||details.action==="metro"?{...response(city),unavailable:true,answer:city+"当前未收录独立线网，不能据此判断当地有没有轨道交通。可改用公交地铁实时路线规划，填写完整起终点查询。"}:null;
  if(pair){
    const starts=findMetroStations(city,pair.origin),ends=findMetroStations(city,pair.destination);
    if(starts.length>1)return clarify(city,"起点",starts);if(ends.length>1)return clarify(city,"终点",ends);
    if(!starts.length||!ends.length)return details.action==="metro"||/地铁|轨道|号线/.test(question)?{...response(city),needs_input:true,answer:"在"+city+"已导入线网中未能准确匹配"+(!starts.length?"起点“"+pair.origin+"”":"终点“"+pair.destination+"”")+"。请从站点提示中选择完整站名；普通地址可切换公交/驾车路线。"}:null;
    const route=planMetro(city,starts[0].id,ends[0].id);
    if(!route)return {...response(city),unavailable:true,answer:"已找到两站，但当前运营站点快照没有可核实的连通路径，不能编造换乘方案。请查看线网图或使用实时路线规划。"};
    const intro=route.stops===0?"起终点为同一站，无需乘坐地铁。":city+"："+route.origin+" → "+route.destination+"，共乘坐 "+route.stops+" 站，"+(route.transfers?"换乘 "+route.transfers+" 次。":"无需换乘。");
    const instructions=route.segments.map((s,i)=>(i+1)+". 在“"+s.origin+"”乘坐"+s.line+"（"+s.direction+"），乘坐 "+s.stops+" 站，在“"+s.destination+"”下车。\n途经："+s.stations.join(" → ")).join("\n\n");
    return {...response(city),answer:intro+(instructions?"\n\n"+instructions:""),metro_route:route,columns:["分段","线路","方向","上车站","下车站","乘坐站数"],rows:route.segments.map((s,i)=>[i+1,s.line,s.direction,s.origin,s.destination,s.stops]),notice:"按换乘较少、再按站数较少计算的静态参考路线。抓取于 "+dataset.retrieved_at.slice(0,10)+"；不含临时停运、班次、票价、出站换乘和贯通车保证，请以运营方现场信息为准。"};
  }
  if(!requested)return null;
  const mapQuestion=/地铁图|线路图|线网图/.test(question);
  const lineToken=question.match(/(?:[Ss]\d+号?线|\d+号线)/)?.[0]?.toUpperCase().replace(/^(S\d+)线$/,"$1号线");
  const selected=lineToken?index.network.lines.filter(l=>l.name.toUpperCase().split(/[（(]/)[0]===lineToken):index.network.lines.filter(l=>question.includes(l.name));
  if(selected.length){return {...response(city),answer:city+selected[0].name+"，以下按运营方向列出已导入站点"+(selected.length>1?"（包含不同分支，请注意终点方向）":"")+"。",columns:["线路","方向","站序","站点"],rows:selected.flatMap(l=>l.stations.filter(s=>s.active).map((s,i)=>[l.name,l.stations.filter(s=>s.active)[0].name+" → "+l.stations.filter(s=>s.active).at(-1)!.name,i+1,s.name]))};}
  if(lineToken)return {...response(city),unavailable:true,answer:"当前"+city+"运营线网快照未收录“"+lineToken+"”，不将规划或在建线路当作已开通。请查看来源中的当前线网图。"};
  if(mapQuestion)return {...response(city),answer:city+"当前导入 "+index.stations.size+" 个轨道站点、"+new Set(index.network.lines.map(l=>l.name)).size+" 条命名线路（含分支 "+index.lines.size+" 项）。点击下方来源打开高德当前地铁图，也可在出行表单按线路浏览全部站点。资料抓取日期："+dataset.retrieved_at.slice(0,10)+"。",columns:["线路","首站","末站","收录运营站数"],rows:index.network.lines.map(l=>{const s=l.stations.filter(s=>s.active);return [l.name,s[0].name,s.at(-1)!.name,s.length];})};
  const stationText=question.replace(/(?:有哪些|有什么|有哪几条|有几条|能换乘|可以换乘|属于|是哪|是几|经过|途经|的线路|线路|地铁线路|地铁|站点信息|站点|车站|查询|线).*$/,"").replace(/^从/,"");
  const matches=findMetroStations(city,stationText);
  if(matches.length>1)return clarify(city,"站名",matches);
  if(matches.length===1){const s=matches[0],lines=[...new Set([...s.lines].map(id=>index.lines.get(id)!.name))];return {...response(city),answer:city+"“"+s.name+"”在当前快照中属于："+lines.join("、")+"。",columns:["站点","所属线路"],rows:[[s.name,lines.join("、")]]};}
  const stations=metroStations(city);return {...response(city),answer:city+"已导入 "+stations.length+" 个轨道站点。可以问“某站怎么去某站”或“某号线有哪些站”。",columns:["站点","所属线路"],rows:stations.slice(0,200).map(s=>[s.name,s.lines.join("、")]),...(stations.length>200?{notice:"本次显示前200站；出行表单中的站名提示和按线路浏览包含完整已导入站点。"}:{})};
}
