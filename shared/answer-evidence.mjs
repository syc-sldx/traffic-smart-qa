// Describes the time meaning of returned evidence; never infers dates from prose.
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const bounded=value=>Object.fromEntries(Object.entries(value).filter(([,v])=>typeof v==='string'&&v).map(([key,value])=>[key,value.slice(0,key==='note'?240:key==='date_value'?160:48)]));
const yearly=new Set(['year','年份','年度','统计年份']);
const dates=new Set(['date','stat_date','ts','日期','统计日期','观测日期','采集日期','采集时刻','采集时间','统计时刻','统计时间','统计时点','起始日','截止日','起始日期','截止日期','开始日期','结束日期','最早日期','最晚日期']);
const moments=new Set(['ts','采集时刻','采集时间','统计时刻','统计时间']);
const annualValues=new Set(['value','normalized_value','数值','指标值','原始数值','统一数值']);
const periods=new Set(['全年','年末']);

function columnName(value){
  if(typeof value!=='string'||value.length>100)return '';
  let name=value.normalize('NFKC').trim().toLowerCase();
  const aggregate=name.match(/^(?:min|max)\(\s*(?:[a-z_]\w*\.)?(date|stat_date|ts|year)\s*\)$/);
  if(aggregate)return aggregate[1];
  const qualified=name.match(/^[a-z_]\w*\.(date|stat_date|ts|year)$/);
  return qualified?qualified[1]:name;
}
function year(value){
  const raw=typeof value==='number'&&Number.isInteger(value)?String(value):typeof value==='string'?value.trim():'';
  return /^[1-9]\d{3}$/.test(raw)?Number(raw):null;
}
function iso(value,{time=false,zone=false}={}){
  if(typeof value!=='string'||value.length>64)return null;
  const raw=value.trim(),m=raw.match(/^([1-9]\d{3})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?)?$/);
  if(!m||time&&!m[4]||zone&&!m[8])return null;
  const y=Number(m[1]),month=Number(m[2]),day=Number(m[3]),leap=y%4===0&&(y%100!==0||y%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(month<1||month>12||day<1||day>days[month-1])return null;
  if(m[4]&&(Number(m[4])>23||Number(m[5])>59||Number(m[6]||0)>59))return null;
  if(m[8]&&m[8]!=='Z'){const h=Number(m[8].slice(1,3)),min=Number(m[8].slice(4));if(h>14||min>59||h===14&&min!==0)return null;}
  return {date:raw.slice(0,10),display:raw.replace('T',' ').replace(/Z$/,' UTC'),hasTime:!!m[4]};
}
function table(result){
  if(!Array.isArray(result.columns)||!Array.isArray(result.rows))return {columns:[],rows:[]};
  return {columns:result.columns.slice(0,100).map(columnName),rows:result.rows.slice(0,2000).filter(Array.isArray)};
}
function yearRange(values){
  const list=[...new Set(values)].sort((a,b)=>a-b);
  return list.length?{value:list.length===1?list[0]+'年':list[0]+'—'+list.at(-1)+'年',multiple:list.length>1}:null;
}
function annual(result){
  const {columns,rows}=table(result),yearIndex=columns.findIndex(c=>yearly.has(c));
  const valueIndices=columns.flatMap((c,i)=>annualValues.has(c)?[i]:[]),hasValues=valueIndices.length>0;
  const relevant=hasValues?rows.filter(row=>valueIndices.some(i=>typeof row[i]==='number'&&Number.isFinite(row[i]))):rows;
  const range=yearRange(yearIndex<0?[]:relevant.map(row=>year(row[yearIndex])).filter(v=>v!==null));
  if(!range)return bounded({kind:'annual',label:'年度资料',date_label:'统计期',date_value:'未提供',note:'当前结果未提供可核实的统计年份；不从问题或答案推定统计期。'});
  const periodIndex=columns.findIndex(c=>c==='统计时点'||c==='period');
  const kinds=periodIndex<0?[]:[...new Set(relevant.map(row=>row[periodIndex]).filter(value=>periods.has(value)))].sort();
  const notes=[];if(!hasValues)notes.push('这是资料年份，不能据此认定已取得年度数值。');
  if(range.multiple)notes.push('年份范围仅反映已返回记录，不保证逐年完整覆盖。');
  if(kinds.length>1)notes.push('全年与年末口径不同，应分开比较。');
  if(!notes.length)notes.push('统计期以原始资料为准，不代表当前交通状态。');
  return bounded({kind:'annual',label:hasValues?'年度统计':'年度资料',date_label:hasValues?'统计期':'资料年份',date_value:range.value+(kinds.length?' · '+kinds.join(' / '):''),note:notes.join('')});
}
function historical(result){
  const {columns,rows}=table(result),found=[],years=[];
  for(let i=0;i<columns.length;i++)for(const row of rows){
    if(yearly.has(columns[i])){const y=year(row[i]);if(y!==null)years.push(y);}
    else if(dates.has(columns[i])){const value=iso(row[i]);if(value)found.push({...value,moment:moments.has(columns[i])});}
  }
  if(found.length){
    const unique=[...new Map(found.map(v=>[v.display,v])).values()],days=[...new Set(found.map(v=>v.date))].sort();
    if(unique.length===1)return bounded({kind:'historical',label:'历史数据',date_label:unique[0].moment&&unique[0].hasTime?'采集时刻':'数据日期',date_value:unique[0].display,note:'来自库内历史记录，不代表当前实时状态。'});
    return bounded({kind:'historical',label:'历史数据',date_label:'记录覆盖',date_value:days.length===1?days[0]:days[0]+' 至 '+days.at(-1),note:'范围只反映已返回记录，不保证连续观测；具体时刻及各来源时区以明细为准。'});
  }
  const range=yearRange(years);
  return bounded({kind:'historical',label:'历史数据',date_label:range?'记录年份':'数据日期',date_value:range?.value||'未提供',note:range?(range.multiple?'年份范围不保证连续覆盖，历史结果不代表当前实时状态。':'来自库内历史记录，不代表当前实时状态。'):'结果未返回明确日期列，不能将查询时间或回答中的日期当作观测日期。'});
}

export function answerEvidence(input){
  const result=record(input)?input:{};
  if(result.needs_input===true)return bounded({kind:'needs_input',label:'待补充条件',note:'补全查询条件后再核实结果。'});
  if(result.ok===false||result.unavailable===true)return bounded({kind:'unavailable',label:'查询未完成',note:'本次未取得可用结果，不能作为实时路线或路况依据。'});
  if(result.ok!==true)return bounded({kind:'unknown',label:'结果状态未确认',note:'尚未提供可核实的数据状态或日期。'});
  if(result.engine==='memory')return bounded({kind:'memory',label:'个人记忆',note:'用户保存的偏好与历史上下文，不作为当前交通事实。'});
  if(result.engine==='annual')return annual(result);
  if(result.engine==='metro'){
    const retrieved=iso(result.retrieved_at);
    return bounded({kind:'metro_snapshot',label:'静态地铁线网',date_label:'线网抓取日期',date_value:retrieved?.date||'未提供',note:'抓取日期不等于运营方更新时间；不反映临时停运、班次或实时运营状态。'});
  }
  if(result.engine==='travel'){
    if(result.steps===0&&!result.rows?.length&&!result.route_options?.length)return bounded({kind:'unavailable',label:'未取得地图结果',note:'当前结果未提供成功的地图查询记录，不能作为实时路线或路况依据。'});
    const queried=iso(result.queried_at,{time:true,zone:true}),traffic=result.slots?.action==='traffic';
    return bounded({kind:traffic?'traffic_query':'map_estimate',label:traffic?'本次路况查询':'本次路线估计',date_label:'查询时间',date_value:queried?.display||'未提供',note:traffic?'查询时间不等于供应商观测时间，未提供观测时刻时不推测路况更新时间。':'距离与预计耗时为本次地图接口估计；查询时间不是实际出发、到达或发车时间。'});
  }
  if(result.engine==='knowledge'||result.domain==='knowledge')return bounded({kind:'knowledge',label:'知识资料',date_label:'资料日期',date_value:'未提供',note:'依据已收录资料回答，不据此认定政策法规当前有效。'});
  if(result.domain==='data'||['verified','model'].includes(result.engine))return historical(result);
  return bounded({kind:'unknown',label:'问答结果',date_label:'数据日期',date_value:'未提供',note:'当前结果没有明确的结构化数据日期。'});
}

export function annotateAnswer(input){
  const result=record(input)?input:{};
  return {...result,evidence:answerEvidence(result)};
}
