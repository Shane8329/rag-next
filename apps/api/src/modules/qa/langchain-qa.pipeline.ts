import { RunnableLambda, RunnableSequence } from "@langchain/core/runnables";

import { DocumentRepository } from "../ingestion/document.repository";
import type { ChatProvider, QaContextGroup } from "../system/chat.provider";
import type { EmbeddingProvider } from "../system/embedding.provider";
import { HybridCompanyRetriever, langChainDocumentToChunk } from "./langchain-retriever";

interface LangChainQaPipelineInput {
  companyNames: string[];
  questionText: string;
}

interface LangChainQaRetrievalOutput {
  contexts: QaContextGroup[];
  questionText: string;
}

export interface LangChainQaPipelineOutput extends LangChainQaRetrievalOutput {
  finalAnswer: string;
}

export class LangChainQaPipeline {
  private readonly runnable: RunnableSequence<LangChainQaPipelineInput, LangChainQaPipelineOutput>;

  constructor(
    private readonly documentRepository: DocumentRepository,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly chatProvider: ChatProvider
  ) {
    this.runnable = RunnableSequence.from([
      RunnableLambda.from((input: LangChainQaPipelineInput) => this.retrieveContexts(input)),
      RunnableLambda.from((retrieval: LangChainQaRetrievalOutput) => this.answerWithExistingChatProvider(retrieval))
    ]);
  }

  invoke(input: LangChainQaPipelineInput): Promise<LangChainQaPipelineOutput> {
    return this.runnable.invoke(input);
  }

  private async retrieveContexts(input: LangChainQaPipelineInput): Promise<LangChainQaRetrievalOutput> {
    const contexts = await Promise.all(
      input.companyNames.map(async (companyName) => {
        const retriever = new HybridCompanyRetriever({
          companyName,
          documentRepository: this.documentRepository,
          embeddingProvider: this.embeddingProvider,
          limit: 3
        });
        const documents = await retriever.invoke(input.questionText);

        return {
          companyName,
          chunks: documents.map(langChainDocumentToChunk)
        };
      })
    );

    return {
      contexts,
      questionText: input.questionText
    };
  }

  private async answerWithExistingChatProvider(retrieval: LangChainQaRetrievalOutput): Promise<LangChainQaPipelineOutput> {
    // 当前项目已经有 DashScope/OpenAI/本地抽取式 ChatProvider。
    // 这里让 LangChain 接管 RAG 编排，但保留现有模型适配器，避免同时改动模型调用、错误处理和环境变量约定。
    const finalAnswer = await this.chatProvider.answerQuestion({
      contexts: retrieval.contexts,
      questionText: retrieval.questionText
    });

    return {
      ...retrieval,
      finalAnswer
    };
  }
}
