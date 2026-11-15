import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile('public/favorites-store.js','utf8');
const route={city:' 南京市 ',origin:' 南京南站 ',destination:'新街口',transport:'transit',action:'metro',origin_id:'start',destination_id:'end'};
function fixture(){
  const values=new Map(),storage={get length(){return values.size;},key:i=>[...values.keys()][i],getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const window={};vm.runInNewContext(source,{window,localStorage:storage});let id=0,time=100;
  return {values,storage,create:()=>window.TrafficFavorites.create(storage,()=>String(++id),()=>++time)};
}
test('favorite query conditions survive reload, normalize duplicates and soft-remove/restore',()=>{
  const h=fixture(),store=h.create(),first=store.add(route);assert.equal(first.route.city,'南京');assert.equal(first.route.origin,'南京南站');
  assert.equal(store.add({...route,city:'南京'}).id,first.id);assert.equal(h.create().list()[0].id,first.id);assert.equal(h.create().find(route).id,first.id);
  store.remove(first.id);assert.equal(store.list().length,0);assert.equal(store.list(true)[0].id,first.id);assert.equal(store.find(route),null);
  store.restore(first.id);assert.equal(store.list()[0].id,first.id);store.remove(first.id);assert.equal(store.add(route).id,first.id);assert.equal(store.list(true).length,0);
});
test('favorites store only route fields, exclude GPS and never depend on history recording',()=>{
  const h=fixture();h.values.set('trafficqa:local:v1:settings','{"save":false}');
  const record=h.create().add({...route,origin_location:'118.123,32.456',trace:['secret'],answer:'old result',token:'secret',resolved_addresses:{origin:'private'}});
  const raw=[...h.values.entries()].find(([key])=>key.startsWith('trafficqa:favorites:'))[1];assert.ok(!raw.includes('118.123'));assert.ok(!raw.includes('secret'));assert.ok(!raw.includes('old result'));assert.ok(!raw.includes('private'));
  assert.equal(record.route.origin_id,'start');const walking=h.create().add({...route,action:'route',transport:'walking',strategy:'3'});assert.equal(walking.route.origin_id,undefined);assert.equal(walking.route.strategy,undefined);
  for(const value of ['当前位置','我的位置','当前位置（本次定位）','118.123,32.456'])assert.throws(()=>h.create().add({...route,origin:value}),/固定站点/);
  assert.throws(()=>h.create().add({...route,destination:'我的位置'}),/固定站点/);
});
test('quota and format failures leave all existing favorites unchanged',()=>{
  const h=fixture(),store=h.create(),first=store.add(route),before=JSON.stringify([...h.values]);
  h.storage.setItem=()=>{throw Error('quota');};assert.throws(()=>store.remove(first.id),/已有收藏仍保留/);assert.equal(JSON.stringify([...h.values]),before);assert.equal(store.list().length,1);
  h.values.set('trafficqa:favorites:v1:route:future',JSON.stringify({schema:99,id:'future'}));const future=JSON.stringify([...h.values]);assert.throws(()=>store.add({...route,destination:'夫子庙'}),/格式异常/);assert.equal(JSON.stringify([...h.values]),future);assert.throws(()=>store.list(),/格式异常/);
});
test('favorites reject invalid parameters and enforce the total including removed routes',()=>{
  const h=fixture(),store=h.create();for(const bad of [null,[],{}, {...route,transport:'plane'}, {...route,action:'traffic'}, {...route,city:'x'.repeat(51)}, {...route,origin:'x'.repeat(201)}, {...route,strategy:'9'}])assert.throws(()=>store.add(bad));
  for(let i=0;i<100;i++){const item=store.add({...route,destination:'站'+i});if(i===0)store.remove(item.id);}
  const before=JSON.stringify([...h.values]);assert.throws(()=>store.add({...route,destination:'超出数量'}),/100条/);assert.equal(JSON.stringify([...h.values]),before);assert.equal(store.list().length,99);assert.equal(store.list(true).length,1);
});
test('blocked localStorage does not interrupt initialization and reports an actionable error',()=>{
  const context={window:{}};Object.defineProperty(context,'localStorage',{get(){throw Error('blocked');}});vm.runInNewContext(source,context);
  assert.ok(context.window.TrafficFavorites);assert.throws(()=>context.window.TrafficFavorites.store.list(),/存储权限/);assert.throws(()=>context.window.TrafficFavorites.store.add(route),/存储权限/);
});
