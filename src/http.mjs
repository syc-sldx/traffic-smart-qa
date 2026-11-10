import {createServer} from "node:http";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {openDatabase} from "./sqlite.mjs";
import {ask} from "../server/agent.ts";
import {ensureSeed} from "../server/database.ts";
import {canReadReport,publicRateLimit} from "../server/public-access.ts";
import {HTML} from "../server/ui.ts";
import documents from "../server/knowledge.json";
import annualData from "../server/annual-data.json";

const directory=fileURLToPath(new URL(".",import.meta.url));
const db=openDatabase(resolve(process.env.DATABASE_PATH||"./data/traffic.db"),resolve(directory,"drizzle"));
const env={DB:db,AMAP_API_KEY:process.env.AMAP_API_KEY||"",LLM_API_KEY:process.env.LLM_API_KEY||"",LLM_BASE_URL:process.env.LLM_BASE_URL||"https://api.deepseek.com",LLM_MODEL:process.env.LLM_MODEL||"deepseek-flash"};
const proxyHops=Number(process.env.TRUST_PROXY_HOPS||0);
if(!Number.isInteger(proxyHops)||proxyHops<0)throw new Error("TRUST_PROXY_HOPS 必须为非负整数");
await ensureSeed(db);

function clientAddress(request){
  const chain=[...String(request.headers["x-forwarded-for"]||"").split(",").map(v=>v.trim()).filter(Boolean),request.socket.remoteAddress||"unknown"];
  return chain[Math.max(0,chain.length-1-proxyHops)];
}
function bodyText(request){
  return new Promise((resolveBody,reject)=>{
    let size=0,settled=false;const chunks=[];
    const fail=error=>{if(!settled){settled=true;reject(error);}};
    request.on("data",chunk=>{size+=chunk.length;if(size>64000){fail(Object.assign(new Error("请求过长。"),{status:413}));}else if(!settled)chunks.push(chunk);});
    request.on("end",()=>{if(!settled){settled=true;resolveBody(Buffer.concat(chunks).toString("utf8"));}});
    request.on("aborted",()=>fail(Object.assign(new Error("请求已中断。"),{status:400})));
    request.on("error",fail);
  });
}
const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{"cache-control":"no-store",...headers}});
async function route(request){
  const url=new URL(request.url,"http://localhost");
  if(request.method==="GET"){
    if(url.pathname==="/"||url.pathname==="/index.html")return new Response(HTML,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
    if(url.pathname==="/healthz")return json({ok:true});
    if(url.pathname==="/api/status")return json({llm:!!env.LLM_API_KEY,model:env.LLM_MODEL,maps:!!env.AMAP_API_KEY,knowledge_chunks:documents.length,annual_records:annualData.summary.records,annual_cities:Object.keys(annualData.summary.cities),annual_years:Object.keys(annualData.summary.years),domains:["auto","data","knowledge","travel"],cloud:true,public_access:true});
    if(/^\/reports\/[a-zA-Z0-9-]+$/.test(url.pathname)){
      const report=await db.prepare("SELECT html,owner FROM reports WHERE id=?").bind(url.pathname.slice(9)).first();
      if(!report||!await canReadReport(report.owner,null,url.searchParams.get("token")))return json({error:"报告不存在或无权访问。"},404);
      return new Response(report.html,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"private, no-store","referrer-policy":"no-referrer"}});
    }
    return json({error:"页面不存在。"},404);
  }
  if(request.method!=="POST")return json({error:"不支持该请求方式。"},405);
  if(!["/api/chat","/api/reset"].includes(url.pathname))return json({error:"接口不存在。"},404);
  if(Number(request.headers["content-length"]||0)>64000)return json({error:"请求过长。"},413);
  if(url.pathname==="/api/reset")return json({ok:true});
  let body;try{body=JSON.parse(await bodyText(request));}catch(error){return json({error:error.status===413?error.message:"请求格式错误。"},error.status===413?413:400);}
  if(!body||typeof body!=="object"||Array.isArray(body))return json({error:"请求格式错误。"},400);
  const q=body.message,mode=body.mode||"auto",history=body.history||[],details=body.travel||{};
  if(typeof q!=="string"||!q.trim()||q.length>8000||!["auto","data","knowledge","travel"].includes(mode)||!Array.isArray(history)||history.some(h=>!h||!["user","assistant"].includes(h.role)||typeof h.content!=="string")||!details||typeof details!=="object"||Array.isArray(details)||Object.values(details).some(v=>typeof v!=="string"||v.length>200))return json({error:"问题或查询参数格式不正确。"},400);
  const limit=await publicRateLimit(db,new Request("http://localhost/api/chat",{headers:{"cf-connecting-ip":clientAddress(request)}}));
  if(limit)return limit;
  return json(await ask(env,null,q.trim(),history.slice(-12).map(h=>({role:h.role,content:h.content.slice(0,4000)})),mode,details));
}
const server=createServer({maxHeaderSize:16384,requestTimeout:30000,headersTimeout:15000},async(request,response)=>{
  try{
    const result=await route(request);
    response.writeHead(result.status,Object.fromEntries([...result.headers,["x-content-type-options","nosniff"]]));
    response.end(Buffer.from(await result.arrayBuffer()));
  }catch(error){
    console.error("Request failed:",error.message);
    if(!response.headersSent){response.writeHead(500,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});response.end(JSON.stringify({ok:false,error:"服务暂时无法完成查询，请稍后重试。"}));}
    else response.end();
  }
});
server.listen(Number(process.env.PORT||10000),process.env.HOST||"0.0.0.0",()=>console.log("交通智问已启动，端口 "+server.address().port));
function shutdown(){server.close(()=>{db.close();process.exit(0);});server.closeIdleConnections();setTimeout(()=>process.exit(0),10000).unref();}
process.on("SIGTERM",shutdown);process.on("SIGINT",shutdown);
