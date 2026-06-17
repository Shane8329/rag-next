import { randomUUID } from "node:crypto";

import type { ImportedLegacyChunkPayload } from "@rag-next/shared-types";

import type { EmbeddingProvider } from "../system/embedding.provider";
import type { ChunkSearchResult, ImportedDocumentSummary, IngestionJobRecord } from "./ingestion.types";

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

const DEFAULT_KEYWORD_TERMS = ["销售收入", "营业收入", "营收", "收入", "全年", "一季度", "第一季度", "2024", "2025"];

export abstract class DocumentRepository {
  abstract listDocuments(): Promise<ImportedDocumentSummary[]> | ImportedDocumentSummary[];
  abstract listIngestionJobs(): Promise<IngestionJobRecord[]> | IngestionJobRecord[];
  abstract createLegacyImportJob(payload: ImportedLegacyChunkPayload, embeddingProvider: EmbeddingProvider): Promise<IngestionJobRecord> | IngestionJobRecord;
  abstract listCompanyNames(): Promise<string[]> | string[];
  abstract searchChunksByCompany(companyName: string, questionText: string, questionEmbedding: number[], limit: number): Promise<ChunkSearchResult[]> | ChunkSearchResult[];
}

export function createDocumentRepository(queryClient?: QueryClientLike): DocumentRepository {
  if (!process.env.DATABASE_URL || !queryClient) {
    return new InMemoryDocumentRepository();
  }

  return new PgDocumentRepository(queryClient);
}

function normalizeQuestionText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

function extractQuestionTerms(questionText: string): string[] {
  const normalized = normalizeQuestionText(questionText);
  const terms = new Set<string>();

  for (const term of DEFAULT_KEYWORD_TERMS) {
    if (normalized.includes(term)) {
      terms.add(term);
    }
  }

  for (const match of normalized.match(/[\u4e00-\u9fff]{2,}|[A-Za-z0-9]{2,}/g) ?? []) {
    terms.add(match);
  }

  return [...terms];
}

function scoreChunk(text: string, questionText: string): number {
  const normalizedText = normalizeQuestionText(text);
  let score = 0;

  for (const term of extractQuestionTerms(questionText)) {
    if (normalizedText.includes(term)) {
      score += term.length >= 4 ? 0.18 : 0.08;
    }
  }

  if (normalizedText.includes("销售收入") || normalizedText.includes("营业收入") || normalizedText.includes("营收")) {
    score += 1;
  }

  if (normalizedText.includes("2024") && normalizedText.includes("销售收入")) {
    score += 0.1;
  }

  return score;
}

function rankChunkCandidates(candidates: ChunkCandidate[], questionText: string, limit: number): ChunkSearchResult[] {
  return candidates
    .map((candidate) => ({
      ...candidate,
      score: candidate.score + scoreChunk(candidate.text, questionText)
    }))
    .sort((left, right) => right.score - left.score || left.pageStart - right.pageStart)
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
    return rankChunkCandidates(
      this.chunks
        .filter((chunk) => chunk.companyName === companyName)
        .map((chunk) => ({
          chunkId: `${chunk.documentId}:${chunk.pageStart}:${chunk.pageEnd}`,
          documentId: chunk.documentId,
          externalId: chunk.externalId,
          companyName: chunk.companyName,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          text: chunk.text,
          score: cosineSimilarity(chunk.embedding, questionEmbedding)
        })),
      questionText,
      limit
    );
  }

  async createLegacyImportJob(payload: ImportedLegacyChunkPayload, embeddingProvider: EmbeddingProvider): Promise<IngestionJobRecord> {
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
      source: "legacy-chunk",
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
    const candidateLimit = Math.max(limit * 4, 12);
    const result = await this.queryClient.query<ChunkCandidate>(
      `
        select
          dc.id as "chunkId",
          dc.document_id as "documentId",
          d.external_id as "externalId",
          d.company_name as "companyName",
          dc.page_start as "pageStart",
          dc.page_end as "pageEnd",
          dc.text_content as "text",
          1 - (ce.embedding <=> $2::vector) as "score"
        from document_chunks dc
        inner join documents d on d.id = dc.document_id
        inner join chunk_embeddings ce on ce.chunk_id = dc.id
        where d.company_name = $1
        order by ce.embedding <=> $2::vector asc, dc.page_start asc
        limit $3
      `,
      [companyName, toPgvectorLiteral(questionEmbedding), candidateLimit]
    );

    return rankChunkCandidates(result.rows, questionText, limit);
  }

  async createLegacyImportJob(payload: ImportedLegacyChunkPayload, embeddingProvider: EmbeddingProvider): Promise<IngestionJobRecord> {
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
      const chunkResult = await this.queryClient.query<{ id: string }>(
        `
          insert into document_chunks (
            id, document_id, chunk_index, page_start, page_end, text_content, reference_mode, created_at
          ) values ($1, $2, $3, $4, $5, $6, $7, $8)
          on conflict (document_id, chunk_index) do update set
            page_start = excluded.page_start,
            page_end = excluded.page_end,
            text_content = excluded.text_content,
            reference_mode = excluded.reference_mode
          returning id
        `,
        [chunkId, persistedDocumentId, chunk.chunkIndex, chunk.pageStart, chunk.pageEnd, chunk.text, chunk.referenceMode, now]
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
        "legacy-chunk-import",
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
      source: "legacy-chunk",
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
