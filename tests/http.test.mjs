import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {mkdtempSync,rmSync} from "node:fs";
import {join,resolve,dirname,basename} from "node:path";
import {tmpdir} from "node:os";
import {DatabaseSync} from "node:sqlite";
import {createHash} from "node:crypto";
import {openDatabase} from "../src/sqlite.mjs";

test("SQLite adapter applies migrations once, rolls back batches and persists reports",async()=>{
  const db=openDatabase(":memory:",resolve("drizzle"));
  await db.prepare("INSERT INTO reports(id,owner,html,created_at) VALUES(?,?,?,?)").bind("fixture","owner","hello","today").run();
  assert.equal((await db.prepare("SELECT * FROM reports WHERE id=?").bind("fixture").first()).html,"hello");
  await assert.rejects(db.batch([
    db.prepare("INSERT INTO seed_state(id) VALUES(?)").bind("rollback"),
    db.prepare("INSERT INTO reports(id,owner,html,created_at) VALUES(?,?,?,?)").bind("fixture","owner","duplicate","today")
  ]));
  assert.equal(await db.prepare("SELECT * FROM seed_state WHERE id=?").bind("rollback").first(),null);
  db.close();
});

test("public HTTP service seeds data, validates requests, isolates reports and rate limits",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"traffic-qa-test-")),dbPath=join(directory,"traffic.db");
  const child=spawn(process.execPath,["runtime.mjs"],{cwd:resolve("."),env:{...process.env,PORT:"0",HOST:"127.0.0.1",DATABASE_PATH:dbPath,TRUST_PROXY_HOPS:"0",LLM_API_KEY:"",AMAP_API_KEY:""},stdio:["ignore","pipe","pipe"]});
  let childError="";child.stderr.on("data",c=>childError+=c.toString());
  try{
    const port=await new Promise((resolvePort,reject)=>{
      let output="";const timer=setTimeout(()=>reject(new Error("Startup timeout: "+childError)),15000);
      child.stdout.on("data",c=>{output+=c.toString();const m=output.match(/端口 (\d+)/);if(m){clearTimeout(timer);resolvePort(Number(m[1]));}});
      child.once("exit",code=>{clearTimeout(timer);reject(new Error("Unexpected exit "+code+": "+childError));});
    });
    const base="http://127.0.0.1:"+port;
    const post=body=>fetch(base+"/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:typeof body==="string"?body:JSON.stringify(body)});
    const home=await fetch(base+"/");assert.equal(home.status,200);assert.ok((await home.text()).includes("公开访问"));
    assert.equal((await fetch(base+"/healthz")).status,200);
    const status=await(await fetch(base+"/api/status")).json();assert.equal(status.public_access,true);assert.equal(status.annual_records,167);assert.equal(status.llm,false);assert.equal(status.maps,false);assert.ok(!("LLM_API_KEY" in status));
    let result=await post({message:"2025年南京地铁客运量是多少"});assert.equal(result.status,200);assert.equal((await result.json()).rows[0][4],113400);
    result=await post({message:"2026年3月南京日均客流是多少"});assert.equal((await result.json()).rows[0][4],343.7);
    const catalogue=await(await fetch(base+"/api/metro/cities")).json();assert.equal(catalogue.cities.length,101);assert.equal(catalogue.summary.network_cities,48);
    const network=await(await fetch(base+"/api/metro/network?city="+encodeURIComponent("南京"))).json();assert.ok(network.station_count>200);assert.ok(network.lines.some(l=>l.name==="1号线"));
    const stops=await(await fetch(base+"/api/metro/stations?city="+encodeURIComponent("南京")+"&q="+encodeURIComponent("新街口"))).json();assert.ok(stops.stations.some(s=>s.name==="新街口"));
    assert.equal((await fetch(base+"/api/metro/network?city="+encodeURIComponent("保定"))).status,404);
    result=await post({message:"南京市地铁图"});const mapAnswer=await result.json();assert.ok(mapAnswer.images[0].url.startsWith("/api/metro/map.svg?"));
    const picture=await fetch(base+mapAnswer.images[0].url);assert.equal(picture.status,200);assert.match(picture.headers.get("content-type"),/^image\/svg\+xml/);assert.equal(picture.headers.get("x-content-type-options"),"nosniff");
    const svg=await picture.text();assert.match(svg,/<svg /);assert.match(svg,/南京南站/);assert.match(svg,/新街口/);assert.match(svg,/高德公开线网数据/);assert.doesNotMatch(svg,/<script|NaN|Infinity|(?:href|src)=/);
    const linePicture=await fetch(base+"/api/metro/map.svg?city="+encodeURIComponent("南京")+"&line="+encodeURIComponent("1号线"));assert.equal(linePicture.status,200);assert.match(await linePicture.text(),/八卦洲大桥南/);
    for(const city of ["上海","常州"]){const image=await fetch(base+"/api/metro/map.svg?city="+encodeURIComponent(city));assert.equal(image.status,200);assert.match(await image.text(),/<polyline /);}
    assert.equal((await fetch(base+"/api/metro/map.svg?city="+encodeURIComponent("保定"))).status,404);
    assert.equal((await fetch(base+"/api/metro/map.svg?city="+encodeURIComponent("南京")+"&line="+encodeURIComponent("99号线"))).status,404);
    assert.equal((await fetch(base+"/api/metro/map.svg?city="+"x".repeat(31))).status,400);
    result=await post({message:"南京南站怎么去南京新街口站"});const metro=await result.json();assert.equal(metro.engine,"metro");assert.equal(metro.metro_route.stops,8);assert.equal(metro.metro_route.transfers,0);
    assert.equal((await post("not-json")).status,400);
    assert.equal((await post({message:"x",history:[{role:"system",content:"bad"}]})).status,400);
    assert.equal((await post({message:"x".repeat(65000)})).status,413);
    assert.equal((await fetch(base+"/api/reset",{method:"POST"})).status,200);
    const native=new DatabaseSync(dbPath);
    assert.equal(native.prepare("SELECT count(*) AS n FROM flow").get().n,2800);
    assert.equal(native.prepare("SELECT count(*) AS n FROM annual_metrics").get().n,167);
    const token="a".repeat(64),owner="link:"+createHash("sha256").update(token).digest("hex");
    const insert=native.prepare("INSERT INTO reports(id,owner,html,created_at) VALUES(?,?,?,?)");
    insert.run("public-fixture",owner,"<p>Own report</p>","today");insert.run("private-fixture","previous-user","private","today");
    assert.equal((await fetch(base+"/reports/private-fixture")).status,404);
    assert.equal((await fetch(base+"/reports/public-fixture")).status,404);
    assert.equal((await fetch(base+"/reports/public-fixture?token="+"b".repeat(64))).status,404);
    const report=await fetch(base+"/reports/public-fixture?token="+token);assert.equal(report.status,200);assert.equal(await report.text(),"<p>Own report</p>");assert.equal(report.headers.get("referrer-policy"),"no-referrer");
    const key=native.prepare("SELECT id FROM public_request_limits LIMIT 1").get().id;
    native.prepare("UPDATE public_request_limits SET count=30 WHERE id=?").run(key);native.close();
    result=await post({message:"2025年南京地铁客运量是多少"});assert.equal(result.status,429);assert.ok(Number(result.headers.get("retry-after"))>0);
  }finally{
    if(child.exitCode===null){const done=once(child,"exit");child.kill();await done;}
    const target=resolve(directory);
    assert.equal(dirname(target),resolve(tmpdir()));assert.ok(basename(target).startsWith("traffic-qa-test-"));
    rmSync(target,{recursive:true,force:true});
  }
});
