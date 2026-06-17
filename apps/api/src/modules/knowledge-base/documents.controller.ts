import { Controller, Get, Inject } from "@nestjs/common";

import { DocumentRepository } from "../ingestion/document.repository";

@Controller("documents")
export class DocumentsController {
  constructor(@Inject(DocumentRepository) private readonly documentRepository: DocumentRepository) {}

  @Get()
  async listDocuments() {
    return {
      items: await this.documentRepository.listDocuments()
    };
  }
}