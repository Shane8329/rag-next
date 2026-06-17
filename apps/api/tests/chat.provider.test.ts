import { describe, expect, it } from "vitest";

import { DashScopeChatProvider } from "../src/modules/system/chat.provider";

describe("chat providers", () => {
  it("calls the DashScope OpenAI-compatible chat completions endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init as RequestInit });

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "model generated answer"
              }
            }
          ]
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      );
    };

    const provider = new DashScopeChatProvider({
      apiKey: "secret-key",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      fetchImpl,
      modelName: "qwen-test"
    });

    const answer = await provider.answerQuestion({
      contexts: [
        {
          companyName: "Acme",
          chunks: [
            {
              documentId: "doc-1",
              externalId: "stock_1",
              companyName: "Acme",
              pageStart: 3,
              pageEnd: 4,
              score: 0.91,
              text: "Acme increased R&D investment."
            }
          ]
        }
      ],
      questionText: "What changed for Acme?"
    });

    expect(answer).toBe("model generated answer");
    expect(calls[0]?.url).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: "Bearer secret-key" });
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "system" }),
        expect.objectContaining({ role: "user" })
      ]),
      model: "qwen-test"
    });
  });
});
