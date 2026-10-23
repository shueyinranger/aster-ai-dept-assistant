# Department AI Bot MVP

模擬公司Aster Machinery的雙部門(HR/Sales)AI助理原型。

目錄結構:
- ai/core_rules.md 全域規則
- ai/hr/ HR部門規則與知識庫
- ai/sales/ Sales部門規則與知識庫
- app/ Next.js 前端與API(App Router + TypeScript + Tailwind CSS)

## 開發

```bash
cd app
npm install
npm run dev
```

開啟 http://localhost:3000,可切換 HR / Sales 分頁對話。

回覆預設走本機 Ollama（`http://127.0.0.1:11434`，模型 `gemma4:e2b`）。請先啟動 Ollama。若要換端點或模型，在 `app/.env.local` 設定 `LLM_BASE_URL` 與 `LLM_MODEL`（範例見 `app/.env.example`）。本地模型失敗時，若有設定 `ONLINE_LLM_*`，會改用線上 OpenAI 相容模型。

### 內部文件（PDF）

把 PDF 放進 `ai/<部門>/docs/` 後執行一次：

```bash
cd app
npm run docs:extract
```

會在同一資料夾產生同名 `.md`：有文字層的頁直接抽取，掃描頁交給本地模型 OCR，全程不離開本機。PDF 新增或修改後再跑一次即可，沒變的檔案會略過；中斷後重跑會從斷掉的頁接續。`ai/*/docs/` 已列入 `.gitignore`。

## 架構重點

- `app/src/lib/departments.ts` 定義部門清單(id、名稱、對應的 `ai/` 規則路徑)。
- `app/src/lib/rules.ts` 在執行時讀取 `ai/core_rules.md` 與各部門的 `rules.md`、`knowledge.md`,組成該部門的 system prompt(`buildSystemPrompt`)。
- `app/src/lib/assistant.ts` 是回覆產生邏輯:先用簡單關鍵字比對做 `ai/*/rules.md` 中「禁止事項」與跨部門邊界的第一層把關,再用 `document-router.ts` 找相關的內部文件段落，接著呼叫本地模型（`assistant_1.ts`），失敗時改用線上模型（`assistant_0.ts`）。內部文件段落只會交給本地模型。
- `app/src/lib/document-router.ts` 依問題主題搜尋 `ai/<部門>/docs/` 已轉檔的 `.md`，繁簡統一後比對，回傳帶檔名與頁碼的節錄。
- `app/scripts/extract-docs.mjs` 是 `npm run docs:extract` 的轉檔腳本。
- `app/src/app/api/chat/route.ts` 是唯一的聊天API端點(`POST /api/chat`),前端 `ChatApp`/`ChatWindow` 元件負責UI與狀態。
- `ai/` 規則檔獨立於 `app/` 之外,方便非工程人員直接編輯規則與知識庫內容而不需碰程式碼。
