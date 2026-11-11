import {build} from "esbuild";
import {createHash} from "node:crypto";
import {readFile,mkdir,writeFile} from "node:fs/promises";

const sources={
  "/manifest.webmanifest":["public/manifest.webmanifest","application/manifest+json; charset=utf-8"],
  "/sw.js":["public/sw.js","text/javascript; charset=utf-8"],
  "/app/pwa.js":["public/pwa.js","text/javascript; charset=utf-8"],
  "/icons/app.svg":["public/icons/app.svg","image/svg+xml"],
  ...Object.fromEntries(["app-192.png","app-512.png","app-maskable-512.png","apple-touch-icon.png"].map(name=>["/icons/"+name,["public/icons/"+name,"image/png"]]))
};
const assets={},hash=createHash("sha256");
hash.update(await readFile("server/interface.html"));
for(const [path,[file,content_type]] of Object.entries(sources)){
  const bytes=await readFile(file),encoding=file.endsWith(".png")?"base64":"utf8";
  hash.update(path).update(bytes);assets[path]={content_type,body:bytes.toString(encoding),encoding};
}
assets["/sw.js"].body=assets["/sw.js"].body.replace("__APP_VERSION__",hash.digest("hex").slice(0,16));
await mkdir("outputs",{recursive:true});
await writeFile("outputs/pwa-assets.json",JSON.stringify(assets));
await build({entryPoints:["src/http.mjs"],bundle:true,platform:"node",format:"esm",target:"node24",loader:{".html":"text"},outfile:"runtime.mjs"});
