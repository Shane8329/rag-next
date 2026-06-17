import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { MineruCommandDocumentParser } from "../src/modules/ingestion/mineru-command-parser";

describe("MineruCommandDocumentParser", () => {
  it("explains how to fix a missing MinerU command", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "rag-next-mineru-missing-"));
    const inputPdf = join(tempDir, "input.pdf");

    await writeFile(inputPdf, "%PDF-1.4 fake");

    const parser = new MineruCommandDocumentParser({
      command: "definitely-missing-mineru-command",
      outputDir: join(tempDir, "mineru-output"),
      timeoutMs: 10_000
    });

    try {
      await expect(
        parser.parse({
          documentId: "document-id",
          fileName: "input.pdf",
          filePath: inputPdf
        })
      ).rejects.toThrow('MinerU command not found: "definitely-missing-mineru-command"');
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("runs the configured command and reads full.md plus raw artifacts", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "rag-next-mineru-"));
    const fakeMineruScript = join(tempDir, "fake-mineru.cjs");
    const inputPdf = join(tempDir, "input.pdf");

    await writeFile(inputPdf, "%PDF-1.4 fake");
    await writeFile(
      fakeMineruScript,
      `
const fs = require("node:fs");
const path = require("node:path");
const outputIndex = process.argv.indexOf("--output");
const outputDir = process.argv[outputIndex + 1];
const artifactDir = path.join(outputDir, "input", "auto");
fs.mkdirSync(artifactDir, { recursive: true });
fs.writeFileSync(path.join(artifactDir, "full.md"), "# Parsed markdown\\n\\ncontent", "utf8");
fs.writeFileSync(path.join(artifactDir, "content_list.json"), JSON.stringify([{ type: "text" }]), "utf8");
`,
      "utf8"
    );

    const parser = new MineruCommandDocumentParser({
      argsTemplate: [`${fakeMineruScript}`, "--path", "{input}", "--output", "{output}"],
      command: process.execPath,
      outputDir: join(tempDir, "mineru-output"),
      timeoutMs: 10_000
    });

    try {
      const result = await parser.parse({
        documentId: "document-id",
        fileName: "input.pdf",
        filePath: inputPdf
      });

      expect(result.markdown).toBe("# Parsed markdown\n\ncontent");
      expect(result.rawArtifacts?.["input/auto/full.md"]?.toString()).toBe("# Parsed markdown\n\ncontent");
      expect(result.rawArtifacts?.["input/auto/content_list.json"]?.toString()).toBe('[{"type":"text"}]');
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
