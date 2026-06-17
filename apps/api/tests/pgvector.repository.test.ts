import { describe, expect, it, vi } from "vitest";

import { PgDocumentRepository } from "../src/modules/ingestion/document.repository";
import { DeterministicEmbeddingProvider } from "../src/modules/system/embedding.provider";

describe("PgDocumentRepository pgvector search", () => {
  it("uses vector similarity sql when searching chunks", async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] as never[] }));
    const repository = new PgDocumentRepository({ query: query as unknown as import("../src/modules/ingestion/document.repository").QueryClientLike["query"] });

    await repository.searchChunksByCompany("Company A", "research investment", [0.1, 0.2, 0.3, 0.4], 3);

    const call = query.mock.calls[0];
    expect(call).toBeDefined();

    const [sql, params] = call as [string, unknown[]];
    expect(sql).toContain("chunk_embeddings ce");
    expect(sql).toContain("ce.embedding <=> $2::vector");
    expect(params[0]).toBe("Company A");
    expect(params[1]).toBe("[0.1,0.2,0.3,0.4]");
    expect(params[2]).toBe(12);
  });

  it("elevates lexical revenue matches for Chinese financial questions", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("chunk_embeddings ce")) {
        return {
          rows: [
            {
              chunkId: "chunk-1",
              documentId: "doc-1",
              externalId: "stock_10001",
              companyName: "中芯国际",
              pageStart: 1,
              pageEnd: 1,
              text: "产能建设和工厂扩建进展",
              score: 0.98
            },
            {
              chunkId: "chunk-2",
              documentId: "doc-1",
              externalId: "stock_10001",
              companyName: "中芯国际",
              pageStart: 150,
              pageEnd: 150,
              text: "其他财务附注内容",
              score: 0.95
            },
            {
              chunkId: "chunk-3",
              documentId: "doc-1",
              externalId: "stock_10001",
              companyName: "中芯国际",
              pageStart: 3,
              pageEnd: 4,
              text: "2024年全年销售收入为人民币578亿元。",
              score: 0.01
            }
          ] as never[]
        };
      }

      return { rows: [] as never[] };
    });
    const repository = new PgDocumentRepository({ query: query as unknown as import("../src/modules/ingestion/document.repository").QueryClientLike["query"] });

    const results = await repository.searchChunksByCompany("中芯国际", "中芯国际2024全年销售收入", [0.1, 0.2, 0.3, 0.4], 3);

    expect(results[0]?.pageStart).toBe(3);
    expect(results[0]?.text).toContain("销售收入");
  });

  it("maps ingestion jobs from the normalized schema", async () => {
    const query = vi.fn(async (_sql: string) => ({ rows: [] as never[] }));
    const repository = new PgDocumentRepository({ query: query as unknown as import("../src/modules/ingestion/document.repository").QueryClientLike["query"] });

    await repository.listIngestionJobs();

    const [sql] = query.mock.calls[0] as [string];
    expect(sql).toContain("job_type");
    expect(sql).toContain("payload->'document'->>'externalId'");
    expect(sql).not.toContain("document_external_id");
  });

  it("uses upserts for repeatable legacy imports", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("insert into documents")) {
        return { rows: [{ id: "document-id" }] };
      }
      if (sql.includes("insert into document_chunks")) {
        return { rows: [{ id: "chunk-id" }] };
      }
      return { rows: [] };
    });
    const repository = new PgDocumentRepository({ query: query as unknown as import("../src/modules/ingestion/document.repository").QueryClientLike["query"] });

    await repository.createLegacyImportJob({
      document: {
        externalId: "stock_10001",
        companyName: "Company A",
        originalFileName: "company-a.md",
        sourceType: "legacy_chunk"
      },
      chunks: [
        {
          chunkIndex: 0,
          pageStart: 1,
          pageEnd: 1,
          text: "research investment",
          referenceMode: "weak"
        }
      ]
    }, new DeterministicEmbeddingProvider());

    expect(String(query.mock.calls[0]?.[0])).toContain("on conflict (external_id)");
    expect(String(query.mock.calls[1]?.[0])).toContain("on conflict (document_id, chunk_index)");
    expect(String(query.mock.calls[2]?.[0])).toContain("on conflict (chunk_id)");
  });
});
