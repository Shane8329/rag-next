import { describe, expect, it } from "vitest";

import { validateRelevantPages } from "../src/reference-validation";

describe("validateRelevantPages", () => {
  it("keeps only retrieved pages and backfills to the minimum count", () => {
    const pages = validateRelevantPages([12, 99], [{ page: 10 }, { page: 12 }, { page: 13 }], 2, 8);

    expect(pages).toEqual([12, 10]);
  });

  it("trims validated pages to the configured maximum", () => {
    const retrieval = Array.from({ length: 10 }, (_, index) => ({ page: index + 1 }));
    const pages = validateRelevantPages([1, 2, 3, 4, 5, 6, 7, 8, 9], retrieval, 2, 4);

    expect(pages).toEqual([1, 2, 3, 4]);
  });
});
