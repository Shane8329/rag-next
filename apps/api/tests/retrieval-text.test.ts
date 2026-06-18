import { describe, expect, it } from "vitest";

import { buildKeywordLexemeString, buildKeywordLexemes, buildKeywordTsQueryString } from "../src/modules/ingestion/retrieval-text";

describe("buildKeywordLexemes", () => {
  it("extracts Chinese bigrams and keeps numeric tokens", () => {
    expect(buildKeywordLexemes("中芯国际2024年销售收入增长")).toEqual([
      "中芯",
      "芯国",
      "国际",
      "销售",
      "售收",
      "收入",
      "入增",
      "增长",
      "中芯国际",
      "销售收入增长",
      "2024"
    ]);
  });

  it("normalizes English and mixed alphanumeric tokens", () => {
    expect(buildKeywordLexemes("Qwen2 A800 Revenue 2024Q1")).toEqual(["qwen2", "a800", "revenue", "2024q1"]);
  });

  it("returns an empty array for punctuation-only input", () => {
    expect(buildKeywordLexemes("，。！？ - /")).toEqual([]);
  });
});

describe("buildKeywordLexemeString", () => {
  it("joins lexemes and applies a term limit", () => {
    expect(buildKeywordLexemeString("中芯国际2024年销售收入增长", 5)).toBe("中芯 芯国 国际 销售 售收");
  });
});

describe("buildKeywordTsQueryString", () => {
  it("joins lexemes with OR for Postgres full-text search", () => {
    expect(buildKeywordTsQueryString("2024年销售收入", 5)).toBe("销售:* | 售收:* | 收入:* | 销售收入:* | 2024:*");
  });
});
