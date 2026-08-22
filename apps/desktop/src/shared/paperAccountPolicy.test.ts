import { describe, expect, it } from "vitest";
import { AGGRESSIVE_ENTRY_INTERVAL_MS, PAPER_ACCOUNT_POLICIES, aggressiveDirection, aggressiveEntryDue } from "./paperAccountPolicy.js";

describe("separate PAPER account policy", () => {
  it("allocates 1000U independently with different risk limits", () => {
    const aggressive = PAPER_ACCOUNT_POLICIES["paper-aggressive"];
    const fundamental = PAPER_ACCOUNT_POLICIES["paper-fundamental"];
    expect(aggressive.initialCapital).toBe(1_000);
    expect(fundamental.initialCapital).toBe(1_000);
    expect(aggressive.maximumOrderNotional).toBeLessThan(fundamental.maximumOrderNotional);
    expect(aggressive.minimumRiskReward).toBeLessThan(fundamental.minimumRiskReward);
    expect(fundamental.allowedSides).toEqual(["long"]);
  });

  it("marks the aggressive account due after the 55 minute buffer", () => {
    expect(aggressiveEntryDue(null, 100)).toBe(true);
    expect(aggressiveEntryDue(100, 100 + AGGRESSIVE_ENTRY_INTERVAL_MS - 1)).toBe(false);
    expect(aggressiveEntryDue(100, 100 + AGGRESSIVE_ENTRY_INTERVAL_MS)).toBe(true);
  });

  it("derives direction from only the visible 40-close prefix", () => {
    expect(aggressiveDirection(Array.from({ length: 40 }, (_, index) => index + 1))).toBe("long");
    expect(aggressiveDirection(Array.from({ length: 40 }, (_, index) => 40 - index))).toBe("short");
    expect(aggressiveDirection([1, 2, 3])).toBeNull();
  });
});
