# Hybrid Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Postgres + pgvector 架构内落地中文通用文档的轻量混合检索，实现向量召回、关键词召回与融合重排，并保持现有 QA 接口兼容。

**Architecture:** 先新增统一的检索文本标准化与词元生成工具，再把 `keyword_lexemes` 写入 `document_chunks`。查询阶段由 `PgDocumentRepository` 用单条 SQL 完成向量候选、关键词候选和 RRF 融合，`InMemoryDocumentRepository` 保持等价行为用于测试回归。

**Tech Stack:** TypeScript, NestJS, Vitest, PostgreSQL, pgvector, PostgreSQL Full Text Search

---

### Task 1: Build shared retrieval text utilities

**Files:**
- Create: `apps/api/src/modules/ingestion/retrieval-text.ts`
- Test: `apps/api/tests/retrieval-text.test.ts`

- [ ] **Step 1: Write the failing utility tests**

```ts
import { describe, expect, it } from "vitest";

import { buildKeywordLexemes } from "../src/modules/ingestion/retrieval-text";

describe("buildKeywordLexemes", () => {
  it("extracts Chinese bigrams and full phrases", () => {
    expect(buildKeywordLexemes("中芯国际2024年销售收入增长")).toEqual([
      "中芯",
      "芯国",
      "国际",
      "2024",
      "销售",
      "售收",
      "收入",
      "增长",
      "中芯国际",
      "销售收入"
    ]);
  });

  it("normalizes english and mixed tokens", () => {
    expect(buildKeywordLexemes("Qwen2 A800 Revenue 2024Q1")).toEqual([
      "qwen2",
      "a800",
      "revenue",
      "2024q1"
    ]);
  });

  it("returns an empty array for punctuation only input", () => {
    expect(buildKeywordLexemes("，。！？ - /")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rag-next/api test -- retrieval-text.test.ts`

Expected: FAIL with `Cannot find module '../src/modules/ingestion/retrieval-text'` or `buildKeywordLexemes is not exported`

- [ ] **Step 3: Write the minimal retrieval text utility**

```ts
const CHINESE_BLOCK_RE = /[\u4e00-\u9fff]+/g;
const LATIN_OR_DIGIT_RE = /[a-z0-9]+/g;

function normalizeRetrievalText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\u4e00-\u9fff]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildKeywordLexemes(text: string): string[] {
  const normalized = normalizeRetrievalText(text);

  if (!normalized) {
    return [];
  }

  const ordered = new Set<string>();

  for (const block of normalized.match(CHINESE_BLOCK_RE) ?? []) {
    if (block.length >= 2) {
      for (let index = 0; index < block.length - 1; index += 1) {
        ordered.add(block.slice(index, index + 2));
      }
    }

    if (block.length >= 4 && block.length <= 12) {
      ordered.add(block);
    }
  }

  for (const token of normalized.match(LATIN_OR_DIGIT_RE) ?? []) {
    ordered.add(token);
  }

  return [...ordered];
}

export function buildKeywordLexemeString(text: string, maxTerms = 120): string {
  return buildKeywordLexemes(text).slice(0, maxTerms).join(" ");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rag-next/api test -- retrieval-text.test.ts`

Expected: PASS with `3 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ingestion/retrieval-text.ts apps/api/tests/retrieval-text.test.ts
git commit -m "feat: add retrieval text tokenization utilities"
```

### Task 2: Persist keyword lexemes during ingestion

**Files:**
- Modify: `db/init/002_schema.sql`
- Modify: `apps/api/src/modules/ingestion/document.repository.ts`
- Test: `apps/api/tests/legacy-import.service.test.ts`
- Test: `apps/api/tests/pgvector.repository.test.ts`

- [ ] **Step 1: Write the failing persistence assertions**

```ts
it("stores keyword lexemes while importing chunks", async () => {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("insert into documents")) {
      return { rows: [{ id: "document-id" }] };
    }

    if (sql.includes("insert into document_chunks")) {
      return { rows: [{ id: "chunk-id" }] };
    }

    return { rows: [] };
  });

  const repository = new PgDocumentRepository({ query: query as QueryClientLike["query"] });

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

  expect(String(query.mock.calls[1]?.[0])).toContain("keyword_lexemes");
  expect(query.mock.calls[1]?.[1]).toContain("销售收入");
});
```

- [ ] **Step 2: Run targeted tests to verify failure**

Run: `pnpm --filter @rag-next/api test -- pgvector.repository.test.ts legacy-import.service.test.ts`

Expected: FAIL because `keyword_lexemes` is missing from SQL and params

- [ ] **Step 3: Update schema and ingestion write path**

```sql
alter table document_chunks
add column if not exists keyword_lexemes text not null default '';

create index if not exists idx_document_chunks_keyword_fts
on document_chunks
using gin (to_tsvector('simple', keyword_lexemes));
```

```ts
import { buildKeywordLexemeString } from "./retrieval-text";

const keywordLexemes = buildKeywordLexemeString(chunk.text);

await this.queryClient.query(
  `
    insert into document_chunks (
      id, document_id, chunk_index, page_start, page_end, text_content, keyword_lexemes, reference_mode, created_at
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    on conflict (document_id, chunk_index) do update set
      page_start = excluded.page_start,
      page_end = excluded.page_end,
      text_content = excluded.text_content,
      keyword_lexemes = excluded.keyword_lexemes,
      reference_mode = excluded.reference_mode
    returning id
  `,
  [chunkId, persistedDocumentId, chunk.chunkIndex, chunk.pageStart, chunk.pageEnd, chunk.text, keywordLexemes, chunk.referenceMode, now]
);
```

- [ ] **Step 4: Run tests to verify persistence**

Run: `pnpm --filter @rag-next/api test -- pgvector.repository.test.ts legacy-import.service.test.ts`

Expected: PASS with the new assertions succeeding

- [ ] **Step 5: Commit**

```bash
git add db/init/002_schema.sql apps/api/src/modules/ingestion/document.repository.ts apps/api/tests/pgvector.repository.test.ts apps/api/tests/legacy-import.service.test.ts
git commit -m "feat: persist keyword lexemes for chunk retrieval"
```

### Task 3: Implement hybrid recall and RRF fusion in repositories

**Files:**
- Modify: `apps/api/src/modules/ingestion/document.repository.ts`
- Modify: `apps/api/src/modules/ingestion/ingestion.types.ts`
- Test: `apps/api/tests/pgvector.repository.test.ts`

- [ ] **Step 1: Write the failing hybrid retrieval tests**

```ts
it("uses hybrid sql with vector candidates, keyword candidates, and fusion ordering", async () => {
  const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] as never[] }));
  const repository = new PgDocumentRepository({ query: query as QueryClientLike["query"] });

  await repository.searchChunksByCompany("Company A", "2024年销售收入", [0.1, 0.2, 0.3, 0.4], 3);

  const [sql, params] = query.mock.calls[0] as [string, unknown[]];
  expect(sql).toContain("with vector_candidates as");
  expect(sql).toContain("keyword_candidates as");
  expect(sql).toContain("plainto_tsquery('simple', $3)");
  expect(sql).toContain("1.0 / (60 + vector_rank)");
  expect(sql).toContain("1.0 / (60 + keyword_rank)");
  expect(params[0]).toBe("Company A");
  expect(params[1]).toBe("[0.1,0.2,0.3,0.4]");
  expect(params[2]).toBe("2024 销售 售收 收入 销售收入");
  expect(params[3]).toBe(24);
  expect(params[4]).toBe(3);
});

it("lets keyword matches outrank weak vector matches in memory", () => {
  const repository = new InMemoryDocumentRepository();
  const embedding = [0.1, 0.2, 0.3, 0.4];

  (repository as unknown as { chunks: StoredChunkRecord[] }).chunks.push(
    {
      documentId: "doc-1",
      externalId: "doc-1",
      companyName: "中芯国际",
      pageStart: 1,
      pageEnd: 1,
      text: "产能建设与工厂扩建进展。",
      embedding: [0.9, 0.9, 0.9, 0.9]
    },
    {
      documentId: "doc-1",
      externalId: "doc-1",
      companyName: "中芯国际",
      pageStart: 3,
      pageEnd: 3,
      text: "2024年销售收入同比增长。",
      embedding: [0.01, 0.01, 0.01, 0.01]
    }
  );

  const results = repository.searchChunksByCompany("中芯国际", "2024年销售收入", embedding, 1);
  expect(results[0]?.pageStart).toBe(3);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @rag-next/api test -- pgvector.repository.test.ts`

Expected: FAIL because the SQL is still vector-only and in-memory ranking is still heuristic-only

- [ ] **Step 3: Replace heuristic ranking with explicit hybrid fusion**

```ts
function reciprocalRank(rank?: number): number {
  return typeof rank === "number" ? 1 / (60 + rank) : 0;
}

function rankHybridChunkCandidates(
  candidates: Array<ChunkCandidate & { vectorRank?: number; keywordRank?: number }>,
  limit: number
): ChunkSearchResult[] {
  return candidates
    .map((candidate) => {
      const fusionScore = reciprocalRank(candidate.vectorRank) + reciprocalRank(candidate.keywordRank);

      return {
        ...candidate,
        score: fusionScore
      };
    })
    .sort((left, right) =>
      right.score - left.score ||
      (left.vectorRank ?? Number.MAX_SAFE_INTEGER) - (right.vectorRank ?? Number.MAX_SAFE_INTEGER) ||
      (left.keywordRank ?? Number.MAX_SAFE_INTEGER) - (right.keywordRank ?? Number.MAX_SAFE_INTEGER) ||
      left.pageStart - right.pageStart
    )
    .slice(0, limit)
    .map(({ documentId, externalId, companyName, pageStart, pageEnd, text, score }) => ({
      documentId,
      externalId,
      companyName,
      pageStart,
      pageEnd,
      text,
      score
    }));
}
```

```ts
const keywordLexemes = buildKeywordLexemeString(questionText, 40);
const candidateLimit = Math.max(limit * 8, 24);

const result = await this.queryClient.query<ChunkCandidate>(
  `
    with vector_candidates as (
      select
        dc.id as "chunkId",
        dc.document_id as "documentId",
        d.external_id as "externalId",
        d.company_name as "companyName",
        dc.page_start as "pageStart",
        dc.page_end as "pageEnd",
        dc.text_content as "text",
        row_number() over (order by ce.embedding <=> $2::vector asc, dc.page_start asc) as "vectorRank"
      from document_chunks dc
      inner join documents d on d.id = dc.document_id
      inner join chunk_embeddings ce on ce.chunk_id = dc.id
      where d.company_name = $1
      order by ce.embedding <=> $2::vector asc, dc.page_start asc
      limit $4
    ),
    keyword_candidates as (
      select
        dc.id as "chunkId",
        dc.document_id as "documentId",
        d.external_id as "externalId",
        d.company_name as "companyName",
        dc.page_start as "pageStart",
        dc.page_end as "pageEnd",
        dc.text_content as "text",
        row_number() over (
          order by ts_rank_cd(to_tsvector('simple', dc.keyword_lexemes), plainto_tsquery('simple', $3)) desc, dc.page_start asc
        ) as "keywordRank"
      from document_chunks dc
      inner join documents d on d.id = dc.document_id
      where d.company_name = $1
        and $3 <> ''
        and to_tsvector('simple', dc.keyword_lexemes) @@ plainto_tsquery('simple', $3)
      order by ts_rank_cd(to_tsvector('simple', dc.keyword_lexemes), plainto_tsquery('simple', $3)) desc, dc.page_start asc
      limit $4
    ),
    merged as (
      select
        coalesce(v."chunkId", k."chunkId") as "chunkId",
        coalesce(v."documentId", k."documentId") as "documentId",
        coalesce(v."externalId", k."externalId") as "externalId",
        coalesce(v."companyName", k."companyName") as "companyName",
        coalesce(v."pageStart", k."pageStart") as "pageStart",
        coalesce(v."pageEnd", k."pageEnd") as "pageEnd",
        coalesce(v."text", k."text") as "text",
        v."vectorRank",
        k."keywordRank",
        coalesce(1.0 / (60 + v."vectorRank"), 0) + coalesce(1.0 / (60 + k."keywordRank"), 0) as "score"
      from vector_candidates v
      full outer join keyword_candidates k on k."chunkId" = v."chunkId"
    )
    select *
    from merged
    order by "score" desc, "vectorRank" asc nulls last, "keywordRank" asc nulls last, "pageStart" asc
    limit $5
  `,
  [companyName, toPgvectorLiteral(questionEmbedding), keywordLexemes, candidateLimit, limit]
);
```

- [ ] **Step 4: Run tests to verify hybrid retrieval**

Run: `pnpm --filter @rag-next/api test -- pgvector.repository.test.ts`

Expected: PASS with SQL assertions and in-memory ranking assertions succeeding

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ingestion/document.repository.ts apps/api/src/modules/ingestion/ingestion.types.ts apps/api/tests/pgvector.repository.test.ts
git commit -m "feat: add hybrid retrieval fusion in repositories"
```

### Task 4: Preserve QA behavior and add regression coverage

**Files:**
- Modify: `apps/api/tests/qa.service.test.ts`
- Modify: `apps/api/tests/legacy-import.service.test.ts`

- [ ] **Step 1: Add failing QA regressions**

```ts
it("uses fused retrieval ordering when preparing references", async () => {
  const repository = new InMemoryDocumentRepository();
  const embeddingProvider = new DeterministicEmbeddingProvider();
  const chatProvider = new FakeChatProvider();

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
        pageStart: 8,
        pageEnd: 8,
        referenceMode: "weak",
        text: "成熟制程产能保持稳定。"
      },
      {
        chunkIndex: 1,
        pageStart: 18,
        pageEnd: 18,
        referenceMode: "weak",
        text: "2024年销售收入同比增长。"
      }
    ]
  }, embeddingProvider);

  const service = new QaService(repository, embeddingProvider, chatProvider);
  const answer = await service.answer("中芯国际2024年销售收入", []);

  expect(answer.relevantPages[0]).toBe(18);
  expect(answer.references[0]?.page).toBe(18);
});
```

- [ ] **Step 2: Run regression tests to verify failure**

Run: `pnpm --filter @rag-next/api test -- qa.service.test.ts legacy-import.service.test.ts`

Expected: FAIL until repository hybrid ordering is fully wired through

- [ ] **Step 3: Adjust tests to the final retrieval semantics**

```ts
expect(answer.finalAnswer).toBe("model answer for 中芯国际2024年销售收入");
expect(answer.relevantPages).toContain(18);
expect(answer.references[0]?.documentId).toBe("stock_10001");
expect(chatProvider.calls).toHaveLength(1);
```

- [ ] **Step 4: Run full API test suite**

Run: `pnpm --filter @rag-next/api test`

Expected: PASS with all existing API tests green

- [ ] **Step 5: Commit**

```bash
git add apps/api/tests/qa.service.test.ts apps/api/tests/legacy-import.service.test.ts
git commit -m "test: cover hybrid retrieval qa regressions"
```

### Task 5: Final verification and workspace checks

**Files:**
- Modify: `docs/superpowers/specs/2026-06-18-hybrid-retrieval-design.md` (only if implementation reveals a spec mismatch)
- Modify: `docs/superpowers/plans/2026-06-18-hybrid-retrieval-implementation.md` (check off progress only if your execution workflow requires it)

- [ ] **Step 1: Run type checking**

Run: `pnpm --filter @rag-next/api typecheck`

Expected: PASS with no TypeScript errors

- [ ] **Step 2: Run targeted lint**

Run: `pnpm --filter @rag-next/api lint`

Expected: PASS with no new lint errors in the API package

- [ ] **Step 3: Run root regression checks**

Run: `pnpm test`

Expected: PASS with shared-types, api, and worker test suites green

- [ ] **Step 4: Inspect git diff for scope control**

Run: `git diff --stat`

Expected: only retrieval-related API files, DB schema, and the two docs changed

- [ ] **Step 5: Commit**

```bash
git add db/init/002_schema.sql apps/api/src/modules/ingestion/document.repository.ts apps/api/src/modules/ingestion/retrieval-text.ts apps/api/src/modules/ingestion/ingestion.types.ts apps/api/tests/retrieval-text.test.ts apps/api/tests/pgvector.repository.test.ts apps/api/tests/qa.service.test.ts apps/api/tests/legacy-import.service.test.ts docs/superpowers/specs/2026-06-18-hybrid-retrieval-design.md docs/superpowers/plans/2026-06-18-hybrid-retrieval-implementation.md
git commit -m "feat: implement lightweight hybrid retrieval"
```

## Self-Review

- Spec coverage:
  - `keyword_lexemes` 入库与索引：Task 2
  - 向量召回 + 关键词召回：Task 3
  - RRF 融合重排：Task 3
  - QA 行为兼容与回归：Task 4
  - 类型、lint、全量测试验证：Task 5
- Placeholder scan:
  - 计划内没有 `TODO`、`TBD`、`implement later` 一类占位项
  - 每个代码步骤都给出了明确代码或命令
- Type consistency:
  - `buildKeywordLexemes` / `buildKeywordLexemeString` 在 Tasks 1-3 中保持一致
  - `searchChunksByCompany(companyName, questionText, questionEmbedding, limit)` 签名保持不变

Plan complete and saved to `docs/superpowers/plans/2026-06-18-hybrid-retrieval-implementation.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
