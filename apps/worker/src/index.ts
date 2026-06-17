import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { extname, resolve } from "node:path";

import { convertLegacyChunkDocument, type ImportedLegacyChunkPayload, type LegacyChunkDocument } from "@rag-next/shared-types";

export async function importLegacyChunkFile(filePath: string): Promise<ImportedLegacyChunkPayload> {
  const rawText = await readFile(filePath, "utf8");
  const parsed = JSON.parse(rawText) as LegacyChunkDocument;
  return convertLegacyChunkDocument(parsed);
}

export async function collectLegacyChunkFiles(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = resolve(directoryPath, entry.name);

      if (entry.isDirectory()) {
        return collectLegacyChunkFiles(fullPath);
      }

      if (entry.isFile() && extname(entry.name).toLowerCase() === ".json") {
        return [fullPath];
      }

      return [] as string[];
    })
  );

  return files.flat().sort((left, right) => left.localeCompare(right, "zh-CN"));
}

export async function importLegacyChunkDirectory(directoryPath: string): Promise<ImportedLegacyChunkPayload[]> {
  const files = await collectLegacyChunkFiles(directoryPath);
  return Promise.all(files.map((filePath) => importLegacyChunkFile(filePath)));
}

export function buildLegacyImportTrace(filePath: string): string {
  return `legacy-import:${randomUUID()}:${filePath}`;
}

async function runCli(inputPath: string) {
  const resolvedPath = resolve(inputPath);
  const payloads = extname(resolvedPath).toLowerCase() === ".json"
    ? [await importLegacyChunkFile(resolvedPath)]
    : await importLegacyChunkDirectory(resolvedPath);

  console.log(JSON.stringify({
    traceId: buildLegacyImportTrace(resolvedPath),
    count: payloads.length,
    payloads
  }, null, 2));
}

if (process.argv[1] && process.argv[1].endsWith("index.ts") && process.argv[2]) {
  void runCli(process.argv[2]);
}