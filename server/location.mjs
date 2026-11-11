export function coordinate(value){
  if(typeof value!=='string'||!/^[-+]?\d{1,3}(?:\.\d{1,8})?,[-+]?\d{1,2}(?:\.\d{1,8})?$/.test(value))throw Object.assign(new Error('坐标格式不正确。'),{status:400});
  const [longitude,latitude]=value.split(',').map(Number);if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||Math.abs(longitude)>180||Math.abs(latitude)>90)throw Object.assign(new Error('坐标超出有效范围。'),{status:400});
  return {longitude,latitude,text:longitude.toFixed(6)+','+latitude.toFixed(6)};
}
export async function resolveLocation(env,body,request=fetch){
  const {latitude,longitude,accuracy}=body;
  if(typeof latitude!=='number'||typeof longitude!=='number'||typeof accuracy!=='number'||!Number.isFinite(latitude)||!Number.isFinite(longitude)||!Number.isFinite(accuracy)||Math.abs(latitude)>90||Math.abs(longitude)>180||accuracy<0||accuracy>200000)throw Object.assign(new Error('定位数据无效，请重新定位。'),{status:400});
  if(!env.AMAP_API_KEY)throw Object.assign(new Error('地图服务尚未配置，暂时不能解析定位城市。'),{status:503});
  async function call(path,params){
    const url=new URL('https://restapi.amap.com/v3/'+path);for(const [key,value]of Object.entries({...params,key:env.AMAP_API_KEY,output:'JSON'}))url.searchParams.set(key,String(value));
    let response;try{response=await request(url,{signal:AbortSignal.timeout(12000)});}catch{throw Object.assign(new Error('定位城市解析超时，请稍后重试。'),{status:502});}
    if(!response.ok)throw Object.assign(new Error('地图定位服务暂不可用。'),{status:502});
    const result=await response.json();if(String(result.status)!=='1')throw Object.assign(new Error('地图服务未能解析位置，请稍后重试或手动填写城市。'),{status:502});return result;
  }
  const converted=await call('assistant/coordinate/convert',{locations:longitude.toFixed(6)+','+latitude.toFixed(6),coordsys:'gps'});
  const point=coordinate(String(converted.locations||''));
  const data=await call('geocode/regeo',{location:point.text,extensions:'base',radius:1000});
  const address=data.regeocode?.addressComponent||{},string=value=>typeof value==='string'?value:'';
  const province=string(address.province),city=string(address.city)||(/北京市|上海市|天津市|重庆市|特别行政区/.test(province)?province:string(address.district));
  if(!city)throw Object.assign(new Error('已取得位置，但未能识别城市，请手动填写城市。'),{status:422});
  return {ok:true,city:city.replace(/市$/,''),province,district:string(address.district),accuracy,coordinate_system:'gcj02',location:point.text,located_at:Date.now(),route_usable:accuracy<=1500,source:'高德坐标转换与逆地理编码'};
}
