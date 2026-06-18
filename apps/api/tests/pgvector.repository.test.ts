import { describe, expect, it, vi } from "vitest";

import { InMemoryDocumentRepository, PgDocumentRepository, type QueryClientLike } from "../src/modules/ingestion/document.repository";
import { DeterministicEmbeddingProvider } from "../src/modules/system/embedding.provider";

describe("PgDocumentRepository pgvector search", () => {
  it("uses hybrid sql with vector candidates, keyword candidates, and fusion ordering", async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] as never[] }));
    const repository = new PgDocumentRepository({ query: query as unknown as QueryClientLike["query"] });

    await repository.searchChunksByCompany("Company A", "2024年销售收入", [0.1, 0.2, 0.3, 0.4], 3);

    const call = query.mock.calls[0];
    expect(call).toBeDefined();

    const [sql, params] = call as [string, unknown[]];
    expect(sql).toContain("with vector_candidates as");
    expect(sql).toContain("keyword_candidates as");
    expect(sql).toContain("ce.embedding <=> $2::vector");
    expect(sql).toContain("to_tsquery('simple', $3)");
    expect(sql).toContain("1.0 / (60 +");
    expect(params[0]).toBe("Company A");
    expect(params[1]).toBe("[0.1,0.2,0.3,0.4]");
    expect(params[2]).toBe("销售:* | 售收:* | 收入:* | 销售收入:* | 2024:*");
    expect(params[3]).toBe(24);
    expect(params[4]).toBe(3);
  });

  it("maps fused search results returned by Postgres", async () => {
    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes("with vector_candidates as")) {
        return {
          rows: [
            {
              chunkId: "chunk-3",
              documentId: "doc-1",
              externalId: "stock_10001",
              companyName: "中芯国际",
              pageStart: 3,
              pageEnd: 4,
              text: "2024年全年销售收入为人民币578亿元。",
              score: 0.0325
            },
            {
              chunkId: "chunk-1",
              documentId: "doc-1",
              externalId: "stock_10001",
              companyName: "中芯国际",
              pageStart: 1,
              pageEnd: 1,
              text: "产能建设和工厂扩建进展",
              score: 0.0163
            }
          ] as never[]
        };
      }

      return { rows: [] as never[] };
    });
    const repository = new PgDocumentRepository({ query: query as unknown as QueryClientLike["query"] });

    const results = await repository.searchChunksByCompany("中芯国际", "中芯国际2024全年销售收入", [0.1, 0.2, 0.3, 0.4], 3);

    expect(results[0]?.pageStart).toBe(3);
    expect(results[0]?.text).toContain("销售收入");
  });

  it("lets keyword-only matches outrank weak vector matches in memory", async () => {
    const repository = new InMemoryDocumentRepository();
    const embeddingProvider = new DeterministicEmbeddingProvider();

    await repository.createLegacyImportJob({
      document: {
        externalId: "stock_10001",
        companyName: "中芯国际",
        originalFileName: "smic.md",
        sourceType: "legacy_chunk"
      },
      chunks: [
        {
          chunkIndex: 0,
          pageStart: 1,
          pageEnd: 1,
          text: "产能建设和工厂扩建进展",
          referenceMode: "weak"
        },
        {
          chunkIndex: 1,
          pageStart: 3,
          pageEnd: 4,
          text: "2024年全年销售收入为人民币578亿元。",
          referenceMode: "weak"
        }
      ]
    }, embeddingProvider);

    const results = repository.searchChunksByCompany("中芯国际", "中芯国际2024全年销售收入", [], 1);

    expect(results[0]?.pageStart).toBe(3);
    expect(results[0]?.text).toContain("销售收入");
  });

  it("maps ingestion jobs from the normalized schema", async () => {
    const query = vi.fn(async (_sql: string) => ({ rows: [] as never[] }));
    const repository = new PgDocumentRepository({ query: query as unknown as QueryClientLike["query"] });

    await repository.listIngestionJobs();

    const [sql] = query.mock.calls[0] as [string];
    expect(sql).toContain("job_type");
    expect(sql).toContain("payload->'document'->>'externalId'");
    expect(sql).not.toContain("document_external_id");
  });

  it("uses upserts for repeatable legacy imports", async () => {
    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes("insert into documents")) {
        return { rows: [{ id: "document-id" }] };
      }
      if (sql.includes("insert into document_chunks")) {
        return { rows: [{ id: "chunk-id" }] };
      }
      return { rows: [] };
    });
    const repository = new PgDocumentRepository({ query: query as unknown as QueryClientLike["query"] });

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

  it("stores keyword lexemes while importing chunks", async () => {
    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes("insert into documents")) {
        return { rows: [{ id: "document-id" }] };
      }
      if (sql.includes("insert into document_chunks")) {
        return { rows: [{ id: "chunk-id" }] };
      }
      return { rows: [] };
    });
    const repository = new PgDocumentRepository({ query: query as unknown as QueryClientLike["query"] });

    await repository.createLegacyImportJob({
      document: {
        externalId: "stock_10001",
        companyName: "中芯国际",
        originalFileName: "smic.md",
        sourceType: "legacy_chunk"
      },
      chunks: [
        {
          chunkIndex: 0,
          pageStart: 3,
          pageEnd: 3,
          text: "2024年销售收入增长",
          referenceMode: "weak"
        }
      ]
    }, new DeterministicEmbeddingProvider());

    const chunkCall = query.mock.calls[1];
    const chunkSql = String(chunkCall?.[0]);
    const chunkParams = chunkCall?.[1] ?? [];
    expect(chunkSql).toContain("keyword_lexemes");
    expect(chunkSql).toContain("keyword_lexemes = excluded.keyword_lexemes");
    expect(chunkParams).toContain("销售 售收 收入 入增 增长 销售收入增长 2024");
  });
});
