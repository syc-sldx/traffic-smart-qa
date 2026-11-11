import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";

const source=await readFile("public/voice-android.js","utf8");
function setup(agent="Android TrafficQAAndroid/1.0.0",origin="https://traffic-smart-qa.onrender.com"){
  const listeners=new Map(),sent=[],timers=new Map();let serial=0;const window={addEventListener:(type,fn)=>listeners.set(type,fn)};
  const port={postMessage:raw=>sent.push(JSON.parse(raw)),start(){},close(){},onmessage:null};
  vm.runInNewContext(source,{window,navigator:{userAgent:agent},location:{origin},setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id)});
  function connect(nonce="secret",payload="traffic-native-v1:secret"){window.__trafficNativeToken=nonce;listeners.get("message")?.({data:payload,ports:[port]});}
  const receive=message=>port.onmessage?.({data:JSON.stringify(message)});
  return {window,port,sent,connect,receive,timers};
}

test("native speech adapter only activates inside the APK on the exact service origin",()=>{
  assert.equal(setup("Android HuaweiBrowser").window.TrafficAndroidVoice,undefined);
  assert.equal(setup("TrafficQAAndroid/1.0.0","https://evil.test").window.TrafficAndroidVoice,undefined);
  const h=setup(),recognition=new h.window.TrafficAndroidVoice.Recognition();recognition.start();h.connect("secret","traffic-native-v1:wrong");assert.equal(h.sent.length,0);h.connect();assert.equal(h.sent[0].type,"speech-start");
});

test('native location on 1.1 delivers one fix and cancellation ignores late results',()=>{
  assert.equal(setup().window.TrafficAndroidLocation,undefined);
  const h=setup('Huawei TrafficQAAndroid/1.1.0');h.connect();const got=[],errors=[];
  const provider=h.window.TrafficAndroidLocation;
  provider.getCurrentPosition(p=>got.push(p.coords),e=>errors.push(e));const id=h.sent.at(-1).id;
  h.receive({type:'location-result',id,latitude:32.05,longitude:118.78,accuracy:40,timestamp:1});
  assert.equal(got.length,1);assert.equal(got[0].latitude,32.05);assert.equal(h.timers.size,0);
  const cancel=provider.getCurrentPosition(p=>got.push(p.coords),e=>errors.push(e));const old=h.sent.at(-1).id;cancel();
  h.receive({type:'location-result',id:old,latitude:33,longitude:119,accuracy:20});assert.equal(got.length,1);assert.equal(h.sent.at(-1).type,'location-cancel');
  provider.getCurrentPosition(p=>got.push(p.coords),e=>errors.push(e));[...h.timers.values()].at(-1)();assert.equal(errors[0].code,3);
});

test("cancelling before the native channel is ready never starts the microphone",()=>{
  const h=setup(),r=new h.window.TrafficAndroidVoice.Recognition();r.start();r.abort();h.connect();assert.ok(h.sent.every(message=>message.type!=="speech-start"));
});

test("native interim/final results arrive as browser-shaped results and stale events are ignored",()=>{
  const h=setup();h.connect();const r=new h.window.TrafficAndroidVoice.Recognition(),received=[];let ended=0;
  r.onresult=event=>received.push({text:event.results[0][0].transcript,final:event.results[0].isFinal});r.onend=()=>ended++;r.start();const id=h.sent.at(-1).id;
  h.receive({type:"speech-partial",id,text:"南京南"});h.receive({type:"speech-result",id,text:"南京南站"});h.receive({type:"speech-end",id});h.receive({type:"speech-result",id,text:"过期"});
  assert.deepEqual(received,[{text:"南京南",final:false},{text:"南京南站",final:true}]);assert.equal(ended,1);
});

test("native TTS preserves segment ordering, cancel and session completion",()=>{
  const h=setup();h.connect();const voice=h.window.TrafficAndroidVoice,first=new voice.Utterance("第一段"),second=new voice.Utterance("第二段");let next=0;
  first.onend=()=>{next++;voice.synthesis.speak(second);};voice.synthesis.speak(first);const firstId=h.sent.at(-1).id;h.receive({type:"tts-end",id:firstId});assert.equal(next,1);assert.equal(h.sent.at(-1).text,"第二段");
  const secondId=h.sent.at(-1).id;voice.synthesis.cancel();h.receive({type:"tts-end",id:secondId});assert.equal(h.sent.at(-1).type,"tts-cancel");voice.synthesis.endSession();assert.equal(h.sent.at(-1).type,"tts-end-session");
});
