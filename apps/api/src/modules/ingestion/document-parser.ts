export const DOCUMENT_PARSER = Symbol("DOCUMENT_PARSER");

export interface ParsedDocumentArtifactMap {
  [relativePath: string]: string | Buffer;
}

export interface ParsedDocumentResult {
  markdown: string;
  rawArtifacts?: ParsedDocumentArtifactMap;
}

export interface DocumentParser {
  parse(input: {
    documentId: string;
    fileName: string;
    filePath: string;
  }): Promise<ParsedDocumentResult>;
}

export class MissingDocumentParser implements DocumentParser {
  async parse(): Promise<ParsedDocumentResult> {
    throw new Error("Document parser is not configured. Set MINERU_COMMAND or provide a parser implementation.");
  }
}
