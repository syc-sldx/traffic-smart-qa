import annualInput from "./annual-data.json";
import {query} from "./database";
const data:any=annualInput;
export const annualSummary=annualInput.summary;
type Plan={codes:string[],cities:string[],years:number[],overview:boolean,rank:boolean,cross:boolean,missing:boolean,official:boolean,latest:boolean};
export function annualPlan(question:string,history:any[]=[]):Plan|null{
  const q=question.replace(/\s/g,"");
  if(/日均|日平均|每天|平均每日|平均每天|\d{1,2}月|\d{1,2}[日号]|今天|昨天|上周|本月|是什么|什么是|定义|含义|原理|怎么走|怎么坐|实时/.test(q))return null;
  let hits:{start:number,end:number,code:string}[]=[];
  for(const [code,entry]of Object.entries(data.aliases) as [string,any][]){for(const alias of entry.aliases){let from=0,index:number;while((index=q.indexOf(alias,from))>=0){hits.push({start:index,end:index+alias.length,code});from=index+1;}}}
  hits=hits.filter(hit=>!hits.some(other=>other.start<=hit.start&&other.end>=hit.end&&other.end-other.start>hit.end-hit.start));
  const codes=[...new Set(hits.map(h=>h.code))];
  const allCities=[...new Set<string>([...data.records,...data.missing].map((r:any)=>r.city))].sort();
  const cities=allCities.filter(c=>q.includes(c));let years=[...new Set((q.match(/20\d{2}/g)||[]).map(Number))].sort((a,b)=>a-b);
  if(years.length===2&&/20\d{2}年?(?:至|到|—|~|～|-)20\d{2}/.test(q))years=Array.from({length:years[1]-years[0]+1},(_,i)=>years[0]+i);
  const overview=/年度数据|年度指标|年报|年鉴|年度交通|数据覆盖|补充.*数据|待补指标|缺失指标|哪些.*数据|数据.*哪些/.test(q);
  if(!codes.length&&!overview){if(/^(?:那|换成|换到)?(.{2,14}?)(?:呢|怎么样)?[？?]?$/.test(q)&&history.length){const i=history.findLastIndex(h=>h.role==="user");const prev=i>=0?annualPlan(history[i].content,history.slice(0,i)):null;if(prev&&(cities.length||years.length))return {...prev,cities:cities.length?cities:prev.cities,years:years.length?years:prev.years};}return null;}
  return {codes,cities,years,overview,rank:/排名|最高|最多|最大|第几/.test(q),cross:/长三角|各城|哪些城|城市.*对比|城市.*比较|排名|最高|最多|最大/.test(q),missing:/待补|缺失|缺哪些|还缺/.test(q),official:/只看官方|仅官方|排除转载|只.*已核验/.test(q),latest:/最新|最近/.test(q)};
}
const reply=(answer:string,fields:any={})=>({ok:true,engine:"annual",domain:"data",answer,steps:0,trace:[],...fields});
export async function annualAnswer(db:D1Database,question:string,history:any[]=[]):Promise<any|null>{
  const p=annualPlan(question,history);if(!p)return null;
  if(p.missing){const rows=data.missing.filter((r:any)=>(!p.cities.length||p.cities.includes(r.city))&&(!p.years.length||p.years.includes(r.year)));return reply(`匹配到 ${rows.length} 个原表待补项。数值仍为缺失，不按零处理。`,{columns:["城市","年份","类别","待补指标","状态","说明"],rows:rows.map((r:any)=>[r.city,r.year,r.category,r.metric,r.status,r.notes])});}
  if(p.codes.length>1)return reply("问题涉及多个年度指标，请一次指定一个指标，或分别提问，以免混用统计口径。");
  if(!p.codes.length&&!p.cities.length)return reply(`新增年度资料有 ${data.summary.records} 条数值，覆盖 ${Object.keys(data.summary.cities).length} 个有数值的城市，年份为2022—2025；另有26个来源入口、80个待补项。可以问“2025年南京地铁客运量是多少”或“2022至2024年南京公路总里程趋势”。`);
  if(!p.years.length){if(p.latest){const pool=data.records.filter((r:any)=>(!p.cities.length||p.cities.includes(r.city))&&(!p.codes.length||p.codes.includes(r.metric_code)));p.years=pool.length?[Math.max(...pool.map((r:any)=>r.year))]:[];}else return reply("想查询哪一年的年度数据？请明确年份，例如2025年。");}
  if(p.codes.length&&!p.cities.length&&!p.cross)return reply("想查询哪个城市的年度数据？也可以明确要求“长三角资料中的城市对比”。");
  const clauses=["dataset_id=?"],params:any[]=[data.dataset_id];
  for(const [values,field]of [[p.codes,"metric_code"],[p.cities,"city"],[p.years,"year"]] as [any[],string][]){if(values.length){clauses.push(field+" IN ("+values.map(()=>"?").join(",")+")");params.push(...values);}}
  if(p.official)clauses.push("verification_status='官方原文已查'");
  const sql="SELECT * FROM annual_metrics WHERE "+clauses.join(" AND ")+" ORDER BY year,city,metric";
  const result=await query(db,sql,params);const records:any[]=result.rows.map(row=>Object.fromEntries(result.columns.map((c,i)=>[c,row[i]])));
  if(!records.length){const name=p.codes.length?data.aliases[p.codes[0]]?.name||"所选指标":"年度指标";return reply(`未查到${p.cities.join("、")||"所选范围"} ${p.years.join(",")}年的${name}记录。缺失不等于0，也不会用其他年份或相近指标代替。`);}
  const scopes=new Set(records.map(r=>JSON.stringify([r.period,r.normalized_unit,r.geo_scope,r.mode_scope])));
  const comparable=scopes.size===1&&p.codes.length===1&&new Set(records.map(r=>r.year)).size===1;
  if(p.rank&&comparable)records.sort((a,b)=>b.normalized_value-a.normalized_value);
  let text="";
  if(records.length===1){const r=records[0];text=`${r.year}年${r.city}${r.metric}为 ${r.value} ${r.unit}（${r.period}）。`;if(r.unit!==r.normalized_unit)text+=`统一单位后为 ${r.normalized_value} ${r.normalized_unit}。`;if(r.yoy!==null)text+=`原表同比为 ${Number((r.yoy*100).toFixed(6))}%。`;else if(question.includes("同比"))text+="原表未给出该项同比，未自动推算。";if(r.notes)text+=r.notes+"。";if(r.cleaning_note)text+=r.cleaning_note;text+=`原表核验标签：${r.verification_status}。`;}
  else text=`匹配到 ${records.length} 条年度记录，见明细。`;
  const absent=p.cities.flatMap(city=>p.years.filter(year=>!records.some(r=>r.city===city&&r.year===year)).map(year=>`${year}年${city}`));
  if(absent.length)text+="未查到"+absent.join("、")+"的同指标记录，未用相近指标代替。";
  if(p.rank)text+=comparable?`这是资料中 ${records.length} 个同名同单位样本的数值排序，不代表长三角全域官方排名。`:"统计时点、制式、地区范围或单位口径不同，已展示数据，未生成统一排名。";
  else if(scopes.size>1)text+="不同口径分列，不合并加总。";
  text+="核验标签沿用原表，本次整理未重新核验全部原文。";
  const sourceRows=new Map<string,number[]>();for(const r of records){if(!sourceRows.has(r.source_ref))sourceRows.set(r.source_ref,[]);sourceRows.get(r.source_ref)!.push(r.source_row);}
  const sources=data.sources.filter((s:any)=>sourceRows.has(s.source_ref)).map((s:any)=>({title:s.title,url:s.url,document:data.source_file,excerpt:`来源编号${s.source_ref}；原表“数据汇总”行：${sourceRows.get(s.source_ref)!.join(",")}；来源类型：${s.source_type}。`}));
  const out:any=reply(text,{steps:1,trace:[{tool:"query_annual_metrics",ok:true,note:"年度数据独立查询"}],sql:result.sql,columns:["城市","年份","指标","统计时点","统一数值","单位","原始数值","原始单位","原表同比","口径","原表核验标签","来源编号"],rows:records.map(r=>[r.city,r.year,r.metric,r.period,r.normalized_value,r.normalized_unit,r.value,r.unit,r.yoy===null?null:Number((r.yoy*100).toFixed(6))+"%",r.geo_scope+"；"+r.mode_scope,r.verification_status,r.source_ref]),sources});
  if(records.length>1&&scopes.size===1&&p.codes.length===1){const sameCity=new Set(records.map(r=>r.city)).size===1;out.chart={tooltip:{trigger:"axis"},grid:{left:80,right:30,bottom:70,top:35},xAxis:{type:"category",data:records.map(r=>sameCity?String(r.year):`${r.city} ${r.year}`)},yAxis:{type:"value",name:records[0].normalized_unit},series:[{type:sameCity?"line":"bar",data:records.map(r=>r.normalized_value),itemStyle:{color:"#79e2c3"}}]};}
  return out;
}
