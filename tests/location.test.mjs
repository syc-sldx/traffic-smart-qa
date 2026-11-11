import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveLocation,coordinate} from '../server/location.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('GPS is converted before city lookup and direct-admin city arrays are normalized',async()=>{
  const calls=[];const request=async url=>{calls.push(url);return Response.json(calls.length===1?{status:'1',locations:'121.400100,31.200100'}:{status:'1',regeocode:{addressComponent:{province:'上海市',city:[],district:'徐汇区'}}});};
  const r=await resolveLocation({AMAP_API_KEY:'fixture-key'},{latitude:31.2,longitude:121.4,accuracy:40},request);assert.equal(r.city,'上海');assert.equal(r.coordinate_system,'gcj02');assert.equal(r.route_usable,true);assert.equal(calls[0].searchParams.get('coordsys'),'gps');assert.equal(calls[1].searchParams.get('location'),'121.400100,31.200100');assert.ok(!('formatted_address' in r));
  await assert.rejects(resolveLocation({AMAP_API_KEY:'fixture-key'},{latitude:999,longitude:118,accuracy:2},request),{status:400});assert.equal(calls.length,2);assert.throws(()=>coordinate('118,32|1,2'),{status:400});assert.throws(()=>coordinate('181,32'),{status:400});
});

const source=await readFile('public/location.js','utf8');
function client(agent='Browser'){
  let position,error,requested=0,network=0,now=100000,precision=30;
  const nodes=Object.fromEntries(['locate','location-origin','location-clear','location-status','city','origin','destination','action','transport'].map(id=>[id,{value:'',hidden:true,disabled:false,textContent:'',dispatchEvent(){},focus(){}}]));nodes.transport.value='transit';
  const window={isSecureContext:true,TrafficChat:{setMode(){}},addEventListener(){}};
  vm.runInNewContext(source,{window,document:{getElementById:id=>nodes[id]},navigator:{userAgent:agent,geolocation:{getCurrentPosition(success,fail){requested++;position=success;error=fail;}}},Event,Date:{now:()=>now},fetch:async()=>{network++;return Response.json({ok:true,city:'南京',district:'雨花台区',accuracy:precision,located_at:now,location:'118.797000,31.968000',route_usable:precision<=1500});}});
  return {nodes,window,requested:()=>requested,network:()=>network,position:()=>position({coords:{latitude:31.96,longitude:118.79,accuracy:precision}}),deny:()=>error({code:1}),age(){now+=600001;},precision(value){precision=value;}};
}
test('location starts only on click, fills city and uses an ephemeral route origin',async()=>{
  const h=client();assert.equal(h.requested(),0);const action=h.nodes.locate.onclick();assert.equal(h.requested(),1);h.position();await action;assert.equal(h.nodes.city.value,'南京');assert.equal(h.nodes['location-origin'].hidden,false);
  h.nodes['location-origin'].onclick();assert.equal(h.nodes.action.value,'route');assert.equal(h.window.TrafficLocation.details().origin_location,'118.797000,31.968000');h.age();assert.equal(Object.keys(h.window.TrafficLocation.details()).length,0);
});
test('denied and cancelled location never produce a route point; old APKs request an update',async()=>{
  const h=client();const pending=h.nodes.locate.onclick();h.deny();await pending;assert.match(h.nodes['location-status'].textContent,/权限/);assert.equal(h.network(),0);
  const next=h.nodes.locate.onclick();h.window.TrafficLocation.clear();h.position();await next;assert.equal(h.network(),0);
  const old=client('TrafficQAAndroid/1.0.0');await old.nodes.locate.onclick();assert.equal(old.requested(),0);assert.match(old.nodes['location-status'].textContent,/1\.1\.0/);
});
