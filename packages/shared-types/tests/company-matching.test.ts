import { describe, expect, it } from "vitest";

import { matchCompaniesFromQuestion } from "../src/company-matching";

describe("matchCompaniesFromQuestion", () => {
  it("prefers longer company names before shorter overlaps", () => {
    const companies = ["中国银行", "银行", "中芯国际"];

    const matched = matchCompaniesFromQuestion("请比较中国银行和中芯国际的研发投入", companies);

    expect(matched).toEqual(["中国银行", "中芯国际"]);
  });

  it("returns an empty list when no company name is present", () => {
    const matched = matchCompaniesFromQuestion("请总结这份年报的核心风险", ["中芯国际"]);

    expect(matched).toEqual([]);
  });
});
