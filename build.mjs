import {build} from "esbuild";
import {createHash} from "node:crypto";
import {readFile,mkdir,writeFile} from "node:fs/promises";

const travelBrowser=await build({entryPoints:["shared/travel-context.mjs"],bundle:true,platform:"browser",format:"iife",globalName:"TrafficTravel",write:false,target:"es2020"});
await mkdir("outputs",{recursive:true});
await writeFile("outputs/travel-context-browser.js",travelBrowser.outputFiles[0].text);

const sources={
  "/app/workspace.css":["public/workspace.css","text/css; charset=utf-8"],
  "/app/favorites-store.js":["public/favorites-store.js","text/javascript; charset=utf-8"],
  "/app/route-ui.js":["public/route-ui.js","text/javascript; charset=utf-8"],
  "/manifest.webmanifest":["public/manifest.webmanifest","application/manifest+json; charset=utf-8"],
  "/sw.js":["public/sw.js","text/javascript; charset=utf-8"],
  "/app/pwa.js":["public/pwa.js","text/javascript; charset=utf-8"],
  "/app/voice-android.js":["public/voice-android.js","text/javascript; charset=utf-8"],
  "/app/voice.js":["public/voice.js","text/javascript; charset=utf-8"],
  "/app/local-history.js":["public/local-history.js","text/javascript; charset=utf-8"],
  "/app/travel-context.js":["outputs/travel-context-browser.js","text/javascript; charset=utf-8"],
  "/app/history.js":["public/history.js","text/javascript; charset=utf-8"],
  "/app/location.js":["public/location.js","text/javascript; charset=utf-8"],
  "/app/android-release.json":["public/android-release.json","application/json; charset=utf-8"],
  "/downloads/traffic-smart-qa-1.0.0.apk":["public/downloads/traffic-smart-qa-1.0.0.apk","application/vnd.android.package-archive"],
  "/downloads/traffic-smart-qa-1.1.0.apk":["public/downloads/traffic-smart-qa-1.1.0.apk","application/vnd.android.package-archive"],
  "/icons/app.svg":["public/icons/app.svg","image/svg+xml"],
  ...Object.fromEntries(["app-192.png","app-512.png","app-maskable-512.png","apple-touch-icon.png"].map(name=>["/icons/"+name,["public/icons/"+name,"image/png"]]))
};
const assets={},hash=createHash("sha256");
hash.update(await readFile("server/interface.html"));
for(const [path,[file,content_type]] of Object.entries(sources)){
  const bytes=await readFile(file),encoding=/\.(?:png|apk)$/.test(file)?"base64":"utf8";
  hash.update(path).update(bytes);assets[path]={content_type,body:bytes.toString(encoding),encoding};
}
assets["/sw.js"].body=assets["/sw.js"].body.replace("__APP_VERSION__",hash.digest("hex").slice(0,16));
await mkdir("outputs",{recursive:true});
await writeFile("outputs/pwa-assets.json",JSON.stringify(assets));
await build({entryPoints:["src/http.mjs"],bundle:true,platform:"node",format:"esm",target:"node24",loader:{".html":"text"},outfile:"runtime.mjs"});
