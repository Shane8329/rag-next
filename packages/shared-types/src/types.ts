export type ReferenceMode = "weak" | "page";

export interface RetrievalPageLike {
  page: number;
}

export interface LegacyChunkRecord {
  lines?: [number, number];
  text: string;
}

export interface LegacyChunkDocument {
  metainfo: {
    sha1: string;
    company_name: string;
    file_name: string;
  };
  content: {
    chunks: LegacyChunkRecord[];
  };
}

export interface ImportedDocumentRecord {
  externalId: string;
  companyName: string;
  originalFileName: string;
  sourceType: "legacy_chunk" | "upload";
}

export interface ImportedChunkRecord {
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  text: string;
  referenceMode: ReferenceMode;
}

export interface ImportedLegacyChunkPayload {
  document: ImportedDocumentRecord;
  chunks: ImportedChunkRecord[];
}

export interface AnswerReference {
  documentId: string;
  page: number;
}

export interface QaAnswer {
  traceId: string;
  finalAnswer: string;
  reasoningSummary: string;
  relevantPages: number[];
  references: AnswerReference[];
}
