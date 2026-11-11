import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {resolve,join,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';

test('account history survives restart, synchronizes independent sessions and isolates other users',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'traffic-account-test-')),dbPath=join(directory,'accounts.db');let child,base;
  async function start(){
    child=spawn(process.execPath,['runtime.mjs'],{cwd:resolve('.'),env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATABASE_PATH:dbPath,AUTH_ENABLED:'true',COOKIE_SECURE:'false',PUBLIC_ORIGIN:'http://fixture.test',LLM_API_KEY:'',AMAP_API_KEY:''},stdio:['ignore','pipe','pipe']});
    let errors='';child.stderr.on('data',c=>errors+=c.toString());
    const port=await new Promise((done,reject)=>{let output='';const timer=setTimeout(()=>reject(Error(errors||'Server timeout')),15000);child.stdout.on('data',c=>{output+=c;const found=output.match(/端口 (\d+)/);if(found){clearTimeout(timer);done(found[1]);}});child.once('exit',code=>{clearTimeout(timer);reject(Error('Unexpected server exit '+code+errors));});});base='http://127.0.0.1:'+port;
  }
  async function stop(){if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done;}}
  async function api(path,{cookie='',body,method,headers={}}={}){const response=await fetch(base+path,{method:method||(body?'POST':'GET'),headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();return {response,value,cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  const password='fixture-password-only',question='南京南站怎么去南京新街口站';
  try{
    await start();
    const a=await api('/api/auth/register',{body:{username:'alice_sync',password}});assert.equal(a.response.status,200);assert.match(a.response.headers.get('set-cookie'),/HttpOnly/);assert.ok(!('password_hash' in a.value.user));const firstCookie=a.cookie,aliceId=a.value.user.id;
    const a2=await api('/api/auth/login',{body:{username:'alice_sync',password}});assert.equal(a2.response.status,200);const secondCookie=a2.cookie;assert.notEqual(firstCookie,secondCookie);
    const bob=await api('/api/auth/register',{body:{username:'bob_separate',password}});assert.equal(bob.response.status,200);
    assert.equal((await api('/api/threads')).response.status,401);
    assert.equal((await api('/api/chat',{body:{message:question,account_required:true,request_id:'expired_session_001'}})).response.status,401);
    const one=await api('/api/chat',{cookie:firstCookie,body:{message:question,request_id:'first_request_001'}});assert.equal(one.value.metro_route.stops,8);const id=one.value.thread_id;
    const repeated=await api('/api/chat',{cookie:firstCookie,body:{message:question,request_id:'first_request_001'}});assert.equal(repeated.value.turn_id,one.value.turn_id);
    const list=await api('/api/threads',{cookie:secondCookie});assert.ok(list.value.threads.some(t=>t.id===id));
    const thread=await api('/api/threads/'+id,{cookie:secondCookie});assert.equal(thread.value.thread.turns.length,1);assert.equal(thread.value.thread.turns[0].question,question);
    assert.equal((await api('/api/threads/'+id,{cookie:bob.cookie})).response.status,404);assert.equal((await api('/api/threads',{cookie:bob.cookie})).value.threads.length,0);
    const note=await api('/api/chat',{cookie:firstCookie,body:{message:'请记住常用城市是南京，偏好少换乘',request_id:'remember_city_002'}});assert.equal(note.value.profile.city,'南京');
    const me=await api('/api/auth/me',{cookie:secondCookie});assert.equal(me.value.user.profile.city,'南京');
    const contextual=await api('/api/chat',{cookie:secondCookie,body:{message:'1号线图',request_id:'default_city_003'}});assert.ok(contextual.value.images[0].alt.includes('南京'));
    const recall=await api('/api/chat',{cookie:secondCookie,body:{message:'我上次问过什么',request_id:'recall_history_004'}});assert.equal(recall.value.engine,'memory');assert.ok(recall.value.rows.some(row=>row[1]===question));
    const forbidden=await api('/api/memory/profile',{cookie:secondCookie,headers:{Origin:'https://attacker.test'},body:{city:'上海'}});assert.equal(forbidden.response.status,403);assert.equal((await api('/api/auth/me',{cookie:secondCookie})).value.user.profile.city,'南京');
    assert.equal((await api('/api/threads/'+id,{cookie:secondCookie,method:'DELETE'})).response.status,200);assert.equal((await api('/api/threads/'+id,{cookie:secondCookie})).response.status,404);
    assert.ok((await api('/api/threads?trash=1',{cookie:secondCookie})).value.threads.some(t=>t.id===id));assert.equal((await api('/api/threads/'+id+'/restore',{cookie:secondCookie,body:{}})).response.status,200);
    const search=await api('/api/threads?q='+encodeURIComponent('南京南站'),{cookie:secondCookie});assert.ok(search.value.threads.some(t=>t.id===id));
    const exportLink=await api('/api/history/export-token',{cookie:secondCookie,body:{}});const exported=await api(exportLink.value.url);assert.equal(exported.value.account.username,'alice_sync');assert.ok(exported.value.threads.some(t=>t.id===id));assert.ok(!JSON.stringify(exported.value).includes('password_hash'));assert.ok(!JSON.stringify(exported.value).includes('bob_separate'));
    await stop();await start();assert.equal((await api('/api/auth/me',{cookie:secondCookie})).value.user.id,aliceId);assert.equal((await api('/api/threads/'+id,{cookie:secondCookie})).value.thread.turns[0].reply.metro_route.stops,8);
    await api('/api/auth/logout',{cookie:firstCookie,body:{}});assert.equal((await api('/api/auth/me',{cookie:firstCookie})).value.user,null);assert.equal((await api('/api/auth/me',{cookie:secondCookie})).value.user.id,aliceId);
    const loginWrong=await api('/api/auth/login',{body:{username:'alice_sync',password:'wrong-password-value'}});assert.equal(loginWrong.response.status,401);
  }finally{await stop();const target=resolve(directory);assert.equal(dirname(target),resolve(tmpdir()));assert.ok(basename(target).startsWith('traffic-account-test-'));rmSync(target,{recursive:true,force:true});}
});
