import fs from "node:fs/promises";
import path from "node:path";
import * as OpenCC from "opencc-js";
import { DEPARTMENTS, type DepartmentId } from "./departments";

// 與目前 rules.ts 使用相同的目錄定位方式。
// 假設 Next.js 從 repo-root/app 啟動。
const AI_DIR = path.join(process.cwd(), "..", "ai");

// PDF 不在提問時解析：掃描檔需要 OCR，一份要好幾分鐘。
// 先執行 `npm run docs:extract`，產生同名 .md，這裡只讀 .md / .txt。
const TEXT_EXTENSIONS = new Set([".md", ".txt"]);

const CHUNK_SIZE = 600;
const CHUNK_OVERLAP = 100;

// Ollama defaults to a 4096-token context; Chinese runs about 0.6 token per character,
// so 2500 characters leaves room for the rules, the question and the answer.
const DEFAULT_MAX_CHUNKS = 4;
const DEFAULT_MAX_CHARACTERS = 2500;

// 文件多為簡體、提問多為繁體，比對前一律轉成簡體。
const toSimplified = OpenCC.Converter({ from: "tw", to: "cn" });

// 問句裡常見、但對找段落沒有幫助的雙字詞。
const STOP_TERMS = new Set(
  ["怎麼", "怎樣", "什麼", "請問", "可以", "是否", "如何", "多少", "哪些", "有沒", "沒有", "需要", "一下", "我們", "公司"].map(
    (term) => toSimplified(term)
  )
);

interface DocumentTopic {
  name: string;
  keywords: string[];
}

// HR 分類依目前 rules.md 的可回答範圍設定。
// Sales 尚未設定，因此目前不會觸發 Sales 文件搜尋。
const DOCUMENT_TOPICS: Partial<Record<DepartmentId, DocumentTopic[]>> = {
  hr: [
    {
      name: "請假制度",
      keywords: ["請假", "休假", "假別", "假期", "特休", "年假", "病假", "事假", "婚假", "喪假", "產假", "陪產假", "補休", "調休"],
    },
    {
      name: "員工福利",
      keywords: ["員工福利", "公司福利", "福利", "福利申請", "福利補助"],
    },
    {
      name: "新人報到",
      keywords: ["新人報到", "新人", "報到", "入職", "到職", "入職文件", "報到資料", "新進員工"],
    },
    {
      name: "公司基本制度",
      keywords: ["公司基本制度", "公司制度", "公司規定", "公司規章", "員工手冊", "出勤", "考勤", "打卡", "遲到", "早退", "上班時間", "下班時間", "班次", "排班", "加班", "工作日曆"],
    },
    {
      name: "用友系統時間管理藍圖方案",
      keywords: ["用友", "用友系統", "時間管理藍圖", "時間管理方案", "時間管理藍圖方案"],
    },
    {
      name: "合同",
      keywords: ["合同", "合約", "勞動合同", "勞動契約", "試用期", "保密", "競業", "終止", "解除"],
    },
    {
      name: "HR FAQ",
      keywords: ["hr faq", "hrfaq", "hr 常見問題", "hr常見問題", "人資常見問題", "人事常見問題"],
    },
  ],
};

interface DocumentChunk {
  sourceFile: string;
  page: number | null;
  chunkNumber: number;
  text: string;
  normalized: string;
}

interface CachedFile {
  signature: string;
  chunks: DocumentChunk[];
}

interface ScoredChunk extends DocumentChunk {
  score: number;
}

export interface LoadDocumentContextOptions {
  departmentId: DepartmentId;
  question: string;
  maxChunks?: number;
  maxCharacters?: number;
}

export interface DocumentContextResult {
  /** 問題有觸發文件搜尋。 */
  searched: boolean;
  /** 可放進 prompt 的節錄；沒有匹配時為空字串。 */
  context: string;
  /** 還沒轉成 .md 的 PDF，提問時讀不到。 */
  pendingPdfs: string[];
}

// 快取只存在目前服務程序的記憶體中。
const fileCache = new Map<string, CachedFile>();

function normalizeText(text: string): string {
  return toSimplified(text.normalize("NFKC").toLowerCase()).replace(/\s+/g, " ").trim();
}

function shouldSearchDocuments(departmentId: DepartmentId, question: string): boolean {
  const normalizedQuestion = normalizeText(question);
  const topics = DOCUMENT_TOPICS[departmentId] ?? [];
  return topics.some((topic) =>
    topic.keywords.some((keyword) => normalizedQuestion.includes(normalizeText(keyword)))
  );
}

interface PageText {
  page: number | null;
  text: string;
}

// docs:extract 產生的 .md 以 `<!-- page: N ... -->` 分頁；一般 .md 視為沒有頁碼。
function splitIntoPages(markdown: string): PageText[] {
  const marker = /<!--\s*page:\s*(\d+)[^>]*-->/g;
  const pages: PageText[] = [];
  const matches = [...markdown.matchAll(marker)];

  if (matches.length === 0) {
    return [{ page: null, text: markdown }];
  }

  matches.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? markdown.length;
    pages.push({ page: Number(match[1]), text: markdown.slice(start, end) });
  });
  return pages;
}

function splitIntoChunks(sourceFile: string, markdown: string): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const step = CHUNK_SIZE - CHUNK_OVERLAP;

  for (const { page, text: rawText } of splitIntoPages(markdown)) {
    const text = rawText.replace(/<!--[\s\S]*?-->/g, "").trim();

    for (let start = 0; start < text.length; start += step) {
      const content = text.slice(start, start + CHUNK_SIZE).trim();
      if (content) {
        chunks.push({
          sourceFile,
          page,
          chunkNumber: chunks.length + 1,
          text: content,
          normalized: normalizeText(content),
        });
      }
      if (start + CHUNK_SIZE >= text.length) break;
    }
  }

  return chunks;
}

async function loadFileChunks(fullPath: string, sourceFile: string): Promise<DocumentChunk[]> {
  const stat = await fs.stat(fullPath);
  const signature = `${stat.mtimeMs}:${stat.size}`;

  const cached = fileCache.get(fullPath);
  if (cached?.signature === signature) {
    return cached.chunks;
  }

  const text = (await fs.readFile(fullPath, "utf-8")).trim();
  const chunks = text ? splitIntoChunks(sourceFile, text) : [];
  fileCache.set(fullPath, { signature, chunks });
  return chunks;
}

// 中文使用相鄰雙字匹配；英文和數字使用完整詞。
// 例如「請病假」會產生「请病」「病假」。
function buildQueryTerms(question: string): string[] {
  const normalized = normalizeText(question);
  const terms = new Set<string>();

  for (const run of normalized.match(/[\u3400-\u9fff]+/g) ?? []) {
    if (run.length === 1) {
      terms.add(run);
      continue;
    }
    for (let index = 0; index < run.length - 1; index++) {
      terms.add(run.slice(index, index + 2));
    }
  }

  for (const term of normalized.match(/[a-z0-9]+/g) ?? []) {
    terms.add(term);
  }

  return [...terms].filter((term) => !STOP_TERMS.has(term));
}

function scoreChunk(chunk: DocumentChunk, queryTerms: string[]): number {
  const fileName = normalizeText(chunk.sourceFile);
  let score = 0;
  for (const term of queryTerms) {
    if (chunk.normalized.includes(term)) score += 1;
    if (fileName.includes(term)) score += 2;
  }
  return score;
}

function clearDeletedFileCache(docsDir: string, activePaths: Set<string>): void {
  for (const cachedPath of fileCache.keys()) {
    if (path.dirname(cachedPath) === docsDir && !activePaths.has(cachedPath)) {
      fileCache.delete(cachedPath);
    }
  }
}

async function listDocsDir(docsDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(docsDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function formatSource(chunk: DocumentChunk): string {
  return chunk.page === null ? chunk.sourceFile : `${chunk.sourceFile}，第 ${chunk.page} 頁`;
}

/**
 * 依部門與問題：
 * 1. 判斷是否觸發文件搜尋。
 * 2. 讀取已轉檔的文件。
 * 3. 選取匹配段落。
 * 4. 組合可加入 prompt 的文字（含來源檔名與頁碼）。
 */
export async function loadDocumentContext({
  departmentId,
  question,
  maxChunks = DEFAULT_MAX_CHUNKS,
  maxCharacters = DEFAULT_MAX_CHARACTERS,
}: LoadDocumentContextOptions): Promise<DocumentContextResult> {
  if (!Object.prototype.hasOwnProperty.call(DEPARTMENTS, departmentId)) {
    throw new Error("未知的部門");
  }
  if (!Number.isInteger(maxChunks) || maxChunks < 1 || !Number.isInteger(maxCharacters) || maxCharacters < 1) {
    throw new Error("maxChunks 與 maxCharacters 必須是正整數");
  }

  const trimmedQuestion = question.trim();
  if (!trimmedQuestion || !shouldSearchDocuments(departmentId, trimmedQuestion)) {
    return { searched: false, context: "", pendingPdfs: [] };
  }

  const docsDir = path.join(AI_DIR, departmentId, "docs");
  const allFiles = await listDocsDir(docsDir);
  const fileSet = new Set(allFiles);

  const textFiles = allFiles.filter((name) => TEXT_EXTENSIONS.has(path.extname(name).toLowerCase()));
  const pendingPdfs = allFiles.filter(
    (name) =>
      path.extname(name).toLowerCase() === ".pdf" &&
      !fileSet.has(`${path.basename(name, path.extname(name))}.md`)
  );

  clearDeletedFileCache(docsDir, new Set(textFiles.map((name) => path.join(docsDir, name))));

  const queryTerms = buildQueryTerms(trimmedQuestion);
  const candidates: ScoredChunk[] = [];

  for (const fileName of textFiles) {
    // Cite the original PDF rather than its extracted Markdown.
    const sourcePdf = `${path.basename(fileName, path.extname(fileName))}.pdf`;
    const displayName = fileSet.has(sourcePdf) ? sourcePdf : fileName;
    const chunks = await loadFileChunks(path.join(docsDir, fileName), displayName);
    for (const chunk of chunks) {
      const score = scoreChunk(chunk, queryTerms);
      if (score > 0) candidates.push({ ...chunk, score });
    }
  }

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      a.sourceFile.localeCompare(b.sourceFile) ||
      a.chunkNumber - b.chunkNumber
  );

  const sections: string[] = [];
  let remainingCharacters = maxCharacters;

  for (const candidate of candidates) {
    if (sections.length >= maxChunks || remainingCharacters <= 0) break;

    const separator = sections.length > 0 ? "\n\n---\n\n" : "";
    const header = `## 來源：${formatSource(candidate)}\n\n`;
    const availableCharacters = remainingCharacters - separator.length - header.length;
    if (availableCharacters <= 0) continue;

    const text = candidate.text.slice(0, availableCharacters).trim();
    if (!text) continue;

    const section = `${separator}${header}${text}`;
    sections.push(section);
    remainingCharacters -= section.length;
  }

  return { searched: true, context: sections.join(""), pendingPdfs };
}
