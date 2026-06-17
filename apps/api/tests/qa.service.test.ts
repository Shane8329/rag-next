import { describe, expect, it } from "vitest";

import { InMemoryDocumentRepository } from "../src/modules/ingestion/document.repository";
import { QaService } from "../src/modules/qa/qa.service";
import { DeterministicEmbeddingProvider } from "../src/modules/system/embedding.provider";

class FakeChatProvider {
  readonly modelName = "fake-chat";
  readonly calls: Array<{ questionText: string }> = [];

  async answerQuestion({ questionText }: { questionText: string }) {
    this.calls.push({ questionText });
    return `model answer for ${questionText}`;
  }
}

describe("QaService", () => {
  it("uses the chat provider to generate answers for matched companies", async () => {
    const repository = new InMemoryDocumentRepository();
    const embeddingProvider = new DeterministicEmbeddingProvider();
    const chatProvider = new FakeChatProvider();

    await repository.createLegacyImportJob({
      document: {
        externalId: "stock_10001",
        companyName: "Acme",
        originalFileName: "Acme.md",
        sourceType: "legacy_chunk"
      },
      chunks: [
        {
          chunkIndex: 0,
          pageStart: 12,
          pageEnd: 12,
          referenceMode: "weak",
          text: "Acme increased R&D investment and focused on advanced process technology."
        }
      ]
    }, embeddingProvider);

    const service = new QaService(repository, embeddingProvider, chatProvider);
    const answer = await service.answer("Summarize Acme R&D investment", []);

    expect(answer.finalAnswer).toBe("model answer for Summarize Acme R&D investment");
    expect(answer.references[0]?.documentId).toBe("stock_10001");
    expect(answer.relevantPages).toContain(12);
    expect(chatProvider.calls).toHaveLength(1);
  });

  it("uses vector similarity to prioritize the closest chunk before generation", async () => {
    const repository = new InMemoryDocumentRepository();
    const embeddingProvider = new DeterministicEmbeddingProvider();
    const chatProvider = new FakeChatProvider();

    await repository.createLegacyImportJob({
      document: {
        externalId: "stock_10001",
        companyName: "Acme",
        originalFileName: "Acme.md",
        sourceType: "legacy_chunk"
      },
      chunks: [
        {
          chunkIndex: 0,
          pageStart: 8,
          pageEnd: 8,
          referenceMode: "weak",
          text: "Mature manufacturing capacity remained stable."
        },
        {
          chunkIndex: 1,
          pageStart: 18,
          pageEnd: 18,
          referenceMode: "weak",
          text: "Research investment increased and advanced process work continued."
        }
      ]
    }, embeddingProvider);

    const service = new QaService(repository, embeddingProvider, chatProvider);
    const answer = await service.answer("Summarize Acme research investment", []);

    expect(answer.finalAnswer).toBe("model answer for Summarize Acme research investment");
    expect(answer.relevantPages[0]).toBe(18);
  });

  it("returns a no-company message without calling the chat provider when nothing matches", async () => {
    const chatProvider = new FakeChatProvider();
    const service = new QaService(new InMemoryDocumentRepository(), new DeterministicEmbeddingProvider(), chatProvider);

    const answer = await service.answer("Summarize this annual report", []);

    expect(answer.finalAnswer).toContain("未识别到公司");
    expect(chatProvider.calls).toHaveLength(0);
  });
});
