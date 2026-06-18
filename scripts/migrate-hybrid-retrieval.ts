import { Pool } from "pg";

import { buildKeywordLexemeString } from "../apps/api/src/modules/ingestion/retrieval-text";
import { loadDotEnv } from "../apps/api/src/modules/system/env";

interface ChunkRow {
  id: string;
  textContent: string;
}

const BATCH_SIZE = 200;

loadDotEnv();

async function ensureHybridRetrievalSchema(pool: Pool): Promise<void> {
  // db/init 只在全新数据库初始化时执行；已有数据库需要这类幂等迁移补齐新列和索引。
  await pool.query(`
    alter table document_chunks
    add column if not exists keyword_lexemes text not null default ''
  `);

  await pool.query(`
    create index if not exists idx_document_chunks_keyword_fts
    on document_chunks
    using gin (to_tsvector('simple', keyword_lexemes))
  `);
}

async function backfillKeywordLexemes(pool: Pool): Promise<number> {
  let updated = 0;

  while (true) {
    // 分批回填，避免历史 chunk 很多时一次性把数据库连接占用太久。
    const result = await pool.query<ChunkRow>(
      `
        select
          id,
          text_content as "textContent"
        from document_chunks
        where keyword_lexemes = ''
        order by created_at asc, id asc
        limit $1
      `,
      [BATCH_SIZE]
    );

    if (result.rows.length === 0) {
      return updated;
    }

    for (const row of result.rows) {
      await pool.query(
        `
          update document_chunks
          set keyword_lexemes = $2
          where id = $1
        `,
        [row.id, buildKeywordLexemeString(row.textContent)]
      );
      updated += 1;
    }

    console.log(`backfilled keyword_lexemes for ${updated} chunks`);
  }
}

async function run() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for hybrid retrieval migration");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await ensureHybridRetrievalSchema(pool);
    const updated = await backfillKeywordLexemes(pool);
    console.log(JSON.stringify({ updatedChunks: updated }, null, 2));
  } finally {
    await pool.end();
  }
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
