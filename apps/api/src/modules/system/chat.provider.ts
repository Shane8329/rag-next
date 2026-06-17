import type { ChunkSearchResult } from "../ingestion/ingestion.types";

export const CHAT_PROVIDER = Symbol("CHAT_PROVIDER");

export interface QaContextGroup {
  companyName: string;
  chunks: ChunkSearchResult[];
}

export interface ChatAnswerRequest {
  questionText: string;
  contexts: QaContextGroup[];
}

export interface ChatProvider {
  readonly modelName: string;
  answerQuestion(request: ChatAnswerRequest): Promise<string>;
}

interface OpenAiCompatibleChatProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  modelName: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function requireValue(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function formatContexts(contexts: QaContextGroup[]): string {
  if (contexts.every((context) => context.chunks.length === 0)) {
    return "No retrieved context chunks were found.";
  }

  return contexts
    .map((context) => {
      const chunks = context.chunks
        .map(
          (chunk, index) =>
            [
              `[${index + 1}] company=${chunk.companyName}`,
              `document=${chunk.externalId}`,
              `pages=${chunk.pageStart}-${chunk.pageEnd}`,
              `score=${chunk.score.toFixed(4)}`,
              `text=${chunk.text}`
            ].join("\n")
        )
        .join("\n\n");

      return `Company: ${context.companyName}\n${chunks || "No chunks."}`;
    })
    .join("\n\n---\n\n");
}

function extractMessageContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const text = content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
          return item.text;
        }

        return "";
      })
      .join("\n")
      .trim();

    return text || undefined;
  }

  return undefined;
}

export class OpenAiCompatibleChatProvider implements ChatProvider {
  readonly modelName: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiCompatibleChatProviderOptions) {
    this.apiKey = requireValue(options.apiKey, "Chat API key");
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? "https://api.openai.com/v1");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.modelName = options.modelName;
  }

  async answerQuestion(request: ChatAnswerRequest): Promise<string> {
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      body: JSON.stringify({
        messages: [
          {
            content:
              "You are an enterprise knowledge-base assistant. Answer from the retrieved context only. If the context is insufficient, say so clearly. Keep page/document citations when useful.",
            role: "system"
          },
          {
            content: [`Question:\n${request.questionText}`, "Retrieved context:", formatContexts(request.contexts)].join("\n\n"),
            role: "user"
          }
        ],
        model: this.modelName,
        temperature: 0.2
      }),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      method: "POST"
    });

    if (!response.ok) {
      throw new Error(`Chat completion request failed (${response.status}): ${await response.text()}`);
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const content = extractMessageContent(payload.choices?.[0]?.message?.content);

    if (!content) {
      throw new Error("Chat completion response did not include message content");
    }

    return content;
  }
}

export class DashScopeChatProvider extends OpenAiCompatibleChatProvider {
  constructor(options: Partial<OpenAiCompatibleChatProviderOptions> = {}) {
    super({
      apiKey: options.apiKey ?? process.env.DASHSCOPE_API_KEY,
      baseUrl: options.baseUrl ?? process.env.DASHSCOPE_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",
      fetchImpl: options.fetchImpl,
      modelName: options.modelName ?? process.env.DASHSCOPE_CHAT_MODEL ?? "qwen-plus"
    });
  }
}

export class OpenAiChatProvider extends OpenAiCompatibleChatProvider {
  constructor(options: Partial<OpenAiCompatibleChatProviderOptions> = {}) {
    super({
      apiKey: options.apiKey ?? process.env.OPENAI_API_KEY,
      baseUrl: options.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      fetchImpl: options.fetchImpl,
      modelName: options.modelName ?? process.env.OPENAI_CHAT_MODEL ?? "gpt-4.1-mini"
    });
  }
}

export class ExtractiveChatProvider implements ChatProvider {
  readonly modelName = "extractive-local-v1";

  async answerQuestion(request: ChatAnswerRequest): Promise<string> {
    return request.contexts
      .map((context) => {
        const chunk = context.chunks[0];
        return chunk ? `${context.companyName}: ${chunk.text.slice(0, 120)}` : `${context.companyName}: no retrieved content.`;
      })
      .join("\n\n");
  }
}
