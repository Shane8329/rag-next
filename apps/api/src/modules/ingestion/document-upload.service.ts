import { Inject, Injectable, Optional } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";

import type { LegacyChunkDocument, LegacyChunkRecord } from "@rag-next/shared-types";

import { DocumentRepository } from "./document.repository";
import { DOCUMENT_PARSER, type DocumentParser, type ParsedDocumentArtifactMap } from "./document-parser";
import { splitMarkdownToLegacyChunks } from "./markdown-chunker";
import { EMBEDDING_PROVIDER, type EmbeddingProvider } from "../system/embedding.provider";

export interface UploadedDocumentInput {
  buffer: Buffer;
  companyName: string;
  originalFileName: string;
}

export interface DocumentUploadServiceOptions {
  storageRoot?: string;
}

export const DOCUMENT_UPLOAD_OPTIONS = Symbol("DOCUMENT_UPLOAD_OPTIONS");

@Injectable()
export class DocumentUploadService {
  private readonly storageRoot: string;

  constructor(
    @Inject(DocumentRepository) private readonly documentRepository: DocumentRepository,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddingProvider: EmbeddingProvider,
    @Inject(DOCUMENT_PARSER) private readonly parser: DocumentParser,
    @Optional()
    @Inject(DOCUMENT_UPLOAD_OPTIONS)
    options: DocumentUploadServiceOptions = {}
  ) {
    this.storageRoot = options.storageRoot ?? process.env.STORAGE_ROOT ?? join(process.cwd(), "storage");
  }

  async importUploadedDocument(input: UploadedDocumentInput) {
    if (extname(input.originalFileName).toLowerCase() !== ".pdf") {
      throw new Error("Only PDF uploads are supported");
    }

    const documentExternalId = createDocumentExternalId(input.buffer);
    const documentDir = join(this.storageRoot, "documents", documentExternalId);
    const originalFilePath = join(documentDir, "original.pdf");

    await mkdir(documentDir, { recursive: true });
    await writeFile(originalFilePath, input.buffer);

    const parsed = await this.parser.parse({
      documentId: documentExternalId,
      fileName: input.originalFileName,
      filePath: originalFilePath
    });

    await writeFile(join(documentDir, "parsed.md"), parsed.markdown, "utf8");

    if (parsed.rawArtifacts) {
      await writeArtifacts(join(documentDir, "mineru"), parsed.rawArtifacts);
    }

    const legacyDocument = toLegacyChunkDocument({
      companyName: input.companyName,
      documentExternalId,
      fileName: input.originalFileName,
      markdown: parsed.markdown
    });

    await writeFile(join(documentDir, "chunks.json"), JSON.stringify(legacyDocument, null, 2), "utf8");

    const pageAnchors = buildMineruPageAnchors(parsed.markdown, parsed.rawArtifacts);

    const job = await this.documentRepository.createLegacyImportJob(
      {
        document: {
          externalId: legacyDocument.metainfo.sha1,
          companyName: legacyDocument.metainfo.company_name,
          originalFileName: input.originalFileName,
          sourceType: "upload"
        },
        chunks: legacyDocument.content.chunks.map((chunk, index) => {
          const pageRange = resolveChunkPageRange(chunk, index, pageAnchors);

          return {
            chunkIndex: index,
            pageEnd: pageRange.pageEnd,
            pageStart: pageRange.pageStart,
            referenceMode: "weak",
            text: chunk.text
          };
        })
      },
      this.embeddingProvider,
      "upload"
    );

    return {
      ...job,
      result: {
        ...(job.result ?? {}),
        chunkCount: legacyDocument.content.chunks.length,
        companyName: input.companyName,
        documentExternalId,
        originalFileName: input.originalFileName,
        storagePath: documentDir
      }
    };
  }
}

interface MineruPageBlock {
  page: number;
  texts: string[];
}

interface MineruPageAnchor {
  lineEnd: number;
  lineStart: number;
  page: number;
}

interface PageRange {
  pageEnd: number;
  pageStart: number;
}

function createDocumentExternalId(buffer: Buffer): string {
  const sha1 = createHash("sha1").update(buffer).digest("hex");
  return sha1 || randomUUID();
}

function toLegacyChunkDocument(input: {
  companyName: string;
  documentExternalId: string;
  fileName: string;
  markdown: string;
}): LegacyChunkDocument {
  return {
    content: {
      chunks: splitMarkdownToLegacyChunks(input.markdown)
    },
    metainfo: {
      company_name: input.companyName,
      file_name: input.fileName,
      sha1: input.documentExternalId
    }
  };
}

function resolveChunkPageRange(chunk: LegacyChunkRecord, index: number, pageAnchors: MineruPageAnchor[]): PageRange {
  const fallback = estimatePageRange(chunk, index);
  if (!chunk.lines || pageAnchors.length === 0) {
    return fallback;
  }

  const [chunkLineStart, chunkLineEnd] = chunk.lines;
  const matchedPages = pageAnchors
    .filter((anchor) => rangesOverlap(chunkLineStart, chunkLineEnd, anchor.lineStart, anchor.lineEnd))
    .map((anchor) => anchor.page);

  if (matchedPages.length === 0) {
    return fallback;
  }

  return {
    pageEnd: Math.max(...matchedPages),
    pageStart: Math.min(...matchedPages)
  };
}

function estimatePageRange(chunk: LegacyChunkRecord, index: number): PageRange {
  return {
    pageEnd: Math.max(1, Math.ceil((chunk.lines?.[1] ?? index + 1) / 30)),
    pageStart: Math.max(1, Math.ceil((chunk.lines?.[0] ?? index + 1) / 30))
  };
}

function rangesOverlap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean {
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function buildMineruPageAnchors(markdown: string, artifacts: ParsedDocumentArtifactMap | undefined): MineruPageAnchor[] {
  const pageBlocks = extractMineruPageBlocks(artifacts);
  if (pageBlocks.length === 0) {
    return [];
  }

  const normalizedMarkdown = markdown.replace(/\r\n/g, "\n");
  const lineStarts = buildLineStarts(normalizedMarkdown);
  const anchors: MineruPageAnchor[] = [];
  let searchOffset = 0;

  for (const block of pageBlocks) {
    for (const text of block.texts) {
      const match = findTextLineRange(normalizedMarkdown, lineStarts, text, searchOffset);
      if (!match) {
        continue;
      }

      anchors.push({
        lineEnd: match.lineEnd,
        lineStart: match.lineStart,
        page: block.page
      });
      searchOffset = match.nextOffset;
    }
  }

  return anchors;
}

function extractMineruPageBlocks(artifacts: ParsedDocumentArtifactMap | undefined): MineruPageBlock[] {
  if (!artifacts) {
    return [];
  }

  const flatContentList = findArtifactJson(artifacts, (path) => path.endsWith("content_list.json"));
  const flatBlocks = extractFlatMineruPageBlocks(flatContentList);
  if (flatBlocks.length > 0) {
    return flatBlocks;
  }

  const v2ContentList = findArtifactJson(artifacts, (path) => path.endsWith("content_list_v2.json"));
  return extractV2MineruPageBlocks(v2ContentList);
}

function findArtifactJson(artifacts: ParsedDocumentArtifactMap, predicate: (path: string) => boolean): unknown {
  const artifact = Object.entries(artifacts).find(([path]) => predicate(path.replace(/\\/g, "/")));
  if (!artifact) {
    return undefined;
  }

  const content = Buffer.isBuffer(artifact[1]) ? artifact[1].toString("utf8") : artifact[1];

  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

function extractFlatMineruPageBlocks(value: unknown): MineruPageBlock[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => extractMineruPageBlock(item));
}

function extractV2MineruPageBlocks(value: unknown): MineruPageBlock[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((pageItems, pageIndex) => {
    if (Array.isArray(pageItems)) {
      return pageItems.flatMap((item) => extractMineruPageBlock(item, pageIndex));
    }

    return extractMineruPageBlock(pageItems, pageIndex);
  });
}

function extractMineruPageBlock(value: unknown, fallbackPageIndex?: number): MineruPageBlock[] {
  if (!isRecord(value)) {
    return [];
  }

  const pageIndex = readPageIndex(value, fallbackPageIndex);
  if (pageIndex === undefined) {
    return [];
  }

  const texts = uniqueMeaningfulTexts(collectMineruTexts(value));
  if (texts.length === 0) {
    return [];
  }

  return [
    {
      page: pageIndex + 1,
      texts
    }
  ];
}

function readPageIndex(record: Record<string, unknown>, fallbackPageIndex?: number): number | undefined {
  const pageIndex = typeof record.page_idx === "number" ? record.page_idx : fallbackPageIndex;
  if (pageIndex === undefined || !Number.isInteger(pageIndex) || pageIndex < 0) {
    return undefined;
  }

  return pageIndex;
}

function collectMineruTexts(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectMineruTexts(item));
  }

  if (!isRecord(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([key, child]) => {
    if (["bbox", "img_path", "page_idx", "type"].includes(key)) {
      return [];
    }

    if (typeof child === "string") {
      return ["content", "table_body", "text"].includes(key) ? [child] : [];
    }

    return collectMineruTexts(child);
  });
}

function uniqueMeaningfulTexts(texts: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const text of texts) {
    const trimmed = text.replace(/\r\n/g, "\n").trim();
    if (trimmed.length < 2 || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

function buildLineStarts(markdown: string): number[] {
  const lineStarts = [0];
  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }

  return lineStarts;
}

function findTextLineRange(
  markdown: string,
  lineStarts: number[],
  text: string,
  searchOffset: number
): { lineEnd: number; lineStart: number; nextOffset: number } | undefined {
  const needle = text.replace(/\r\n/g, "\n").trim();
  const offsetAfterCurrent = markdown.indexOf(needle, searchOffset);
  const offset = offsetAfterCurrent >= 0 ? offsetAfterCurrent : markdown.indexOf(needle);
  if (offset < 0) {
    return undefined;
  }

  const endOffset = offset + needle.length;
  return {
    lineEnd: offsetToLineNumber(lineStarts, Math.max(offset, endOffset - 1)),
    lineStart: offsetToLineNumber(lineStarts, offset),
    nextOffset: endOffset
  };
}

function offsetToLineNumber(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const lineStart = lineStarts[middle] ?? 0;

    if (lineStart <= offset) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return Math.max(1, high + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function writeArtifacts(rootDir: string, artifacts: Record<string, string | Buffer>) {
  for (const [relativePath, content] of Object.entries(artifacts)) {
    const safeRelativePath = relativePath.replace(/^[/\\]+/, "");
    const filePath = join(rootDir, safeRelativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }
}
