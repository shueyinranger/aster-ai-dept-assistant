import { requestChatCompletion, type LlmConfig, type LlmMessage } from "./llm-client";

// Local model (Ollama by default). Internal documents are only ever sent here.
const DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_MODEL = "gemma4:e2b";

// gemma4 thinks by default and can spend its whole output budget on reasoning,
// leaving the reply empty. Set LLM_REASONING_EFFORT="" for servers that reject the field.
const DEFAULT_REASONING_EFFORT = "none";

export function localModelConfig(): LlmConfig {
  const reasoningEffort = process.env.LLM_REASONING_EFFORT ?? DEFAULT_REASONING_EFFORT;
  return {
    baseUrl: process.env.LLM_BASE_URL ?? DEFAULT_BASE_URL,
    model: process.env.LLM_MODEL ?? DEFAULT_MODEL,
    apiKey: process.env.LLM_API_KEY,
    extraBody: reasoningEffort ? { reasoning_effort: reasoningEffort } : undefined,
  };
}

export function callLocalModel(messages: LlmMessage[]): Promise<string> {
  return requestChatCompletion(localModelConfig(), messages);
}
