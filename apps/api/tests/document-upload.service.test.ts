import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { InMemoryDocumentRepository } from "../src/modules/ingestion/document.repository";
import { DocumentUploadService } from "../src/modules/ingestion/document-upload.service";
import type { DocumentParser } from "../src/modules/ingestion/document-parser";
import { DeterministicEmbeddingProvider } from "../src/modules/system/embedding.provider";
import { DocumentRepository } from "../src/modules/ingestion/document.repository";

class FakeParser implements DocumentParser {
  async parse() {
    return {
      markdown: Array.from({ length: 32 }, (_, index) => `line ${index + 1}`).join("\n"),
      rawArtifacts: {
        "full.md": "fake markdown"
      }
    };
  }
}

class MineruPageParser implements DocumentParser {
  async parse() {
    const lines = Array.from({ length: 32 }, (_, index) => `line ${index + 1}`);
    lines[0] = "page-five-anchor";
    lines[30] = "page-ten-anchor";

    return {
      markdown: lines.join("\n"),
      rawArtifacts: {
        "task-id/content_list.json": JSON.stringify([
          { type: "text", text: "page-five-anchor", page_idx: 4 },
          { type: "text", text: "page-ten-anchor", page_idx: 9 }
        ])
      }
    };
  }
}

class CapturingDocumentRepository extends InMemoryDocumentRepository {
  public lastPayload: Parameters<DocumentRepository["createLegacyImportJob"]>[0] | undefined;

  override async createLegacyImportJob(
    payload: Parameters<DocumentRepository["createLegacyImportJob"]>[0],
    embeddingProvider: Parameters<DocumentRepository["createLegacyImportJob"]>[1],
    source?: Parameters<DocumentRepository["createLegacyImportJob"]>[2]
  ) {
    this.lastPayload = payload;
    return super.createLegacyImportJob(payload, embeddingProvider, source);
  }
}

describe("DocumentUploadService", () => {
  it("stores an uploaded PDF, parses markdown, chunks it, and imports embeddings", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "rag-next-upload-"));
    const repository = new InMemoryDocumentRepository();
    const service = new DocumentUploadService(repository, new DeterministicEmbeddingProvider(), new FakeParser(), {
      storageRoot
    });

    try {
      const job = await service.importUploadedDocument({
        buffer: Buffer.from("%PDF-1.4 fake"),
        companyName: "中芯国际",
        originalFileName: "中芯国际2024年年度报告.pdf"
      });

      expect(job.status).toBe("completed");
      expect(job.source).toBe("upload");
      expect(job.result).toMatchObject({
        chunkCount: 2,
        companyName: "中芯国际",
        originalFileName: "中芯国际2024年年度报告.pdf"
      });
      expect(repository.listDocuments()).toHaveLength(1);
      expect(repository.listDocuments()[0]).toMatchObject({
        companyName: "中芯国际",
        originalFileName: "中芯国际2024年年度报告.pdf",
        sourceType: "upload"
      });

      const documentId = String(job.result?.documentExternalId);
      await expect(readFile(join(storageRoot, "documents", documentId, "original.pdf"), "utf8")).resolves.toBe("%PDF-1.4 fake");
      await expect(readFile(join(storageRoot, "documents", documentId, "parsed.md"), "utf8")).resolves.toContain("line 1");
      await expect(readFile(join(storageRoot, "documents", documentId, "chunks.json"), "utf8")).resolves.toContain("\"company_name\": \"中芯国际\"");
      await expect(readFile(join(storageRoot, "documents", documentId, "mineru", "full.md"), "utf8")).resolves.toBe("fake markdown");
    } finally {
      await rm(storageRoot, { force: true, recursive: true });
    }
  });

  it("rejects non-PDF uploads before parsing", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "rag-next-upload-"));
    const service = new DocumentUploadService(new InMemoryDocumentRepository(), new DeterministicEmbeddingProvider(), new FakeParser(), {
      storageRoot
    });

    try {
      await writeFile(join(storageRoot, "placeholder.txt"), "keep directory around");

      await expect(
        service.importUploadedDocument({
          buffer: Buffer.from("not a pdf"),
          companyName: "中芯国际",
          originalFileName: "report.txt"
        })
      ).rejects.toThrow("Only PDF uploads are supported");
    } finally {
      await rm(storageRoot, { force: true, recursive: true });
    }
  });

  it("uses MinerU page_idx values when content_list.json is available", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "rag-next-upload-"));
    const repository = new CapturingDocumentRepository();
    const service = new DocumentUploadService(repository, new DeterministicEmbeddingProvider(), new MineruPageParser(), {
      storageRoot
    });

    try {
      await service.importUploadedDocument({
        buffer: Buffer.from("%PDF-1.4 fake"),
        companyName: "中原国际",
        originalFileName: "中原国际2024年年度报告.pdf"
      });

      expect(repository.lastPayload?.chunks).toEqual([
        {
          chunkIndex: 0,
          pageStart: 5,
          pageEnd: 5,
          referenceMode: "weak",
          text: expect.stringContaining("page-five-anchor")
        },
        {
          chunkIndex: 1,
          pageStart: 10,
          pageEnd: 10,
          referenceMode: "weak",
          text: expect.stringContaining("page-ten-anchor")
        }
      ]);
    } finally {
      await rm(storageRoot, { force: true, recursive: true });
    }
  });
});
