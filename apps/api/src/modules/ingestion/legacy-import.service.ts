import { Inject, Injectable } from "@nestjs/common";
import { convertLegacyChunkDocument, type LegacyChunkDocument } from "@rag-next/shared-types";

import { DocumentRepository } from "./document.repository";
import { EMBEDDING_PROVIDER, type EmbeddingProvider } from "../system/embedding.provider";

@Injectable()
export class LegacyImportService {
  constructor(
    @Inject(DocumentRepository) private readonly documentRepository: DocumentRepository,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddingProvider: EmbeddingProvider
  ) {}

  convert(document: LegacyChunkDocument) {
    return convertLegacyChunkDocument(document);
  }

  async importLegacyChunkDocument(document: LegacyChunkDocument) {
    const payload = convertLegacyChunkDocument(document);
    return this.documentRepository.createLegacyImportJob(payload, this.embeddingProvider);
  }

  async importLegacyChunkDocuments(documents: LegacyChunkDocument[] | LegacyChunkDocument) {
    const items = Array.isArray(documents) ? documents : [documents];
    return Promise.all(items.map((document) => this.importLegacyChunkDocument(document)));
  }
}