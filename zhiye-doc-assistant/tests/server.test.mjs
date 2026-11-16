import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApplication } from "../server.mjs";
import { docxFixture } from "./fixtures.mjs";

test("standalone HTTP app serves assets, uploads, chat and origin/security boundaries", async () => {
  let providerCalls = 0;
  const app = await createApplication({ databasePath: ":memory:", env: { LLM_API_KEY: "fixture-secret", LLM_MODEL: "deepseek-flash" }, fetchImpl: async (url, init) => {
    providerCalls++;
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    assert.equal(init.headers.Authorization, "Bearer fixture-secret");
    return new Response('data: {"choices":[{"delta":{"content":"下午两点 [第 2 行]"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  } });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const base = `http://127.0.0.1:${app.address().port}`;
  try {
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.ok((await page.text()).includes("知页"));
    assert.equal((await fetch(base + "/static/app.js")).status, 200);
    for (const path of ["/.env", "/server.mjs", "/lib/document-api.mjs", "/.data/usage.sqlite", "/static/../server.mjs"]) assert.equal((await fetch(base + path)).status, 404);
    const health = await (await fetch(base + "/api/health")).json();
    assert.equal(health.mode, "live");
    assert.ok(!JSON.stringify(health).includes("fixture-secret"));
    const file = new FormData(); file.append("file", new File(["# 标题\n活动时间是下午两点。"], "测试.md"));
    const upload = await fetch(base + "/api/documents", { method: "POST", body: file, headers: { Origin: base } });
    assert.equal(upload.status, 200);
    const document = await upload.json();
    const wordFile = new FormData(); wordFile.append("file", new File([docxFixture()], "upload.docx"));
    const wordResponse = await fetch(base + "/api/documents", { method: "POST", body: wordFile, headers: { Origin: base } });
    assert.equal(wordResponse.status, 200);
    assert.ok((await wordResponse.json()).content.includes("中文文档测试"));
    const request = { document: { name: document.name, content: document.content }, messages: [{ role: "user", content: "活动时间？" }] };
    const response = await fetch(base + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify(request) });
    assert.equal(response.status, 200);
    const output = await response.text();
    assert.ok(output.includes("event: done"));
    assert.ok(output.includes("下午两点"));
    assert.ok(!output.includes("fixture-secret"));
    const cross = await fetch(base + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://unrelated.invalid" }, body: JSON.stringify(request) });
    assert.equal(cross.status, 403);
    assert.equal(providerCalls, 1);
  } finally {
    await new Promise((resolve) => app.close(resolve));
  }
});
