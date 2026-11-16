import test from "node:test";
import assert from "node:assert/strict";
import iconv from "iconv-lite";
import { extractDocument, LIMITS } from "../lib/documents.mjs";
import { docxFixture, odtFixture, epubFixture, pdfFixture, xlsxFixture, pptxFixture, zipDocument } from "./fixtures.mjs";

test("accepts structured text, code, subtitles, unknown extensions and extensionless text", async () => {
  for (const name of ["a.txt", "a.md", "a.csv", "a.tsv", "a.json", "a.jsonl", "a.xml", "a.yaml", "a.toml", "a.ini", "a.log", "a.py", "a.js", "a.srt", "a.vtt", "a.tex", "a.custom", "README"]) {
    const result = await extractDocument(new File(["中文内容\r\n第二行"], name));
    assert.equal(result.content, "中文内容\n第二行", name);
    assert.equal(result.lines, 2);
  }
});

test("recognizes BOM and common Unicode, Chinese and Western encodings", async () => {
  for (const encoding of ["utf8", "utf16le", "utf16be", "utf32le", "utf32be", "gb18030"]) {
    const data = iconv.encode("中文测试\nHello", encoding, { addBOM: true });
    assert.equal((await extractDocument(new File([data], "encoding.txt"))).content, "中文测试\nHello", encoding);
  }
  assert.equal((await extractDocument(new File([iconv.encode("café", "windows1252")], "latin.txt"))).content, "café");
});

test("extracts DOCX, ODT, EPUB, RTF and HTML without executing script text", async () => {
  for (const [name, bytes, expected] of [
    ["a.docx", docxFixture(), "中文文档测试"],
    ["a.odt", odtFixture(), "开放文档中文测试"],
    ["a.epub", epubFixture(), "电子书中文内容"],
    ["a.rtf", Buffer.from('{\\rtf1\\ansi\\uc1 Hello \\u20013?\\u25991?\\par Second paragraph}'), "中文"],
    ["a.html", Buffer.from('<!doctype html><html><body><h1>网页标题</h1><p>正文内容</p><script>DO_NOT_READ_SCRIPT</script><style>DO_NOT_READ_STYLE</style></body></html>'), "正文内容"],
  ]) {
    const result = await extractDocument(new File([bytes], name));
    assert.ok(result.content.includes(expected), `${name}: ${result.content}`);
    assert.ok(!result.content.includes("DO_NOT_READ"));
  }
});

test("extracts text PDFs and recognizes their signature under another extension", async () => {
  for (const name of ["a.pdf", "renamed.upload"]) {
    const result = await extractDocument(new File([pdfFixture()], name));
    assert.equal(result.format, "PDF");
    assert.ok(result.content.includes("Document upload test"));
  }
});

test("extracts spreadsheet cells and presentation text", async () => {
  for (const [name, fixture, expected] of [["a.xlsx", xlsxFixture(), "表格中文内容"], ["a.pptx", pptxFixture(), "幻灯片中文内容"]]) {
    const result = await extractDocument(new File([fixture], name));
    assert.ok(result.content.includes(expected), `${name}: ${result.content}`);
  }
});

test("rejects ZIP expansion excess and password-protected Office containers", async () => {
  const archive = zipDocument({ "word/document.xml": "a".repeat(17 * 1024 * 1024) });
  await assert.rejects(() => extractDocument(new File([archive], "bomb.docx")), /过大|复杂/);
  await assert.rejects(() => extractDocument(new File([Uint8Array.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1])], "encrypted.docx")), /密码/);
});

test("blank PDFs produce an actionable OCR message", async () => {
  await assert.rejects(() => extractDocument(new File([pdfFixture("", true)], "scan.pdf")), /OCR/);
});

test("rejects binary files, fake containers, excess text and file size clearly", async () => {
  for (const [name, bytes, pattern] of [
    ["a.png", Uint8Array.from([137,80,78,71,13,10,26,10]), /图片/],
    ["a.docx", Buffer.from("not a word document"), /格式不符/],
    ["a.pdf", Buffer.from("not a pdf"), /格式不符/],
    ["a.exe", Buffer.from("MZexecutable"), /可执行/],
    ["a.txt", Buffer.from("binary\0data"), /二进制/],
    ["a.txt", Buffer.from("x".repeat(24001)), /24,000/],
    ["a.txt", new Uint8Array(LIMITS.fileBytes + 1), /8 MB/],
  ]) await assert.rejects(() => extractDocument(new File([bytes], name)), pattern);
});
