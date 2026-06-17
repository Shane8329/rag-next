import { Buffer } from "node:buffer";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";

import { MineruCloudDocumentParser } from "../src/modules/ingestion/mineru-cloud-parser";

describe("MineruCloudDocumentParser", () => {
  it("creates a MinerU task, polls until done, downloads zip output, and reads full.md", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "rag-next-mineru-cloud-"));
    const inputPdf = join(tempDir, "input.pdf");
    const calls: Array<{ body?: unknown; url: string }> = [];
    const zipBytes = Buffer.from(
      zipSync({
        "task-id/full.md": strToU8("# Parsed markdown\n\ncontent"),
        "task-id/content_list.json": strToU8(JSON.stringify([{ type: "text" }]))
      })
    );
    let pollCount = 0;

    await writeFile(inputPdf, "%PDF-1.4 fake");

    const parser = new MineruCloudDocumentParser({
      apiKey: "mineru-key",
      fetchImpl: async (url, init) => {
        calls.push({
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
          url: String(url)
        });

        if (String(url).endsWith("/extract/task") && init?.method === "POST") {
          return jsonResponse({
            data: {
              task_id: "task-id"
            }
          });
        }

        if (String(url).endsWith("/extract/task/task-id")) {
          pollCount += 1;

          return jsonResponse({
            data:
              pollCount === 1
                ? { state: "running" }
                : {
                    full_zip_url: "https://example.test/result.zip",
                    state: "done"
                  }
          });
        }

        if (String(url) === "https://example.test/result.zip") {
          return new Response(zipBytes);
        }

        return new Response("not found", { status: 404 });
      },
      outputDir: join(tempDir, "mineru-output"),
      pdfUrlBase: "https://oss.example.test/pdf/",
      pollIntervalMs: 1
    });

    try {
      const result = await parser.parse({
        documentId: "document-id",
        fileName: "中芯国际2024年年度报告.pdf",
        filePath: inputPdf
      });

      expect(calls[0]).toMatchObject({
        body: {
          enable_formula: false,
          is_ocr: true,
          url: "https://oss.example.test/pdf/%E4%B8%AD%E8%8A%AF%E5%9B%BD%E9%99%852024%E5%B9%B4%E5%B9%B4%E5%BA%A6%E6%8A%A5%E5%91%8A.pdf"
        },
        url: "https://mineru.net/api/v4/extract/task"
      });
      expect(pollCount).toBe(2);
      expect(result.markdown).toBe("# Parsed markdown\n\ncontent");
      expect(result.rawArtifacts?.["task-id/full.md"]?.toString()).toBe("# Parsed markdown\n\ncontent");
      expect(result.rawArtifacts?.["task-id/content_list.json"]?.toString()).toBe('[{"type":"text"}]');
      expect(Buffer.isBuffer(result.rawArtifacts?.["task-id.zip"])).toBe(true);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("fails when the MinerU task reports an error message", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "rag-next-mineru-cloud-error-"));
    const inputPdf = join(tempDir, "input.pdf");
    const parser = new MineruCloudDocumentParser({
      apiKey: "mineru-key",
      fetchImpl: async (url, init) => {
        if (String(url).endsWith("/extract/task") && init?.method === "POST") {
          return jsonResponse({ data: { task_id: "task-id" } });
        }

        return jsonResponse({ data: { err_msg: "parse failed", state: "failed" } });
      },
      outputDir: join(tempDir, "mineru-output"),
      pdfUrlBase: "https://oss.example.test/pdf/",
      pollIntervalMs: 1
    });

    await writeFile(inputPdf, "%PDF-1.4 fake");

    try {
      await expect(
        parser.parse({
          documentId: "document-id",
          fileName: "input.pdf",
          filePath: inputPdf
        })
      ).rejects.toThrow("MinerU task failed: parse failed");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json"
    }
  });
}
