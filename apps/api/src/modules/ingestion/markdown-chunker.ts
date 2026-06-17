export interface MarkdownChunk {
  lines: [number, number];
  text: string;
}

export interface MarkdownChunkOptions {
  chunkOverlap?: number;
  chunkSize?: number;
}

export function splitMarkdownToLegacyChunks(markdown: string, options: MarkdownChunkOptions = {}): MarkdownChunk[] {
  const chunkSize = Math.max(1, options.chunkSize ?? 30);
  const chunkOverlap = Math.max(0, Math.min(options.chunkOverlap ?? 5, chunkSize - 1));
  const step = chunkSize - chunkOverlap;
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const chunks: MarkdownChunk[] = [];

  for (let start = 0; start < lines.length; start += step) {
    const endExclusive = Math.min(start + chunkSize, lines.length);
    const selectedLines = lines.slice(start, endExclusive);
    const firstContentOffset = selectedLines.findIndex((line) => line.trim().length > 0);

    if (firstContentOffset === -1) {
      continue;
    }

    let lastContentOffset = selectedLines.length - 1;
    while (lastContentOffset >= 0 && selectedLines[lastContentOffset]?.trim().length === 0) {
      lastContentOffset -= 1;
    }

    const contentLines = selectedLines.slice(firstContentOffset, lastContentOffset + 1);
    chunks.push({
      lines: [start + firstContentOffset + 1, start + lastContentOffset + 1],
      text: contentLines.join("\n").trim()
    });
  }

  return chunks;
}
