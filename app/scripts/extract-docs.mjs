// Converts ai/<dept>/docs/*.pdf into same-name .md files that document-router.ts can search.
// Pages with a text layer are copied directly; scanned pages are OCR'd by the local model.
// Nothing is sent off this machine.
//
//   npm run docs:extract            convert new or changed PDFs
//   npm run docs:extract -- --force  reconvert everything
//   npm run docs:extract -- hr       only one department

import fs from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const AI_DIR = path.join(process.cwd(), "..", "ai");
const PDFJS_DIR = path.join(process.cwd(), "node_modules", "pdfjs-dist").replaceAll("\\", "/");

const OLLAMA_URL = (
  process.env.OCR_OLLAMA_URL ??
  (process.env.LLM_BASE_URL ?? "http://127.0.0.1:11434/v1").replace(/\/v1\/?$/, "")
).replace(/\/$/, "");
const OCR_MODEL = process.env.OCR_MODEL ?? process.env.LLM_MODEL ?? "gemma4:e2b";

// Below this many non-space characters a page is treated as scanned.
const MIN_TEXT_LAYER_CHARS = 30;
const RENDER_SCALE = 2;

const OCR_PROMPT = `把這一頁的文字逐字轉成 Markdown。
- 保留原文用字（簡體就保留簡體），不要翻譯。
- 保留標題層級；表格用 Markdown 表格。
- 頁面邊緣的批註用「> 批註：」標出。
- 只輸出頁面上看得到的文字，看不清楚的字用 □ 表示。
- 不要摘要，不要加任何說明。`;

const args = process.argv.slice(2);
const force = args.includes("--force");
const onlyDepartments = args.filter((arg) => !arg.startsWith("--"));

function signatureOf(stat) {
  return `${stat.size}:${Math.round(stat.mtimeMs)}`;
}

function headerOf(fileName, signature, totalPages) {
  return `<!-- source: ${fileName} | signature: ${signature} | pages: ${totalPages} -->`;
}

async function readIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function pageTextLayer(page) {
  const content = await page.getTextContent();
  return content.items
    .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : ""))
    .join("")
    .trim();
}

async function renderPagePng(page) {
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport }).promise;
  return canvas.encode("png");
}

// Small vision models sometimes loop on one table row until the token limit.
const MAX_REPEATED_LINES = 2;

function cleanOcrOutput(text) {
  const lines = text
    .replace(/^```(?:markdown)?\s*|\s*```$/g, "")
    .split("\n")
    .filter((line) => !/^\s*\|(\s*\|)+\s*$/.test(line));

  const kept = [];
  let previous = null;
  let runLength = 0;
  for (const line of lines) {
    const current = line.trim();
    runLength = current !== "" && current === previous ? runLength + 1 : 1;
    previous = current;

    if (runLength <= MAX_REPEATED_LINES) {
      kept.push(line);
    } else if (runLength === MAX_REPEATED_LINES + 1) {
      kept.push("> （OCR 重複輸出同一行，以下已省略，請對照原 PDF）");
    }
  }

  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function ocrPage(png) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OCR_MODEL,
          stream: false,
          think: false,
          options: { temperature: 0, num_predict: 3000, repeat_penalty: 1.15 },
          messages: [{ role: "user", content: OCR_PROMPT, images: [Buffer.from(png).toString("base64")] }],
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
      const text = cleanOcrOutput(data?.message?.content ?? "");
      if (!text) throw new Error("OCR 沒有回傳文字");
      return text;
    } catch (error) {
      lastError = error;
      console.warn(`    OCR 第 ${attempt} 次失敗：${error.message}`);
    }
  }
  throw lastError;
}

function donePages(partial) {
  return new Set([...partial.matchAll(/<!--\s*page:\s*(\d+)/g)].map((match) => Number(match[1])));
}

async function extractPdf(docsDir, fileName) {
  const pdfPath = path.join(docsDir, fileName);
  const baseName = path.basename(fileName, path.extname(fileName));
  const mdPath = path.join(docsDir, `${baseName}.md`);
  const partialPath = `${mdPath}.partial`;
  const signature = signatureOf(await fs.stat(pdfPath));

  const existing = await readIfExists(mdPath);
  if (!force && existing?.includes(`signature: ${signature}`)) {
    console.log(`  略過（已是最新）：${fileName}`);
    return;
  }

  const loadingTask = getDocument({
    data: new Uint8Array(await fs.readFile(pdfPath)),
    wasmUrl: `${PDFJS_DIR}/wasm/`,
    standardFontDataUrl: `${PDFJS_DIR}/standard_fonts/`,
    cMapUrl: `${PDFJS_DIR}/cmaps/`,
    cMapPacked: true,
    verbosity: 0,
  });

  try {
    const pdf = await loadingTask.promise;
    const header = headerOf(fileName, signature, pdf.numPages);

    let partial = force ? null : await readIfExists(partialPath);
    if (!partial?.startsWith(header)) {
      partial = `${header}\n`;
      await fs.writeFile(partialPath, partial, "utf-8");
    }
    const finished = donePages(partial);
    if (finished.size > 0) {
      console.log(`  接續上次進度：已完成 ${finished.size}/${pdf.numPages} 頁`);
    }

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      if (finished.has(pageNumber)) continue;

      const started = Date.now();
      const page = await pdf.getPage(pageNumber);
      const layerText = await pageTextLayer(page);
      const useTextLayer = layerText.replace(/\s/g, "").length >= MIN_TEXT_LAYER_CHARS;
      const method = useTextLayer ? "text" : "ocr";
      const body = useTextLayer ? layerText : await ocrPage(await renderPagePng(page));
      page.cleanup();

      const block = `\n<!-- page: ${pageNumber} | method: ${method} -->\n## 第 ${pageNumber} 頁\n\n${body}\n`;
      await fs.appendFile(partialPath, block, "utf-8");
      console.log(`  第 ${pageNumber}/${pdf.numPages} 頁（${method}，${((Date.now() - started) / 1000).toFixed(1)}s）`);
    }

    const pages = (await fs.readFile(partialPath, "utf-8")).slice(header.length);
    const methods = [...pages.matchAll(/method:\s*(text|ocr)/g)].map((match) => match[1]);
    const ocrCount = methods.filter((method) => method === "ocr").length;
    const note =
      ocrCount > 0
        ? `> 由 \`${fileName}\` 自動轉檔：文字層 ${methods.length - ocrCount} 頁、本地模型 OCR ${ocrCount} 頁。OCR 的表格欄位可能錯位，引用前請對照原 PDF。`
        : `> 由 \`${fileName}\` 自動轉檔（全部取自文字層）。`;

    await fs.writeFile(mdPath, `${header}\n# ${baseName}\n\n${note}\n${pages}`, "utf-8");
    await fs.rm(partialPath, { force: true });
    console.log(`  完成：${path.relative(AI_DIR, mdPath)}`);
  } finally {
    await loadingTask.destroy();
  }
}

async function main() {
  const departments = (await fs.readdir(AI_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => onlyDepartments.length === 0 || onlyDepartments.includes(name));

  console.log(`OCR 模型：${OCR_MODEL}（${OLLAMA_URL}）`);
  let failures = 0;

  for (const department of departments) {
    const docsDir = path.join(AI_DIR, department, "docs");
    const pdfs = (await fs.readdir(docsDir).catch(() => [])).filter((name) => name.toLowerCase().endsWith(".pdf"));
    if (pdfs.length === 0) continue;

    console.log(`[${department}] ${pdfs.length} 份 PDF`);
    for (const fileName of pdfs.sort()) {
      console.log(`  處理：${fileName}`);
      try {
        await extractPdf(docsDir, fileName);
      } catch (error) {
        failures++;
        console.error(`  失敗：${fileName}：${error.message}（下次執行會從中斷的頁接續）`);
      }
    }
  }

  if (failures > 0) process.exitCode = 1;
}

await main();
