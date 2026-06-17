export interface IngestionJobRecord {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  source: "legacy-chunk" | "upload";
  documentExternalId?: string;
  result?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ImportedDocumentSummary {
  id: string;
  externalId: string;
  companyName: string;
  originalFileName: string;
  sourceType: string;
  referenceMode: string;
  createdAt: string;
}

export interface ChunkSearchResult {
  documentId: string;
  externalId: string;
  companyName: string;
  pageStart: number;
  pageEnd: number;
  text: string;
  score: number;
}
