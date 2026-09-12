export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequestBody {
  departmentId: string;
  messages: ChatMessage[];
}

export interface ChatResponseBody {
  reply: ChatMessage;
}
