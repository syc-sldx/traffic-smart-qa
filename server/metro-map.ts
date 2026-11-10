import geometry from "./metro-map-data.json";
import dataset from "./metro-data.json";

type Point=number[];
type MapLine={id:string,paths:Point[][],stations:(string|number)[][]};
const maps=geometry.maps as {city:string,lines:MapLine[]}[];
const cache=new Map<string,string>();
const xml=(value:unknown)=>String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]!));
const cleanCity=(city:string)=>city.trim().replace(/特别行政区$/,"").replace(/市$/,"");
function lookup(city:string,line=""){
  city=cleanCity(city);
  const network=dataset.networks.find(n=>n.city===city),map=maps.find(m=>m.city===city);
  if(!network||!map||line&&!network.lines.some(l=>l.name===line))return null;
  return {network,map,city,line};
}
export function metroMapInfo(city:string,line=""){
  const data=lookup(city,line);if(!data)return null;
  return {url:"/api/metro/map.svg?"+new URLSearchParams({city:data.city,...(line?{line}:{}),v:geometry.retrieved_at}),alt:data.city+(line||"轨道交通线网")+"示意图",caption:"依据高德公开线网数据绘制 · 资料抓取于 "+geometry.retrieved_at.slice(0,10),retrieved_at:geometry.retrieved_at};
}
export function renderMetroMap(city:string,line=""):string|null{
  const data=lookup(city,line);if(!data)return null;
  const cacheKey=data.city+"|"+line;if(cache.has(cacheKey))return cache.get(cacheKey)!;
  const lines=data.network.lines.filter(l=>!line||l.name===line),ids=new Set(lines.map(l=>l.id));
  const drawing=data.map.lines.filter(l=>ids.has(l.id));
  const points=drawing.flatMap(l=>[...l.paths.flat(),...l.stations.map(s=>[Number(s[1]),Number(s[2])])]);
  if(!points.length||points.some(p=>p.length!==2||p.some(v=>!Number.isFinite(v))))return null;
  const minX=Math.min(...points.map(p=>p[0]))-150,minY=Math.min(...points.map(p=>p[1]))-45;
  const width=Math.max(1000,Math.max(...points.map(p=>p[0]))-minX+150);
  const mapHeight=Math.max(...points.map(p=>p[1]))-minY+65;
  const legend=[...new Map(lines.map(l=>[l.name,l])).values()],columns=Math.max(2,Math.min(5,Math.floor(width/230)));
  const legendY=mapHeight+132,height=legendY+Math.ceil(legend.length/columns)*36+82;
  const color=(c:string)=>/^#[0-9a-f]{6}$/i.test(c)?c:"#2864ec";
  const title=data.city+(line?" · "+line:"轨道交通线网图");
  let svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'" role="img" aria-labelledby="title desc"><title id="title">'+xml(title)+'</title><desc id="desc">依据高德公开线网数据绘制的运营站点示意图，资料抓取于'+geometry.retrieved_at.slice(0,10)+'。不含实时停运信息。</desc><rect width="100%" height="100%" fill="#ffffff"/><g font-family="Microsoft YaHei,PingFang SC,sans-serif"><text x="40" y="52" font-size="30" font-weight="700" fill="#18334d">'+xml(title)+'</text><text x="42" y="82" font-size="14" fill="#718299">运营站点与换乘 · 线网示意图</text><g transform="translate('+(-minX)+' '+(112-minY)+')">';
  for(const l of drawing){const meta=lines.find(m=>m.id===l.id)!;for(const path of l.paths){const coords=path.map(p=>p.join(",")).join(" ");svg+='<polyline points="'+coords+'" fill="none" stroke="white" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/><polyline points="'+coords+'" fill="none" stroke="'+color(meta.color)+'" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>';}}
  const stations=new Map<string,{id:string,name:string,x:number,y:number,lg:number,colors:Set<string>}>();
  for(const l of drawing){const meta=lines.find(m=>m.id===l.id)!;for(const [id,x,y,lg] of l.stations){const raw=meta.stations.find(s=>s.id===id&&s.active);if(!raw)continue;const existing=stations.get(String(id));if(existing){existing.colors.add(color(meta.color));continue;}stations.set(String(id),{id:String(id),name:raw.name,x:Number(x),y:Number(y),lg:Number(lg),colors:new Set([color(meta.color)])});}}
  for(const s of stations.values()){const transfer=s.colors.size>1;svg+='<circle cx="'+s.x+'" cy="'+s.y+'" r="'+(transfer?5.7:3.7)+'" fill="white" stroke="'+(transfer?"#23394e":[...s.colors][0])+'" stroke-width="'+(transfer?2:1.8)+'"/>';if(transfer)svg+='<circle cx="'+s.x+'" cy="'+s.y+'" r="2" fill="#23394e"/>';}
  const offsets=[[0,-11],[11,-9],[12,4],[11,17],[0,20],[-11,17],[-12,4],[-11,-9]];
  for(const s of stations.values()){const direction=s.lg>=0&&s.lg<8?s.lg:2,[dx,dy]=offsets[direction],anchor=direction===0||direction===4?"middle":direction<4?"start":"end";svg+='<text x="'+(s.x+dx)+'" y="'+(s.y+dy)+'" text-anchor="'+anchor+'" font-size="12" font-weight="'+(s.colors.size>1?600:400)+'" fill="#223a50" stroke="white" stroke-width="3" stroke-linejoin="round" paint-order="stroke">'+xml(s.name)+'</text>';}
  svg+='</g><path d="M40 '+(legendY-24)+'H'+(width-40)+'" stroke="#e4eaf1"/>';
  legend.forEach((l,i)=>{const x=42+(i%columns)*(width-84)/columns,y=legendY+Math.floor(i/columns)*36;svg+='<path d="M'+x+' '+y+'h25" stroke="'+color(l.color)+'" stroke-width="6" stroke-linecap="round"/><text x="'+(x+36)+'" y="'+(y+5)+'" font-size="14" fill="#354d63">'+xml(l.name)+'</text>';});
  svg+='<text x="42" y="'+(height-43)+'" font-size="13" fill="#718299">资料：高德公开线网数据 · 抓取日期 '+geometry.retrieved_at.slice(0,10)+'</text><text x="42" y="'+(height-20)+'" font-size="12" fill="#8a98a8">仅供出行参考；临时调整、运营时段请以运营方公告为准。线路位置不代表实际地理距离。</text></g></svg>';
  if(cache.size>=12)cache.delete(cache.keys().next().value!);cache.set(cacheKey,svg);return svg;
}
