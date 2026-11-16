import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { handleApi } from "./lib/document-api.mjs";
import { openUsageStore } from "./lib/sqlite-store.mjs";

const root = fileURLToPath(new URL("./", import.meta.url));
const assets = new Map([
  ["/", ["public/index.html", "text/html; charset=utf-8"]],
  ["/static/app.js", ["public/static/app.js", "text/javascript; charset=utf-8"]],
  ["/static/styles.css", ["public/static/styles.css", "text/css; charset=utf-8"]],
  ["/static/favicon.svg", ["public/static/favicon.svg", "image/svg+xml"]],
]);
const securityHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

export async function createApplication({ env = process.env, databasePath, fetchImpl } = {}) {
  const db = openUsageStore(databasePath || env.DATABASE_PATH || resolve(root, ".data/usage.sqlite"));
  const config = { ...env, DB: db };
  const sample = await readFile(resolve(root, "examples/sample.md"), "utf8");
  const staticFiles = new Map(await Promise.all([...assets].map(async ([path, [file, type]]) => [path, { body: await readFile(resolve(root, file)), type }])));
  const server = createServer({ headersTimeout: 15000, requestTimeout: 30000 }, async (req, res) => {
    const abort = new AbortController();
    res.on("close", () => { if (!res.writableEnded) abort.abort(); });
    req.on("aborted", () => abort.abort());
    try {
      // Render terminates HTTPS at its ingress proxy. The host remains the
      // public host, preserving same-origin checks for browser uploads/chat.
      const protocol = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https" ? "https" : "http";
      const url = new URL(req.url || "/", `${protocol}://${req.headers.host || "localhost"}`);
      if (["GET", "HEAD"].includes(req.method) && staticFiles.has(url.pathname)) {
        const asset = staticFiles.get(url.pathname);
        res.writeHead(200, { ...securityHeaders, "Content-Type": asset.type });
        res.end(req.method === "HEAD" ? undefined : asset.body);
        return;
      }
      if (!url.pathname.startsWith("/api/")) {
        res.writeHead(404, { ...securityHeaders, "Content-Type": "text/plain; charset=utf-8" });
        res.end("页面不存在");
        return;
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
        else if (value !== undefined) headers.set(name, value);
      }
      const init = { method: req.method, headers, signal: abort.signal };
      if (!["GET", "HEAD"].includes(req.method)) { init.body = Readable.toWeb(req); init.duplex = "half"; }
      const response = await handleApi(new Request(url, init), config, { sample, ...(fetchImpl ? { fetchImpl } : {}) });
      res.writeHead(response.status, { ...securityHeaders, ...Object.fromEntries(response.headers) });
      if (response.body) await pipeline(Readable.fromWeb(response.body), res, { signal: abort.signal });
      else res.end();
    } catch (error) {
      if (abort.signal.aborted) return;
      if (!res.headersSent) {
        res.writeHead(500, { ...securityHeaders, "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ detail: "服务暂时不可用，请稍后重试。" }));
      } else res.destroy();
      console.error("HTTP request failed", { name: error?.name || "Error" });
    }
  });
  server.on("close", () => db.close());
  return server;
}

async function main() {
  try { process.loadEnvFile(resolve(root, ".env")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const port = Number(process.env.PORT || 8000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port");
  const server = await createApplication();
  server.listen(port, "0.0.0.0", () => console.log(`Zhiye listening on port ${port}`));
  const stop = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 25000).unref();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error("Startup failed", { name: error?.name || "Error", code: error?.code || "STARTUP_ERROR" }); process.exitCode = 1; });
}
