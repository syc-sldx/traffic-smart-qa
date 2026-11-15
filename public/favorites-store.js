(()=>{
  'use strict';
  const prefix='trafficqa:favorites:v1:route:',limit=100,maxSize=200000;
  const fields=['city','origin','destination','transport','action','strategy','origin_id','destination_id'];
  const malformed=()=>Error('本机路线收藏格式异常，已有记录不会被覆盖。');
  function text(value,label,max=200){
    if(typeof value!=='string')throw Error('请补充'+label+'后再收藏路线。');
    const result=value.trim().replace(/\s+/g,' ');
    if(!result||result.length>max)throw Error(label+'不能为空，且不能超过'+max+'个字符。');
    return result;
  }
  function normalize(slots){
    if(!slots||typeof slots!=='object'||Array.isArray(slots))throw Error('请先查询一条有效路线后再收藏。');
    const city=text(slots.city,'城市',50).replace(/市$/,''),origin=text(slots.origin,'起点'),destination=text(slots.destination,'终点');
    if(!city)throw Error('请补充城市后再收藏路线。');
    const moving=value=>/^(?:当前位置|我的位置|本次定位|当前定位|gps|current\s*location)(?:[（(].*[）)])?$/i.test(value)||/^[+-]?\d+(?:\.\d+)?\s*[,，]\s*[+-]?\d+(?:\.\d+)?$/.test(value);
    if(moving(origin)||moving(destination))throw Error('请填写固定站点或地址后再收藏；设备定位坐标不会保存到收藏。');
    const transport=text(slots.transport,'出行方式',20),action=text(slots.action,'查询类型',20);
    if(!['transit','driving','walking'].includes(transport)||!['route','metro'].includes(action)||action==='metro'&&transport!=='transit')throw Error('请使用公交地铁、驾车或步行路线收藏。');
    const route={city,origin,destination,transport,action};
    if(transport==='transit'){
      if(slots.strategy!==undefined&&slots.strategy!==''){
        const strategy=text(slots.strategy,'路线偏好',10);if(!['0','1','2','3'].includes(strategy))throw Error('路线偏好不正确，请重新查询后收藏。');route.strategy=strategy;
      }
      for(const key of ['origin_id','destination_id'])if(slots[key]!==undefined&&slots[key]!=='')route[key]=text(slots[key],'站点标识');
    }
    return route;
  }
  const signature=route=>JSON.stringify(fields.map(key=>route[key]||''));
  function create(storage,makeId=()=>globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),now=()=>Date.now()){
    function stamp(){const value=new Date(now());if(!Number.isFinite(value.getTime()))throw Error('设备时间异常，暂时无法保存收藏。');return value.toISOString();}
    function read(){
      const rows=[];
      try{for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key?.startsWith(prefix))rows.push([key,storage.getItem(key)]);}}
      catch{throw Error('当前设备无法读取本机收藏，请检查浏览器存储权限。');}
      return rows.map(([key,raw])=>{
        let value;try{value=JSON.parse(raw);}catch{throw malformed();}
        if(!value||value.schema!==1||typeof value.id!=='string'||key!==prefix+value.id||typeof value.created_at!=='string'||!Number.isFinite(Date.parse(value.created_at))||typeof value.updated_at!=='string'||!Number.isFinite(Date.parse(value.updated_at))||value.deleted_at!=null&&(typeof value.deleted_at!=='string'||!Number.isFinite(Date.parse(value.deleted_at))))throw malformed();
        try{const route=normalize(value.route);if(Object.keys(value.route).some(k=>!fields.includes(k))||signature(route)!==signature(value.route))throw malformed();}catch{throw malformed();}
        return {key,raw,record:value};
      });
    }
    function save(record,rows){
      const key=prefix+record.id,raw=JSON.stringify(record),exists=rows.some(row=>row.key===key);
      if(!exists&&rows.length>=limit)throw Error('本机最多保存100条路线（含已移除），已有收藏仍保留。');
      if(rows.filter(row=>row.key!==key).reduce((sum,row)=>sum+row.key.length+row.raw.length,0)+key.length+raw.length>maxSize)throw Error('本机收藏空间已满，已有收藏仍保留。');
      try{storage.setItem(key,raw);}catch{throw Error('设备未允许保存或存储空间不足，本次未保存；已有收藏仍保留。');}
      return record;
    }
    function add(slots){
      const route=normalize(slots),rows=read(),old=rows.find(row=>signature(row.record.route)===signature(route))?.record;
      if(old&&!old.deleted_at)return old;
      const time=stamp();if(old)return save({...old,deleted_at:null,updated_at:time},rows);
      const id=String(makeId());if(!/^[\w-]{1,100}$/.test(id)||rows.some(row=>row.record.id===id))throw Error('暂时无法生成收藏编号，请重试。');
      return save({schema:1,id,route,created_at:time,updated_at:time,deleted_at:null},rows);
    }
    function move(id,removed){
      if(typeof id!=='string')throw Error('这条本机收藏不存在，请刷新后重试。');
      const rows=read(),old=rows.find(row=>row.record.id===id)?.record;if(!old)throw Error('这条本机收藏不存在，请刷新后重试。');
      if(!!old.deleted_at===removed)return old;
      const time=stamp();return save({...old,deleted_at:removed?time:null,updated_at:time},rows);
    }
    return {
      list(removed=false){return read().map(row=>row.record).filter(record=>!!record.deleted_at===!!removed).sort((a,b)=>Date.parse(b.updated_at)-Date.parse(a.updated_at));},
      add,
      find(slots){const route=normalize(slots);return read().find(row=>!row.record.deleted_at&&signature(row.record.route)===signature(route))?.record||null;},
      remove:id=>move(id,true),restore:id=>move(id,false)
    };
  }
  let storage;try{storage=localStorage;}catch{storage={get length(){throw Error('unavailable');}};}
  window.TrafficFavorites={create,store:create(storage)};
})();
