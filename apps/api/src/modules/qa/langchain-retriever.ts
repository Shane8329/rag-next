import { Document } from "@langchain/core/documents";
import { BaseRetriever } from "@langchain/core/retrievers";

import { DocumentRepository } from "../ingestion/document.repository";
import type { ChunkSearchResult } from "../ingestion/ingestion.types";
import type { EmbeddingProvider } from "../system/embedding.provider";

export interface HybridChunkMetadata {
  companyName: string;
  documentId: string;
  externalId: string;
  pageEnd: number;
  pageStart: number;
  score: number;
}

interface HybridCompanyRetrieverOptions {
  companyName: string;
  documentRepository: DocumentRepository;
  embeddingProvider: EmbeddingProvider;
  limit: number;
}

export function chunkToLangChainDocument(chunk: ChunkSearchResult): Document<HybridChunkMetadata> {
  return new Document({
    pageContent: chunk.text,
    metadata: {
      companyName: chunk.companyName,
      documentId: chunk.documentId,
      externalId: chunk.externalId,
      pageEnd: chunk.pageEnd,
      pageStart: chunk.pageStart,
      score: chunk.score
    }
  });
}

export function langChainDocumentToChunk(document: Document<HybridChunkMetadata>): ChunkSearchResult {
  return {
    companyName: document.metadata.companyName,
    documentId: document.metadata.documentId,
    externalId: document.metadata.externalId,
    pageEnd: document.metadata.pageEnd,
    pageStart: document.metadata.pageStart,
    score: document.metadata.score,
    text: document.pageContent
  };
}

export class HybridCompanyRetriever extends BaseRetriever<HybridChunkMetadata> {
  lc_namespace = ["rag-next", "qa", "retrievers"];

  private readonly companyName: string;
  private readonly documentRepository: DocumentRepository;
  private readonly embeddingProvider: EmbeddingProvider;
  private readonly limit: number;

  constructor(options: HybridCompanyRetrieverOptions) {
    super({
      metadata: {
        companyName: options.companyName,
        retriever: "postgres-hybrid-rrf"
      }
    });
    this.companyName = options.companyName;
    this.documentRepository = options.documentRepository;
    this.embeddingProvider = options.embeddingProvider;
    this.limit = options.limit;
  }

  async _getRelevantDocuments(query: string): Promise<Array<Document<HybridChunkMetadata>>> {
    // LangChain 只负责把“给定 query 返回 Document[]”这个检索接口标准化；
    // 真实的公司过滤、pgvector 向量召回、关键词召回和 RRF 融合仍保留在仓储层，
    // 这样排查召回问题时可以直接看 SQL 和数据库结果。
    const questionEmbedding = await this.embeddingProvider.embedQuery(query);
    const chunks = await this.documentRepository.searchChunksByCompany(this.companyName, query, questionEmbedding, this.limit);

    // 页码、外部文档 ID 和融合分数必须放进 metadata，后续 QA 引用和调试都依赖这些字段。
    return chunks.map(chunkToLangChainDocument);
  }
}
