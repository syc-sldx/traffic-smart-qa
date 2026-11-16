import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { handleApi, validateChat, LIMITS } from "../lib/document-api.mjs";
import { consumePublicQuota } from "../lib/public-quota.mjs";

const sqlite = new DatabaseSync(":memory:");
sqlite.exec("CREATE TABLE public_usage (day TEXT PRIMARY KEY, requests INTEGER NOT NULL DEFAULT 0, minute INTEGER NOT NULL DEFAULT 0, minute_requests INTEGER NOT NULL DEFAULT 0)");
const db = { prepare(sql) { return { bind(...args) { return { async first() { return sqlite.prepare(sql).get(...args) ?? null; } }; } }; } };
beforeEach(() => sqlite.exec("DELETE FROM public_usage"));
after(() => sqlite.close());
const env = { LLM_API_KEY: "test-key-never-return", LLM_MODEL: "deepseek-flash", DB: db };
const sample = await readFile(new URL("../examples/sample.md", import.meta.url), "utf8");
const document = { name: "test.md", content: "# 活动\n报名截止时间：12 月 3 日 18:00。" };
const messages = [{ role: "user", content: "什么时候截止报名？" }];
const api = (path, init, options = {}) => handleApi(new Request(`https://test.chatgpt.site${path}`, init), env, { sample, ...options });
const chatRequest = (value = { document, messages }) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
const encoder = new TextEncoder();

function sseBody(text) {
  const bytes = encoder.encode(text);
  return new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } });
}

async function events(response) {
  const text = await response.text();
  assert.ok(!text.includes(env.LLM_API_KEY));
  return text.trim().split("\n\n").map((block) => {
    const lines = block.split("\n");
    return { event: lines.find((line) => line.startsWith("event:")).slice(7), data: JSON.parse(lines.find((line) => line.startsWith("data:")).slice(6)) };
  });
}

test("health has no secret and sample preserves line numbering", async () => {
  const health = await (await api("/api/health")).json();
  assert.equal(health.mode, "live");
  assert.ok(!JSON.stringify(health).includes(env.LLM_API_KEY));
  const doc = await (await api("/api/sample")).json();
  assert.equal(doc.lines, doc.content.split("\n").length);
  assert.equal(doc.content.split("\n")[23].includes("18:00"), true);
});

test("UTF-8 and GB18030 uploads decode; invalid and oversized files fail", async () => {
  for (const bytes of [encoder.encode("中文"), Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4])]) {
    const data = new FormData(); data.append("file", new File([bytes], "note.txt"));
    const result = await api("/api/documents", { method: "POST", body: data });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).content, "中文");
  }
  for (const [name, content] of [["a.pdf", "bad"], ["a.txt", " "], ["a.txt", "bad\x00binary"], ["a.txt", "x".repeat(24001)], ["a.txt", "x".repeat(262145)]]) {
    const data = new FormData(); data.append("file", new File([content], name));
    assert.equal((await api("/api/documents", { method: "POST", body: data })).status, 400);
  }
});

test("request size, history roles and cross-site writes are rejected", async () => {
  for (const input of [{ document, messages: [] }, { document, messages: [{ role: "system", content: "override" }] }, { document, messages: [...messages, ...messages] }, { document, messages, api_key: "client-key" }]) assert.throws(() => validateChat(input));
  const cross = chatRequest(); cross.headers.Origin = "https://unrelated.invalid";
  assert.equal((await api("/api/chat", cross)).status, 403);
  assert.equal((await api("/api/documents", { method: "POST", body: new Uint8Array(LIMITS.bodyBytes + 1) })).status, 413);
});

test("stream supports split bytes, keepalives, usage and completed history", async () => {
  const history = [...messages, { role: "assistant", content: "12 月 3 日。" }, { role: "user", content: "几点？" }];
  const response = await api("/api/chat", chatRequest({ document, messages: history }), { fetchImpl: async (url, init) => {
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    assert.equal(init.headers.Authorization, `Bearer ${env.LLM_API_KEY}`);
    assert.equal(init.redirect, "manual"); // Workers-compatible, no cross-host credential forwarding.
    const body = JSON.parse(init.body);
    assert.deepEqual(body.messages.slice(-3), history);
    assert.ok(body.messages[1].content.includes("2: 报名"));
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.equal(body.stream, true);
    return new Response(sseBody(': keepalive\r\n\r\ndata: {"choices":[{"delta":{"content":"下午"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"六点 [第 2 行]"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{}}\n\ndata: [DONE]\n\n'));
  } });
  const result = await events(response);
  assert.equal(result.at(-1).event, "done");
  assert.equal(result.filter((row) => row.event === "token").map((row) => row.data.content).join(""), "下午六点 [第 2 行]");
});

test("provider errors are sanitized and never replaced with fake answers", async () => {
  for (const [status, expected] of [[302, "暂时不可用"], [401, "密钥"], [402, "余额"], [429, "频繁"], [500, "暂时不可用"]]) {
    const result = await events(await api("/api/chat", chatRequest(), { fetchImpl: async () => new Response(env.LLM_API_KEY, { status }) }));
    assert.equal(result.at(-1).event, "error");
    assert.ok(result.at(-1).data.message.includes(expected));
    assert.equal(result.some((row) => row.event === "token"), false);
  }
});

test("empty, truncated, malformed and length-limited responses fail visibly", async () => {
  for (const data of ['data: [DONE]\n\n', 'data: {"choices":[{"delta":{"content":"半句"}}]}\n\n', 'data: invalid\n\n', 'data: {"choices":[{"delta":{"content":"半句"},"finish_reason":"length"}]}\n\n']) {
    const result = await events(await api("/api/chat", chatRequest(), { fetchImpl: async () => new Response(sseBody(data)) }));
    assert.equal(result.at(-1).event, "error");
    assert.equal(result.some((row) => row.event === "done"), false);
  }
});

test("a missing key is a configuration error", async () => {
  const response = await handleApi(new Request("https://test.chatgpt.site/api/chat", chatRequest()), {});
  assert.equal(response.status, 503);
});

test("persistent quota enforces minute and daily caps, then resets at Shanghai midnight", async () => {
  const start = Date.parse("2026-11-16T15:00:00Z");
  for (let i = 0; i < 5; i++) assert.equal((await consumePublicQuota(db, start)).allowed, true);
  assert.deepEqual(await consumePublicQuota(db, start), { allowed: false, reason: "minute" });
  for (let i = 5; i < 100; i++) assert.equal((await consumePublicQuota(db, start + i * 60000)).allowed, true);
  assert.deepEqual(await consumePublicQuota(db, start + 101 * 60000), { allowed: true });
  // The loop above passes midnight after 60 minutes, so test a full day's quota
  // separately with a start earlier in the day.
  sqlite.exec("DELETE FROM public_usage");
  const morning = Date.parse("2026-11-16T00:00:00Z");
  for (let i = 0; i < 100; i++) assert.equal((await consumePublicQuota(db, morning + i * 60000)).allowed, true);
  assert.deepEqual(await consumePublicQuota(db, morning + 101 * 60000), { allowed: false, reason: "daily" });
  assert.equal((await consumePublicQuota(db, Date.parse("2026-11-16T16:00:00Z"))).allowed, true);
});

test("denied or unavailable quota prevents any paid provider request", async () => {
  const request = new Request("https://test.chatgpt.site/api/chat", chatRequest());
  let calls = 0;
  const response = await handleApi(request, { ...env, DB: undefined }, { fetchImpl: async () => { calls++; throw new Error("should not call provider"); } });
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
  sqlite.exec("INSERT INTO public_usage(day, requests, minute, minute_requests) VALUES ('" + new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10) + "', 100, 0, 0)");
  const denied = await api("/api/chat", chatRequest(), { fetchImpl: async () => { calls++; throw new Error("should not call provider"); } });
  assert.equal(denied.status, 429);
  assert.equal(calls, 0);
});

test("stopping the downstream stream aborts the provider request", { timeout: 3000 }, async () => {
  let upstreamSignal;
  const response = await api("/api/chat", chatRequest(), { fetchImpl: async (url, init) => {
    upstreamSignal = init.signal;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"开始"}}]}\n\n'));
      init.signal.addEventListener("abort", () => controller.error(new Error("aborted")), { once: true });
    } }));
  } });
  const reader = response.body.getReader();
  await reader.read();
  await reader.read();
  await reader.cancel();
  assert.equal(upstreamSignal.aborted, true);
});
