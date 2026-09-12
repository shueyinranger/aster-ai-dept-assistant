import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage } from "@/types/chat";
import { DEPARTMENTS, type DepartmentId } from "./departments";
import { buildSystemPrompt } from "./rules";

const MODEL = "claude-opus-5";

// Lazily constructed so the module can be imported (e.g. by route handlers)
// without requiring ANTHROPIC_API_KEY to be set at build time.
let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

interface GuardrailTopic {
  keywords: string[];
  reason: string;
}

// Fast, deterministic pre-filter mirroring the "禁止事項" sections in
// ai/<dept>/rules.md and the cross-department boundary in ai/core_rules.md.
// This runs before the API call so obvious violations never reach the model
// (defense in depth) - the same rules are also included in the system
// prompt below so Claude enforces them on everything else.
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

export async function generateReply(
  departmentId: DepartmentId,
  messages: ChatMessage[]
): Promise<ChatMessage> {
  const department = DEPARTMENTS[departmentId];
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  const question = lastUserMessage?.content.trim() ?? "";

  if (!question) {
    return {
      role: "assistant",
      content: `我是 ${department.name}。請問有什麼關於${department.tagline}的問題嗎?`,
    };
  }

  const guardrailReason = findGuardrailHit(departmentId, question);
  if (guardrailReason) {
    return {
      role: "assistant",
      content: `很抱歉,這個問題超出我的權限範圍。\n\n原因:${guardrailReason}。\n建議:請改洽相關窗口或主管處理。`,
    };
  }

  const systemPrompt = buildSystemPrompt(departmentId);
  const anthropicMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      messages: anthropicMessages,
    });

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text"
    );

    return {
      role: "assistant",
      content: textBlock?.text ?? "(模型未回傳文字內容,請稍後再試。)",
    };
  } catch (error) {
    console.error("Anthropic API error:", error);

    if (error instanceof Anthropic.AuthenticationError) {
      return {
        role: "assistant",
        content: "系統設定錯誤:API 金鑰無效或未設定,請聯絡系統管理員檢查 .env.local。",
      };
    }
    if (error instanceof Anthropic.RateLimitError) {
      return {
        role: "assistant",
        content: "目前請求量過大,請稍後再試一次。",
      };
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return {
        role: "assistant",
        content: "無法連線至 AI 服務,請檢查網路連線後再試。",
      };
    }
    if (error instanceof Anthropic.APIError) {
      return {
        role: "assistant",
        content: `AI 服務發生錯誤(狀態碼 ${error.status}),請稍後再試。`,
      };
    }
    return {
      role: "assistant",
      content: "發生未知錯誤,請稍後再試。",
    };
  }
}
