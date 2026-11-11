(()=>{
  'use strict';
  // The APK transfers a MessagePort only to this HTTPS origin's main frame.
  if(!/TrafficQAAndroid\//.test(navigator.userAgent)||location.origin!=='https://traffic-smart-qa.onrender.com')return;
  let port=null,serial=0,currentInput=null,currentSpeech=null,queued=[];
  function send(message){if(port)port.postMessage(JSON.stringify(message));else queued.push(message);}
  function deliver(message){
    const input=currentInput,speech=currentSpeech;
    if(message.type.startsWith('speech-')&&input?.id===message.id){
      if(message.type==='speech-start')input.onstart?.();
      else if(message.type==='speech-partial'||message.type==='speech-result'){
        const result=[{transcript:message.text||'',confidence:1}];result.isFinal=message.type==='speech-result';input.onresult?.({results:[result],resultIndex:0});
      }else if(message.type==='speech-error'){currentInput=null;input.onerror?.({error:message.error||'audio-capture'});input.onend?.();}
      else if(message.type==='speech-end'){currentInput=null;input.onend?.();}
    }
    if(message.type.startsWith('tts-')&&speech?.id===message.id){
      if(message.type==='tts-start')speech.utterance.onstart?.();
      else if(message.type==='tts-end'){currentSpeech=null;speech.utterance.onend?.();}
      else if(message.type==='tts-error'){currentSpeech=null;speech.utterance.onerror?.({error:message.error||'synthesis-failed'});}
    }
  }
  window.addEventListener('message',event=>{
    if(!window.__trafficNativeToken||event.data!=='traffic-native-v1:'+window.__trafficNativeToken||event.ports?.length!==1)return;
    if(port)port.close();port=event.ports[0];
    port.onmessage=event=>{try{const message=JSON.parse(event.data);if(message&&typeof message.type==='string'&&typeof message.id==='string')deliver(message);}catch{}};
    port.start();const pending=queued;queued=[];pending.forEach(send);
  });
  class Recognition{
    start(){if(currentInput)currentInput.abort();this.id='input-'+(++serial);currentInput=this;send({type:'speech-start',id:this.id});}
    stop(){if(currentInput===this)send({type:'speech-stop',id:this.id});}
    abort(){if(currentInput!==this)return;currentInput=null;queued=queued.filter(message=>message.id!==this.id);send({type:'speech-abort',id:this.id});}
  }
  class Utterance{constructor(text){this.text=text;this.lang='zh-CN';this.rate=1;}}
  const synthesis={
    getVoices(){return [{name:'系统中文语音',lang:'zh-CN'}];},
    speak(utterance){this.cancel();const id='tts-'+(++serial);currentSpeech={id,utterance};send({type:'tts-speak',id,text:utterance.text,rate:utterance.rate,lang:'zh-CN'});},
    cancel(){const previous=currentSpeech;currentSpeech=null;queued=queued.filter(message=>!message.type.startsWith('tts-'));if(previous)send({type:'tts-cancel',id:previous.id});},
    endSession(){send({type:'tts-end-session',id:''});}
  };
  window.TrafficAndroidVoice={Recognition,Utterance,synthesis};
})();
