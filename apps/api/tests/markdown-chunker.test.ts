import { describe, expect, it } from "vitest";

import { splitMarkdownToLegacyChunks } from "../src/modules/ingestion/markdown-chunker";

describe("splitMarkdownToLegacyChunks", () => {
  it("splits markdown by line with overlap compatible with the legacy chunk format", () => {
    const markdown = Array.from({ length: 35 }, (_, index) => `line ${index + 1}`).join("\n");

    const chunks = splitMarkdownToLegacyChunks(markdown, {
      chunkOverlap: 5,
      chunkSize: 30
    });

    expect(chunks).toEqual([
      {
        lines: [1, 30],
        text: Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n")
      },
      {
        lines: [26, 35],
        text: Array.from({ length: 10 }, (_, index) => `line ${index + 26}`).join("\n")
      }
    ]);
  });

  it("drops blank chunks after trimming whitespace", () => {
    const chunks = splitMarkdownToLegacyChunks("\n\nuseful content\n\n", {
      chunkOverlap: 0,
      chunkSize: 2
    });

    expect(chunks).toEqual([
      {
        lines: [3, 3],
        text: "useful content"
      }
    ]);
  });
});
