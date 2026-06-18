import { randomUUID } from "node:crypto";

import type { ImportedLegacyChunkPayload } from "@rag-next/shared-types";

import type { EmbeddingProvider } from "../system/embedding.provider";
import type { ChunkSearchResult, ImportedDocumentSummary, IngestionJobRecord } from "./ingestion.types";
import { buildKeywordLexemeString, buildKeywordLexemes, buildKeywordTsQueryString } from "./retrieval-text";

export interface QueryClientLike {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

interface StoredChunkRecord {
  documentId: string;
  externalId: string;
  companyName: string;
  pageStart: number;
  pageEnd: number;
  text: string;
  embedding: number[];
}

interface ChunkCandidate extends ChunkSearchResult {
  chunkId: string;
}

interface HybridChunkCandidate extends ChunkCandidate {
  keywordRank?: number;
  vectorRank?: number;
}

export abstract class DocumentRepository {
  abstract listDocuments(): Promise<ImportedDocumentSummary[]> | ImportedDocumentSummary[];
  abstract listIngestionJobs(): Promise<IngestionJobRecord[]> | IngestionJobRecord[];
  abstract createLegacyImportJob(
    payload: ImportedLegacyChunkPayload,
    embeddingProvider: EmbeddingProvider,
    source?: IngestionJobRecord["source"]
  ): Promise<IngestionJobRecord> | IngestionJobRecord;
  abstract listCompanyNames(): Promise<string[]> | string[];
  abstract searchChunksByCompany(companyName: string, questionText: string, questionEmbedding: number[], limit: number): Promise<ChunkSearchResult[]> | ChunkSearchResult[];
}

export function createDocumentRepository(queryClient?: QueryClientLike): DocumentRepository {
  if (!process.env.DATABASE_URL || !queryClient) {
    return new InMemoryDocumentRepository();
  }

  return new PgDocumentRepository(queryClient);
}

function reciprocalRank(rank?: number): number {
  return typeof rank === "number" ? 1 / (60 + rank) : 0;
}

function rankHybridChunkCandidates(candidates: HybridChunkCandidate[], limit: number): ChunkSearchResult[] {
  return candidates
    .map((candidate) => ({
      ...candidate,
      score: reciprocalRank(candidate.vectorRank) + reciprocalRank(candidate.keywordRank)
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        (left.vectorRank ?? Number.MAX_SAFE_INTEGER) - (right.vectorRank ?? Number.MAX_SAFE_INTEGER) ||
        (left.keywordRank ?? Number.MAX_SAFE_INTEGER) - (right.keywordRank ?? Number.MAX_SAFE_INTEGER) ||
        left.pageStart - right.pageStart
    )
    .slice(0, limit)
    .map((candidate) => ({
      documentId: candidate.documentId,
      externalId: candidate.externalId,
      companyName: candidate.companyName,
      pageStart: candidate.pageStart,
      pageEnd: candidate.pageEnd,
      text: candidate.text,
      score: candidate.score
    }));
}

function mergeHybridCandidates(vectorCandidates: HybridChunkCandidate[], keywordCandidates: HybridChunkCandidate[]): HybridChunkCandidate[] {
  const merged = new Map<string, HybridChunkCandidate>();

  for (const candidate of [...vectorCandidates, ...keywordCandidates]) {
    const existing = merged.get(candidate.chunkId);

    if (!existing) {
      merged.set(candidate.chunkId, { ...candidate });
      continue;
    }

    existing.vectorRank = existing.vectorRank ?? candidate.vectorRank;
    existing.keywordRank = existing.keywordRank ?? candidate.keywordRank;
  }

  return [...merged.values()];
}

function scoreKeywordMatch(text: string, questionText: string): number {
  const textLexemes = new Set(buildKeywordLexemes(text));
  let score = 0;

  for (const lexeme of buildKeywordLexemes(questionText)) {
    if (textLexemes.has(lexeme)) {
      score += 1;
    }
  }

  return score;
}

function toSearchResult(row: ChunkCandidate): ChunkSearchResult {
  return {
    documentId: row.documentId,
    externalId: row.externalId,
    companyName: row.companyName,
    pageStart: row.pageStart,
    pageEnd: row.pageEnd,
    text: row.text,
    score: Number(row.score)
  };
}

function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function toPgvectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export class InMemoryDocumentRepository implements DocumentRepository {
  private readonly documents: ImportedDocumentSummary[] = [];
  private readonly ingestionJobs: IngestionJobRecord[] = [];
  private readonly chunks: StoredChunkRecord[] = [];

  listDocuments(): ImportedDocumentSummary[] {
    return [...this.documents];
  }

  listIngestionJobs(): IngestionJobRecord[] {
    return [...this.ingestionJobs];
  }

  listCompanyNames(): string[] {
    return [...new Set(this.documents.map((document) => document.companyName))];
  }

  searchChunksByCompany(companyName: string, questionText: string, questionEmbedding: number[], limit: number): ChunkSearchResult[] {
    const candidateLimit = Math.max(limit * 8, 24);
    const chunks = this.chunks.filter((chunk) => chunk.companyName === companyName);
    const vectorCandidates = chunks
      .map((chunk) => ({
        chunk,
        score: cosineSimilarity(chunk.embedding, questionEmbedding)
      }))
      .sort((left, right) => right.score - left.score || left.chunk.pageStart - right.chunk.pageStart)
      .slice(0, candidateLimit)
      .map(({ chunk, score }, index) => ({
        chunkId: `${chunk.documentId}:${chunk.pageStart}:${chunk.pageEnd}`,
        documentId: chunk.documentId,
        externalId: chunk.externalId,
        companyName: chunk.companyName,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        text: chunk.text,
        score,
        vectorRank: index + 1
      }));
    const keywordCandidates = chunks
      .map((chunk) => ({
        chunk,
        score: scoreKeywordMatch(chunk.text, questionText)
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.chunk.pageStart - right.chunk.pageStart)
      .slice(0, candidateLimit)
      .map(({ chunk, score }, index) => ({
          chunkId: `${chunk.documentId}:${chunk.pageStart}:${chunk.pageEnd}`,
          documentId: chunk.documentId,
          externalId: chunk.externalId,
          companyName: chunk.companyName,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          text: chunk.text,
        score,
        keywordRank: index + 1
      }));

    return rankHybridChunkCandidates(mergeHybridCandidates(vectorCandidates, keywordCandidates), limit);
  }

  async createLegacyImportJob(
    payload: ImportedLegacyChunkPayload,
    embeddingProvider: EmbeddingProvider,
    source: IngestionJobRecord["source"] = "legacy-chunk"
  ): Promise<IngestionJobRecord> {
    const now = new Date().toISOString();
    const documentId = randomUUID();
    const embeddings = await embeddingProvider.embedDocuments(payload.chunks.map((chunk) => chunk.text));

    this.documents.push({
      id: documentId,
      externalId: payload.document.externalId,
      companyName: payload.document.companyName,
      originalFileName: payload.document.originalFileName,
      sourceType: payload.document.sourceType,
      referenceMode: payload.chunks[0]?.referenceMode ?? "weak",
      createdAt: now
    });

    this.chunks.push(
      ...payload.chunks.map((chunk, index) => ({
        documentId,
        externalId: payload.document.externalId,
        companyName: payload.document.companyName,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        text: chunk.text,
        embedding: embeddings[index] ?? []
      }))
    );

    const job: IngestionJobRecord = {
      id: randomUUID(),
      status: "completed",
      source,
      documentExternalId: payload.document.externalId,
      result: {
        chunkCount: payload.chunks.length,
        companyName: payload.document.companyName
      },
      createdAt: now,
      updatedAt: now
    };

    this.ingestionJobs.push(job);
    return job;
  }
}

export class PgDocumentRepository implements DocumentRepository {
  constructor(private readonly queryClient: QueryClientLike) {}

  async listDocuments(): Promise<ImportedDocumentSummary[]> {
    const result = await this.queryClient.query<ImportedDocumentSummary>(
      `
        select
          id,
          external_id as "externalId",
          company_name as "companyName",
          original_file_name as "originalFileName",
          source_type as "sourceType",
          reference_mode as "referenceMode",
          created_at as "createdAt"
        from documents
        order by created_at desc
      `
    );

    return result.rows;
  }

  async listIngestionJobs(): Promise<IngestionJobRecord[]> {
    const result = await this.queryClient.query<IngestionJobRecord>(
      `
        select
          id,
          status,
          job_type as "source",
          payload->'document'->>'externalId' as "documentExternalId",
          result,
          created_at as "createdAt",
          updated_at as "updatedAt"
        from ingestion_jobs
        order by created_at desc
      `
    );

    return result.rows;
  }

  async listCompanyNames(): Promise<string[]> {
    const result = await this.queryClient.query<{ companyName: string }>(
      `select distinct company_name as "companyName" from documents order by company_name asc`
    );

    return result.rows.map((row) => row.companyName);
  }

  async searchChunksByCompany(companyName: string, questionText: string, questionEmbedding: number[], limit: number): Promise<ChunkSearchResult[]> {
    const candidateLimit = Math.max(limit * 8, 24);
    const keywordTsQuery = buildKeywordTsQueryString(questionText, 40);
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
              order by ts_rank_cd(to_tsvector('simple', dc.keyword_lexemes), to_tsquery('simple', $3)) desc, dc.page_start asc
            ) as "keywordRank"
          from document_chunks dc
          inner join documents d on d.id = dc.document_id
          where d.company_name = $1
            and $3 <> ''
            and to_tsvector('simple', dc.keyword_lexemes) @@ to_tsquery('simple', $3)
          order by ts_rank_cd(to_tsvector('simple', dc.keyword_lexemes), to_tsquery('simple', $3)) desc, dc.page_start asc
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
            coalesce((1.0 / (60 + v."vectorRank"))::double precision, 0)
              + coalesce((1.0 / (60 + k."keywordRank"))::double precision, 0) as "score"
          from vector_candidates v
          full outer join keyword_candidates k on k."chunkId" = v."chunkId"
        )
        select
          "chunkId",
          "documentId",
          "externalId",
          "companyName",
          "pageStart",
          "pageEnd",
          "text",
          "score"
        from merged
        order by "score" desc, "vectorRank" asc nulls last, "keywordRank" asc nulls last, "pageStart" asc
        limit $5
      `,
      [companyName, toPgvectorLiteral(questionEmbedding), keywordTsQuery, candidateLimit, limit]
    );

    return result.rows.map(toSearchResult);
  }

  async createLegacyImportJob(
    payload: ImportedLegacyChunkPayload,
    embeddingProvider: EmbeddingProvider,
    source: IngestionJobRecord["source"] = "legacy-chunk"
  ): Promise<IngestionJobRecord> {
    const now = new Date().toISOString();
    const jobId = randomUUID();
    const documentId = randomUUID();
    const embeddings = await embeddingProvider.embedDocuments(payload.chunks.map((chunk) => chunk.text));

    const documentResult = await this.queryClient.query<{ id: string }>(
      `
        insert into documents (
          id, external_id, company_name, original_file_name, source_type, parse_status, reference_mode, created_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (external_id) do update set
          company_name = excluded.company_name,
          original_file_name = excluded.original_file_name,
          source_type = excluded.source_type,
          parse_status = excluded.parse_status,
          reference_mode = excluded.reference_mode
        returning id
      `,
      [
        documentId,
        payload.document.externalId,
        payload.document.companyName,
        payload.document.originalFileName,
        payload.document.sourceType,
        "completed",
        payload.chunks[0]?.referenceMode ?? "weak",
        now
      ]
    );
    const persistedDocumentId = documentResult.rows[0]?.id ?? documentId;

    for (const [index, chunk] of payload.chunks.entries()) {
      const chunkId = randomUUID();
      const keywordLexemes = buildKeywordLexemeString(chunk.text);
      const chunkResult = await this.queryClient.query<{ id: string }>(
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
      const persistedChunkId = chunkResult.rows[0]?.id ?? chunkId;

      await this.queryClient.query(
        `
          insert into chunk_embeddings (
            chunk_id, embedding, model_name, created_at
          ) values ($1, $2::vector, $3, $4)
          on conflict (chunk_id) do update set
            embedding = excluded.embedding,
            model_name = excluded.model_name,
            created_at = excluded.created_at
        `,
        [persistedChunkId, toPgvectorLiteral(embeddings[index] ?? []), embeddingProvider.modelName, now]
      );
    }

    await this.queryClient.query(
      `
        insert into ingestion_jobs (
          id, job_type, status, payload, result, created_at, updated_at
        ) values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
      `,
      [
        jobId,
        source === "upload" ? "upload" : "legacy-chunk-import",
        "completed",
        JSON.stringify(payload),
        JSON.stringify({ chunkCount: payload.chunks.length, companyName: payload.document.companyName }),
        now,
        now
      ]
    );

    return {
      id: jobId,
      status: "completed",
      source,
      documentExternalId: payload.document.externalId,
      result: {
        chunkCount: payload.chunks.length,
        companyName: payload.document.companyName
      },
      createdAt: now,
      updatedAt: now
    };
  }
}
