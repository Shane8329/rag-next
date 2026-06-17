import { Inject, Injectable } from "@nestjs/common";

import { DocumentRepository } from "../ingestion/document.repository";

@Injectable()
export class JobsService {
  constructor(@Inject(DocumentRepository) private readonly documentRepository: DocumentRepository) {}

  async listJobs() {
    return {
      ingestionJobs: await this.documentRepository.listIngestionJobs(),
      qaJobs: []
    };
  }
}