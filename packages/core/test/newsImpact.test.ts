import { describe, expect, it } from "vitest";
import {
  analyzeNewsImpact,
  parseLocalNewsText,
} from "../src/news/newsImpact.js";

describe("local news impact research", () => {
  const cutoff = new Date("2026-08-21T10:00:00+08:00").getTime();

  it("classifies local headline text without any network or account data", () => {
    const items = parseLocalNewsText(
      "公司财报增长并超预期\n监管调查导致下调",
      cutoff - 1_000,
    );
    const result = analyzeNewsImpact(items, cutoff);
    expect(result.bias).toBe("MIXED");
    expect(result.itemsAnalyzed).toBe(2);
    expect(result.matchedKeywords).toContain("超预期");
    expect(JSON.stringify(result)).not.toMatch(/apiKey|secret|order/i);
  });

  it("pauses around a scheduled high-impact event inside 24 hours", () => {
    const items = parseLocalNewsText(
      "2026-08-21 20:00 | FOMC 利率决议",
      cutoff - 1_000,
    );
    const result = analyzeNewsImpact(items, cutoff);
    expect(result.highImpactEventSoon).toBe(true);
    expect(result.riskLevel).toBe("HIGH");
  });

  it("ignores headlines recorded after the analysis cutoff", () => {
    const future = parseLocalNewsText("财报超预期", cutoff + 1);
    expect(analyzeNewsImpact(future, cutoff).itemsAnalyzed).toBe(0);
  });
});
