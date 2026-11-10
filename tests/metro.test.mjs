import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
await build({entryPoints:["server/metro.ts"],bundle:true,platform:"node",format:"esm",target:"node24",outfile:"outputs/metro-test-support.mjs"});
const {metroCatalogue,metroNetwork,metroStations,findMetroStations,planMetro,metroAnswer,isMetroQuery}=await import("../outputs/metro-test-support.mjs");

test("all 101 source cities have explicit coverage and every imported city has searchable stations",()=>{
  const c=metroCatalogue();assert.equal(c.cities.length,101);assert.equal(c.summary.network_cities,48);
  assert.equal(c.summary.failed_downloads,0);assert.ok(c.summary.stations>6000);
  for(const city of c.cities){if(city.status==="available"){const n=metroNetwork(city.city);assert.ok(n.lines.length);assert.equal(metroStations(city.city).length,n.station_count);}else assert.ok(!metroNetwork(city.city));}
});
test("the user's Nanjing South to Xinjiekou wording resolves without a from-prefix or map/model key",()=>{
  for(const q of ["南京南站怎么去南京新街口站","南京南站到新街口站怎么走","从南京南站到新街口怎么坐地铁","南京从南京南站到新街口怎么走"]){const r=metroAnswer(q);assert.equal(r.engine,"metro",q);assert.equal(r.metro_route.transfers,0,q);assert.equal(r.metro_route.stops,8,q);assert.equal(r.metro_route.segments[0].line,"1号线");assert.match(r.metro_route.segments[0].direction,/八卦洲大桥南/);assert.ok(r.sources[0].url.startsWith("https://m.amap.com/"));}
});
test("canonical stop IDs merge true interchange platforms and preserve station suffix/city aliases",()=>{
  const a=findMetroStations("南京","南京南站"),b=findMetroStations("南京","南京南"),c=findMetroStations("南京","南京新街口站");
  assert.equal(a.length,1);assert.equal(a[0].id,b[0].id);assert.ok(a[0].lines.size>=4);assert.equal(c.length,1);
  const form=metroAnswer("南京从南京南站到新街口，地铁路线",[],{action:"metro",city:"南京",origin:"南京南站",destination:"新街口站",transport:"walking"});assert.equal(form.metro_route.stops,8);
});
test("genuinely separate same-named stops require clarification",()=>{
  assert.equal(findMetroStations("上海","国家会展中心").length,2);
  const r=metroAnswer("上海虹桥火车站怎么去国家会展中心站");assert.equal(r.needs_input,true);assert.equal(r.rows.length,2);assert.ok(!r.metro_route);
});
test("ring closure and a transfer route return connected, reproducible station steps",()=>{
  const a=findMetroStations("上海","宜山路")[0],b=findMetroStations("上海","上海体育馆")[0];const ring=planMetro("上海",a.id,b.id);assert.equal(ring.stops,1);assert.equal(ring.transfers,0);
  const r=metroAnswer("南京南站怎么去南京苜蓿园站");assert.ok(r.metro_route.transfers>=1);assert.equal(r.metro_route.segments[0].origin,"南京南站");assert.equal(r.metro_route.segments.at(-1).destination,"苜蓿园");
  for(let i=1;i<r.metro_route.segments.length;i++)assert.equal(r.metro_route.segments[i-1].destination,r.metro_route.segments[i].origin);
});
test("every fully active first-line sample has an in-network route without synthetic links",()=>{
  let checked=0;for(const city of metroCatalogue().cities.filter(c=>c.status==="available")){const n=metroNetwork(city.city),l=n.lines[0];const r=planMetro(city.city,l.stations[0].id,l.stations.at(-1).id);if(r){checked++;for(const leg of r.segments){assert.ok(leg.stations.length>=2);assert.equal(leg.stops,leg.stations.length-1);}}}assert.ok(checked>=40);
});
test("unsupported cities and lines do not become claims of no rail service or fictional routes",()=>{
  const city=metroAnswer("保定地铁线路图");assert.equal(city.unavailable,true);assert.match(city.answer,/不能据此判断/);assert.ok(!city.metro_route);
  const line=metroAnswer("南京地铁99号线有哪些站");assert.equal(line.unavailable,true);assert.ok(!line.metro_route);
  const missing=metroAnswer("查地铁",[],{action:"metro",city:"南京",origin:"不存在的站",destination:"新街口"});assert.equal(missing.needs_input,true);
});
test("annual statistics, knowledge definitions, walking and ordinary-address queries retain their original engines",()=>{
  assert.equal(metroAnswer("2025年南京地铁客运量是多少"),null);assert.equal(metroAnswer("什么是地铁站"),null);assert.equal(metroAnswer("南京地铁站无障碍规范是什么"),null);assert.equal(metroAnswer("南京从南京南站步行到新街口"),null);assert.equal(metroAnswer("南京南站怎么去南京博物院"),null);assert.equal(isMetroQuery("南京南站有几条线"),true);
});
test("line browsing, station membership, same-station routes and historical context are supported",()=>{
  const line=metroAnswer("南京地铁1号线有哪些站");assert.ok(line.rows.some(r=>r[3]==="南京南站"));assert.ok(line.rows.some(r=>r[3]==="新街口"));
  const station=metroAnswer("南京南站有几条线");assert.match(station.answer,/1号线/);assert.match(station.answer,/3号线/);
  assert.match(metroAnswer("南京南站").answer,/1号线/);assert.equal(metroAnswer("南京"),null);
  const same=metroAnswer("南京南站怎么去南京南站");assert.equal(same.metro_route.stops,0);
  const context=metroAnswer("1号线有哪些站",[{role:"user",content:"南京地铁图"}]);assert.ok(context.rows.length>=30);
});

test("map questions return embeddable images for cities, individual lines and image follow-ups",()=>{
  const city=metroAnswer("南京市地铁图");assert.equal(city.images.length,1);assert.ok(city.images[0].url.startsWith("/api/metro/map.svg?"));assert.match(city.images[0].alt,/南京/);assert.doesNotMatch(city.answer,/点击下方来源/);
  const line=metroAnswer("南京地铁1号线图");assert.equal(new URL(line.images[0].url,"https://example.com").searchParams.get("line"),"1号线");
  const followup=metroAnswer("我要直接出图片，不要点击链接",[{role:"user",content:"南京市地铁图"},{role:"assistant",content:city.answer}]);assert.equal(followup.images[0].url,city.images[0].url);
  for(const c of metroCatalogue().cities.filter(c=>c.status==="available"))assert.ok(metroAnswer(c.city+"地铁线路图").images[0]);
  assert.ok(!metroAnswer("保定地铁图").images);
});
