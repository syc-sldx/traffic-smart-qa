(()=>{
  'use strict';
  const get=id=>document.getElementById(id),state={user:null,enabled:false,current:null,busy:false,trash:false,lastTurn:null};
  let searchTimer,register=false;
  async function api(path,options={}){
    const response=await fetch(path,{credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
    const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error||'同步暂时失败，请稍后重试。'),{status:response.status});return value;
  }
  const time=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
  function lastKey(){return 'trafficqa:last-thread:'+state.user?.id;}
  function rememberId(){try{if(state.current)localStorage.setItem(lastKey(),state.current);else localStorage.removeItem(lastKey());}catch{}}
  function controls(){
    get('auth-title').textContent=state.user?'账号与记忆':register?'注册账号':'登录账号';
    get('account-label').textContent=state.user?state.user.username:'登录同步记录';
    get('account-form').hidden=!!state.user;get('memory-settings').hidden=!state.user;
    get('account-storage-note').hidden=state.enabled;
    get('auth-submit').disabled=!state.enabled||state.busy;get('account-open').disabled=state.busy;get('account-logout').hidden=!state.user;get('account-logout').disabled=state.busy;
    get('history-search').disabled=!state.user;get('history-trash').disabled=!state.user;get('history-refresh').disabled=!state.user||state.busy;
    get('history-note').textContent=state.user?'已登录 · 历史在账号内同步':state.enabled?'登录后，在手机和电脑继续旧对话。':'云端记忆待启用，暂时不能注册或同步。';
    if(state.user){const p=state.user.profile;get('profile-city').value=p.city;get('profile-transport').value=p.transport;get('profile-notes').value=p.notes;get('profile-recall').checked=p.recallEnabled;get('account-name').textContent=state.user.username;}
    document.querySelectorAll('.history-item button').forEach(button=>button.disabled=state.busy);
  }
  function authMode(value){register=value;get('auth-title').textContent=value?'注册账号':'登录账号';get('auth-submit').textContent=value?'注册并同步':'登录';get('auth-password').autocomplete=value?'new-password':'current-password';get('auth-toggle').textContent=value?'已有账号，去登录':'还没有账号？注册';get('auth-error').textContent='';}
  get('account-open').onclick=()=>{controls();get('account-result').textContent='';get('account-dialog').showModal();};
  get('account-close').onclick=()=>get('account-dialog').close();
  get('auth-toggle').onclick=()=>authMode(!register);
  get('account-form').onsubmit=async event=>{
    event.preventDefault();if(!state.enabled)return;get('auth-submit').disabled=true;get('auth-error').textContent='';
    try{const value=await api('/api/auth/'+(register?'register':'login'),{method:'POST',body:JSON.stringify({username:get('auth-username').value,password:get('auth-password').value})});state.user=value.user;state.current=null;get('auth-password').value='';controls();window.TrafficChat.reset();window.TrafficChat.profile(state.user.profile);await refresh(true);get('account-dialog').close();}
    catch(error){get('auth-error').textContent=error.message;}finally{get('auth-submit').disabled=!state.enabled;}
  };
  get('account-logout').onclick=async()=>{
    if(state.busy)return;
    try{await api('/api/auth/logout',{method:'POST',body:'{}'});state.current=null;rememberId();state.user=null;state.lastTurn=null;get('history-list').replaceChildren();window.TrafficChat.reset();window.TrafficLocation?.clear();controls();get('account-dialog').close();}catch(error){get('account-result').textContent=error.message;}
  };
  get('memory-save').onclick=async()=>{
    const profile={city:get('profile-city').value,transport:get('profile-transport').value,notes:get('profile-notes').value,recallEnabled:get('profile-recall').checked};
    try{const value=await api('/api/memory/profile',{method:'POST',body:JSON.stringify(profile)});state.user.profile=value.profile;window.TrafficChat.profile(value.profile);get('account-result').textContent='记忆设置已保存，会在其他登录设备同步。';}catch(error){get('account-result').textContent=error.message;}
  };
  get('history-export').onclick=async()=>{
    try{const value=await api('/api/history/export-token',{method:'POST',body:'{}'});location.assign(value.url);}catch(error){get('account-result').textContent=error.message;}
  };
  async function openThread(id,preserveDraft=false){
    if(state.busy)return;const value=await api('/api/threads/'+encodeURIComponent(id));state.current=id;state.lastTurn=value.thread.turns.at(-1)?.id||null;rememberId();window.TrafficChat.restore(value.thread,preserveDraft);document.querySelectorAll('.history-item').forEach(item=>item.classList.toggle('active',item.dataset.id===id));
  }
  async function refresh(restore=false){
    if(!state.user)return;
    const value=await api('/api/threads?'+new URLSearchParams({q:get('history-search').value,trash:state.trash?'1':'0'}));
    get('history-list').replaceChildren();
    for(const thread of value.threads){
      const row=document.createElement('div');row.className='history-item'+(thread.id===state.current?' active':'');row.dataset.id=thread.id;
      const select=document.createElement('button');select.type='button';select.className='history-select';select.disabled=state.busy||state.trash;
      const title=document.createElement('span');title.textContent=thread.title;const note=document.createElement('small');note.textContent=time(thread.updated_at)+' · '+thread.turns+' 轮';select.appendChild(title);select.appendChild(note);
      select.onclick=()=>openThread(thread.id).catch(showError);
      const action=document.createElement('button');action.type='button';action.className='history-remove';action.disabled=state.busy;action.textContent=state.trash?'恢复':'×';action.setAttribute('aria-label',(state.trash?'恢复对话：':'移至回收站：')+thread.title);
      action.onclick=async()=>{try{await api('/api/threads/'+thread.id+(state.trash?'/restore':''),{method:state.trash?'POST':'DELETE',...(state.trash?{body:'{}'}:{})});if(state.current===thread.id){state.current=null;rememberId();window.TrafficChat.reset();}await refresh();}catch(error){showError(error);}};
      row.appendChild(select);row.appendChild(action);get('history-list').appendChild(row);
    }
    if(!value.threads.length){const empty=document.createElement('p');empty.className='history-empty';empty.textContent=state.trash?'回收站为空':'还没有匹配的历史问答';get('history-list').appendChild(empty);}
    if(restore&&!state.trash){let id;try{id=localStorage.getItem(lastKey());}catch{}if(!value.threads.some(t=>t.id===id))id=value.threads[0]?.id;if(id)await openThread(id);}
  }
  function showError(error){get('history-note').textContent=error.message;if(error.status===401){state.user=null;state.current=null;state.lastTurn=null;window.TrafficChat.reset();window.TrafficLocation?.clear();controls();get('history-note').textContent='登录已过期，请重新登录后继续。';}}
  get('history-search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>refresh().catch(showError),300);};
  get('history-refresh').onclick=()=>refresh().catch(showError);
  get('history-trash').onclick=()=>{state.trash=!state.trash;get('history-trash').setAttribute('aria-pressed',String(state.trash));get('history-trash').textContent=state.trash?'返回记录':'回收站';refresh().catch(showError);};
  async function initialize(){
    try{const value=await api('/api/auth/me');state.enabled=value.enabled;state.user=value.user;controls();if(state.user){window.TrafficChat.profile(state.user.profile);await refresh(true);}}catch(error){get('history-note').textContent='暂时无法连接账号服务，问答仍可使用。';controls();}
  }
  const ready=initialize();
  window.TrafficHistory={ready,authenticated:()=>!!state.user,threadId:()=>state.current,
    newChat(){if(state.busy)return;state.current=null;state.lastTurn=null;rememberId();document.querySelectorAll('.history-item').forEach(item=>item.classList.remove('active'));},
    busy(value){state.busy=!!value;controls();},
    async received(result){if(!state.user||!result.thread_id)return;state.current=result.thread_id;state.lastTurn=result.turn_id;rememberId();if(result.profile){state.user.profile=result.profile;window.TrafficChat.profile(result.profile);}await refresh();},
    fail:showError
  };
  document.addEventListener('visibilitychange',async()=>{
    if(document.visibilityState!=='visible'||!state.user||state.busy)return;
    try{const value=await api('/api/auth/me');if(!value.user){showError(Object.assign(new Error('登录已过期，请重新登录。'),{status:401}));return;}state.user=value.user;await refresh();if(state.current){const value=await api('/api/threads/'+state.current);if(value.thread.turns.at(-1)?.id!==state.lastTurn)await openThread(state.current,true);}}
    catch(error){showError(error);}
  });
})();
