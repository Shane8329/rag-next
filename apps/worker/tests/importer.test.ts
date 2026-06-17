import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { buildLegacyImportTrace, importLegacyChunkDirectory, importLegacyChunkFile } from "../src/index";

describe("importLegacyChunkFile", () => {
  it("reads a legacy chunk file and converts it into the new import payload", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rag-next-worker-"));
    const filePath = join(dir, "chunk.json");
    await writeFile(filePath, JSON.stringify({
      metainfo: {
        sha1: "stock_10001",
        company_name: "中芯国际",
        file_name: "中芯国际.md"
      },
      content: {
        chunks: [{ lines: [1, 30], text: "第一页内容" }]
      }
    }), "utf8");

    const payload = await importLegacyChunkFile(filePath);

    expect(payload.document.companyName).toBe("中芯国际");
    expect(payload.chunks[0]?.pageStart).toBe(1);
  });

  it("reads every legacy chunk json file in a directory tree", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rag-next-worker-batch-"));
    const nestedDir = join(dir, "nested");
    await mkdir(nestedDir);

    await writeFile(join(dir, "a.json"), JSON.stringify({
      metainfo: {
        sha1: "stock_10001",
        company_name: "中芯国际",
        file_name: "中芯国际.md"
      },
      content: {
        chunks: [{ lines: [2, 5], text: "晶圆产能提升" }]
      }
    }), "utf8");

    await writeFile(join(nestedDir, "b.json"), JSON.stringify({
      metainfo: {
        sha1: "stock_10002",
        company_name: "寒武纪",
        file_name: "寒武纪.md"
      },
      content: {
        chunks: [{ lines: [7, 9], text: "AI 芯片收入增长" }]
      }
    }), "utf8");

    await writeFile(join(dir, "ignore.txt"), "skip me", "utf8");

    const payloads = await importLegacyChunkDirectory(dir);

    expect(payloads).toHaveLength(2);
    expect(payloads.map((payload) => payload.document.companyName)).toEqual(["中芯国际", "寒武纪"]);
  });

  it("builds a non-empty trace id for CLI output", () => {
    expect(buildLegacyImportTrace("sample.json")).toContain("legacy-import:");
  });
});