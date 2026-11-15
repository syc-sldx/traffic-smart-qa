import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {resolveTravel} from '../shared/travel-context.mjs';
await build({entryPoints:['server/metro.ts'],bundle:true,platform:'node',format:'esm',target:'node24',outfile:'outputs/station-choice-test-support.mjs'});
const {metroAnswer,findMetroStations,planMetro}=await import('../outputs/station-choice-test-support.mjs');
const query='上海虹桥火车站怎么去国家会展中心站';

test('same-named platforms are selectable by verified station IDs and routes retain those IDs',()=>{
  const ambiguous=metroAnswer(query);assert.equal(ambiguous.needs_input,true);assert.equal(ambiguous.clarification.field,'destination');assert.equal(ambiguous.clarification.options.length,2);
  const ids=new Set();for(const option of ambiguous.clarification.options){
    ids.add(option.travel.destination_id);assert.ok(option.description);assert.equal(option.travel.action,'metro');
    const result=metroAnswer(ambiguous.clarification.question,[],option.travel);
    assert.ok(result.metro_route);assert.equal(result.metro_route.destination_id,option.travel.destination_id);assert.equal(result.slots.destination_id,option.travel.destination_id);
    assert.equal(result.metro_route.origin_id,findMetroStations('上海','虹桥火车站')[0].id);
  }
  assert.equal(ids.size,2);
  const same=findMetroStations('南京','南京南站')[0],route=planMetro('南京',same.id,same.id);assert.equal(route.origin_id,same.id);assert.equal(route.destination_id,same.id);
});

test('city and both endpoint choices can be completed in sequence without forgetting earlier choices',()=>{
  const q='国家会展中心站怎么去国家会展中心站',city=metroAnswer(q);assert.equal(city.clarification.field,'city');assert.deepEqual(city.clarification.options.map(o=>o.label).sort(),['上海','天津']);
  const shanghai=city.clarification.options.find(o=>o.label==='上海'),origin=metroAnswer(q,[],shanghai.travel);assert.equal(origin.clarification.field,'origin');
  const from=origin.clarification.options.find(o=>o.description==='17号线'),destination=metroAnswer(q,[],from.travel);assert.equal(destination.clarification.field,'destination');
  const to=destination.clarification.options.find(o=>o.description==='2号线');assert.equal(to.travel.origin_id,from.travel.origin_id);
  const route=metroAnswer(q,[],to.travel);assert.ok(route.metro_route.stops>0);assert.notEqual(route.metro_route.origin_id,route.metro_route.destination_id);
});

test('single station queries first clarify city and then return only the selected station lines',()=>{
  const q='国家会展中心站有几条线',city=metroAnswer(q);assert.equal(city.clarification.field,'city');
  const station=metroAnswer(q,[],city.clarification.options.find(o=>o.label==='上海').travel);assert.equal(station.clarification.field,'station');
  const selected=station.clarification.options.find(o=>o.description==='17号线'),result=metroAnswer(q,[],selected.travel);
  assert.equal(result.needs_input,undefined);assert.equal(result.rows[0][1],'17号线');assert.equal(result.slots.station_id,selected.travel.station_id);
});

test('forged, expired, cross-city and name-mismatched IDs require explicit reselection',()=>{
  const first=metroAnswer(query),valid=first.clarification.options[0].travel,nanjingId=findMetroStations('南京','新街口')[0].id;
  for(const destination_id of ['expired-station',nanjingId,valid.origin_id]){
    const result=metroAnswer(query,[],{...valid,destination_id,origin_location:'118,32'});assert.equal(result.needs_input,true);assert.ok(!result.metro_route);assert.equal(result.clarification.field,'destination');assert.equal(result.clarification.options.length,findMetroStations('上海',valid.destination).length);
    assert.ok(!JSON.stringify(result.slots).includes('origin_location'));assert.ok(!JSON.stringify(result.clarification).includes('118,32'));
  }
  const wrongName=metroAnswer('上海从人民广场站到虹桥火车站',[],{action:'metro',city:'上海',origin:'人民广场站',destination:'虹桥火车站',origin_id:valid.origin_id});assert.equal(wrongName.needs_input,true);assert.equal(wrongName.clarification.field,'origin');assert.equal(wrongName.clarification.options.length,1);
  const absent=metroAnswer('查地铁',[],{action:'metro',city:'上海',origin:'不存在的站',destination:'虹桥火车站',origin_id:valid.origin_id});assert.equal(absent.needs_input,true);assert.equal(absent.clarification.options.length,0);
  const single=metroAnswer('上海国家会展中心站有几条线',[],{action:'metro',city:'上海',station_id:nanjingId});assert.equal(single.needs_input,true);assert.equal(single.clarification.field,'station');
});

test('follow-ups keep unchanged selected endpoints but clear IDs when endpoints or city change',()=>{
  const chosen=metroAnswer(query).clarification.options.find(o=>o.description==='17号线').travel,context={...chosen,action:'route',contextual:'true'},history=[{role:'user',content:query},{role:'assistant',content:'路线结果'}],cities=['南京','上海'];
  const less=resolveTravel('少换乘一点',history,context,cities);assert.equal(less.origin_id,chosen.origin_id);assert.equal(less.destination_id,chosen.destination_id);assert.equal(metroAnswer('少换乘一点',history,less).metro_route.destination_id,chosen.destination_id);
  const walk=resolveTravel('改成步行',history,context,cities);assert.equal(walk.origin_id,chosen.origin_id);assert.equal(walk.destination_id,chosen.destination_id);assert.equal(walk.transport,'walking');
  const next=resolveTravel('终点改成国家会展中心(2号线)',history,context,cities);assert.equal(next.destination_id,undefined);assert.equal(next.origin_id,chosen.origin_id);
  const origin=resolveTravel('起点改成人民广场',history,context,cities);assert.equal(origin.origin_id,undefined);assert.equal(origin.destination_id,chosen.destination_id);
  const city=resolveTravel('终点改成南京新街口站',history,context,cities);assert.equal(city.origin_id,undefined);assert.equal(city.destination_id,undefined);
  assert.doesNotThrow(()=>resolveTravel('少换乘一点',[],{...context,city:'南京('},cities));
});
