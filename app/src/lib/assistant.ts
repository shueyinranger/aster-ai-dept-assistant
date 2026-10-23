import type { ChatMessage, ModelProvider } from "@/types/chat";
import { DEPARTMENTS, type DepartmentId } from "./departments";
import { buildSystemPrompt } from "./rules";
import { loadDocumentContext, type DocumentContextResult } from "./document-router";
import { LlmError, type LlmMessage } from "./llm-client";
import { callLocalModel, localModelConfig } from "./assistant_1";
import { callOnlineModel, onlineModelConfig } from "./assistant_0";

interface GuardrailTopic {
  keywords: string[];
  reason: string;
}

// Fast, deterministic pre-filter mirroring the "禁止事項" sections in
// ai/<dept>/rules.md and the cross-department boundary in ai/core_rules.md.
// This runs before the model call so obvious violations never reach it
// (defense in depth) — the same rules are also included in the system prompt.
const GUARDRAILS: Record<DepartmentId, GuardrailTopic[]> = {
  hr: [
    { keywords: ["薪水", "薪資", "加薪", "獎金金額"], reason: "HR Assistant 不得決定或建議具體薪資數字" },
    { keywords: ["解雇", "資遣", "開除"], reason: "HR Assistant 不得決定或暗示任何員工的解雇結果" },
    { keywords: ["懲處", "記過", "處分"], reason: "HR Assistant 不得決定或建議懲處內容" },
    { keywords: ["割草機", "噴霧機", "報價", "客戶"], reason: "此問題屬於 Sales 部門範圍,HR Assistant 無法存取 Sales 資料" },
  ],
  sales: [
    { keywords: ["最終報價", "報價多少", "底價"], reason: "Sales Assistant 不得提供最終報價" },
    { keywords: ["折扣", "打折", "優惠多少"], reason: "Sales Assistant 不得自行承諾折扣" },
    { keywords: ["合約核准", "合約批准", "簽約"], reason: "Sales Assistant 不得進行合約批准" },
    { keywords: ["請假", "特休", "員工福利", "薪資", "個資"], reason: "此問題屬於 HR 部門範圍,Sales Assistant 無法存取 HR 資料" },
  ],
};

function findGuardrailHit(departmentId: DepartmentId, text: string): string | null {
  const hit = GUARDRAILS[departmentId].find((topic) =>
    topic.keywords.some((keyword) => text.includes(keyword))
  );
  return hit?.reason ?? null;
}

const FOLLOWUP_INSTRUCTION = `只有在使用者這一次的問題太籠統、有多種合理解讀，或缺少必要條件而無法在部門知識範圍內給出具體答案時，才先用一兩句話說明需要確認什麼，然後在回覆最後單獨一行輸出：
FOLLOWUPS: 具體問題A | 具體問題B | 具體問題C
每個選項必須是使用者可能原本想問的完整短句，緊扣他剛剛的用詞與本部門知識，2 到 3 個，彼此不要重複。不要解釋這一行。
若意圖已經清楚、可以直接回答，不要輸出 FOLLOWUPS 這一行，也不要再問是不是這個方向。`;

function directAnswerInstruction(question: string, earlierQuestion: string | null): string {
  const context = earlierQuestion
    ? `使用者原本說「${earlierQuestion}」，並已從建議中選定：「${question}」。`
    : `使用者已選定要問：「${question}」。`;
  return `${context}
這題意圖已經確定。請只根據部門知識直接回答選定的問題。
禁止反問、禁止確認「是不是這個方向」、禁止請使用者再選一次、禁止輸出 FOLLOWUPS。`;
}

function documentInstruction(context: string): string {
  return `# 內部文件節錄

以下節錄來自公司內部文件，由掃描檔自動轉寫，表格欄位可能錯位。
- 與 Knowledge Base 衝突時，以內部文件為準。
- 只根據節錄回答，不要補充節錄裡沒有的內容；節錄沒寫到就說文件中沒有提到。
- 每個重點後面用（來源：檔名，第 N 頁）標出出處。
- 節錄若為簡體中文，回答一律使用繁體中文。
- 涉及合同條款時，只說明文件怎麼寫，不替使用者做決定。

${context}`;
}

export function splitFollowUps(text: string): { content: string; followUps: string[] } {
  const match = text.match(/(?:^|\n)\s*FOLLOWUPS\s*[:：]\s*(.+)\s*$/i);
  if (!match || match.index === undefined) {
    return { content: text.trim(), followUps: [] };
  }

  const followUps = match[1]
    .split("|")
    .map((item) => item.replace(/^[\d]+[.)、]\s*/, "").replace(/^["「]|["」]$/g, "").trim())
    .filter((item) => item.length > 0 && item.length <= 48)
    .slice(0, 3);

  const content = text.slice(0, match.index).trim();
  return {
    content:
      content ||
      (followUps.length > 0 ? "這個問題可以有幾種意思，請選一個比較接近的：" : text.trim()),
    followUps,
  };
}

export interface AssistantResult {
  reply: ChatMessage;
  followUps: string[];
}

function plainReply(content: string, provider?: ModelProvider): AssistantResult {
  return { reply: { role: "assistant", content, ...(provider ? { provider } : {}) }, followUps: [] };
}

function localFailureText(error: LlmError): string {
  const { baseUrl, model } = localModelConfig();
  switch (error.kind) {
    case "connection":
      return `無法連線至本地模型（${baseUrl}）。請確認 Ollama 已啟動。`;
    case "model_not_found":
      return `找不到本地模型「${model}」。請先執行 ollama pull ${model}，或在 .env.local 設定 LLM_MODEL。`;
    case "empty":
      return `本地模型沒有回傳文字內容（${error.message}）。`;
    default:
      return `本地模型回傳錯誤：${error.message}`;
  }
}

function onlineFailureText(error: LlmError): string {
  switch (error.kind) {
    case "connection":
      return "也無法連線至線上模型，請檢查網路或 ONLINE_LLM_BASE_URL。";
    case "auth":
      return "線上模型的 API 金鑰無效，請檢查 .env.local 的 ONLINE_LLM_API_KEY。";
    case "model_not_found":
      return "線上模型名稱不存在，請檢查 ONLINE_LLM_MODEL。";
    case "http":
      return error.status === 429
        ? "線上模型目前請求量過大，請稍後再試。"
        : `線上模型也回傳錯誤（狀態碼 ${error.status}）。`;
    default:
      return "線上模型也沒有回傳文字內容。";
  }
}

async function findDocuments(departmentId: DepartmentId, question: string): Promise<DocumentContextResult> {
  const maxCharacters = Number(process.env.DOC_CONTEXT_MAX_CHARS) || undefined;
  try {
    return await loadDocumentContext({ departmentId, question, maxCharacters });
  } catch (error) {
    console.error("Document lookup failed:", error);
    return { searched: false, context: "", pendingPdfs: [] };
  }
}

export async function generateReply(
  departmentId: DepartmentId,
  messages: ChatMessage[],
  options?: { answerDirectly?: boolean }
): Promise<AssistantResult> {
  const department = DEPARTMENTS[departmentId];
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  const question = lastUserMessage?.content.trim() ?? "";

  if (!question) {
    return plainReply(`我是 ${department.name}。請問有什麼關於${department.tagline}的問題嗎?`);
  }

  const guardrailReason = findGuardrailHit(departmentId, question);
  if (guardrailReason) {
    return plainReply(
      `很抱歉,這個問題超出我的權限範圍。\n\n原因:${guardrailReason}。\n建議:請改洽相關窗口或主管處理。`
    );
  }

  const answerDirectly = options?.answerDirectly === true;
  const earlierQuestion =
    [...messages]
      .filter((message) => message.role === "user")
      .slice(0, -1)
      .pop()?.content.trim() || null;

  const documents = await findDocuments(departmentId, question);
  if (documents.pendingPdfs.length > 0) {
    console.warn(`尚未轉檔的 PDF（執行 npm run docs:extract）：${documents.pendingPdfs.join(", ")}`);
  }
  const usesInternalDocuments = documents.context.length > 0;

  const basePrompt = [
    buildSystemPrompt(departmentId),
    answerDirectly ? directAnswerInstruction(question, earlierQuestion) : FOLLOWUP_INSTRUCTION,
  ].join("\n\n");

  const conversation: LlmMessage[] = answerDirectly
    ? [{ role: "user", content: question }]
    : messages.map((message) => ({ role: message.role, content: message.content }));

  const localPrompt = usesInternalDocuments
    ? `${basePrompt}\n\n---\n\n${documentInstruction(documents.context)}`
    : basePrompt;

  const toResult = (raw: string, provider: ModelProvider): AssistantResult => {
    const { content, followUps } = splitFollowUps(raw);
    return {
      reply: { role: "assistant", content, provider },
      followUps: answerDirectly ? [] : followUps,
    };
  };

  try {
    const raw = await callLocalModel([{ role: "system", content: localPrompt }, ...conversation]);
    return toResult(raw, "local");
  } catch (error) {
    if (!(error instanceof LlmError)) throw error;
    console.error("Local LLM error:", error.kind, error.message);

    const localReason = localFailureText(error);

    // Internal documents never leave the machine, so there is no online fallback here.
    if (usesInternalDocuments) {
      return plainReply(
        `${localReason}\n\n這個問題需要引用內部文件，內部文件只交給本地模型處理，因此不會改用線上模型。請在本地模型恢復後再試。`
      );
    }

    // The model was reached but rejected the request; online would not fix a setup mistake.
    if (error.kind === "model_not_found") {
      return plainReply(localReason);
    }

    const onlineConfig = onlineModelConfig();
    if (!onlineConfig) {
      return plainReply(
        `${localReason}\n\n若要在本地失敗時改用線上模型，請在 .env.local 設定 ONLINE_LLM_BASE_URL、ONLINE_LLM_API_KEY、ONLINE_LLM_MODEL。`
      );
    }

    try {
      // Earlier local replies may quote internal documents, so the online model only sees this question.
      const raw = await callOnlineModel(onlineConfig, [
        { role: "system", content: basePrompt },
        { role: "user", content: question },
      ]);
      return toResult(raw, "online");
    } catch (onlineError) {
      if (!(onlineError instanceof LlmError)) throw onlineError;
      console.error("Online LLM error:", onlineError.kind, onlineError.message);
      return plainReply(`${localReason}\n${onlineFailureText(onlineError)}`);
    }
  }
}
