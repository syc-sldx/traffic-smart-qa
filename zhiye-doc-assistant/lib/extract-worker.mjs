import { parentPort, workerData } from "node:worker_threads";
import { unzipSync } from "fflate";

try {
  const data = Buffer.from(workerData.bytes);
  const format = workerData.format;
  if (data[0] === 0x50 && data[1] === 0x4b) {
    let total = 0, entries = 0;
    unzipSync(data, { filter(entry) {
      total += entry.originalSize; entries++;
      if (!Number.isSafeInteger(entry.originalSize) || entry.originalSize > 16 * 1024 * 1024 || total > 24 * 1024 * 1024 || entries > 1500) throw new Error("ARCHIVE_LIMIT");
      return false;
    } });
  }
  let text;
  if (format === "doc") {
    const { default: WordExtractor } = await import("word-extractor");
    const doc = await new WordExtractor().extract(data);
    text = [doc.getBody(), doc.getFootnotes(), doc.getEndnotes(), doc.getHeaders()].filter(Boolean).join("\n\n");
  } else {
    const { OfficeParser } = await import("officeparser");
    const ast = await OfficeParser.parseOffice(data, {
      fileType: format, ocr: false, extractAttachments: false,
      allowRemoteAssets: false, includeRawContent: false, serializeRawContent: false,
      decompressionLimits: { maxUncompressedBytes: 24 * 1024 * 1024, maxZipEntries: 1500, maxTableCells: 20000, maxXmlElements: 100000, maxRepeatedContent: 100000 },
      pdfParserConfig: { separateProcess: false, extractTextColor: false, maxTextItems: 30000, maxOperators: 100000, maxTimeMs: 12000 },
    });
    if (ast.warnings?.some((warning) => /LIMIT|TRUNCAT|BUDGET/.test(String(warning.code || warning.type || warning)))) throw new Error("DOCUMENT_LIMIT");
    text = (await ast.to("text", { textConfig: { preserveLayout: false } })).value;
  }
  parentPort.postMessage({ ok: true, text });
} catch (error) {
  const diagnostic = `${error?.code || ""} ${error?.message || ""}`;
  const message = /password|encrypt/i.test(diagnostic) ? "文档受密码保护，请先解密后上传。"
    : /ARCHIVE_LIMIT|limit|budget/i.test(diagnostic) ? "文档内部内容过大或过于复杂，请拆分后上传。"
    : "文档解析失败，文件可能损坏或格式不受支持，请转存为 TXT、DOCX 或 PDF 后重试。";
  parentPort.postMessage({ ok: false, message });
}
