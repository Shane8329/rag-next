import { describe, expect, it } from "vitest";

import { DashScopeEmbeddingProvider, DeterministicEmbeddingProvider, OpenAiEmbeddingProvider } from "../src/modules/system/embedding.provider";

describe("embedding providers", () => {
  it("returns 1536 dimensions for local embeddings", async () => {
    const provider = new DeterministicEmbeddingProvider();
    const embedding = await provider.embedQuery("research investment");

    expect(embedding).toHaveLength(1536);
  });

  it("returns 1536 dimensions for openai-compatible embeddings", async () => {
    const provider = new OpenAiEmbeddingProvider({
      apiKey: "secret-key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                embedding: Array.from({ length: 1536 }, () => 0.1)
              }
            ]
          })
        )
    });
    const embedding = await provider.embedQuery("research investment");

    expect(embedding).toHaveLength(1536);
  });

  it("calls the DashScope OpenAI-compatible embeddings endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init as RequestInit });

      return new Response(
        JSON.stringify({
          data: [
            { embedding: Array.from({ length: 1024 }, (_, index) => index + 1) },
            { embedding: Array.from({ length: 1024 }, (_, index) => index + 2) }
          ]
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      );
    };

    const provider = new DashScopeEmbeddingProvider({
      apiKey: "secret-key",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      fetchImpl,
      modelName: "dashscope-test-embedding"
    });

    const embeddings = await provider.embedDocuments(["first", "second"]);

    expect(embeddings).toEqual([
      expect.arrayContaining([1, 2, 3]),
      expect.arrayContaining([2, 3, 4])
    ]);
    expect(embeddings[0]).toHaveLength(1536);
    expect(embeddings[1]).toHaveLength(1536);
    expect(calls[0]?.url).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings");
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: "Bearer secret-key" });
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      dimensions: 1024,
      input: ["first", "second"],
      model: "dashscope-test-embedding"
    });
  });

  it("batches DashScope embedding requests to stay within provider limits", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init as RequestInit });
      const body = JSON.parse(String(init?.body)) as { input: string[] };

      return new Response(
        JSON.stringify({
          data: body.input.map((_, batchIndex) => ({
            embedding: Array.from({ length: 1024 }, () => batchIndex + 1)
          }))
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      );
    };

    const provider = new DashScopeEmbeddingProvider({
      apiKey: "secret-key",
      fetchImpl,
      modelName: "dashscope-test-embedding"
    });

    const embeddings = await provider.embedDocuments(Array.from({ length: 11 }, (_, index) => `text-${index}`));

    expect(embeddings).toHaveLength(11);
    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ input: Array.from({ length: 10 }, (_, index) => `text-${index}`) });
    expect(JSON.parse(String(calls[1]?.init.body))).toMatchObject({ input: ["text-10"] });
  });

  it("splits oversized DashScope inputs and merges them into one embedding", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init as RequestInit });
      const body = JSON.parse(String(init?.body)) as { input: string[] };

      return new Response(
        JSON.stringify({
          data: body.input.map((_, index) => ({
            embedding: Array.from({ length: 1024 }, () => index + 1)
          }))
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      );
    };

    const provider = new DashScopeEmbeddingProvider({
      apiKey: "secret-key",
      fetchImpl,
      modelName: "dashscope-test-embedding"
    });

    const [embedding] = await provider.embedDocuments(["x".repeat(8_500)]);

    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ input: ["x".repeat(8_000), "x".repeat(500)] });
    expect(embedding?.slice(0, 3)).toEqual([0.03125, 0.03125, 0.03125]);
    expect(embedding).toHaveLength(1536);
  });
});
