import { afterEach, describe, expect, it } from "vitest";

import { createMineruDocumentParser } from "../src/modules/ingestion/mineru-parser.factory";
import { MineruCloudDocumentParser } from "../src/modules/ingestion/mineru-cloud-parser";
import { MineruCommandDocumentParser } from "../src/modules/ingestion/mineru-command-parser";

const originalEnvironment = { ...process.env };

describe("createMineruDocumentParser", () => {
  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it("uses the cloud API parser by default to match the legacy RAG-cy flow", () => {
    process.env.MINERU_API_KEY = "mineru-key";
    process.env.MINERU_PDF_URL_BASE = "https://oss.example.test/pdf";
    delete process.env.MINERU_PARSER;

    expect(createMineruDocumentParser()).toBeInstanceOf(MineruCloudDocumentParser);
  });

  it("can still use the command parser for local fake-parser acceptance", () => {
    process.env.MINERU_PARSER = "command";

    expect(createMineruDocumentParser()).toBeInstanceOf(MineruCommandDocumentParser);
  });
});
