export async function modelMessage(env:Cloudflare.Env,messages:any[],tools?:any[],maxTokens=1200){
  if(!env.LLM_API_KEY)throw new Error("开放式分析需要配置模型密钥；常见指标和资料检索仍可用。");
  const payload:any={model:env.LLM_MODEL||"deepseek-flash",messages,temperature:0,max_tokens:maxTokens};
  const base=(env.LLM_BASE_URL||"https://api.deepseek.com").replace(/\/$/,"");
  if(new URL(base).hostname==="api.deepseek.com")payload.thinking={type:"disabled"};
  if(tools){payload.tools=tools;payload.tool_choice="auto";}
  let response:Response;try{response=await fetch(base+"/chat/completions",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+env.LLM_API_KEY},body:JSON.stringify(payload),signal:AbortSignal.timeout(55000)});}catch{throw new Error("模型服务连接失败或超时，请稍后重试。");}
  if(!response.ok)throw new Error(response.status===402?"DeepSeek API 余额不足（HTTP 402），请在开放平台补充 API 余额后重试。":`模型服务返回 HTTP ${response.status}。`);
  const data:any=await response.json();if(!data.choices?.[0]?.message)throw new Error("模型没有返回有效消息。");return data.choices[0].message;
}
