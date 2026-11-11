import {randomBytes,randomUUID,createHash,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import metro from './metro-data.json' with {type:'json'};

const derive=promisify(scrypt),hash=value=>createHash('sha256').update(value).digest('hex');
const reply=(value,status=200,headers={})=>Response.json(value,{status,headers:{'cache-control':'private, no-store','referrer-policy':'no-referrer',...headers}});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const cleanCity=value=>String(value||'').trim().replace(/市$/,'');
export function memoryProfile(value={}){
  return {city:cleanCity(value.city).slice(0,30),transport:['transit','walking','driving'].includes(value.transport)?value.transport:'transit',notes:String(value.notes||'').trim().slice(0,1200),recallEnabled:value.recallEnabled!==false};
}
async function passwordHash(password,salt=randomBytes(16).toString('hex')){
  const key=await derive(password,salt,32,{N:32768,r:8,p:3,maxmem:64*1024*1024});return salt+':'+key.toString('hex');
}
async function passwordMatches(password,stored){
  const [salt,expected]=stored.split(':'),actual=(await passwordHash(password,salt)).split(':')[1];
  return expected.length===actual.length&&timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(actual,'hex'));
}
function publicAccount(row){return {id:row.id,username:row.username,profile:memoryProfile(JSON.parse(row.profile_json||'{}'))};}
export function storedReply(result){
  const out={};for(const key of ['ok','answer','error','domain','engine','notice','columns','rows','chart','images','sources','sql','report_url','queried_at','metro_route','memory_hits','needs_input','unavailable'])if(result[key]!==undefined)out[key]=result[key];
  if(JSON.stringify(out).length>220000){delete out.chart;if(out.rows)out.rows=out.rows.slice(0,50);out.notice=(out.notice?out.notice+'\n':'')+'历史记录只保留前50行明细，结论与问题已保存。';}
  return out;
}
function words(text){const s=text.toLowerCase().replace(/\s/g,'');const set=new Set(s.match(/[a-z0-9]+/g)||[]);for(let i=0;i<s.length-1;i++){const t=s.slice(i,i+2);if(/^[\u4e00-\u9fff]{2}$/.test(t)&&!['怎么','多少','什么','一下','请问','帮我','之前','上次','查询'].includes(t))set.add(t);}return [...set];}
export function selectMemories(question,turns,recentIds=new Set()){
  const candidates=turns.filter(t=>!recentIds.has(t.id)&&JSON.parse(t.reply_json).ok);
  if(/上次|之前|接着|继续|^那/.test(question))return candidates.slice(0,2);
  const tokens=words(question);return candidates.map(turn=>{const content=turn.question+' '+(JSON.parse(turn.reply_json).answer||'').slice(0,900);const hits=tokens.filter(t=>content.includes(t)).length;return {turn,score:hits};}).filter(x=>x.score>=2).sort((a,b)=>b.score-a.score||b.turn.created_at-a.turn.created_at).slice(0,3).map(x=>x.turn);
}
export function createAccounts({db,enabled=false,secureCookies=true,origin='https://traffic-smart-qa.onrender.com',address=request=>request.socket?.remoteAddress||'local'}){
  const cookieName=secureCookies?'__Host-traffic_session':'traffic_session',queues=new Map();
  const cookie=(token,maxAge=2592000)=>`${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookies?'; Secure':''}`;
  function tokenOf(request){const raw=String(request.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='));return raw?.slice(cookieName.length+1)||'';}
  async function current(request){
    if(!enabled)return null;const token=tokenOf(request);if(!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
    return db.prepare('SELECT u.* FROM qa_sessions s JOIN qa_accounts u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(hash(token),Date.now()).first();
  }
  async function rate(request,label,max=12,window=900000,key=''){
    const now=Date.now(),id=label+':'+Math.floor(now/window)+':'+hash(key||String(address(request)));
    const r=await db.prepare('INSERT INTO public_request_limits(id,count,expires_at) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count').bind(id,now+window).first();
    if(r.count>max)fail('操作较频繁，请稍后再试。',429);
  }
  async function session(user){
    const token=randomBytes(32).toString('base64url');await db.prepare('INSERT INTO qa_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(hash(token),user.id,Date.now()+2592000000).run();
    await db.prepare('DELETE FROM qa_sessions WHERE expires_at<?').bind(Date.now()).run();
    return reply({ok:true,user:publicAccount(user) },200,{'set-cookie':cookie(token)});
  }
  async function owner(user,id,deleted=false){
    if(!/^[a-f0-9-]{36}$/.test(id||''))fail('对话不存在。',404);
    const thread=await db.prepare('SELECT * FROM qa_threads WHERE id=? AND user_id=?'+(deleted?'':' AND deleted_at IS NULL')).bind(id,user.id).first();
    if(!thread)fail('对话不存在。',404);return thread;
  }
  const turnView=turn=>({id:turn.id,question:turn.question,reply:JSON.parse(turn.reply_json),created_at:turn.created_at});
  async function getTurns(user,id){return (await db.prepare('SELECT * FROM qa_turns WHERE user_id=? AND thread_id=? ORDER BY created_at,rowid').bind(user.id,id).all()).results;}
  async function requireUser(request){const user=await current(request);if(!user)fail('请先登录账号。',401);return user;}
  function checkOrigin(request){const actual=request.headers.origin;if(request.headers['sec-fetch-site']==='cross-site'||actual&&actual!==origin)fail('不接受其他网站发起的账号操作。',403);}
  async function route(request,url,body={}){
    const path=url.pathname,method=request.method;
    if(method==='GET'&&path==='/api/auth/me'){const user=await current(request);return reply({enabled,user:user?publicAccount(user):null});}
    if(!enabled)return reply({error:'账号同步尚未启用：需要先配置持久化存储。',storage_required:true},503);
    try{
      if(method!=='GET')checkOrigin(request);
      if(method==='POST'&&['/api/auth/register','/api/auth/login'].includes(path)){
        await rate(request,'auth-burst',100,60000);const username=String(body.username||'').normalize('NFKC').trim().toLowerCase(),password=body.password;
        if(!/^[a-z0-9_]{3,32}$/.test(username)||typeof password!=='string'||password.length<10||password.length>128)fail('用户名用3—32位字母、数字或下划线，密码用10—128位字符。');
        await rate(request,'auth-account',12,900000,username);
        const existing=await db.prepare('SELECT * FROM qa_accounts WHERE username=?').bind(username).first();
        if(path.endsWith('/register')){
          await rate(request,'register',50,3600000);if(existing)fail('该用户名已被使用，请换一个。',409);
          const user={id:randomUUID(),username,password_hash:await passwordHash(password),profile_json:JSON.stringify(memoryProfile()),created_at:Date.now()};
          try{await db.prepare('INSERT INTO qa_accounts(id,username,password_hash,profile_json,created_at) VALUES(?,?,?,?,?)').bind(user.id,user.username,user.password_hash,user.profile_json,user.created_at).run();}catch{fail('该用户名已被使用，请换一个。',409);}
          return session(user);
        }
        const stored=existing?.password_hash||'00000000000000000000000000000000:'+('00'.repeat(32));
        if(!await passwordMatches(password,stored)||!existing)fail('用户名或密码不正确。',401);return session(existing);
      }
      if(method==='POST'&&path==='/api/auth/logout'){
        await db.prepare('DELETE FROM qa_sessions WHERE token_hash=?').bind(hash(tokenOf(request))).run();return reply({ok:true},200,{'set-cookie':cookie('',0)});
      }
      if(method==='GET'&&path==='/api/history/export'){
        const token=url.searchParams.get('token')||'';if(!/^[A-Za-z0-9_-]{43}$/.test(token))fail('备份链接已失效，请重新导出。',401);
        const row=await db.prepare('SELECT u.* FROM qa_download_tokens t JOIN qa_accounts u ON u.id=t.user_id WHERE t.token_hash=? AND t.expires_at>?').bind(hash(token),Date.now()).first();if(!row)fail('备份链接已失效，请重新导出。',401);
        const threads=(await db.prepare('SELECT * FROM qa_threads WHERE user_id=? ORDER BY updated_at DESC').bind(row.id).all()).results;
        for(const thread of threads){delete thread.user_id;thread.turns=(await getTurns(row,thread.id)).map(turnView);}
        return reply({schema:1,exported_at:new Date().toISOString(),account:publicAccount(row),threads},200,{'content-disposition':'attachment; filename="traffic-qa-history.json"'});
      }
      const user=await requireUser(request);
      if(method==='POST'&&path==='/api/history/export-token'){
        const token=randomBytes(32).toString('base64url');await db.prepare('DELETE FROM qa_download_tokens WHERE expires_at<?').bind(Date.now()).run();await db.prepare('INSERT INTO qa_download_tokens(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(hash(token),user.id,Date.now()+180000).run();return reply({url:'/api/history/export?token='+token});
      }
      if(method==='GET'&&path==='/api/threads'){
        const q=(url.searchParams.get('q')||'').trim().slice(0,100),deleted=url.searchParams.get('trash')==='1',pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
        const threads=(await db.prepare(`SELECT t.id,t.title,t.mode,t.created_at,t.updated_at,t.deleted_at,(SELECT COUNT(*) FROM qa_turns x WHERE x.thread_id=t.id) AS turns FROM qa_threads t WHERE t.user_id=? AND t.deleted_at IS ${deleted?'NOT ':''}NULL AND (t.title LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM qa_turns x WHERE x.thread_id=t.id AND (x.question LIKE ? ESCAPE '\\' OR x.reply_json LIKE ? ESCAPE '\\'))) ORDER BY t.updated_at DESC LIMIT 200`).bind(user.id,pattern,pattern,pattern).all()).results;
        return reply({threads});
      }
      const match=path.match(/^\/api\/threads\/([a-f0-9-]{36})(?:\/(restore))?$/);
      if(match){const thread=await owner(user,match[1],method==='POST'&&match[2]==='restore');
        if(method==='GET')return reply({thread:{id:thread.id,title:thread.title,mode:thread.mode,updated_at:thread.updated_at,turns:(await getTurns(user,thread.id)).map(turnView)}});
        if(method==='DELETE'){await db.prepare('UPDATE qa_threads SET deleted_at=? WHERE id=? AND user_id=?').bind(Date.now(),thread.id,user.id).run();return reply({ok:true});}
        if(method==='POST'&&match[2]==='restore'){await db.prepare('UPDATE qa_threads SET deleted_at=NULL,updated_at=? WHERE id=? AND user_id=?').bind(Date.now(),thread.id,user.id).run();return reply({ok:true});}
      }
      if(method==='POST'&&path==='/api/memory/profile'){
        const profile=memoryProfile(body);await db.prepare('UPDATE qa_accounts SET profile_json=? WHERE id=?').bind(JSON.stringify(profile),user.id).run();return reply({ok:true,profile});
      }
      return reply({error:'接口不存在。'},404);
    }catch(error){return reply({error:error.status?error.message:'账号服务暂时不可用，请稍后重试。'},error.status||500);}
  }
  async function chat(user,question,mode,details,threadId,requestId,answer){
    if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(requestId))fail('对话请求编号无效。');
    const previous=await db.prepare('SELECT * FROM qa_turns WHERE user_id=? AND request_id=?').bind(user.id,requestId).first();if(previous)return {...JSON.parse(previous.reply_json),thread_id:previous.thread_id,turn_id:previous.id};
    let thread;if(threadId)thread=await owner(user,threadId);else{
      const now=Date.now();thread={id:randomUUID(),title:question.replace(/\s+/g,' ').slice(0,60),mode,created_at:now};
      await db.prepare('INSERT INTO qa_threads(id,user_id,title,mode,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(thread.id,user.id,thread.title,mode,now,now).run();
    }
    const key=user.id+':'+thread.id,prior=queues.get(key)||Promise.resolve();
    const job=prior.catch(()=>{}).then(async()=>{
      const repeated=await db.prepare('SELECT * FROM qa_turns WHERE user_id=? AND request_id=?').bind(user.id,requestId).first();if(repeated)return {...JSON.parse(repeated.reply_json),thread_id:repeated.thread_id,turn_id:repeated.id};
      await owner(user,thread.id);
      const rows=(await db.prepare('SELECT x.* FROM qa_turns x JOIN qa_threads t ON t.id=x.thread_id WHERE x.user_id=? AND t.deleted_at IS NULL ORDER BY x.created_at DESC,x.rowid DESC LIMIT 300').bind(user.id).all()).results;
      const recent=(await db.prepare('SELECT * FROM qa_turns WHERE user_id=? AND thread_id=? ORDER BY created_at DESC,rowid DESC LIMIT 6').bind(user.id,thread.id).all()).results.reverse(),profile=memoryProfile(JSON.parse((await db.prepare('SELECT profile_json FROM qa_accounts WHERE id=?').bind(user.id).first()).profile_json));
      let result;
      if(/^\s*(?:请)?记住/.test(question)){
        const note=question.replace(/^\s*(?:请)?记住[：:,，]?/,'').trim();const city=metro.scope_cities.find(city=>note.includes(city));if(city)profile.city=city;
        profile.notes=(profile.notes?profile.notes+'\n':'')+note;profile.notes=profile.notes.slice(-1200);
        await db.prepare('UPDATE qa_accounts SET profile_json=? WHERE id=?').bind(JSON.stringify(profile),user.id).run();
        result={ok:true,domain:'knowledge',engine:'memory',answer:'已保存到你的账号记忆。可在“记忆设置”中查看、修改或清空。',profile};
      }else if(/我的(?:常用|默认)城市|记得我.*(?:偏好|城市)/.test(question)){
        result={ok:true,domain:'knowledge',engine:'memory',answer:'你账号中保存的常用城市：'+(profile.city||'尚未设置')+'。'+(profile.notes?'\n保存的偏好：'+profile.notes:'')+'\n这是一条账号记忆，不是本次实时定位结果。'};
      }else if(/我(?:上次|之前|以前|最近).*(?:问|查|咨询)|历史问答|我问过什么|回顾我的/.test(question)){
        const last=rows.filter(x=>JSON.parse(x.reply_json).engine!=='memory').slice(0,5);result={ok:true,domain:'knowledge',engine:'memory',answer:last.length?'以下是你账号中最近保存的问答。历史答案只作回顾，最新出行情况请重新查询。':'你的账号里还没有历史问答。',columns:['时间','历史问题','历史回答'],rows:last.map(x=>[new Date(x.created_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}),x.question,(JSON.parse(x.reply_json).answer||JSON.parse(x.reply_json).error||'').slice(0,1200)])};
      }else{
        let candidates=rows;
        const keys=words(question).slice(0,10);
        if(profile.recallEnabled&&keys.length&&!/上次|之前|接着|继续|^那/.test(question)){
          const clauses=keys.map(()=>'(x.question LIKE ? OR x.reply_json LIKE ?)').join(' OR '),values=keys.flatMap(key=>['%'+key+'%','%'+key+'%']);
          candidates=(await db.prepare('SELECT x.* FROM qa_turns x JOIN qa_threads t ON t.id=x.thread_id WHERE x.user_id=? AND t.deleted_at IS NULL AND ('+clauses+') ORDER BY x.created_at DESC,x.rowid DESC LIMIT 200').bind(user.id,...values).all()).results;
        }
        const memories=profile.recallEnabled?selectMemories(question,candidates,new Set(recent.map(x=>x.id))):[];
        const history=[...memories.slice().reverse(),...recent].flatMap(x=>{const r=JSON.parse(x.reply_json);return r.ok?[{role:'user',content:x.question.slice(0,1200)},{role:'assistant',content:String(r.answer||'').slice(0,1600)}]:[];});
        const slots={...details};if(!slots.city&&profile.city&&!metro.scope_cities.some(c=>question.includes(c)))slots.city=profile.city;
        if(!slots.transport&&!/驾车|开车|步行|走路|公交|地铁/.test(question))slots.transport=profile.transport;
        result=await answer(history,slots,profile.notes);result={...result,memory_hits:memories.length};
      }
      const turnId=randomUUID(),now=Date.now(),saved=storedReply(result);
      await db.batch([db.prepare('INSERT INTO qa_turns(id,user_id,thread_id,request_id,question,reply_json,created_at) VALUES(?,?,?,?,?,?,?)').bind(turnId,user.id,thread.id,requestId,question,JSON.stringify(saved),now),db.prepare('UPDATE qa_threads SET updated_at=?,mode=? WHERE id=? AND user_id=?').bind(now,mode,thread.id,user.id)]);
      return {...result,thread_id:thread.id,turn_id:turnId};
    });
    queues.set(key,job);try{return await job;}finally{if(queues.get(key)===job)queues.delete(key);}
  }
  return {enabled,current,route,chat};
}
