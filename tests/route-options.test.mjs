import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
await build({entryPoints:['server/travel.ts'],bundle:true,platform:'node',format:'esm',target:'node24',outfile:'outputs/route-options-test-support.mjs'});
const {travelAnswer}=await import('../outputs/route-options-test-support.mjs');
const details={city:'南京',origin:'当前位置',destination:'新街口',transport:'transit',origin_location:'118.802063,31.966917'};
async function answer(paths,transport='transit'){
  const request=async url=>url.pathname.endsWith('/geo')?Response.json({status:'1',geocodes:[{level:'兴趣点',location:'118.784123,32.041234',formatted_address:'新街口'}]}):Response.json({status:'1',route:{[transport==='transit'?'transits':'paths']:paths}});
  const result=await travelAnswer({AMAP_API_KEY:'fixture-only-key'},'路线',[],{...details,transport},request);
  assert.ok(!result.unavailable,result.answer);return result;
}
test('route cards distinguish explicit zero fares from missing and invalid provider metrics',async()=>{
  const result=await answer([{distance:'1250',duration:'90',cost:'0',walking_distance:'0',segments:[]},{distance:[],duration:'',cost:[],walking_distance:null,segments:[]},{distance:'-2',duration:true,cost:'not known',walking_distance:{},segments:[]}]);
  assert.equal(result.route_options.length,3);assert.equal(result.route_options[0].distance_km,1.25);assert.equal(result.route_options[0].duration_minutes,1.5);assert.equal(result.route_options[0].fare_yuan,0);assert.equal(result.route_options[0].walking_meters,0);
  for(const option of result.route_options.slice(1))for(const key of ['distance_km','duration_minutes','fare_yuan','walking_meters'])assert.equal(option[key],null,key);
  assert.equal(result.columns[0],'方案');assert.equal(result.rows.length,3);assert.equal(result.rows[0][1],1.3);
});
test('bus alternatives stay on one ride step and railway and walking instructions preserve order',async()=>{
  const result=await answer([{distance:'20000',duration:'3600',cost:'8.50',walking_distance:'300',polyline:'SECRET-POLYLINE',segments:[
    {walking:{distance:'300',steps:[{instruction:'沿道路向东步行',polyline:'SECRET-POLYLINE',start_location:'118.123456,32.123456'}]},bus:{buslines:[
      {name:'1号线',departure_stop:{name:'南京南站',location:'118.123456,32.123456'},arrival_stop:{name:'新街口'},via_num:'8',distance:'10000'},
      {name:'替代线路',departure_stop:{name:'南京南站'},arrival_stop:{name:'新街口'}},
      {name:'替代线路'}]}},
    {railway:{name:'城际列车',departure_stop:{name:'南京站'},arrival_stop:{name:'苏州站'},distance:'9000',location:'118.123456,32.123456'}}]}]);
  const option=result.route_options[0];assert.equal(option.fare_yuan,8.5);assert.deepEqual(option.steps.map(s=>s.kind),['walk','ride','rail']);
  assert.equal(option.steps[0].instruction,'沿道路向东步行');assert.equal(option.steps[1].line,'1号线');assert.deepEqual(option.steps[1].alternative_lines,['替代线路']);assert.equal(option.steps[1].via_stops,8);assert.equal(option.steps[1].stops,undefined);assert.equal(option.steps[2].destination,'苏州站');
  assert.match(result.rows[0][3],/1号线（南京南站 → 新街口） \/ 替代线路/);assert.match(result.rows[0][3],/同段可选/);assert.doesNotMatch(result.rows[0][3],/1号线（南京南站 → 新街口） → 替代线路/);
  const serialized=JSON.stringify(result.route_options);assert.ok(!serialized.includes('118.123456'));assert.ok(!serialized.includes('SECRET-POLYLINE'));assert.ok(!serialized.includes('fixture-only-key'));
});
test('walking and driving use actual instructions, keep unknown costs and cap long routes',async()=>{
  for(const mode of ['walking','driving']){
    const result=await answer(Array.from({length:4},()=>({distance:'500',duration:'120',tolls:'12',steps:Array.from({length:70},(_,i)=>({instruction:'沿路前行第'+i+'段',distance:'10',polyline:'DO-NOT-SAVE'}))})),mode);
    assert.equal(result.route_options.length,3);
    for(const option of result.route_options){assert.equal(option.steps.length,60);assert.equal(option.steps_truncated,true);assert.equal(option.steps[0].kind,mode==='walking'?'walk':'drive');assert.equal(option.steps[59].instruction,'沿路前行第59段');assert.equal(option.fare_yuan,null);assert.equal(option.walking_meters,mode==='walking'?500:null);}
  }
});
test('missing transit details yield an empty step list without invented route instructions',async()=>{
  const result=await answer([{segments:[{walking:{distance:'0'},bus:{buslines:[{}]},railway:{}}]}]);
  assert.deepEqual(result.route_options[0].steps,[]);assert.equal(result.route_options[0].fare_yuan,null);assert.equal(result.route_options[0].duration_minutes,null);assert.equal(result.route_options[0].steps_truncated,undefined);
});
test('walking and driving normalize old metro contexts while unknown actions stay rejected',async()=>{
  for(const transport of ['walking','driving']){
    let routePath;
    const request=async url=>{
      if(url.pathname.endsWith('/geo'))return Response.json({status:'1',geocodes:[{level:'兴趣点',location:'118.784123,32.041234'}]});
      routePath=url.pathname;return Response.json({status:'1',route:{paths:[{distance:'500',duration:'100',steps:[{instruction:'沿道路前行'}]}]}});
    };
    const result=await travelAnswer({AMAP_API_KEY:'fixture-only-key'},transport==='walking'?'改成步行':'改成驾车',[],{...details,action:'metro',transport},request);
    assert.equal(result.slots.action,'route');assert.equal(result.unavailable,undefined);assert.ok(routePath.endsWith('/'+transport));assert.equal(result.route_options[0].steps[0].kind,transport==='walking'?'walk':'drive');
  }
  let requested=false;
  const rejected=await travelAnswer({AMAP_API_KEY:'fixture-only-key'},'路线',[],{...details,action:'unknown',transport:'walking'},async()=>{requested=true;throw Error('must not request');});
  assert.equal(requested,false);assert.equal(rejected.slots.action,'unknown');assert.match(rejected.answer,/请选择路线规划或道路路况/);
});
