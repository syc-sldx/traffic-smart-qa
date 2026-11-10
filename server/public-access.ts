export async function hashText(text:string){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
// 旧报告继续按登录用户授权；匿名新报告使用单独的不可猜测访问凭证。
export async function reportIdentity(userId:string|null){
  if(userId)return {owner:userId,token:null};
  const token=(crypto.randomUUID()+crypto.randomUUID()).replace(/-/g,"");
  return {owner:"link:"+await hashText(token),token};
}
export async function canReadReport(owner:string,userId:string|null,token:string|null){
  if(userId&&owner===userId)return true;
  if(!owner.startsWith("link:")||!token||!/^[0-9a-f]{64}$/.test(token))return false;
  return owner==="link:"+await hashText(token);
}
export async function publicRateLimit(db:D1Database|undefined,request:Request,now=Date.now()):Promise<Response|null>{
  if(!db)return Response.json({error:"查询服务暂未就绪，请稍后重试。"},{status:503});
  const minute=Math.floor(now/60000);
  const address=request.headers.get("cf-connecting-ip")||"unidentified";
  const id="chat:"+minute+":"+await hashText(address);
  const count=await db.prepare("INSERT INTO public_request_limits(id,count,expires_at) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count").bind(id,now+120000).first<{count:number}>();
  if(!count)throw new Error("请求计数失败，请稍后重试。");
  if(count.count===1)await db.prepare("DELETE FROM public_request_limits WHERE expires_at<?").bind(now).run();
  if(count.count>30)return Response.json({error:"请求较频繁，请稍后再试。"},{status:429,headers:{"retry-after":String(60-Math.floor(now/1000)%60),"cache-control":"no-store"}});
  return null;
}
