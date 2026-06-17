import { describe, expect, it } from "vitest";

import { InMemoryDocumentRepository } from "../src/modules/ingestion/document.repository";
import { LegacyImportService } from "../src/modules/ingestion/legacy-import.service";
import { DeterministicEmbeddingProvider } from "../src/modules/system/embedding.provider";

describe("LegacyImportService", () => {
  it("creates a completed ingestion job and stores document metadata", async () => {
    const repository = new InMemoryDocumentRepository();
    const service = new LegacyImportService(repository, new DeterministicEmbeddingProvider());

    const job = await service.importLegacyChunkDocument({
      metainfo: {
        sha1: "stock_10001",
        company_name: "中芯国际",
        file_name: "中芯国际.md"
      },
      content: {
        chunks: [{ lines: [1, 30], text: "第一页内容" }]
      }
    });

    expect(job.status).toBe("completed");
    expect(repository.listDocuments()).toHaveLength(1);
    expect(repository.listIngestionJobs()).toHaveLength(1);
  });

  it("imports a batch of legacy chunk documents", async () => {
    const repository = new InMemoryDocumentRepository();
    const service = new LegacyImportService(repository, new DeterministicEmbeddingProvider());

    const jobs = await service.importLegacyChunkDocuments([
      {
        metainfo: {
          sha1: "stock_10001",
          company_name: "中芯国际",
          file_name: "中芯国际.md"
        },
        content: {
          chunks: [{ lines: [1, 30], text: "第一页内容" }]
        }
      },
      {
        metainfo: {
          sha1: "stock_10002",
          company_name: "寒武纪",
          file_name: "寒武纪.md"
        },
        content: {
          chunks: [{ lines: [4, 8], text: "第二页内容" }]
        }
      }
    ]);

    expect(jobs).toHaveLength(2);
    expect(repository.listDocuments()).toHaveLength(2);
    expect(repository.listIngestionJobs()).toHaveLength(2);
    expect(repository.listDocuments().map((doc) => doc.companyName)).toEqual(["中芯国际", "寒武纪"]);
  });

  it("computes and stores embeddings while importing", async () => {
    const repository = new InMemoryDocumentRepository();
    const service = new LegacyImportService(repository, new DeterministicEmbeddingProvider());

    await service.importLegacyChunkDocument({
      metainfo: {
        sha1: "stock_10001",
        company_name: "中芯国际",
        file_name: "中芯国际.md"
      },
      content: {
        chunks: [{ lines: [1, 30], text: "研发投入持续增长" }]
      }
    });

    const chunks = repository.searchChunksByCompany("中芯国际", "研发投入", [0.1, 0.2, 0.3, 0.4], 3);
    expect(chunks[0]?.score).toBeGreaterThan(0);
  });
});