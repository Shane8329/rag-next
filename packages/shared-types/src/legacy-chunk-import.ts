import type { ImportedLegacyChunkPayload, LegacyChunkDocument } from "./types";

function inferPageRange(lines: [number, number] | undefined, fallbackPage: number): [number, number] {
  if (!lines) {
    return [fallbackPage, fallbackPage];
  }

  const [startLine, endLine] = lines;
  const startPage = Math.max(1, Math.ceil(startLine / 30));
  const endPage = Math.max(startPage, Math.ceil(endLine / 30));

  return [startPage, endPage];
}

export function convertLegacyChunkDocument(document: LegacyChunkDocument): ImportedLegacyChunkPayload {
  return {
    document: {
      externalId: document.metainfo.sha1,
      companyName: document.metainfo.company_name,
      originalFileName: document.metainfo.file_name,
      sourceType: "legacy_chunk"
    },
    chunks: document.content.chunks.map((chunk, index) => {
      const [pageStart, pageEnd] = inferPageRange(chunk.lines, index + 1);

      return {
        chunkIndex: index,
        pageStart,
        pageEnd,
        text: chunk.text,
        referenceMode: "weak"
      };
    })
  };
}
