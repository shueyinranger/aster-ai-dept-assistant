export interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Provider-specific request fields, e.g. `reasoning_effort` for Ollama. */
  extraBody?: Record<string, unknown>;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type LlmErrorKind = "connection" | "model_not_found" | "auth" | "http" | "empty";

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "LlmError";
  }
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
  error?: { message?: string } | string;
}

function errorDetail(data: ChatCompletionResponse | null, status: number): string {
  if (typeof data?.error === "string") return data.error;
  return data?.error?.message ?? `HTTP ${status}`;
}

/** Calls any OpenAI-compatible `/chat/completions` endpoint (Ollama, LM Studio, OpenAI, ...). */
export async function requestChatCompletion(
  config: LlmConfig,
  messages: LlmMessage[],
  temperature = 0.3
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({ ...config.extraBody, model: config.model, temperature, messages }),
    });
  } catch (error) {
    throw new LlmError("connection", error instanceof Error ? error.message : String(error));
  }

  const data = (await response.json().catch(() => null)) as ChatCompletionResponse | null;

  if (!response.ok) {
    const detail = errorDetail(data, response.status);
    if (response.status === 401 || response.status === 403) {
      throw new LlmError("auth", detail, response.status);
    }
    if (response.status === 404) {
      throw new LlmError("model_not_found", detail, response.status);
    }
    throw new LlmError("http", detail, response.status);
  }

  const choice = data?.choices?.[0];
  const text = choice?.message?.content?.trim();
  if (!text) {
    throw new LlmError(
      "empty",
      choice?.finish_reason === "length" ? "輸出被截斷（上下文長度不足）" : "模型未回傳文字內容"
    );
  }
  return text;
}
