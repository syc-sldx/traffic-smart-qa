import assets from "../outputs/pwa-assets.json";

export function pwaAsset(path:string):Response|null{
  const files=assets as Record<string,{content_type:string,body:string,encoding:string}>;
  if(!Object.hasOwn(files,path))return null;
  const asset=files[path],script=path==="/sw.js";
  return new Response(asset.encoding==="base64"?Buffer.from(asset.body,"base64"):asset.body,{headers:{
    "content-type":asset.content_type,
    "cache-control":script?"no-store, no-cache, must-revalidate":path.startsWith("/icons/")?"public, max-age=86400":"no-cache",
    ...(script?{"service-worker-allowed":"/"}:{})
  }});
}
