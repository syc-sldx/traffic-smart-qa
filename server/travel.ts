import {cities} from "./database";
import {coordinate} from "./location.mjs";
import {parseTravelContext,resolveTravel} from "../shared/travel-context.mjs";
const names:Record<string,string>={driving:"驾车",walking:"步行",transit:"公交地铁"};
const doc="https://lbs.amap.com/api/webservice/guide/api/direction";
function num(value:any,div=1){if(value===null||value===undefined||value===""||Array.isArray(value))return null;const n=Number(value);return Number.isFinite(n)?Math.round(n/div*10)/10:null;}
function metric(value:any,div=1,digits=1){
  if(typeof value!=="number"&&typeof value!=="string"||typeof value==="string"&&!/^\d+(?:\.\d+)?$/.test(value.trim()))return null;
  const n=Number(value);return Number.isFinite(n)&&n>=0?Math.round(n/div*10**digits)/10**digits:null;
}
const text=(value:any,max=600)=>typeof value==="string"&&value.trim()?value.trim().slice(0,max):undefined;
const array=(value:any):any[]=>Array.isArray(value)?value:[];
function routeOptions(paths:any[],transport:string){
  return paths.slice(0,3).map((path:any,index:number)=>{
    const steps:any[]=[];let truncated=false;
    const add=(step:any)=>{if(steps.length<60)steps.push(step);else truncated=true;};
    if(transport==="transit"){
      for(const segment of array(path.segments)){
        const walking=segment.walking||{},distance=metric(walking.distance),instructions=array(walking.steps).map(s=>text(s.instruction)).filter(Boolean);
        if(distance!==null&&distance>0||instructions.length)add({kind:"walk",distance_meters:distance,...(instructions.length?{instruction:instructions.join("；").slice(0,1200)}:{})});
        const lines=array(segment.bus?.buslines).filter(line=>line&&typeof line==="object"&&(text(line.name)||text(line.departure_stop?.name)||text(line.arrival_stop?.name)));
        if(lines.length){
          const first=lines[0],line=text(first.name,160),alternatives=[...new Set(lines.slice(1).map(item=>text(item.name,160)).filter(name=>name&&name!==line))];
          // buslines in one segment are alternatives, not consecutive rides.
          const via=metric(first.via_num,1,0),rawVia=metric(first.via_num,1,6);
          add({kind:"ride",line,origin:text(first.departure_stop?.name,160),destination:text(first.arrival_stop?.name,160),direction:text(first.direction,160),distance_meters:metric(first.distance),...(via!==null&&via===rawVia?{via_stops:via}:{}),...(alternatives.length?{alternative_lines:alternatives.slice(0,20)}:{})});
        }
        const rail=segment.railway;
        if(rail&&(text(rail.name)||text(rail.trip)||text(rail.departure_stop?.name)||text(rail.arrival_stop?.name)))add({kind:"rail",line:text(rail.name,160)||text(rail.trip,160),origin:text(rail.departure_stop?.name,160),destination:text(rail.arrival_stop?.name,160),distance_meters:metric(rail.distance)});
      }
    }else for(const step of array(path.steps)){
      const instruction=text(step.instruction,1200),distance=metric(step.distance);
      if(instruction||distance!==null)add({kind:transport==="walking"?"walk":"drive",...(instruction?{instruction}:{}),distance_meters:distance});
    }
    return {id:String(index+1),distance_km:metric(path.distance,1000,3),duration_minutes:metric(path.duration,60),fare_yuan:transport==="transit"?metric(path.cost,1,2):null,walking_meters:transport==="walking"?metric(path.distance):transport==="transit"?metric(path.walking_distance):null,steps,...(truncated?{steps_truncated:true}:{})};
  });
}
function mapFailure(code:string,attempts:number,path:string){
  const transient=/^3\d{4}$/.test(code),suffix=code?`（错误码 ${code}）`:"";
  const service=path.startsWith("direction/")?"路线规划":path.startsWith("geocode/")?"地址查询":"交通路况";
  const message=transient?`高德${service}服务响应失败${suffix}，自动重试后仍未返回结果。请稍后再试，或补充更明确的起终点地址。`
    :code==="10001"?`高德地图密钥无效${suffix}，请联系网站维护者检查服务端配置。`
    :["10002","10005","10006","10007","10009","10012","20011"].includes(code)?`高德${service}服务的权限或访问配置不满足要求${suffix}，请联系网站维护者。`
    :["10003","10004","10010","10014","10019","10020","10021","10022","10023","10029","10044","40000","40002","40003"].includes(code)?`高德${service}服务的调用额度、频率或服务有效期受限${suffix}，请稍后再试或联系网站维护者。`
    :/^208\d{2}$/.test(code)?`高德未能规划这两个位置之间的路线${suffix}，请核对起终点或换一种出行方式。`
    :/^2\d{4}$/.test(code)?`高德${service}请求的参数未被接受${suffix}，请核对城市和完整起终点。`
    :`高德${service}服务未完成本次查询${suffix}，请稍后再试。`;
  return Object.assign(new Error(message),{mapError:{code,service,retryable:transient,attempts}});
}
async function mapRequest(env:Cloudflare.Env,path:string,params:Record<string,string|number>,request:typeof fetch){
  if(!env.AMAP_API_KEY)throw new Error("尚未配置高德地图服务。");
  const url=new URL("https://restapi.amap.com/v3/"+path);for(const [k,v]of Object.entries({...params,key:env.AMAP_API_KEY,output:"JSON"}))url.searchParams.set(k,String(v));
  for(let attempt=1;attempt<=2;attempt++){
    let response:Response;try{response=await request(url,{signal:AbortSignal.timeout(12000)});}catch{throw new Error("地图服务连接失败或超时，请稍后重试。");}
    if(!response.ok)throw new Error(`地图服务返回 HTTP ${response.status}。`);
    const data:any=await response.json();if(String(data.status)==="1")return data;
    const code=String(data.infocode||"").replace(/\D/g,"").slice(0,5);
    if(/^3\d{4}$/.test(code)&&attempt===1){await new Promise(resolve=>setTimeout(resolve,300));continue;}
    throw mapFailure(code,attempt,path);
  }
}
async function geocode(env:Cloudflare.Env,address:string,city:string,request:typeof fetch){
  const data=await mapRequest(env,"geocode/geo",{address,city},request);let candidates=(data.geocodes||[]).filter((r:any)=>r.location);
  const admin=["国家","省","市","区县","区","县"],precise=candidates.filter((r:any)=>!admin.includes(r.level));if(precise.length)candidates=precise;
  if(!candidates.length)throw new Error(`未找到地址“${address}”，请补充完整地址。`);
  if(candidates.length>1)throw new Error(`地址“${address}”有多个候选，请补充区县或门牌号：`+candidates.slice(0,4).map((r:any)=>r.formatted_address).join("；"));
  if(admin.includes(candidates[0].level))throw new Error(`地址“${address}”只定位到行政区，请补充详细地址。`);return {...candidates[0],location:coordinate(String(candidates[0].location)).text};
}
export function parseTravel(question:string,history:any[]=[]):Record<string,string>{return parseTravelContext(question,history,cities);}
export async function travelAnswer(env:Cloudflare.Env,q:string,history:any[],details:Record<string,string>={},request:typeof fetch=fetch){
  const slots=resolveTravel(q,history,details,cities);
  if(slots.action==="metro"&&["walking","driving"].includes(slots.transport))slots.action="route";
  const out:any={ok:true,domain:"travel",engine:"travel",steps:0,trace:[],slots};
  const action=slots.action||"route",required=action==="traffic"?["city","road"]:["city","origin","destination","transport"];
  const labels:Record<string,string>={city:"城市",road:"道路名称",origin:"起点",destination:"终点",transport:"出行方式（驾车、步行或公交地铁）"};
  if(!["route","traffic"].includes(action))return {...out,answer:"请选择路线规划或道路路况。"};
  const missing=required.filter(k=>!slots[k]);if(missing.length)return {...out,needs_input:true,answer:"请补充"+missing.map(k=>labels[k]).join("、")+"。可以在上方“出行服务”中填写查询条件。"};
  if(action==="route"&&!names[slots.transport])return {...out,answer:"请选择驾车、步行或公交地铁。"};
  try{
    if(action==="traffic"){
      const data=await mapRequest(env,"traffic/status/road",{city:slots.city.endsWith("市")?slots.city:slots.city+"市",name:slots.road,level:6,extensions:"all"},request),info=data.trafficinfo||{};
      if(!info.description&&!info.roads?.length)throw new Error("接口未返回该道路的交通态势，不能据此认定畅通。");
      const statuses:Record<string,string>={"0":"未知","1":"畅通","2":"缓行","3":"拥堵"};
      Object.assign(out,{answer:`${slots.city}${slots.road}：${info.description||"分路段状态见下表。"}\n来源：高德交通态势。查询时间不等于供应商观测时间，接口未提供观测时刻时不推测更新时间。`,columns:["道路","方向","状态","车速（公里/小时）"],rows:(info.roads||[]).map((r:any)=>[r.name||slots.road,r.direction||"未提供",statuses[String(r.status)]||"未知",num(r.speed)])});
    }else{
      if(/^(?:我的位置|当前位置)$/.test(slots.origin)&&!details.origin_location)return {...out,needs_input:true,answer:"请重新定位并设置起点，或手动填写起点地址。历史定位坐标不会自动沿用。"};
      const point=/^(?:我的位置|当前位置)$/.test(slots.origin)&&details.origin_location?coordinate(details.origin_location):null;
      const start=point?{location:point.text,formatted_address:"当前位置（本次定位）"}:await geocode(env,slots.origin,slots.city,request),end=await geocode(env,slots.destination,slots.city,request);
      const params:Record<string,string>={origin:start.location,destination:end.location};if(slots.transport==="transit")Object.assign(params,{city:slots.city,cityd:typeof end.citycode==="string"&&end.citycode.trim()?end.citycode.trim():slots.city,extensions:"all"});
      if(slots.transport==="transit"&&["0","1","2","3"].includes(slots.strategy))params.strategy=slots.strategy;
      const data=await mapRequest(env,slots.transport==="transit"?"direction/transit/integrated":"direction/"+slots.transport,params,request);
      const paths=(slots.transport==="transit"?data.route?.transits:data.route?.paths)||[];if(!paths.length)throw new Error("地图接口没有返回可用路线，请检查地址或换一种出行方式。");
      const rows=paths.slice(0,3).map((path:any,i:number)=>{const summary:string[]=[];
        if(slots.transport==="transit")for(const segment of path.segments||[]){const walking=segment.walking||{},distance=num(walking.distance);if(distance!==null&&distance>0)summary.push(`步行${distance}米`);else if(walking.steps?.length)summary.push("步行（接口未提供距离）");const busLegs=[...new Set(array(segment.bus?.buslines).map(line=>`${line.name||""}（${line.departure_stop?.name||""} → ${line.arrival_stop?.name||""}）`))];if(busLegs.length)summary.push(busLegs.join(" / ")+(busLegs.length>1?"（同段可选）":""));if(segment.railway?.name)summary.push(segment.railway.name);}
        else for(const step of path.steps||[])if(step.instruction)summary.push(step.instruction);
        return [i+1,num(path.distance,1000),num(path.duration,60),summary.slice(0,10).join(" → ")||"接口未返回分段说明"];
      });
      Object.assign(out,{answer:`${slots.city}：${slots.origin} → ${slots.destination}，出行方式为${names[slots.transport]}。返回 ${rows.length} 个方案，距离和预计耗时见下表；这是本次地图查询的估计值。`,columns:["方案","距离（公里）","预计耗时（分钟）","路线说明"],rows,route_options:routeOptions(paths,slots.transport),resolved_addresses:{origin:start.formatted_address||slots.origin,destination:end.formatted_address||slots.destination}});
    }
    return {...out,steps:1,queried_at:new Date().toLocaleString("sv-SE",{timeZone:"Asia/Shanghai"}).replace(" ","T")+"+08:00",sources:[{title:action==="traffic"?"高德交通态势":"高德路线规划",url:action==="traffic"?"https://lbs.amap.com/api/webservice/guide/api-advanced/traffic-situation-inquiry":doc}],trace:[{tool:action,ok:true,note:"已调用高德 Web 服务"}]};
  }catch(error){return {...out,unavailable:true,answer:(error as Error).message,...((error as any).mapError?{map_error:(error as any).mapError}:{})};}
}
