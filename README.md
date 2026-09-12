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

需在 `app/.env.local` 設定 `ANTHROPIC_API_KEY`(範例見 `app/.env.example`)才能取得真實回覆。

## 架構重點

- `app/src/lib/departments.ts` 定義部門清單(id、名稱、對應的 `ai/` 規則路徑)。
- `app/src/lib/rules.ts` 在執行時讀取 `ai/core_rules.md` 與各部門的 `rules.md`、`knowledge.md`,組成該部門的 system prompt(`buildSystemPrompt`)。
- `app/src/lib/assistant.ts` 是回覆產生邏輯:先用簡單關鍵字比對做 `ai/*/rules.md` 中「禁止事項」與跨部門邊界的第一層把關,其餘問題會呼叫 Anthropic Claude API(`claude-opus-5`),並把 `buildSystemPrompt()` 的結果當作 system prompt 傳入,讓模型在 `ai/` 規則與知識庫範圍內回答。
- `app/src/app/api/chat/route.ts` 是唯一的聊天API端點(`POST /api/chat`),前端 `ChatApp`/`ChatWindow` 元件負責UI與狀態。
- `ai/` 規則檔獨立於 `app/` 之外,方便非工程人員直接編輯規則與知識庫內容而不需碰程式碼。
