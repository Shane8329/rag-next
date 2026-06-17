import { Inject, Injectable } from "@nestjs/common";
import { matchCompaniesFromQuestion, validateRelevantPages, type QaAnswer } from "@rag-next/shared-types";
import { randomUUID } from "node:crypto";

import { DocumentRepository } from "../ingestion/document.repository";
import { CHAT_PROVIDER, type ChatProvider } from "../system/chat.provider";
import { EMBEDDING_PROVIDER, type EmbeddingProvider } from "../system/embedding.provider";

@Injectable()
export class QaService {
  constructor(
    @Inject(DocumentRepository) private readonly documentRepository: DocumentRepository,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddingProvider: EmbeddingProvider,
    @Inject(CHAT_PROVIDER) private readonly chatProvider: ChatProvider
  ) {}

  async answer(questionText: string, companyNames: string[]): Promise<QaAnswer> {
    const candidateCompanies = companyNames.length > 0 ? companyNames : await this.documentRepository.listCompanyNames();
    const matchedCompanies = matchCompaniesFromQuestion(questionText, candidateCompanies);

    if (matchedCompanies.length === 0) {
      return {
        traceId: randomUUID(),
        finalAnswer: "未识别到公司，请补充公司名。",
        reasoningSummary: "问题文本中没有命中知识库内的公司名，因此未调用大模型生成答案。",
        relevantPages: [],
        references: []
      };
    }

    const questionEmbedding = await this.embeddingProvider.embedQuery(questionText);
    const contexts = await Promise.all(
      matchedCompanies.map(async (companyName) => ({
        companyName,
        chunks: await this.documentRepository.searchChunksByCompany(companyName, questionText, questionEmbedding, 3)
      }))
    );

    const flatChunks = contexts.flatMap((context) => context.chunks);
    const relevantPages = validateRelevantPages(
      flatChunks.map((chunk) => chunk.pageStart),
      flatChunks.map((chunk) => ({ page: chunk.pageStart })),
      Math.min(2, Math.max(flatChunks.length, 1)),
      8
    );

    const finalAnswer = await this.chatProvider.answerQuestion({
      contexts,
      questionText
    });

    return {
      traceId: randomUUID(),
      finalAnswer,
      reasoningSummary: `已识别 ${matchedCompanies.length} 家公司，基于 ${flatChunks.length} 个检索片段调用 ${this.chatProvider.modelName} 生成答案。`,
      relevantPages,
      references: flatChunks.map((chunk) => ({
        documentId: chunk.externalId,
        page: chunk.pageStart
      }))
    };
  }
}
