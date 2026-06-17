import { Module } from "@nestjs/common";

import { DocumentRepository } from "./ingestion/document.repository";
import { LegacyImportController } from "./ingestion/legacy-import.controller";
import { LegacyImportService } from "./ingestion/legacy-import.service";
import { DocumentsController } from "./knowledge-base/documents.controller";
import { QaController } from "./qa/qa.controller";
import { QaService } from "./qa/qa.service";
import { createChatProvider, createEmbeddingProvider, createRepositoryFromEnvironment } from "./system/database.provider";
import { CHAT_PROVIDER } from "./system/chat.provider";
import { EMBEDDING_PROVIDER } from "./system/embedding.provider";
import { JobsController } from "./system/jobs.controller";
import { JobsService } from "./system/jobs.service";

@Module({
  controllers: [DocumentsController, JobsController, QaController, LegacyImportController],
  providers: [
    LegacyImportService,
    JobsService,
    QaService,
    {
      provide: DocumentRepository,
      useFactory: () => createRepositoryFromEnvironment()
    },
    {
      provide: EMBEDDING_PROVIDER,
      useFactory: () => createEmbeddingProvider()
    },
    {
      provide: CHAT_PROVIDER,
      useFactory: () => createChatProvider()
    }
  ]
})
export class AppModule {}
