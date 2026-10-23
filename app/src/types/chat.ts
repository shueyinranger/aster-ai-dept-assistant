export type ChatRole = "user" | "assistant";

export type ModelProvider = "local" | "online";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Which model produced an assistant reply; absent for rule-based replies. */
  provider?: ModelProvider;
}

export interface ChatRequestBody {
  departmentId: string;
  messages: ChatMessage[];
  /** The latest user message was chosen from a follow-up button. */
  selectedFollowUp?: boolean;
}

export interface ChatResponseBody {
  reply: ChatMessage;
  /** Present when the question was too vague to answer directly. */
  followUps?: string[];
}
