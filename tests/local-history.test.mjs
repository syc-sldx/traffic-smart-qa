import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile('public/local-history.js','utf8');
function fixture(){
  const values=new Map(),storage={get length(){return values.size;},key:i=>[...values.keys()][i],getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const window={};vm.runInNewContext(source,{window,localStorage:storage});let id=0,time=100;
  return {values,storage,create:()=>window.TrafficLocalHistory.create(storage,()=>String(++id),()=>++time)};
}
test('local records survive reload, continue a thread, search, trash and restore independently',()=>{
  const h=fixture(),a=h.create(),first=a.append(null,'南京南站怎么去新街口',{ok:true,answer:'乘坐1号线'});
  const reload=h.create();reload.append(first.id,'少换乘一点',{ok:true,answer:'无需换乘'});
  const second=reload.append(null,'上海路线',{ok:true,answer:'方案'});
  assert.equal(reload.get(first.id).turns.length,2);assert.equal(reload.list('无需换乘')[0].id,first.id);
  reload.trash(first.id);assert.equal(reload.list().length,1);assert.equal(reload.list('',true)[0].id,first.id);
  assert.throws(()=>reload.append(first.id,'继续',{}),/移除/);reload.restore(first.id);
  assert.equal(reload.list().length,2);assert.equal(reload.get(second.id).turns.length,1);
});
test('local history omits GPS and request diagnostics and pausing preserves existing records',()=>{
  const h=fixture(),a=h.create(),record=a.append(null,'去新街口',{ok:true,answer:'路线',slots:{city:'南京',origin:'当前位置',origin_location:'118.123,32.123',destination:'新街口'},origin_location:'118.123,32.123',resolved_addresses:{origin:'门牌号'},trace:[{note:'secret'}]});
  const backup=a.backup();assert.ok(!backup.includes('118.123'));assert.ok(!backup.includes('门牌号'));assert.ok(!backup.includes('secret'));assert.equal(a.get(record.id).turns[0].reply.slots.origin,'当前位置');
  a.enabled(false);assert.equal(a.append(record.id,'不保存',{}),null);assert.equal(a.get(record.id).turns.length,1);assert.equal(h.create().enabled(),false);
  a.enabled(true);assert.ok(a.append(record.id,'继续保存',{}));
});
test('quota failures preserve old records, corrupt records are not replaced and clearing is scoped',()=>{
  const h=fixture(),a=h.create(),record=a.append(null,'第一轮',{ok:true,answer:'已保存'}),old=a.backup();
  h.storage.setItem=()=>{throw Error('QuotaExceededError');};assert.throws(()=>a.append(record.id,'第二轮',{}),/旧记录仍保留/);assert.equal(a.get(record.id).turns.length,1);
  assert.deepEqual(JSON.parse(a.backup()).records,JSON.parse(old).records);
  h.values.set('trafficqa:local:v1:thread:broken','{"schema":99,"turns":[]}');assert.throws(()=>a.list(),/格式异常/);assert.ok(a.backup().includes('broken'));
  h.values.set('other-app','keep');h.values.set('trafficqa:local:v1:settings','{"save":false}');a.clear();assert.equal(a.count(),0);assert.equal(h.values.get('other-app'),'keep');assert.equal(a.enabled(),false);
});
test('blocked localStorage does not break script initialization and gives a readable error',()=>{
  const context={window:{}};Object.defineProperty(context,'localStorage',{get(){throw Error('blocked');}});
  vm.runInNewContext(source,context);assert.ok(context.window.TrafficLocalHistory);assert.throws(()=>context.window.TrafficLocalHistory.store.list(),/未允许本机存储/);
});
test('saved route cards and clarification choices survive reload without retaining GPS fields',()=>{
  const h=fixture(),a=h.create(),thread=a.append(null,'上海国家会展中心站',{
    ok:true,answer:'请选择车站',clarification:{field:'station',question:'上海国家会展中心站',options:[{label:'国家会展中心',description:'17号线',travel:{city:'上海',action:'metro',station_id:'fixture-station'}}]},
    route_options:[{id:'1',fare_yuan:0,steps:[{kind:'ride',line:'示例线路'}]}],retrieved_at:'2026-11-10',slots:{city:'上海',station_id:'fixture-station',origin_location:'121,31'}
  });
  const reply=h.create().get(thread.id).turns[0].reply;assert.equal(reply.route_options[0].fare_yuan,0);assert.equal(reply.clarification.options[0].travel.station_id,'fixture-station');assert.equal(reply.slots.station_id,'fixture-station');assert.ok(!('origin_location' in reply.slots));assert.equal(reply.retrieved_at,'2026-11-10');
});
