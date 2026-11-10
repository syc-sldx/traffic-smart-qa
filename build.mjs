import {build} from "esbuild";
await build({entryPoints:["src/http.mjs"],bundle:true,platform:"node",format:"esm",target:"node24",outfile:"runtime.mjs"});
