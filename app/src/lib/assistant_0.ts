import { requestChatCompletion, type LlmConfig, type LlmMessage } from "./llm-client";

// Online OpenAI-compatible model, used only as a fallback when the local model fails.
// Must never receive excerpts from ai/<dept>/docs.
export function onlineModelConfig(): LlmConfig | null {
  const baseUrl = process.env.ONLINE_LLM_BASE_URL;
  const model = process.env.ONLINE_LLM_MODEL;
  const apiKey = process.env.ONLINE_LLM_API_KEY;
  if (!baseUrl || !model || !apiKey) return null;
  return { baseUrl, model, apiKey };
}

export function callOnlineModel(config: LlmConfig, messages: LlmMessage[]): Promise<string> {
  return requestChatCompletion(config, messages);
}
