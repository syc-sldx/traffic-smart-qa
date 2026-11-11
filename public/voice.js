(()=>{
  'use strict';
  const get=id=>document.getElementById(id),input=get('q'),mic=get('voice-input'),label=get('voice-input-label'),status=get('voice-status');
  const native=window.TrafficAndroidVoice;
  const Recognition=native?.Recognition||window.SpeechRecognition||window.webkitSpeechRecognition;
  const synth=native?.synthesis||window.speechSynthesis,Utterance=native?.Utterance||window.SpeechSynthesisUtterance,canRead=!!synth&&typeof Utterance==='function';
  const canListen=!!Recognition&&window.isSecureContext;
  if(native&&get('voice-provider-note'))get('voice-provider-note').textContent='识别与朗读使用手机系统语音服务，可能联网处理；交通智问不保存录音。请核对站名后发送。系统未提供识别服务时，可用键盘麦克风输入。';
  let busy=!!get('go').disabled,recognition=null,inputToken=0,inputTimer=null,writing=false,reading=null,readToken=0;
  const fallback='此浏览器暂不支持语音识别，可用手机键盘上的麦克风输入文字。';
  function micState(state){
    mic.dataset.state=state;mic.disabled=!canListen||busy||state==='stopping';
    mic.setAttribute('aria-pressed',String(['starting','listening','stopping'].includes(state)));
    const text=state==='starting'?'取消语音':state==='listening'?'停止录音':state==='stopping'?'识别中…':'语音输入';
    label.textContent=text;mic.setAttribute('aria-label',text);
  }
  function stopInput(message=''){
    inputToken++;clearTimeout(inputTimer);const previous=recognition;recognition=null;
    if(previous){try{previous.abort();}catch{}}
    micState('idle');if(message)status.textContent=message;
  }
  function stopReading(){
    readToken++;const previous=reading;reading=null;
    if(previous){previous.button.textContent='朗读回答';previous.button.setAttribute('aria-pressed','false');previous.status.textContent='';try{synth.cancel();}catch{}}
  }
  function startInput(){
    if(!canListen||busy)return;
    if(recognition){
      if(mic.dataset.state==='starting'){stopInput('已取消语音输入。');return;}
      const current=recognition,token=inputToken;micState('stopping');status.textContent='正在完成识别，请稍候…';
      clearTimeout(inputTimer);inputTimer=setTimeout(()=>{if(token===inputToken)stopInput('语音输入已结束，可核对文字后发送。');},5000);
      try{current.stop();}catch{stopInput('语音输入已结束，可核对文字后发送。');}return;
    }
    stopReading();
    const token=++inputToken,start=input.selectionStart??input.value.length,end=input.selectionEnd??start;
    const before=input.value.slice(0,start),after=input.value.slice(end);let received=false,failed=false,current;
    try{current=new Recognition();}catch{status.textContent='当前无法启动语音识别，请使用键盘输入或稍后重试。';return;}
    recognition=current;current.lang='zh-CN';current.continuous=false;current.interimResults=true;current.maxAlternatives=1;
    current.onstart=()=>{if(token!==inputToken)return;micState('listening');status.textContent='正在听，请说出交通问题；再点一次可结束录音。';};
    current.onresult=event=>{
      if(token!==inputToken)return;
      let text='';for(let i=0;i<event.results.length;i++)text+=event.results[i][0]?.transcript||'';
      text=text.trim().slice(0,Math.max(0,8000-before.length-after.length));if(!text)return;
      received=true;writing=true;
      try{input.value=before+text+after;input.setSelectionRange(before.length+text.length,before.length+text.length);input.dispatchEvent(new Event('input',{bubbles:true}));}finally{writing=false;}
      status.textContent='已识别文字，可结束录音后核对并发送。';
    };
    current.onerror=event=>{
      if(token!==inputToken)return;failed=true;
      const messages={
        'not-allowed':'麦克风未获授权。请在浏览器的站点权限中允许麦克风，然后重试。',
        'service-not-allowed':'当前设备未提供可用的语音识别服务，可改用手机键盘麦克风。',
        'audio-capture':'未能使用麦克风，请检查设备连接及麦克风权限。',
        'network':'未能连接浏览器的语音识别服务，请检查网络，或改用手机键盘麦克风。',
        'no-speech':'没有听到清晰语音，请再试一次。',
        'language-not-supported':'当前语音服务暂不支持普通话，可改用手机键盘麦克风。',
        'aborted':'语音输入已结束。'
      };
      stopInput(messages[event.error]||'语音识别暂不可用，请重试或使用键盘输入。');
    };
    current.onend=()=>{
      if(token!==inputToken)return;clearTimeout(inputTimer);recognition=null;inputToken++;micState('idle');
      if(!failed)status.textContent=received?'识别完成，请核对站名等文字后点发送。':'没有识别到文字，请再试一次。';
    };
    micState('starting');status.textContent='正在启动麦克风；若浏览器询问，请允许使用麦克风。';
    inputTimer=setTimeout(()=>{if(token===inputToken)stopInput('本次语音输入已结束，可核对已有文字后发送。');},45000);
    try{current.start();}catch(error){stopInput(error.name==='NotAllowedError'?'麦克风未获授权，请检查浏览器站点权限。':'未能启动语音识别，请稍后重试。');}
  }
  function speechChunks(text){
    const clean=String(text).replace(/https?:\/\/\S+/g,'').replace(/[#*_`~]/g,'').replace(/→/g,'，到，').trim();
    const characters=Array.from(clean),chunks=[];
    while(characters.length){
      let end=Math.min(120,characters.length);
      if(end<characters.length){for(let i=end-1;i>=45;i--){if(/[。！？；，\n.!?;]/.test(characters[i])){end=i+1;break;}}}
      const chunk=characters.splice(0,end).join('').trim();if(chunk)chunks.push(chunk);
    }
    return chunks;
  }
  function bindAnswer(element,text){
    if(element.dataset.voiceBound||!String(text||'').trim())return;
    element.dataset.voiceBound='true';
    const actions=document.createElement('div');actions.className='answer-actions';
    const button=document.createElement('button');button.type='button';button.className='answer-speech';button.textContent='朗读回答';button.setAttribute('aria-pressed','false');button.disabled=!canRead;
    const note=document.createElement('span');note.className='answer-speech-status';note.setAttribute('role','status');
    if(!canRead){button.title='此浏览器暂不支持朗读，可使用系统的文字朗读功能。';note.textContent='当前浏览器不支持朗读';}
    actions.appendChild(button);actions.appendChild(note);(element.querySelector('.who')||element).appendChild(actions);
    button.onclick=()=>{
      if(!canRead)return;
      if(reading?.button===button){stopReading();return;}
      if(recognition)stopInput('录音已结束，可核对输入文字。');stopReading();
      const chunks=speechChunks(text);if(!chunks.length)return;
      const token=++readToken;reading={button,status:note,utterance:null};button.textContent='停止朗读';button.setAttribute('aria-pressed','true');note.textContent='准备朗读…';
      let index=0;
      const next=()=>{
        if(token!==readToken||!reading)return;
        if(index>=chunks.length){reading=null;button.textContent='朗读回答';button.setAttribute('aria-pressed','false');note.textContent='';synth.endSession?.();return;}
        const utterance=new Utterance(chunks[index++]);utterance.lang='zh-CN';utterance.rate=1;
        const voices=synth.getVoices(),voice=voices.find(v=>/^zh[-_]CN$/i.test(v.lang))||voices.find(v=>/^zh/i.test(v.lang));if(voice)utterance.voice=voice;
        reading.utterance=utterance;
        utterance.onstart=()=>{if(token===readToken)note.textContent='正在朗读';};
        utterance.onend=next;
        utterance.onerror=event=>{if(token!==readToken)return;stopReading();note.textContent=event.error==='not-allowed'?'请再点一次朗读，并检查设备声音设置。':'朗读暂不可用，请检查设备语音和声音设置。';};
        try{synth.speak(utterance);}catch{stopReading();note.textContent='未能开始朗读，请稍后重试。';}
      };
      next();
    };
  }
  mic.onclick=startInput;
  input.addEventListener('input',()=>{if(!writing&&recognition)stopInput('已切换为手动编辑，可核对后发送。');});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&recognition)stopInput('页面已切到后台，语音输入已停止。');});
  window.addEventListener('pagehide',()=>{stopInput();stopReading();});
  window.TrafficVoice={bindAnswer,setBusy(value){busy=!!value;if(busy){if(recognition)stopInput('语音输入已结束。');stopReading();}micState(recognition?mic.dataset.state:'idle');},beforeSubmit(){if(recognition)stopInput('语音输入已结束。');stopReading();},reset(){stopInput();stopReading();status.textContent=canListen?'点击麦克风说话，识别后核对再发送。':fallback;}};
  document.querySelectorAll('[data-voice-answer]').forEach(element=>bindAnswer(element,element.dataset.voiceAnswer));
  micState('idle');status.textContent=canListen?'点击麦克风说话，识别后核对再发送。':fallback;
})();
