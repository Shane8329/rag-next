import { describe, expect, it } from "vitest";

import { convertLegacyChunkDocument } from "../src/legacy-chunk-import";

describe("convertLegacyChunkDocument", () => {
  it("converts legacy chunk json into importable pages and chunks", () => {
    const converted = convertLegacyChunkDocument({
      metainfo: {
        sha1: "stock_10001",
        company_name: "中芯国际",
        file_name: "中芯国际.md"
      },
      content: {
        chunks: [
          { lines: [1, 30], text: "第一页内容" },
          { lines: [26, 55], text: "第二页内容" }
        ]
      }
    });

    expect(converted.document.externalId).toBe("stock_10001");
    expect(converted.document.companyName).toBe("中芯国际");
    expect(converted.chunks).toHaveLength(2);
    expect(converted.chunks[0]?.pageStart).toBe(1);
    expect(converted.chunks[0]?.referenceMode).toBe("weak");
  });
});
