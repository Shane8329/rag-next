import { describe, expect, it } from "vitest";

import { createChatProvider, createEmbeddingProvider, createQueryClient } from "../src/modules/system/database.provider";

describe("database and provider factories", () => {
  it("returns undefined when DATABASE_URL is absent", () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    const client = createQueryClient();

    expect(client).toBeUndefined();

    if (original === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = original;
    }
  });

  it("uses the deterministic embedding provider by default", () => {
    const originalProvider = process.env.EMBEDDING_PROVIDER;
    delete process.env.EMBEDDING_PROVIDER;

    const provider = createEmbeddingProvider();

    expect(provider.modelName).toBe("deterministic-local-v1");

    if (originalProvider === undefined) {
      delete process.env.EMBEDDING_PROVIDER;
    } else {
      process.env.EMBEDDING_PROVIDER = originalProvider;
    }
  });

  it("creates an openai embedding provider when configured", () => {
    const originalProvider = process.env.EMBEDDING_PROVIDER;
    const originalApiKey = process.env.OPENAI_API_KEY;
    process.env.EMBEDDING_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "demo-key";

    const provider = createEmbeddingProvider();

    expect(provider.modelName).toBe("text-embedding-3-small");

    process.env.EMBEDDING_PROVIDER = originalProvider;
    process.env.OPENAI_API_KEY = originalApiKey;
  });

  it("creates a DashScope embedding provider when configured", () => {
    const originalProvider = process.env.EMBEDDING_PROVIDER;
    const originalApiKey = process.env.DASHSCOPE_API_KEY;
    const originalModel = process.env.DASHSCOPE_EMBEDDING_MODEL;
    process.env.EMBEDDING_PROVIDER = "dashscope";
    process.env.DASHSCOPE_API_KEY = "demo-key";
    process.env.DASHSCOPE_EMBEDDING_MODEL = "dashscope-embedding-test";

    const provider = createEmbeddingProvider();

    expect(provider.modelName).toBe("dashscope-embedding-test");

    process.env.EMBEDDING_PROVIDER = originalProvider;
    process.env.DASHSCOPE_API_KEY = originalApiKey;
    process.env.DASHSCOPE_EMBEDDING_MODEL = originalModel;
  });

  it("creates a DashScope chat provider when configured", () => {
    const originalProvider = process.env.CHAT_PROVIDER;
    const originalApiKey = process.env.DASHSCOPE_API_KEY;
    const originalModel = process.env.DASHSCOPE_CHAT_MODEL;
    process.env.CHAT_PROVIDER = "dashscope";
    process.env.DASHSCOPE_API_KEY = "demo-key";
    process.env.DASHSCOPE_CHAT_MODEL = "qwen-test";

    const provider = createChatProvider();

    expect(provider.modelName).toBe("qwen-test");

    process.env.CHAT_PROVIDER = originalProvider;
    process.env.DASHSCOPE_API_KEY = originalApiKey;
    process.env.DASHSCOPE_CHAT_MODEL = originalModel;
  });
});
