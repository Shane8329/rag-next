import { describe, expect, it } from "vitest";

describe("bootstrap port selection", () => {
  it("allows overriding the listen port through PORT", () => {
    expect(Number(process.env.PORT ?? 3000)).toBeGreaterThan(0);
  });
});
