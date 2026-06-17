import { Pool } from "pg";

import { createDocumentRepository, type QueryClientLike } from "../ingestion/document.repository";
import {
  DashScopeEmbeddingProvider,
  DeterministicEmbeddingProvider,
  OpenAiEmbeddingProvider,
  type EmbeddingProvider
} from "./embedding.provider";
import { DashScopeChatProvider, ExtractiveChatProvider, OpenAiChatProvider, type ChatProvider } from "./chat.provider";

let sharedPool: Pool | null = null;

export function createQueryClient(): QueryClientLike | undefined {
  if (!process.env.DATABASE_URL) {
    return undefined;
  }

  if (!sharedPool) {
    sharedPool = new Pool({
      connectionString: process.env.DATABASE_URL
    });
  }

  return {
    query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
      const result = await sharedPool!.query(sql, params);
      return { rows: result.rows as T[] };
    }
  };
}

export function createRepositoryFromEnvironment() {
  return createDocumentRepository(createQueryClient());
}

export function createEmbeddingProvider(): EmbeddingProvider {
  const provider = (process.env.EMBEDDING_PROVIDER ?? "deterministic").toLowerCase();

  if (provider === "openai") {
    return new OpenAiEmbeddingProvider();
  }

  if (provider === "dashscope") {
    return new DashScopeEmbeddingProvider();
  }

  return new DeterministicEmbeddingProvider();
}

export function createChatProvider(): ChatProvider {
  const provider = (process.env.CHAT_PROVIDER ?? process.env.EMBEDDING_PROVIDER ?? "extractive").toLowerCase();

  if (provider === "openai") {
    return new OpenAiChatProvider();
  }

  if (provider === "dashscope") {
    return new DashScopeChatProvider();
  }

  return new ExtractiveChatProvider();
}
