/* Only the public app shell is cached. Queries, reports and API data stay online. */
const CACHE_PREFIX='traffic-smart-qa-shell-';
const CACHE_NAME=CACHE_PREFIX+'__APP_VERSION__';
const SHELL=['/','/manifest.webmanifest','/app/pwa.js','/icons/app.svg','/icons/app-192.png','/icons/app-512.png','/icons/app-maskable-512.png','/icons/apple-touch-icon.png'];
const STATIC=new Set(SHELL.filter(path=>path!=='/'));

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL)));
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(name=>name.startsWith(CACHE_PREFIX)&&name!==CACHE_NAME).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')event.waitUntil(self.skipWaiting());
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  const home=request.mode==='navigate'&&['/','/index.html'].includes(url.pathname);
  const asset=STATIC.has(url.pathname)&&!url.search;
  if(!home&&!asset)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME),key=home?'/':url.pathname;
    try{
      const response=await fetch(request);
      if(response.ok){
        // A question in the address bar must not enter persistent storage.
        if(!url.search)event.waitUntil(cache.put(key,response.clone()).catch(()=>{}));
        return response;
      }
      const stored=await cache.match(key);
      return stored||response;
    }catch{
      const stored=await cache.match(key);
      if(stored)return stored;
      return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>交通智问 · 离线</title><body><h1>当前处于离线状态</h1><p>请连接网络后重新打开交通智问。问答与路线查询需要联网。</p><a href="/">重新打开</a></body></html>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8'}});
    }
  })());
});
