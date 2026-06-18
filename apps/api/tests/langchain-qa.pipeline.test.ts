import { describe, expect, it } from "vitest";

import { DocumentRepository } from "../src/modules/ingestion/document.repository";
import type { ChunkSearchResult, ImportedDocumentSummary, IngestionJobRecord } from "../src/modules/ingestion/ingestion.types";
import { LangChainQaPipeline } from "../src/modules/qa/langchain-qa.pipeline";
import { HybridCompanyRetriever } from "../src/modules/qa/langchain-retriever";
import type { ChatProvider } from "../src/modules/system/chat.provider";
import type { EmbeddingProvider } from "../src/modules/system/embedding.provider";

class StaticDocumentRepository extends DocumentRepository {
  readonly searchCalls: Array<{ companyName: string; questionText: string; questionEmbedding: number[]; limit: number }> = [];

  constructor(private readonly chunks: ChunkSearchResult[]) {
    super();
  }

  listDocuments(): ImportedDocumentSummary[] {
    return [];
  }

  listIngestionJobs(): IngestionJobRecord[] {
    return [];
  }

  createLegacyImportJob(): IngestionJobRecord {
    throw new Error("not needed in this test");
  }

  listCompanyNames(): string[] {
    return ["中芯国际"];
  }

  searchChunksByCompany(companyName: string, questionText: string, questionEmbedding: number[], limit: number): ChunkSearchResult[] {
    this.searchCalls.push({ companyName, questionText, questionEmbedding, limit });
    return this.chunks;
  }
}

class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly modelName = "fake-embedding";

  async embedDocuments(): Promise<number[][]> {
    return [];
  }

  async embedQuery(): Promise<number[]> {
    return [0.1, 0.2, 0.3, 0.4];
  }
}

class FakeChatProvider implements ChatProvider {
  readonly modelName = "fake-chat";
  readonly calls: Parameters<ChatProvider["answerQuestion"]>[] = [];

  async answerQuestion(request: Parameters<ChatProvider["answerQuestion"]>[0]): Promise<string> {
    this.calls.push([request]);
    return "answer from langchain pipeline";
  }
}

const chunks: ChunkSearchResult[] = [
  {
    documentId: "document-id",
    externalId: "stock_10001",
    companyName: "中芯国际",
    pageStart: 18,
    pageEnd: 19,
    score: 0.0325,
    text: "2024年销售收入同比增长。"
  }
];

describe("HybridCompanyRetriever", () => {
  it("keeps retrieval metadata on LangChain documents", async () => {
    const repository = new StaticDocumentRepository(chunks);
    const retriever = new HybridCompanyRetriever({
      companyName: "中芯国际",
      documentRepository: repository,
      embeddingProvider: new FakeEmbeddingProvider(),
      limit: 3
    });

    const documents = await retriever.invoke("中芯国际2024年销售收入");

    expect(repository.searchCalls[0]).toEqual({
      companyName: "中芯国际",
      questionText: "中芯国际2024年销售收入",
      questionEmbedding: [0.1, 0.2, 0.3, 0.4],
      limit: 3
    });
    expect(documents[0]?.pageContent).toBe("2024年销售收入同比增长。");
    expect(documents[0]?.metadata).toEqual({
      companyName: "中芯国际",
      documentId: "document-id",
      externalId: "stock_10001",
      pageEnd: 19,
      pageStart: 18,
      score: 0.0325
    });
  });
});

describe("LangChainQaPipeline", () => {
  it("uses LangChain retrieval documents while preserving the existing chat context shape", async () => {
    const repository = new StaticDocumentRepository(chunks);
    const chatProvider = new FakeChatProvider();
    const pipeline = new LangChainQaPipeline(repository, new FakeEmbeddingProvider(), chatProvider);

    const result = await pipeline.invoke({
      companyNames: ["中芯国际"],
      questionText: "中芯国际2024年销售收入"
    });

    expect(result.finalAnswer).toBe("answer from langchain pipeline");
    expect(result.contexts[0]?.chunks[0]).toEqual(chunks[0]);
    expect(chatProvider.calls[0]?.[0].contexts[0]?.chunks[0]?.pageStart).toBe(18);
  });
});
