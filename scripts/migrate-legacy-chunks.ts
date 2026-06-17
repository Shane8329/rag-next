import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

import { convertLegacyChunkDocument, type LegacyChunkDocument } from "@rag-next/shared-types";
import { PgDocumentRepository, type QueryClientLike } from "../apps/api/src/modules/ingestion/document.repository";
import { createEmbeddingProvider } from "../apps/api/src/modules/system/database.provider";
import { loadDotEnv } from "../apps/api/src/modules/system/env";
import { collectLegacyChunkFiles } from "../apps/worker/src/index";

const [sourceArg] = process.argv.slice(2);
const sourceDir = sourceArg
  ? resolve(sourceArg)
  : resolve(process.cwd(), "..", "RAG-cy", "data", "stock_data", "databases", "chunked_reports");

loadDotEnv();

async function run() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for direct legacy migration");
  }

  const files = await collectLegacyChunkFiles(sourceDir);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const queryClient: QueryClientLike = {
    query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
      const result = await pool.query(sql, params);
      return { rows: result.rows as T[] };
    }
  };
  const repository = new PgDocumentRepository(queryClient);
  const embeddingProvider = createEmbeddingProvider();

  let imported = 0;
  try {
    for (const file of files) {
      const document = JSON.parse(await readFile(file, "utf8")) as LegacyChunkDocument;
      await repository.createLegacyImportJob(convertLegacyChunkDocument(document), embeddingProvider);
      imported += 1;
      console.log(`imported ${imported}/${files.length}: ${document.metainfo.sha1}`);
    }
  } finally {
    await pool.end();
  }

  console.log(JSON.stringify({ sourceDir, documentCount: imported }, null, 2));
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
