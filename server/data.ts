import { cities, query } from "./database";
type Plan={kind:string,city:string|null,start:string|null,end:string|null};
const metrics:Record<string,[string,string]>={"拥堵延迟指数":["congestion_delay_index",""],"拥堵指数":["congestion_delay_index",""],"平均车速":["avg_speed_kmh"," 公里/小时"],"交通健康指数":["health_index",""]};
const day=(d:Date)=>d.toISOString().slice(0,10);
export function period(question:string) {
  const q=question.replace(/\s/g,"");
  const matches=[...q.matchAll(/(20\d{2}年|今年|去年)(?:(\d{1,2})月(?:(\d{1,2})[日号])?)?|(20\d{2})-(\d{1,2})(?:-(\d{1,2}))?|今天|昨天|前天|本周|这周|上周|本月|这个月|上个月|上月/g)];
  if(matches.length!==1)return null;
  const m=matches[0], rest=q.slice(0,m.index)+q.slice(m.index!+m[0].length);
  if(/\d|季度|半年|同期|同比|环比|月初|月末|年初|年底|以来|之前|之后|以前|以后|截至|截止|过去|最近|近[一两三四五六七八九十]|假期|春节|元旦|国庆|上旬|中旬|下旬/.test(rest))return null;
  const now=new Date(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format()+"T00:00:00Z");
  let start:Date,end:Date;
  if(["今天","昨天","前天"].includes(m[0])){start=new Date(+now-["今天","昨天","前天"].indexOf(m[0])*86400000);end=start;}
  else if(["本周","这周","上周"].includes(m[0])){start=new Date(+now-((now.getUTCDay()+6)%7+(m[0]==="上周"?7:0))*86400000);end=new Date(+start+6*86400000);}
  else {
    let year=m[1]?(["今年","去年"].includes(m[1])?now.getUTCFullYear()-(m[1]==="去年"?1:0):parseInt(m[1])):m[4]?+m[4]:now.getUTCFullYear();
    let month=m[2]?+m[2]:m[5]?+m[5]:null;
    if(!m[1]&&!m[4]){month=now.getUTCMonth()+1;if(["上个月","上月"].includes(m[0]))month--;if(month===0){month=12;year--;}}
    const date=m[3]?+m[3]:m[6]?+m[6]:null;
    if(month!==null&&(month<1||month>12))return null;
    start=new Date(Date.UTC(year,(month||1)-1,date||1));
    end=date?start:month?new Date(Date.UTC(year,month,0)):new Date(Date.UTC(year,12,0));
    if(date&&start.getUTCDate()!==date)return null;
  }
  return {start:day(start),end:day(end),rest};
}
function intent(q:string):Plan|null {
  const span=period(q);if(!span&&!/最新|雨/.test(q))return null;
  let rest=(span?.rest||q).replace(/\s|[？?。，,！!]/g,"").replace(/^(?:请问|帮我查一下|查一下)/,"");
  const found=cities.filter(c=>rest.includes(c));if(found.length>1)return null;
  const city=found[0]||null;if(city)rest=rest.replace(city+"市","").replace(city,"");
  rest=rest.replace(/的|地铁|全年/g,"");
  let kind:string|null=null;
  if(/^(?:雨天对客流(?:量)?(?:有什么影响|影响(?:有多大|多大)?)|(?:下雨天|雨天)(?:和|与)(?:无雨天?|不下雨天?)(?:日均)?客流(?:量)?(?:对比|差多少))$/.test(rest))kind="rain_flow";
  else if(!span){const m=rest.match(/^最新(?:采集)?(?:时刻|快照)?(拥堵延迟指数|拥堵指数|平均车速|交通健康指数)(?:是多少|多少)?$/);kind=m?.[1]||null;}
  else if(/^(?:(?:日均|平均每日|平均每天|日平均)客流(?:量)?(?:是多少|多少|如何)?|客流(?:量)?(?:日均|日平均)(?:是多少|多少)?)$/.test(rest))kind="mean";
  else if(/^(?:(?:一共|共有|有|共)?(?:多少|几)(?:个?雨天|天是雨天|天下雨)|雨天(?:有)?(?:多少|几)天|下了(?:多少|几)天雨)$/.test(rest))kind="rain";
  else if(/^(?:(?:各城市|各城|城市)(?:日均)?客流(?:量)?排名(?:排)?(?:第几)?|(?:日均)?客流(?:量)?(?:排名第几|排第几))$/.test(rest))kind="rank";
  else if(span.start===span.end&&/^天气(?:情况|怎么样|如何)?$/.test(rest))kind="weather";
  return kind?{kind,city,start:span?.start||null,end:span?.end||null}:null;
}
function plan(q:string,history:any[]):Plan|null{
  const direct=intent(q);if(direct)return direct;
  let last:Plan|null=null;
  for(const h of [...history,{role:"user",content:q}]){
    if(h.role!=="user")continue;
    const next=intent(h.content);if(next){last=next;continue;}
    const follow=h.content.trim().match(/^(?:那|换成|换到)?(.{2,12}?)(?:呢|怎么样)?[？?]?$/);
    if(last&&follow){let value=follow[1].replace(/市$/,"");
      if(cities.includes(value)){last={...last,city:value};continue;}
      if(last.start&&/^\d{1,2}月(?:\d{1,2}[日号])?$/.test(value))value=last.start.slice(0,4)+"年"+value;
      const date=period(value);if(date&&!date.rest&&!metrics[last.kind]){last={...last,start:date.start,end:date.end};continue;}
    }last=null;
  }return last;
}
const reply=(answer:string,result:any={})=>({ok:true,domain:"data",engine:"verified",steps:result.rows?1:0,trace:result.rows?[{tool:"run_sql",ok:true,note:"只读查询云端历史数据"}]:[],answer,...result});
export async function dataAnswer(db:D1Database,q:string,history:any[]=[]):Promise<any|null>{
  const p=plan(q,history);
  if(!p){const span=period(q);const tables=[/客流|客运量|乘车人次/.test(q)?"flow":null,/天气|雨|降水|气温|风力/.test(q)?"weather":null,/拥堵|畅通|车速|健康指数/.test(q)?"congestion":null].filter(Boolean) as string[];
    if(span&&tables.length===1){const table=tables[0],field=table==="congestion"?"ts":"stat_date";const test=await query(db,`SELECT 1 FROM ${table} WHERE substr(${field},1,10) BETWEEN ? AND ? LIMIT 1`,[span.start,span.end]);if(!test.rows.length)return reply(`${span.start} 至 ${span.end} 没有对应记录。当前是历史快照，客流为 2024年8—12月与2026年3月两段，交通指数截止2026-03-24，南京天气截止2026-04-01。`);}
    return null;
  }
  const {kind,city,start,end}=p;
  if(!city&&(kind!=="rank"||q.includes("第几")))return reply("想查哪个城市？可以补充完整问句，也可以回复“南京呢”。");
  let result:any;
  if(metrics[kind]){
    const [column,unit]=metrics[kind];result=await query(db,`SELECT city AS 城市,ts AS 采集时刻,${column} AS 指标值 FROM congestion WHERE ts=(SELECT MAX(ts) FROM congestion) AND city=?`,[city]);
    return reply(result.rows.length?`库内最新快照采集于 ${result.rows[0][1]}。${city}的${kind}为 ${result.rows[0][2]}${unit}。`:`库内最近一次交通快照没有${city}的有效记录。`,result);
  }
  if(kind==="rain_flow"){
    const filter=start?"f.stat_date BETWEEN ? AND ?":"f.source=(SELECT source FROM flow WHERE city=? GROUP BY source ORDER BY COUNT(*) DESC,source LIMIT 1)";
    result=await query(db,`SELECT f.source AS 来源,CASE WHEN w.precipitation_mm>=1 THEN '雨日' ELSE '非雨日' END AS 分组,COUNT(*) AS 配对天数,AVG(f.ridership) AS 日均万人次,MIN(f.stat_date) AS 起始日,MAX(f.stat_date) AS 截止日 FROM flow f JOIN weather w ON f.city=w.city AND f.stat_date=w.stat_date WHERE f.city=? AND w.precipitation_mm IS NOT NULL AND ${filter} GROUP BY f.source,分组 ORDER BY f.source,分组`,start?[city,start,end]:[city,city]);
    if(!result.rows.length)return reply(`${city}没有同城同日的客流与降水配对观测，无法比较。`,result);
    let text="";for(const source of new Set(result.rows.map((r:any)=>r[0]))){const group=result.rows.filter((r:any)=>r[0]===source);text+=`${city}（${source}）：`+group.map((r:any)=>`${r[1]} ${r[2]} 天、日均 ${Number(r[3]).toFixed(1)} 万人次`).join("；")+"。";const a=group.find((r:any)=>r[1]==="雨日"),b=group.find((r:any)=>r[1]==="非雨日");text+=a&&b?`雨日减非雨日的日均差额为 ${(a[3]-b[3]).toFixed(1)} 万人次。`:"另一组缺少样本，无法计算差额。";}
    return reply(text+"雨日按日降水量 ≥ 1 毫米划分。同期差异不能单独证明降雨造成客流变化。",result);
  }
  if(kind==="rain")result=await query(db,"SELECT COUNT(precipitation_mm) AS 有效天数,SUM(precipitation_mm>=1) AS 雨天数 FROM weather WHERE city=? AND stat_date BETWEEN ? AND ?",[city,start,end]);
  else if(kind==="weather")result=await query(db,"SELECT weather_type AS 天气,temp_low AS 最低温,temp_high AS 最高温,precipitation_mm AS 降水毫米 FROM weather WHERE city=? AND stat_date=?",[city,start]);
  else if(kind==="mean")result=await query(db,"SELECT source AS 来源,MIN(stat_date) AS 起始日,MAX(stat_date) AS 截止日,COUNT(DISTINCT stat_date) AS 样本天数,ROUND(AVG(ridership),1) AS 日均万人次 FROM flow WHERE city=? AND stat_date BETWEEN ? AND ? GROUP BY source ORDER BY 起始日",[city,start,end]);
  else result=await query(db,"SELECT source AS 来源,city AS 城市,RANK() OVER(PARTITION BY source ORDER BY AVG(ridership) DESC) AS 名次,ROUND(AVG(ridership),1) AS 日均万人次,COUNT(DISTINCT stat_date) AS 样本天数,COUNT(*) OVER(PARTITION BY source) AS 参与城市数 FROM flow WHERE stat_date BETWEEN ? AND ? GROUP BY source,city ORDER BY 来源,名次,城市",[start,end]);
  if(!result.rows.length||(kind==="rain"&&!result.rows[0][0]))return reply(kind==="rain"||kind==="weather"?`未查到${city}的有效天气记录，天气表当前仅收录南京。`:`${start} 至 ${end} 未查到${city||""}的有效客流记录。`,result);
  let text="";
  if(kind==="rain")text=`${start} 至 ${end}，${city}有 ${result.rows[0][0]} 天有效降水记录，其中 ${result.rows[0][1]} 天为雨天（日降水量 ≥ 1 毫米）。`;
  else if(kind==="weather"){const r=result.rows[0];text=`${start}，${city}天气为${r[0]??"缺测"}，气温 ${r[1]??"缺测"}～${r[2]??"缺测"} ℃，降水量 ${r[3]??"缺测"} 毫米。`;}
  else if(kind==="mean")text=`${city}在 ${start} 至 ${end} 的日均地铁客流按来源计算。`+result.rows.map((r:any)=>`${r[0]} 实际记录覆盖 ${r[1]} 至 ${r[2]}，共 ${r[3]} 天，日均 ${Number(r[4]).toFixed(1)} 万人次。`).join(" ");
  else{const focus=result.rows.filter((r:any)=>city?r[1]===city:r[2]===1);text=`${start} 至 ${end} 按实际观测日的日均客流排名。`+focus.map((r:any)=>`${r[1]}在 ${r[5]} 个有数据的城市中排第 ${r[2]}，日均 ${r[3]} 万人次，样本 ${r[4]} 天（${r[0]}）。`).join(" ");if(!focus.length)text+=`${city}未出现在该时段样本中。`;
    if(new Set(result.rows.map((r:any)=>r[0])).size===1)result.chart={tooltip:{trigger:"axis"},grid:{left:90,right:35,bottom:45,top:15},yAxis:{type:"category",data:result.rows.map((r:any)=>r[1]).reverse()},xAxis:{type:"value",name:"日均万人次"},series:[{type:"bar",data:result.rows.map((r:any)=>r[3]).reverse(),itemStyle:{color:"#79e2c3"}}]};}
  return reply(text,result);
}
