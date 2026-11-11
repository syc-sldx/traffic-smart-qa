import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";

test("offline shell remains available while questions, reports and API data never enter the app cache",async()=>{
  const script=await readFile("public/sw.js","utf8"),handlers=new Map(),stores=new Map(),deleted=[];
  let online=true,claims=0,skips=0;
  const store=name=>{
    if(!stores.has(name))stores.set(name,new Map());const values=stores.get(name);
    return {
      addAll:async paths=>{for(const path of paths)values.set(path,new Response("public shell "+path));},
      match:async path=>values.get(path)?.clone(),
      put:async(path,response)=>values.set(path,response.clone())
    };
  };
  stores.set("traffic-smart-qa-shell-old",new Map());stores.set("unrelated-app",new Map());
  const context={URL,Response,Set,self:{location:{origin:"https://traffic.test"},clients:{claim:async()=>{claims++;}},skipWaiting:async()=>{skips++;},addEventListener:(name,handler)=>handlers.set(name,handler)},caches:{open:async name=>store(name),keys:async()=>[...stores.keys()],delete:async name=>{deleted.push(name);return stores.delete(name);}},fetch:async()=>{if(!online)throw Error("offline");return new Response("fresh public interface");}};
  vm.runInNewContext(script,context);
  async function lifecycle(name,data={}){const jobs=[];handlers.get(name)({...data,waitUntil:p=>jobs.push(p)});await Promise.all(jobs);}
  async function request(path,options={}){
    const jobs=[];let response;
    handlers.get("fetch")({request:{url:path.startsWith("http")?path:"https://traffic.test"+path,method:"GET",mode:"navigate",...options},waitUntil:p=>jobs.push(p),respondWith:p=>response=p});
    const result=response?await response:null;await Promise.all(jobs);return result;
  }
  await lifecycle("install");await lifecycle("activate");assert.equal(claims,1);assert.deepEqual(deleted,["traffic-smart-qa-shell-old"]);assert.ok(stores.has("unrelated-app"));
  for(const path of ["/api/chat","/api/metro/map.svg?city=南京","/api/status","/reports/private?token=secret","/unknown","https://cdn.test/asset.js"])assert.equal(await request(path),null,path);
  assert.equal(await request("/",{method:"POST"}),null);
  online=false;assert.equal(await(await request("/?q=private-question")).text(),"public shell /");
  assert.equal(await(await request("/app/pwa.js",{mode:"cors"})).text(),"public shell /app/pwa.js");
  assert.equal(await(await request("/app/voice.js",{mode:"cors"})).text(),"public shell /app/voice.js");
  online=true;assert.equal(await(await request("/?q=private-question")).text(),"fresh public interface");
  const current=[...stores.keys()].find(name=>name.startsWith("traffic-smart-qa-shell-"));
  assert.equal(await stores.get(current).get("/").clone().text(),"public shell /");
  await request("/");online=false;assert.equal(await(await request("/")).text(),"fresh public interface");
  for(const path of stores.get(current).keys())assert.doesNotMatch(path,/\?|api|reports|private|token/);
  await lifecycle("message",{data:{type:"SKIP_WAITING"}});assert.equal(skips,1);
});

test("PWA browser script parses independently of the main interface",async()=>{
  new vm.Script(await readFile("public/pwa.js","utf8"));
});
