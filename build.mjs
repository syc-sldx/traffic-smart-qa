import {build} from "esbuild";
await build({entryPoints:["src/http.mjs"],bundle:true,platform:"node",format:"esm",target:"node24",loader:{".html":"text"},outfile:"runtime.mjs"});
