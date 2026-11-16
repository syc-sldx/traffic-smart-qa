import { Worker } from "node:worker_threads";
import { extname, basename } from "node:path";
import iconv from "iconv-lite";
import { detect } from "chardet";
import { AppError } from "./errors.mjs";

export const LIMITS = Object.freeze({ fileBytes: 8 * 1024 * 1024, documentChars: 24000, bodyBytes: 9 * 1024 * 1024 });
export const SUPPORTED = Object.freeze({ text: "各类纯文本、代码、CSV、JSON、XML、YAML、日志和字幕", documents: "PDF、DOC、DOCX、RTF、HTML、EPUB、ODT、XLSX、PPTX、ODS、ODP" });
const officeTypes = new Set(["docx", "pptx", "xlsx", "odt", "ods", "odp", "odg", "epub"]);
const aliases = { htm: "html", xhtml: "html", dotx: "docx", ott: "odt", ots: "ods", otp: "odp" };
let activeParsers = 0;

export function normalizeText(text) {
  if (typeof text !== "string") throw new AppError("文档内容必须是文本。", 422);
  text = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!text) throw new AppError("文档没有可读取的文字，请换一个文件。");
  if (/[\u0000-\u0008\u000b\u000e-\u001f]/.test(text)) throw new AppError("这个文件包含二进制内容，无法作为文本文档读取。");
  text = text.replace(/\f/g, "\n\n");
  if (text.length > LIMITS.documentChars) throw new AppError("提取后的文字超过 24,000 字符，请拆分文档后上传。");
  return text;
}

export function decodeText(bytes) {
  const buffer = Buffer.from(bytes);
  let encoding;
  if (buffer.subarray(0, 4).equals(Buffer.from([0xff, 0xfe, 0, 0]))) encoding = "utf32le";
  else if (buffer.subarray(0, 4).equals(Buffer.from([0, 0, 0xfe, 0xff]))) encoding = "utf32be";
  else if (buffer[0] === 0xff && buffer[1] === 0xfe) encoding = "utf16le";
  else if (buffer[0] === 0xfe && buffer[1] === 0xff) encoding = "utf16be";
  if (!encoding) {
    const sample = buffer.subarray(0, 65536);
    const evenNulls = sample.filter((value, index) => value === 0 && index % 2 === 0).length;
    const oddNulls = sample.filter((value, index) => value === 0 && index % 2 === 1).length;
    if (sample.length >= 4 && oddNulls > sample.length / 5 && !evenNulls) encoding = "utf16le";
    else if (sample.length >= 4 && evenNulls > sample.length / 5 && !oddNulls) encoding = "utf16be";
  }
  if (!encoding) {
    try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(buffer), encoding: "UTF-8" }; } catch {}
    const guess = detect(buffer.subarray(0, 65536));
    // Keep the previous Chinese GB18030 support as a deterministic first choice
    // for short files; statistical detection needs more data to be reliable.
    if (buffer.length < 16) {
      try { return { text: new TextDecoder("gb18030", { fatal: true }).decode(buffer), encoding: "GB18030" }; } catch {}
    }
    encoding = guess && !/^(utf-?8|ascii)$/i.test(guess) && iconv.encodingExists(guess) ? guess : "windows-1252";
  }
  const text = iconv.decode(buffer, encoding);
  if (text.includes("\uFFFD")) throw new AppError("文字编码无法可靠识别，请将文件转为 UTF-8 后重试。");
  return { text, encoding };
}

function binarySignature(bytes) {
  const hex = Buffer.from(bytes.subarray(0, 8)).toString("hex");
  return /^(89504e47|ffd8ff|47494638|4d5a|7f454c46|52494646|494433|377abcaf|52617221|1f8b)/.test(hex);
}

export async function parseInWorker(bytes, format) {
  if (activeParsers >= 1) throw new AppError("正在解析其他文档，请稍后再上传。", 429);
  activeParsers++;
  const data = Uint8Array.from(bytes);
  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      const worker = new Worker(new URL("./extract-worker.mjs", import.meta.url), {
        workerData: { bytes: data, format }, transferList: [data.buffer],
        env: { NODE_ENV: "production" },
        resourceLimits: { maxOldGenerationSizeMb: 160, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
        stdout: true, stderr: true,
      });
      // Discard parser diagnostics: they may contain text from an uploaded file.
      worker.stdout.resume(); worker.stderr.resume();
      const finish = (error, result) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        worker.terminate().finally(() => error ? reject(error) : resolve(result));
      };
      const timer = setTimeout(() => finish(new AppError("文档解析超时，请拆成较小的文件后重试。")), 20000);
      worker.once("message", (result) => result.ok ? finish(null, result) : finish(new AppError(result.message)));
      worker.once("error", () => finish(new AppError("文档解析失败，文件可能损坏、加密或过于复杂，请转存为 TXT 后重试。")));
      worker.once("exit", () => { if (!settled) finish(new AppError("文档解析未完成，请换一个文件重试。")); });
    });
  } finally { activeParsers--; }
}

export async function extractDocument(file) {
  if (file.size > LIMITS.fileBytes) throw new AppError("文件超过 8 MB，请拆分后上传。");
  const name = basename(String(file.name).replaceAll("\\", "/")).replace(/[\x00-\x1f]/g, "").slice(0, 160) || "document.txt";
  const extension = extname(name).slice(1).toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const prefix = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  const hex = Buffer.from(bytes.subarray(0, 8)).toString("hex");
  let format = aliases[extension] || extension;
  if (prefix.trimStart().startsWith("%PDF-")) format = "pdf";
  else if (/^\s*\{\\rtf/i.test(prefix)) format = "rtf";
  else if (hex === "d0cf11e0a1b11ae1") {
    if (["docx", "xlsx", "pptx"].includes(extension)) throw new AppError("文档可能受密码保护，请先解密并重新保存后上传。");
    if (["xls", "ppt"].includes(extension)) throw new AppError("请将旧版 XLS/PPT 转存为 XLSX/PPTX 后上传。");
    format = "doc";
  } else if (hex.startsWith("504b")) {
    if (!officeTypes.has(format)) throw new AppError("请直接上传 DOCX、EPUB、ODT 等文档，不支持通用压缩包。");
  } else if (["pdf", "doc", ...officeTypes].includes(format)) {
    throw new AppError("文件内容与文档格式不符，文件可能损坏，请重新导出后上传。");
  } else if (binarySignature(bytes)) throw new AppError("暂不支持图片、音视频或可执行文件，请上传包含文字的文档。");

  let text, encoding;
  if (format === "html" || /^\s*(?:<!doctype html|<html[\s>])/i.test(prefix)) {
    format = "html";
    const decoded = decodeText(bytes); encoding = decoded.encoding;
    text = (await parseInWorker(new TextEncoder().encode(decoded.text), format)).text;
  } else if (["pdf", "doc", "rtf", ...officeTypes].includes(format)) {
    text = (await parseInWorker(bytes, format)).text;
  } else {
    const decoded = decodeText(bytes); text = decoded.text; encoding = decoded.encoding;
    format = extension ? extension.toUpperCase() : "纯文本";
  }
  if (!text?.trim()) throw new AppError(format === "pdf"
    ? "这个 PDF 没有可提取的文字，可能是扫描件，请先进行 OCR 识别后上传。"
    : "文档中没有可提取的文字，请确认文件包含正文。");
  const content = normalizeText(text);
  return { name, content, format: format.toUpperCase(), encoding, characters: content.length, lines: content.split("\n").length };
}
