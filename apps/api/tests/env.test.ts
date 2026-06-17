import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadDotEnv } from "../src/modules/system/env";

const originalCwd = process.cwd();
const originalEmbeddingProvider = process.env.EMBEDDING_PROVIDER;

describe("loadDotEnv", () => {
  afterEach(() => {
    if (originalEmbeddingProvider === undefined) {
      delete process.env.EMBEDDING_PROVIDER;
    } else {
      process.env.EMBEDDING_PROVIDER = originalEmbeddingProvider;
    }
  });

  it("uses the project .env value even when the shell already has a provider value", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "rag-next-env-"));

    try {
      await writeFile(join(tempDir, ".env"), "EMBEDDING_PROVIDER=dashscope\n", "utf8");
      process.env.EMBEDDING_PROVIDER = "openai";

      loadDotEnv(tempDir);

      expect(process.env.EMBEDDING_PROVIDER).toBe("dashscope");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
