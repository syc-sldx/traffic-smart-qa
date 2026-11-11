import {cities} from "./database";
import {coordinate} from "./location.mjs";
const names:Record<string,string>={driving:"驾车",walking:"步行",transit:"公交地铁"};
const doc="https://lbs.amap.com/api/webservice/guide/api/direction";
function num(value:any,div=1){if(value===null||value===undefined||value===""||Array.isArray(value))return null;const n=Number(value);return Number.isFinite(n)?Math.round(n/div*10)/10:null;}
async function mapRequest(env:Cloudflare.Env,path:string,params:Record<string,string|number>){
  if(!env.AMAP_API_KEY)throw new Error("尚未配置高德地图服务。");
  const url=new URL("https://restapi.amap.com/v3/"+path);for(const [k,v]of Object.entries({...params,key:env.AMAP_API_KEY,output:"JSON"}))url.searchParams.set(k,String(v));
  let response:Response;try{response=await fetch(url,{signal:AbortSignal.timeout(12000)});}catch{throw new Error("地图服务连接失败或超时，请稍后重试。");}
  if(!response.ok)throw new Error(`地图服务返回 HTTP ${response.status}。`);
  const data:any=await response.json();if(String(data.status)!=="1")throw new Error(`地图接口拒绝请求（错误码 ${String(data.infocode||"").replace(/\D/g,"")}），请检查密钥、权限和配额。`);return data;
}
async function geocode(env:Cloudflare.Env,address:string,city:string){
  const data=await mapRequest(env,"geocode/geo",{address,city});let candidates=(data.geocodes||[]).filter((r:any)=>r.location);
  const admin=["国家","省","市","区县","区","县"],precise=candidates.filter((r:any)=>!admin.includes(r.level));if(precise.length)candidates=precise;
  if(!candidates.length)throw new Error(`未找到地址“${address}”，请补充完整地址。`);
  if(candidates.length>1)throw new Error(`地址“${address}”有多个候选，请补充区县或门牌号：`+candidates.slice(0,4).map((r:any)=>r.formatted_address).join("；"));
  if(admin.includes(candidates[0].level))throw new Error(`地址“${address}”只定位到行政区，请补充详细地址。`);return candidates[0];
}
export function parseTravel(question:string,history:any[]=[]):Record<string,string>{
  const q=question.replace(/\s/g,"");let slots:Record<string,string>={};
  const last=[...history].reverse().find(h=>h.role==="assistant")?.content||"";
  if(/^(?:那|换成|改成)?(?:步行|走路|驾车|开车|公交|地铁)(?:呢)?[？?]?$/.test(q)||last.includes("可以在上方“出行服务”中填写查询条件")){
    const i=history.findLastIndex(h=>h.role==="user");if(i>=0)slots=parseTravel(history[i].content,history.slice(0,i));
  }
  const c=q.match(/(?:城市[：:]|^)([\u4e00-\u9fff]{2,8}?)(?:市)?(?:[，,:：]|从)/);
  if(c)slots.city=c[1];else{const found=cities.filter(c=>q.includes(c));const prefix=q.replace(/^(?:(?:请问|查一下|现在|实时|当前|今天|帮我查|查询|在))+/,'');const leading=found.filter(c=>prefix.startsWith(c));if(leading.length)slots.city=leading.sort((a,b)=>b.length-a.length)[0];else if(found.length===1)slots.city=found[0];}
  const m=q.match(/从(.+?)(?:到|去)(.+?)(?=怎么|如何|驾车|开车|步行|走路|坐|乘|[，。？?]|$)/);if(m)Object.assign(slots,{origin:m[1],destination:m[2],action:"route"});
  if(!m){const natural=q.match(/^(.+?)(?:怎么去|如何去|怎么到|如何到)(.+?)(?=[，。？?]|$)/);if(natural)Object.assign(slots,{origin:natural[1],destination:natural[2],action:"route"});}
  if(/步行|走路/.test(q))slots.transport="walking";else if(/地铁|公交|换乘/.test(q))slots.transport="transit";else if(/驾车|开车|自驾/.test(q))slots.transport="driving";
  const road=q.match(/(?:道路|路名)[：:](.+?)(?=[，。？?]|$)/);
  if(road)Object.assign(slots,{road:road[1],action:"traffic"});
  else if(/实时|现在|当前|今天/.test(q)&&/路况|堵不堵|拥堵/.test(q)){slots.action="traffic";if(slots.city){const rest=q.split(slots.city)[1]?.replace(/^市/,"")||"";const street=rest.match(/^(.+?(?:大道|高速|公路|路|街|桥))(?:现在|实时|当前|今天|的|交通|路况|拥堵|堵不堵|怎么样|如何|[？?]|$)/);if(street)slots.road=street[1];}}
  return slots;
}
export async function travelAnswer(env:Cloudflare.Env,q:string,history:any[],details:Record<string,string>={}){
  const slots=parseTravel(q,history);for(const [k,v]of Object.entries(details))if(["city","origin","destination","transport","road","action"].includes(k)&&v?.trim())slots[k]=v.trim();
  const out:any={ok:true,domain:"travel",engine:"travel",steps:0,trace:[],slots};
  const action=slots.action||"route",required=action==="traffic"?["city","road"]:["city","origin","destination","transport"];
  const labels:Record<string,string>={city:"城市",road:"道路名称",origin:"起点",destination:"终点",transport:"出行方式（驾车、步行或公交地铁）"};
  if(!["route","traffic"].includes(action))return {...out,answer:"请选择路线规划或道路路况。"};
  const missing=required.filter(k=>!slots[k]);if(missing.length)return {...out,needs_input:true,answer:"请补充"+missing.map(k=>labels[k]).join("、")+"。可以在上方“出行服务”中填写查询条件。"};
  if(action==="route"&&!names[slots.transport])return {...out,answer:"请选择驾车、步行或公交地铁。"};
  try{
    if(action==="traffic"){
      const data=await mapRequest(env,"traffic/status/road",{city:slots.city.endsWith("市")?slots.city:slots.city+"市",name:slots.road,level:6,extensions:"all"}),info=data.trafficinfo||{};
      if(!info.description&&!info.roads?.length)throw new Error("接口未返回该道路的交通态势，不能据此认定畅通。");
      const statuses:Record<string,string>={"0":"未知","1":"畅通","2":"缓行","3":"拥堵"};
      Object.assign(out,{answer:`${slots.city}${slots.road}：${info.description||"分路段状态见下表。"}\n来源：高德交通态势。查询时间不等于供应商观测时间，接口未提供观测时刻时不推测更新时间。`,columns:["道路","方向","状态","车速（公里/小时）"],rows:(info.roads||[]).map((r:any)=>[r.name||slots.road,r.direction||"未提供",statuses[String(r.status)]||"未知",num(r.speed)])});
    }else{
      if(/^(?:我的位置|当前位置)$/.test(slots.origin)&&!details.origin_location)return {...out,needs_input:true,answer:"请重新定位并设置起点，或手动填写起点地址。历史定位坐标不会自动沿用。"};
      const point=details.origin_location?coordinate(details.origin_location):null;
      const start=point?{location:point.text,formatted_address:"当前位置（本次定位）"}:await geocode(env,slots.origin,slots.city),end=await geocode(env,slots.destination,slots.city);
      const params:Record<string,string>={origin:start.location,destination:end.location};if(slots.transport==="transit")Object.assign(params,{city:slots.city,cityd:end.citycode||slots.city,extensions:"all"});
      const data=await mapRequest(env,slots.transport==="transit"?"direction/transit/integrated":"direction/"+slots.transport,params);
      const paths=(slots.transport==="transit"?data.route?.transits:data.route?.paths)||[];if(!paths.length)throw new Error("地图接口没有返回可用路线，请检查地址或换一种出行方式。");
      const rows=paths.slice(0,3).map((path:any,i:number)=>{const summary:string[]=[];
        if(slots.transport==="transit")for(const segment of path.segments||[]){const walking=segment.walking||{},distance=num(walking.distance);if(distance!==null&&distance>0)summary.push(`步行${distance}米`);else if(walking.steps?.length)summary.push("步行（接口未提供距离）");for(const line of segment.bus?.buslines||[])summary.push(`${line.name||""}（${line.departure_stop?.name||""} → ${line.arrival_stop?.name||""}）`);if(segment.railway?.name)summary.push(segment.railway.name);}
        else for(const step of path.steps||[])if(step.instruction)summary.push(step.instruction);
        return [i+1,num(path.distance,1000),num(path.duration,60),summary.slice(0,10).join(" → ")||"接口未返回分段说明"];
      });
      Object.assign(out,{answer:`${slots.city}：${slots.origin} → ${slots.destination}，出行方式为${names[slots.transport]}。返回 ${rows.length} 个方案，距离和预计耗时见下表；这是本次地图查询的估计值。`,columns:["方案","距离（公里）","预计耗时（分钟）","路线说明"],rows,resolved_addresses:{origin:start.formatted_address||slots.origin,destination:end.formatted_address||slots.destination}});
    }
    return {...out,steps:1,queried_at:new Date().toLocaleString("sv-SE",{timeZone:"Asia/Shanghai"}).replace(" ","T")+"+08:00",sources:[{title:action==="traffic"?"高德交通态势":"高德路线规划",url:action==="traffic"?"https://lbs.amap.com/api/webservice/guide/api-advanced/traffic-situation-inquiry":doc}],trace:[{tool:action,ok:true,note:"已调用高德 Web 服务"}]};
  }catch(error){return {...out,unavailable:true,answer:(error as Error).message};}
}
