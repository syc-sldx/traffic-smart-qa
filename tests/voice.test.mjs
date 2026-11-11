import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";

const source=await readFile("public/voice.js","utf8");
class Element{
  constructor(){this.dataset={};this.attributes={};this.listeners=new Map();this.children=[];this.textContent='';this.disabled=false;this.value='';this.selectionStart=0;this.selectionEnd=0;}
  setAttribute(name,value){this.attributes[name]=value;}
  addEventListener(name,callback){this.listeners.set(name,[...(this.listeners.get(name)||[]),callback]);}
  dispatchEvent(event){for(const callback of this.listeners.get(event.type)||[])callback(event);}
  setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
  appendChild(child){this.children.push(child);return child;}
  querySelector(){return this.who||null;}
}
function setup({recognition=true,synthesis=true}={}){
  const nodes=Object.fromEntries(['q','go','voice-input','voice-input-label','voice-status'].map(id=>[id,new Element()]));
  const recognizers=[],spoken=[],windowListeners=new Map(),documentListeners=new Map(),timers=new Map();let nextTimer=0,cancelled=0;
  class Recognizer{constructor(){recognizers.push(this);this.starts=0;this.aborts=0;this.stops=0;}start(){this.starts++;}abort(){this.aborts++;}stop(){this.stops++;}}
  class Utterance{constructor(text){this.text=text;}}
  const document={visibilityState:'visible',getElementById:id=>nodes[id],createElement:()=>new Element(),querySelectorAll:()=>[],addEventListener:(name,fn)=>documentListeners.set(name,fn)};
  const window={isSecureContext:true,addEventListener:(name,fn)=>windowListeners.set(name,fn),...(recognition?{SpeechRecognition:Recognizer}:{}),...(synthesis?{SpeechSynthesisUtterance:Utterance,speechSynthesis:{getVoices:()=>[{lang:'en-US'},{lang:'zh-CN',name:'Chinese'}],speak:u=>spoken.push(u),cancel:()=>{cancelled++;}}}:{})};
  vm.runInNewContext(source,{window,document,Event,setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer;},clearTimeout:id=>timers.delete(id)});
  function answer(text){const element=new Element();element.who=new Element();window.TrafficVoice.bindAnswer(element,text);return {element,button:element.who.children[0].children[0],status:element.who.children[0].children[1]};}
  function result(recognizer,texts){recognizer.onresult({results:texts.map(text=>[{transcript:text}])});}
  return {nodes,recognizers,spoken,window,document,windowListeners,documentListeners,timers,answer,result,cancelled:()=>cancelled};
}

test("dictation replaces only the selection, revises interim results and waits for manual sending",()=>{
  const h=setup(),input=h.nodes.q;input.value='查询旧文字的地铁路线';input.setSelectionRange(2,5);
  h.nodes['voice-input'].onclick();const r=h.recognizers[0];assert.equal(r.lang,'zh-CN');assert.equal(r.continuous,false);assert.equal(r.interimResults,true);
  r.onstart();h.result(r,['南京南']);assert.equal(input.value,'查询南京南的地铁路线');
  h.result(r,['南京南站','到新街口']);assert.equal(input.value,'查询南京南站到新街口的地铁路线');
  h.nodes['voice-input'].onclick();assert.equal(r.stops,1);assert.equal(h.nodes['voice-input'].dataset.state,'stopping');
  h.result(r,['南京南站到新街口站']);r.onend();assert.equal(input.value,'查询南京南站到新街口站的地铁路线');assert.match(h.nodes['voice-status'].textContent,/核对/);assert.equal(h.nodes.go.disabled,false);
});

test("submission, manual editing and permission failures cannot inject late microphone results",()=>{
  const h=setup(),input=h.nodes.q;h.nodes['voice-input'].onclick();const first=h.recognizers[0];first.onstart();h.result(first,['南京南站']);
  h.window.TrafficVoice.beforeSubmit();input.value='';h.result(first,['过期录音']);assert.equal(input.value,'');assert.equal(first.aborts,1);
  h.nodes['voice-input'].onclick();const second=h.recognizers[1];second.onstart();input.value='手动修改';input.dispatchEvent(new Event('input'));h.result(second,['迟到结果']);assert.equal(input.value,'手动修改');assert.equal(second.aborts,1);
  h.nodes['voice-input'].onclick();const third=h.recognizers[2];third.onerror({error:'not-allowed'});third.onend();assert.match(h.nodes['voice-status'].textContent,/授权/);assert.equal(h.nodes['voice-input'].dataset.state,'idle');assert.equal(third.aborts,1);
  h.window.TrafficVoice.setBusy(true);h.nodes['voice-input'].onclick();assert.equal(h.recognizers.length,3);assert.equal(h.nodes['voice-input'].disabled,true);h.window.TrafficVoice.setBusy(false);assert.equal(h.nodes['voice-input'].disabled,false);
});

test("switching to the background releases the microphone and recording has a time limit",()=>{
  const h=setup();h.nodes['voice-input'].onclick();const r=h.recognizers[0];r.onstart();h.document.visibilityState='hidden';h.documentListeners.get('visibilitychange')();assert.equal(r.aborts,1);assert.equal(h.timers.size,0);
  h.nodes['voice-input'].onclick();const next=h.recognizers[1];[...h.timers.values()][0]();assert.equal(next.aborts,1);assert.match(h.nodes['voice-status'].textContent,/已结束/);
});

test("unsupported browsers keep text entry usable and explain voice alternatives",()=>{
  const h=setup({recognition:false,synthesis:false});assert.equal(h.nodes['voice-input'].disabled,true);assert.match(h.nodes['voice-status'].textContent,/键盘/);assert.equal(h.nodes.q.disabled,false);
  const answer=h.answer('交通回答');assert.equal(answer.button.disabled,true);assert.match(answer.status.textContent,/不支持/);
});

test("long Chinese answers are read in order with a Chinese voice and restore the play control on completion",()=>{
  const h=setup(),text='南京南站乘坐一号线到新街口站。'.repeat(35),answer=h.answer(text);
  answer.button.onclick();assert.equal(answer.button.textContent,'停止朗读');
  let count=0;while(count<h.spoken.length){const u=h.spoken[count++];assert.ok(Array.from(u.text).length<=120);assert.equal(u.lang,'zh-CN');assert.equal(u.voice.lang,'zh-CN');u.onstart();u.onend();}
  assert.equal(h.spoken.map(u=>u.text).join(''),text);assert.equal(answer.button.textContent,'朗读回答');assert.equal(answer.button.attributes['aria-pressed'],'false');assert.equal(answer.status.textContent,'');
});

test("stop, new answers and microphone activation cancel old speech without resuming stale chunks",()=>{
  const h=setup(),first=h.answer('南京交通信息。'.repeat(50)),second=h.answer('上海地铁信息。');
  first.button.onclick();const old=h.spoken[0];second.button.onclick();const count=h.spoken.length;old.onend();assert.equal(h.spoken.length,count);assert.equal(first.button.textContent,'朗读回答');assert.ok(h.cancelled()>=1);
  h.nodes['voice-input'].onclick();assert.equal(second.button.textContent,'朗读回答');assert.equal(h.nodes['voice-input'].dataset.state,'starting');
  second.button.onclick();assert.equal(h.recognizers[0].aborts,1);const latest=h.spoken.at(-1);second.button.onclick();const stopped=h.spoken.length;latest.onend();assert.equal(h.spoken.length,stopped);
  first.button.onclick();h.window.TrafficVoice.reset();assert.equal(first.button.textContent,'朗读回答');assert.equal(h.timers.size,0);
});
