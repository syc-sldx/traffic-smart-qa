import {query} from "./database";
import {dataAnswer} from "./data";
import {knowledgeAnswer} from "./knowledge";
import {travelAnswer} from "./travel";
import {modelMessage} from "./model";
import {annualAnswer} from "./annual";
import {reportIdentity} from "./public-access";
type History={role:string,content:string};
export function domain(q:string,history:History[],mode:string){
  if(mode!=="auto")return mode;
  if(/是什么|什么是|定义|含义|原理|概念|知识|政策|法规|规范|标准|智慧交通|数字交通|车路协同|如何统计|应该如何|因果关系|相关性/.test(q))return "knowledge";
  if(/从.+(?:到|去).+|路线|怎么走|怎么坐|怎么去|换乘|(?:实时|现在|当前|今天).*(?:路况|拥堵|堵不堵)/.test(q)||/^(?:那|换成|改成)?(?:步行|走路|驾车|开车|公交|地铁)(?:呢)?[？?]?$/.test(q))return "travel";
  const last=[...history].reverse().find(h=>h.role==="assistant")?.content||"";
  if(last.includes("可以在上方“出行服务”中填写查询条件")&&/^[\u4e00-\u9fff，,、：:]{2,24}[？?]?$/.test(q))return "travel";
  const previous=[...history].reverse().find(h=>h.role==="user")?.content||"";
  if(/^(?:请)?(?:详细说说|展开讲讲|举个例子|为什么|再详细一点)[？?]?$/.test(q)&&/是什么|什么是|定义|原理|智慧交通|政策|规范/.test(previous))return "knowledge";
  return "data";
}
const functionTool=(name:string,description:string,properties:any,required:string[]=[])=>({type:"function",function:{name,description,parameters:{type:"object",properties,required}}});
const toolSpecs=[
  functionTool("run_sql","对历史交通库执行只读 SQL，最多返回200行。",{query:{type:"string"}},["query"]),
  functionTool("make_chart","基于最近一次查询结果画图。",{kind:{type:"string",enum:["bar","line"]},x:{type:"string"},y:{type:"string"}},["kind","x","y"]),
  functionTool("summarize","统计最近结果中数值列的均值、最小、最大。",{}),
  functionTool("export_report","用户明确要求报告或导出时调用一次，保存结果与结论。",{title:{type:"string"},conclusion:{type:"string"}},["title","conclusion"]),
];
const esc=(x:any)=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
function makeChart(last:any,args:any){if(!last?.rows?.length)throw new Error("请先查询数据。");if(!["bar","line"].includes(args.kind))throw new Error("仅支持柱状图和折线图。");const x=last.columns.indexOf(args.x),y=last.columns.indexOf(args.y);if(x<0||y<0||last.rows.some((r:any)=>r[y]!==null&&typeof r[y]!=="number"))throw new Error("图表列名或数值类型不正确。");return {tooltip:{trigger:"axis"},grid:{left:70,right:30,bottom:70,top:30},xAxis:{type:"category",data:last.rows.map((r:any)=>r[x]),axisLabel:{rotate:30}},yAxis:{type:"value",name:args.y},series:[{type:args.kind,data:last.rows.map((r:any)=>r[y]),itemStyle:{color:"#79e2c3"}}]};}
export async function ask(env:Cloudflare.Env,userId:string|null,q:string,history:History[],mode="auto",details:any={}){
  if(env.DB&&["auto","data"].includes(mode)){const annual=await annualAnswer(env.DB,q,history);if(annual)return annual;}
  const selected=domain(q,history,mode);if(selected==="knowledge")return knowledgeAnswer(env,q,history);if(selected==="travel")return travelAnswer(env,q,history,details);
  if(!env.DB)throw new Error("云端数据库尚未连接。");
  const quick=await dataAnswer(env.DB,q,history);if(quick)return quick;
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai"}).format();
  const system=`你是城市交通数据问答助手，北京时间日期为${today}。
flow(city 城市,stat_date 日期,ridership 地铁客流/万人次,unit 单位,source 来源)
congestion(city,city_code,ts 采集时刻,health_index 健康指数越高越好,congestion_delay_index 延迟指数越高越堵,avg_speed_kmh 车速公里每小时,city_rank)
weather(city,stat_date,weather_type,temp_high,temp_low,precipitation_mm 日降水毫米,wind_level,is_extreme)
annual_metrics(city,year,category,metric 标准指标,metric_code,original_metric,period 全年或年末,value 原值,unit 原单位,normalized_value 统一数值,normalized_unit 统一单位,yoy 原表同比小数,geo_scope 地理范围,mode_scope 制式,verification_status 原表核验标签,notes,cleaning_note,source_ref,source_title,source_url,source_type,source_file,source_sheet,source_row,dataset_id)
annual_sources(id,source_ref,region,title,published_at,source_type,notes,url,source_file,source_sheet,source_row,dataset_id)
annual_missing(city,year,category,metric,status,notes,source_file,source_sheet,source_row,dataset_id)
年度表来自用户工作簿，有167条2022—2025年数值、26个来源入口和80个待补项。与日观测分开，全年总量不能当日观测。回答附年份、原单位、全年或年末、来源链接及原表核验标签；该标签未由本次整理重新核验。缺项不填零、不用旧年或其他指标代替。苏州2025年4889.75万列公里是运营走行工作量，不是线网长度；线网为392.45公里且含有轨电车。地铁、含有轨电车、进站量、客运量、机场吞吐量及民航运输量不得混用。跨城排名检查normalized_unit、period、geo_scope、mode_scope，口径不同不生成统一排名；相同也只是资料内样本排序，不称长三角全域官方排名。
数据为历史快照：flow来源metro_db_wide为2024-08-27至2024-12-03，metro_api为2026-03-05至2026-03-23；分来源统计，两段不连续不能做连续同比环比。congestion为2026-01-27至2026-03-24的8个时刻，不能做连续趋势。weather仅南京，2024-07-01至2026-04-01。
城市名去市后缀；没有站点、线路明细或小时客流，年度表可有线路数量汇总。雨日按降水>=1毫米，天气客流按城市日期同时关联，差异不是因果。所有数字先run_sql，不编造。样本缺失不能补零。排名注明参与城市和样本天数，交通指数横向比较须同一时刻。
合适时画图一次，单值不画图；数值统计可调用summarize；只有明确要求报告时export_report且只调一次。只可SELECT查询flow,congestion,weather,annual_metrics,annual_sources,annual_missing。最多6次工具调用。最终用中文2至4句话，附单位、日期、来源和样本限制。`;
  const messages:any[]=[{role:"system",content:system},...history,{role:"user",content:q}];const trace:any[]=[];
  let last:any=null,chart:any=null,report_url:string|null=null,summary="";
  try{for(let turn=0;turn<7;turn++){
    const message=await modelMessage(env,messages,toolSpecs);const calls=message.tool_calls||[];messages.push({role:"assistant",content:message.content||"",...(calls.length?{tool_calls:calls}:{})});
    if(!calls.length){if(!message.content?.trim())throw new Error("模型没有返回结论。");if(trace.some(t=>t.tool==="run_sql")&&!last)throw new Error("查询未成功，无法核实数字。");return {ok:true,domain:"data",engine:"model",answer:message.content,steps:turn+1,trace,chart,report_url,summary,...(last||{})};}
    if(trace.length+calls.length>6)throw new Error("工具调用达到上限，请缩小问题范围。");
    for(const call of calls){let text="",ok=true;try{const args=JSON.parse(call.function.arguments||"{}");switch(call.function.name){
      case "run_sql":last=null;chart=null;last=await query(env.DB,String(args.query||""));text=JSON.stringify(last);break;
      case "make_chart":chart=makeChart(last,args);text="图表已生成。";break;
      case "summarize":if(!last)throw new Error("请先查询数据。");summary=JSON.stringify(last.columns.map((name:string,i:number)=>{const a=last.rows.map((r:any)=>r[i]).filter((v:any)=>typeof v==="number");return a.length?{column:name,count:a.length,mean:a.reduce((s:number,v:number)=>s+v,0)/a.length,min:Math.min(...a),max:Math.max(...a)}:null;}).filter(Boolean));text=summary;break;
      case "export_report":{if(!last)throw new Error("请先查询数据。");if(report_url)throw new Error("报告已导出，不要重复调用。");const id=crypto.randomUUID();const identity=await reportIdentity(userId);const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${esc(args.title)}</title><style>body{font:15px/1.8 sans-serif;max-width:1000px;margin:40px auto;padding:20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px}pre{white-space:pre-wrap}</style><h1>${esc(args.title)}</h1><p>${esc(args.conclusion)}</p><table><tr>${last.columns.map((c:string)=>`<th>${esc(c)}</th>`).join("")}</tr>${last.rows.map((r:any)=>`<tr>${r.map((v:any)=>`<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</table><h2>SQL</h2><pre>${esc(last.sql)}</pre><p>数据为历史快照，查询结论仅对应实际观测样本。</p></html>`;await env.DB.prepare("INSERT INTO reports(id,owner,html,created_at) VALUES(?,?,?,?)").bind(id,identity.owner,html,new Date().toISOString()).run();report_url="/reports/"+id+(identity.token?"?token="+identity.token:"");text="报告已保存。";break;}
      default:throw new Error("未知工具。");
    }}catch(error){ok=false;text=(error as Error).message;}trace.push({tool:call.function.name,ok,note:text.slice(0,100)});messages.push({role:"tool",tool_call_id:call.id,content:text});}
  }throw new Error("超过工具调用轮数，请缩小问题范围。");}catch(error){return {ok:false,domain:"data",error:(error as Error).message,trace};}
}
