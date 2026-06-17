import { Injectable } from "@nestjs/common";

export const EMBEDDING_PROVIDER = Symbol("EMBEDDING_PROVIDER");
const STORAGE_EMBEDDING_DIMENSION = 1536;
const DASHSCOPE_REQUEST_DIMENSIONS = 1024;
const DASHSCOPE_MAX_BATCH_SIZE = 10;
const DASHSCOPE_MAX_INPUT_LENGTH = 8000;

export interface EmbeddingProvider {
  readonly modelName: string;
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

interface OpenAiCompatibleEmbeddingProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  batchSize?: number;
  dimensions?: number;
  fetchImpl?: typeof fetch;
  modelName: string;
}

interface EmbeddingResponse {
  data?: Array<{
    embedding?: unknown;
  }>;
}

function normalizeVector(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    return values;
  }

  return values.map((value) => value / norm);
}

function keywordVector(text: string): number[] {
  const normalized = text.toLowerCase();
  const values = Array.from({ length: STORAGE_EMBEDDING_DIMENSION }, () => 0);

  addKeyword(values, normalized, ["research", "r and d", "rnd"], 0);
  addKeyword(values, normalized, ["capacity", "manufacturing", "production"], 1);
  addKeyword(values, normalized, ["investment", "spend", "expense"], 2);
  addKeyword(values, normalized, ["process", "technology", "advanced"], 3);

  for (const char of normalized) {
    const code = char.codePointAt(0) ?? 0;
    values[code % STORAGE_EMBEDDING_DIMENSION] += 0.01;
  }

  return normalizeVector(values);
}

function addKeyword(values: number[], text: string, keywords: string[], offset: number) {
  const matchedCount = keywords.reduce((count, keyword) => count + (text.includes(keyword) ? 1 : 0), 0);
  values[offset] += matchedCount * 10;
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

function parseEmbedding(value: unknown): number[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "number")) {
    throw new Error("Embedding response contained an invalid embedding vector");
  }

  return value;
}

function padEmbedding(values: number[], targetLength = STORAGE_EMBEDDING_DIMENSION): number[] {
  if (values.length === targetLength) {
    return values;
  }

  if (values.length > targetLength) {
    return values.slice(0, targetLength);
  }

  return [...values, ...Array.from({ length: targetLength - values.length }, () => 0)];
}

function parseOptionalPositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) {
    return [];
  }

  const length = vectors[0]?.length ?? 0;
  const averaged = Array.from({ length }, (_, index) => {
    const sum = vectors.reduce((total, vector) => total + (vector[index] ?? 0), 0);
    return sum / vectors.length;
  });

  return normalizeVector(averaged);
}

function splitTextForDashScope(text: string): string[] {
  if (text.length <= DASHSCOPE_MAX_INPUT_LENGTH) {
    return [text];
  }

  const chunks: string[] = [];

  for (let index = 0; index < text.length; index += DASHSCOPE_MAX_INPUT_LENGTH) {
    chunks.push(text.slice(index, index + DASHSCOPE_MAX_INPUT_LENGTH));
  }

  return chunks;
}

@Injectable()
export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly modelName = "deterministic-local-v1";

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return texts.map((text) => keywordVector(text));
  }

  async embedQuery(text: string): Promise<number[]> {
    return keywordVector(text);
  }
}

export class OpenAiCompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly modelName: string;

  private readonly apiKey: string;
  private readonly batchSize: number | undefined;
  private readonly baseUrl: string;
  private readonly dimensions: number | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiCompatibleEmbeddingProviderOptions) {
    this.apiKey = requireValue(options.apiKey, "Embedding API key");
    this.batchSize = options.batchSize;
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? "https://api.openai.com/v1");
    this.dimensions = options.dimensions;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.modelName = options.modelName;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    if (this.batchSize && texts.length > this.batchSize) {
      const embeddings: number[][] = [];

      for (let start = 0; start < texts.length; start += this.batchSize) {
        embeddings.push(...(await this.embedDocuments(texts.slice(start, start + this.batchSize))));
      }

      return embeddings;
    }

    const response = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
      body: JSON.stringify({
        ...(this.dimensions ? { dimensions: this.dimensions } : {}),
        input: texts,
        model: this.modelName
      }),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      method: "POST"
    });

    if (!response.ok) {
      throw new Error(`Embedding request failed (${response.status}): ${await response.text()}`);
    }

    const payload = (await response.json()) as EmbeddingResponse;
    const embeddings = payload.data?.map((item) => padEmbedding(parseEmbedding(item.embedding))) ?? [];

    if (embeddings.length !== texts.length) {
      throw new Error(`Embedding response count ${embeddings.length} did not match input count ${texts.length}`);
    }

    return embeddings;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [embedding] = await this.embedDocuments([text]);

    if (!embedding) {
      throw new Error("Embedding response did not include a query embedding");
    }

    return embedding;
  }
}

@Injectable()
export class OpenAiEmbeddingProvider extends OpenAiCompatibleEmbeddingProvider {
  constructor(options: Partial<OpenAiCompatibleEmbeddingProviderOptions> = {}) {
    super({
      apiKey: options.apiKey ?? process.env.OPENAI_API_KEY,
      baseUrl: options.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      dimensions: options.dimensions ?? parseOptionalPositiveInteger(process.env.OPENAI_EMBEDDING_DIMENSION),
      fetchImpl: options.fetchImpl,
      modelName: options.modelName ?? process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small"
    });
  }
}

@Injectable()
export class DashScopeEmbeddingProvider extends OpenAiCompatibleEmbeddingProvider {
  constructor(options: Partial<OpenAiCompatibleEmbeddingProviderOptions> = {}) {
    super({
      apiKey: options.apiKey ?? process.env.DASHSCOPE_API_KEY,
      batchSize: options.batchSize ?? DASHSCOPE_MAX_BATCH_SIZE,
      baseUrl: options.baseUrl ?? process.env.DASHSCOPE_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",
      dimensions:
        options.dimensions ??
        parseOptionalPositiveInteger(process.env.DASHSCOPE_EMBEDDING_DIMENSION) ??
        DASHSCOPE_REQUEST_DIMENSIONS,
      fetchImpl: options.fetchImpl,
      modelName: options.modelName ?? process.env.DASHSCOPE_EMBEDDING_MODEL ?? "text-embedding-v4"
    });
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const expandedTexts: string[] = [];
    const originalIndexes: number[] = [];

    for (const [originalIndex, text] of texts.entries()) {
      for (const chunk of splitTextForDashScope(text)) {
        expandedTexts.push(chunk);
        originalIndexes.push(originalIndex);
      }
    }

    const expandedEmbeddings = await super.embedDocuments(expandedTexts);
    const groupedEmbeddings = texts.map((): number[][] => []);

    expandedEmbeddings.forEach((embedding, index) => {
      const originalIndex = originalIndexes[index];
      if (originalIndex !== undefined) {
        groupedEmbeddings[originalIndex]?.push(embedding);
      }
    });

    return groupedEmbeddings.map((embeddings) => (embeddings.length === 1 ? embeddings[0]! : averageVectors(embeddings)));
  }
}
