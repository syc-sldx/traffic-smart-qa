"use strict";

const $ = (id) => document.getElementById(id);
const state = { document: null, history: [], busy: false, loading: false, controller: null, mode: "live", connected: false };
let toastTimer;

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("icon");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").classList.toggle("error", error);
  $("toast").hidden = false;
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 5500);
}

function updateControls() {
  const locked = state.busy || state.loading;
  $("question").disabled = !state.document || state.loading || !state.connected;
  $("send-button").disabled = !state.busy && (!state.document || !state.connected || state.loading || !$("question").value.trim());
  for (const id of ["upload-zone", "file-input", "sample-button", "new-chat"]) $(id).disabled = locked;
  document.querySelectorAll(".prompt-card").forEach((button) => { button.disabled = locked; });
  $("workspace-state").replaceChildren(document.createElement("span"), document.createTextNode(state.busy ? "正在阅读文档…" : state.loading ? "正在载入文档…" : state.connected ? "准备就绪" : "服务未连接"));
}

async function responseJson(response) {
  let body;
  try { body = await response.json(); } catch { throw new Error("暂时无法读取服务响应，请确认已登录并刷新页面。"); }
  if (!response.ok) {
    const message = typeof body.detail === "string" ? body.detail : response.status === 422 ? "文档、问题或对话超出限制，请缩短内容，或点击「新对话」后重试。" : "请求失败，请稍后重试。";
    throw new Error(message);
  }
  return body;
}

async function checkHealth() {
  try {
    const health = await responseJson(await fetch("/api/health"));
    state.mode = health.mode;
    state.connected = health.mode === "live";
    const live = health.mode === "live";
    $("mode-badge").classList.toggle("is-live", live);
    $("mode-label").textContent = live ? "DeepSeek · 在线" : "服务待配置";
    $("mode-notice").hidden = live;
    $("composer-model").textContent = live ? health.model : "等待服务配置";
    $("settings-button").lastElementChild.textContent = "使用说明";
  } catch {
    state.connected = false;
    $("mode-label").textContent = "服务未连接";
    toast("暂时无法连接网站服务，请检查网络并刷新页面。", true);
  }
  updateControls();
}

function clearConversation() {
  state.history = [];
  $("messages").replaceChildren();
  $("messages").hidden = true;
  $("welcome").hidden = false;
  $("question").value = "";
  resizeInput();
  updateControls();
}

function selectDocument(doc) {
  state.document = doc;
  clearConversation();
  $("empty-document").hidden = true;
  $("document-card").hidden = false;
  $("document-count").textContent = "1";
  $("document-name").textContent = doc.name;
  $("document-name").title = doc.name;
  $("document-size").textContent = `${doc.characters.toLocaleString()} 字符 · ${doc.lines} 行`;
  $("workspace-title").textContent = doc.name;
  $("attached-name").textContent = doc.name;
  $("attached-document").hidden = false;
  $("question").placeholder = "关于这份文档，你想知道什么？";
  $("welcome-description").textContent = `「${doc.name}」已经准备好了。选择下方的问题，或直接输入你的好奇。`;
  $("welcome-tip").replaceChildren();
  const step = document.createElement("span"); step.textContent = "02";
  $("welcome-tip").append(step, document.createTextNode(" 文档已就位，现在开始你的第一个问题"));
  updateControls();
}

async function loadDocument(loader) {
  if (state.busy || state.loading) return false;
  state.loading = true;
  updateControls();
  try {
    const doc = await responseJson(await loader());
    selectDocument(doc);
    toast(`已载入 ${doc.name}`);
    return true;
  } catch (error) {
    toast(error.message || "文档上传失败，请重试。", true);
    return false;
  } finally {
    state.loading = false;
    $("file-input").value = "";
    updateControls();
  }
}

async function uploadFile(file) {
  if (!file) return;
  if (!/\.(txt|md|markdown)$/i.test(file.name)) { toast("请选择 TXT 或 Markdown 文件。", true); return; }
  if (file.size > 256 * 1024) { toast("文件超过 256 KB，请拆分后重试。", true); return; }
  const form = new FormData();
  form.append("file", file);
  await loadDocument(() => fetch("/api/documents", { method: "POST", body: form }));
}

function previewDocument() {
  if (!state.document) return;
  $("preview-title").textContent = state.document.name;
  $("preview-content").replaceChildren();
  const fragment = document.createDocumentFragment();
  state.document.content.split("\n").forEach((text, index) => {
    const row = document.createElement("div"); row.className = "preview-line";
    const line = document.createElement("span"); line.className = "line-number"; line.textContent = String(index + 1);
    const content = document.createElement("span"); content.className = "line-text"; content.textContent = text;
    row.append(line, content); fragment.append(row);
  });
  $("preview-content").append(fragment);
  $("preview-dialog").showModal();
}

// A small safe Markdown renderer: all document/model content becomes text nodes.
// Raw HTML, images and active links are never inserted through innerHTML.
function inline(text, target) {
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    target.append(document.createTextNode(text.slice(offset, match.index)));
    let node;
    if (match[1]) { node = document.createElement("strong"); node.textContent = match[1]; }
    else if (match[2]) { node = document.createElement("code"); node.textContent = match[2]; }
    else { node = document.createElement("a"); node.textContent = match[3]; node.href = match[4]; node.target = "_blank"; node.rel = "noopener noreferrer"; }
    target.append(node);
    offset = match.index + match[0].length;
  }
  target.append(document.createTextNode(text.slice(offset)));
}

function markdown(text, target) {
  const fragment = document.createDocumentFragment();
  let paragraph = [], list = null, quote = null, code = null;
  const flush = () => {
    if (paragraph.length) { const p = document.createElement("p"); inline(paragraph.join("\n"), p); fragment.append(p); paragraph = []; }
    list = null; quote = null;
  };
  for (const line of text.replace(/\r/g, "").split("\n")) {
    if (/^\s*```/.test(line)) {
      flush();
      if (code) code = null;
      else { const pre = document.createElement("pre"); code = document.createElement("code"); pre.append(code); fragment.append(pre); }
      continue;
    }
    if (code) { code.append(document.createTextNode(`${line}\n`)); continue; }
    if (!line.trim()) { flush(); continue; }
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) { flush(); const h = document.createElement(line.startsWith("####") ? "h4" : "h3"); inline(heading[1], h); fragment.append(h); continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { flush(); fragment.append(document.createElement("hr")); continue; }
    const item = line.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)(.+)$/);
    if (item) {
      if (paragraph.length || quote) flush();
      const tag = /^\s*\d/.test(line) ? "ol" : "ul";
      if (!list || list.tagName.toLowerCase() !== tag) { list = document.createElement(tag); fragment.append(list); }
      const li = document.createElement("li"); inline(item[1], li); list.append(li); continue;
    }
    if (/^>\s?/.test(line)) {
      if (paragraph.length || list) flush();
      if (!quote) { quote = document.createElement("blockquote"); fragment.append(quote); }
      else quote.append(document.createElement("br"));
      inline(line.replace(/^>\s?/, ""), quote); continue;
    }
    if (list || quote) flush();
    paragraph.push(line);
  }
  flush();
  target.replaceChildren(fragment);
}

function makeMessage(role, text = "") {
  const article = document.createElement("article"); article.className = `message ${role}`;
  const top = document.createElement("div"); top.className = "message-top";
  const avatar = document.createElement("span"); avatar.className = `avatar ${role}`;
  if (role === "assistant") avatar.append(icon("book")); else avatar.textContent = "你";
  const author = document.createElement("span"); author.className = "message-author"; author.textContent = role === "user" ? "你" : "知页";
  top.append(avatar, author);
  if (role === "assistant" && state.mode === "demo") { const label = document.createElement("span"); label.className = "message-label"; label.textContent = "演示 · 原文摘录"; top.append(label); }
  const body = document.createElement("div"); body.className = "message-body";
  if (text) body.textContent = text;
  else { const dots = document.createElement("span"); dots.className = "typing-dots"; dots.setAttribute("aria-label", "正在等待回答"); dots.append(document.createElement("i"), document.createElement("i"), document.createElement("i")); body.append(dots); }
  article.append(top, body);
  $("messages").append(article);
  return { article, body };
}

function scrollToEnd(force = false) {
  const area = $("conversation-scroll");
  if (window.innerWidth <= 580) {
    if (force) $("messages").lastElementChild?.scrollIntoView({ block: "start", behavior: "auto" });
  } else if (force || area.scrollHeight - area.scrollTop - area.clientHeight < 230) {
    area.scrollTop = area.scrollHeight;
  }
}

function addCopyButton(message, text) {
  if (!text) return;
  const actions = document.createElement("div"); actions.className = "message-actions";
  const copy = document.createElement("button"); copy.type = "button"; copy.className = "copy-button";
  copy.append(icon("copy"), document.createTextNode("复制回答"));
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(text); toast("回答已复制"); }
    catch { toast("复制失败，请选中文字后手动复制。", true); }
  });
  actions.append(copy); message.article.append(actions);
}

async function readEvents(response, onEvent) {
  if (!response.body) throw new Error("当前浏览器不支持流式读取，请使用新版 Chrome 或 Edge。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
      let end;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        let event = "message", data = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        }
        if (data.length) onEvent(event, JSON.parse(data.join("\n")));
      }
      if (done) return;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function sendQuestion(question) {
  if (state.busy || state.loading || !state.connected) return;
  question = question.trim();
  if (!question) return;
  if (!state.document) { toast("请先在左侧上传文档，或点击「使用示例文档」。"); return; }
  if (question.length > 4000) { toast("问题超过 4,000 字符，请缩短后重试。", true); return; }
  // Keep the latest ten completed turns, always beginning with a user message.
  let history = state.history.slice(-20);
  while (history.length && history.reduce((n, item) => n + item.content.length, question.length) > 32000) history = history.slice(2);
  const outbound = [...history, { role: "user", content: question }];
  state.busy = true;
  state.controller = new AbortController();
  $("welcome").hidden = true; $("messages").hidden = false;
  $("question").value = ""; resizeInput();
  $("send-button").classList.add("is-stop");
  $("send-button").setAttribute("aria-label", "停止生成");
  const square = document.createElement("span"); square.className = "stop-square";
  $("send-button").replaceChildren(square);
  updateControls();
  makeMessage("user", question);
  const answer = makeMessage("assistant");
  scrollToEnd(true);
  let text = "", completed = false;
  try {
    const response = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document: { name: state.document.name, content: state.document.content }, messages: outbound }),
      signal: state.controller.signal,
    });
    if (!response.ok) await responseJson(response);
    await readEvents(response, (event, data) => {
      if (event === "token") { text += data.content; markdown(text, answer.body); scrollToEnd(); }
      if (event === "done") completed = true;
      if (event === "error") throw new Error(data.message);
    });
    if (!completed) throw new Error("连接提前结束，回答可能不完整，请重试。");
    if (!text.trim()) throw new Error("没有收到回答，请重试。");
    state.history = [...outbound, { role: "assistant", content: text }];
  } catch (error) {
    const stopped = error.name === "AbortError" || state.controller.signal.aborted;
    if (!text) answer.body.replaceChildren();
    const notice = document.createElement("div"); notice.className = "message-error";
    notice.textContent = stopped ? "已停止生成。未完成的这一轮不会带入后续对话。" : error.message || "连接失败，请检查网络后重试。";
    const retry = document.createElement("button"); retry.type = "button"; retry.className = "retry-button"; retry.textContent = "重新提问";
    retry.addEventListener("click", () => { if (!state.busy) { $("question").value = question; resizeInput(); updateControls(); $("question").focus(); } });
    notice.append(document.createTextNode(" "), retry); answer.article.append(notice);
    if (!stopped) toast("这次回答未完成，可点击「重新提问」重试。", true);
  } finally {
    addCopyButton(answer, text);
    state.busy = false; state.controller = null;
    $("send-button").classList.remove("is-stop");
    $("send-button").setAttribute("aria-label", "发送问题");
    $("send-button").replaceChildren(icon("arrow"));
    updateControls(); scrollToEnd();
    if (window.innerWidth > 580) $("question").focus();
  }
}

function resizeInput() {
  $("question").style.height = "auto";
  $("question").style.height = `${Math.min(130, $("question").scrollHeight)}px`;
}

$("upload-zone").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", (event) => uploadFile(event.target.files[0]));
for (const eventName of ["dragenter", "dragover"]) $("upload-zone").addEventListener(eventName, (event) => { event.preventDefault(); if (!state.busy && !state.loading) $("upload-zone").classList.add("drag-over"); });
for (const eventName of ["dragleave", "drop"]) $("upload-zone").addEventListener(eventName, (event) => { event.preventDefault(); $("upload-zone").classList.remove("drag-over"); });
$("upload-zone").addEventListener("drop", (event) => { if (!state.busy && !state.loading) uploadFile(event.dataTransfer.files[0]); });
// Prevent dropping elsewhere from navigating away and discarding the conversation.
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => event.preventDefault());
$("sample-button").addEventListener("click", () => loadDocument(() => fetch("/api/sample")));
$("new-chat").addEventListener("click", () => { if (!state.busy && !state.loading) { clearConversation(); toast("已开始新对话，当前文档继续保留。"); } });
$("preview-button").addEventListener("click", previewDocument);
for (const id of ["settings-button", "notice-config"]) $(id).addEventListener("click", () => $("settings-dialog").showModal());
document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => $(button.dataset.closeDialog).close()));
document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } }));
document.querySelectorAll(".prompt-card").forEach((button) => button.addEventListener("click", () => {
  if (!state.document) { toast("先上传文档，或点击左侧的「使用示例文档」。"); $("sample-button").focus(); return; }
  sendQuestion(button.dataset.prompt);
}));
$("question").addEventListener("input", () => { resizeInput(); updateControls(); });
$("question").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!state.busy) sendQuestion($("question").value); } });
$("chat-form").addEventListener("submit", (event) => { event.preventDefault(); if (state.busy) state.controller?.abort(); else sendQuestion($("question").value); });
checkHealth();
