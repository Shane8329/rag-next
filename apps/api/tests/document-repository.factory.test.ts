import { describe, expect, it } from "vitest";

import { createDocumentRepository, InMemoryDocumentRepository, PgDocumentRepository } from "../src/modules/ingestion/document.repository";

describe("createDocumentRepository", () => {
  it("falls back to the in-memory repository when DATABASE_URL is missing", () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    const repository = createDocumentRepository();

    expect(repository).toBeInstanceOf(InMemoryDocumentRepository);

    if (original === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = original;
    }
  });

  it("creates a pg repository when DATABASE_URL and a query client are provided", () => {
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://demo";

    const repository = createDocumentRepository({
      query: async () => ({ rows: [] })
    });

    expect(repository).toBeInstanceOf(PgDocumentRepository);

    if (original === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = original;
    }
  });
});