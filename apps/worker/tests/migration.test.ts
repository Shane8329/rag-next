import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, vi } from "vitest";

import {
  createLegacyImportBatches,
  migrateLegacyChunkDirectoryToApi
} from "../src/migrate";

describe("legacy migration CLI helpers", () => {
  it("splits imported legacy payloads into stable API batches", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rag-next-migration-"));
    const nestedDir = join(dir, "nested");
    await mkdir(nestedDir);

    const docs = [
      {
        sha1: "stock_10001",
        company_name: "Company A",
        file_name: "company-a.md",
        text: "first chunk"
      },
      {
        sha1: "stock_10002",
        company_name: "Company B",
        file_name: "company-b.md",
        text: "second chunk"
      },
      {
        sha1: "stock_10003",
        company_name: "Company C",
        file_name: "company-c.md",
        text: "third chunk"
      }
    ];

    await writeFile(join(dir, "a.json"), JSON.stringify({
      metainfo: docs[0],
      content: { chunks: [{ lines: [1, 30], text: docs[0].text }] }
    }), "utf8");

    await writeFile(join(nestedDir, "b.json"), JSON.stringify({
      metainfo: docs[1],
      content: { chunks: [{ lines: [31, 60], text: docs[1].text }] }
    }), "utf8");

    await writeFile(join(nestedDir, "c.json"), JSON.stringify({
      metainfo: docs[2],
      content: { chunks: [{ lines: [61, 90], text: docs[2].text }] }
    }), "utf8");

    const batches = await createLegacyImportBatches(dir, 2);

    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(2);
    expect(batches[1]).toHaveLength(1);
    expect(batches.flatMap((batch) => batch.map((doc) => doc.metainfo.company_name))).toEqual([
      "Company A",
      "Company B",
      "Company C"
    ]);
  });

  it("posts batches to the API and returns a summary", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rag-next-migration-api-"));

    await writeFile(join(dir, "a.json"), JSON.stringify({
      metainfo: {
        sha1: "stock_10001",
        company_name: "Company A",
        file_name: "company-a.md"
      },
      content: { chunks: [{ lines: [1, 30], text: "first chunk" }] }
    }), "utf8");

    await writeFile(join(dir, "b.json"), JSON.stringify({
      metainfo: {
        sha1: "stock_10002",
        company_name: "Company B",
        file_name: "company-b.md"
      },
      content: { chunks: [{ lines: [31, 60], text: "second chunk" }] }
    }), "utf8");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([{ id: "job-1" }, { id: "job-2" }])
    }));

    const summary = await migrateLegacyChunkDirectoryToApi({
      sourceDir: dir,
      apiBaseUrl: "http://localhost:3000",
      batchSize: 1,
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(summary.documentCount).toBe(2);
    expect(summary.batchCount).toBe(2);
    expect(summary.jobCount).toBe(4);
  });
});