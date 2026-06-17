import { readFile } from "node:fs/promises";

import type { LegacyChunkDocument } from "@rag-next/shared-types";

import { collectLegacyChunkFiles } from "./index";

export interface LegacyMigrationOptions {
  sourceDir: string;
  apiBaseUrl: string;
  batchSize?: number;
  fetchImpl?: typeof fetch;
}

export interface LegacyMigrationSummary {
  sourceDir: string;
  apiBaseUrl: string;
  documentCount: number;
  batchCount: number;
  jobCount: number;
}

async function readLegacyDocuments(sourceDir: string): Promise<LegacyChunkDocument[]> {
  const files = await collectLegacyChunkFiles(sourceDir);

  return Promise.all(
    files.map(async (filePath) => JSON.parse(await readFile(filePath, "utf8")) as LegacyChunkDocument)
  );
}

export async function createLegacyImportBatches(sourceDir: string, batchSize = 10): Promise<LegacyChunkDocument[][]> {
  const normalizedBatchSize = Math.max(1, batchSize);
  const documents = await readLegacyDocuments(sourceDir);
  const batches: LegacyChunkDocument[][] = [];

  for (let index = 0; index < documents.length; index += normalizedBatchSize) {
    batches.push(documents.slice(index, index + normalizedBatchSize));
  }

  return batches;
}

export async function migrateLegacyChunkDirectoryToApi(options: LegacyMigrationOptions): Promise<LegacyMigrationSummary> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const batches = await createLegacyImportBatches(options.sourceDir, options.batchSize ?? 10);
  let jobCount = 0;

  for (const [index, batch] of batches.entries()) {
    const url = `${options.apiBaseUrl}/ingestion/legacy-chunk/batch`;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(batch)
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Legacy migration batch ${index + 1}/${batches.length} failed with status ${response.status}: ${text.slice(0, 500)}`);
    }

    try {
      const jobs = JSON.parse(text) as unknown[];
      jobCount += jobs.length;
    } catch (error: unknown) {
      throw new Error(
        `Legacy migration batch ${index + 1}/${batches.length} returned non-JSON from ${url}: ${text.slice(0, 500)}`,
        { cause: error }
      );
    }
  }

  return {
    sourceDir: options.sourceDir,
    apiBaseUrl: options.apiBaseUrl,
    documentCount: batches.flat().length,
    batchCount: batches.length,
    jobCount
  };
}
