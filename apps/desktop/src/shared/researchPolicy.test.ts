import { describe, expect, it } from "vitest";
import { DEFAULT_DESKTOP_SETTINGS, NAVIGATION_PAGES, normalizeDesktopSettings, paperOrderSafetyChecks } from "./researchPolicy.js";

describe("desktop research workspace policy", () => {
  it("registers every implemented navigation page exactly once", () => {
    expect(NAVIGATION_PAGES).toHaveLength(10);
    expect(new Set(NAVIGATION_PAGES).size).toBe(10);
  });

  it("keeps editable research settings inside safety bounds", () => {
    const normalized = normalizeDesktopSettings({ ...DEFAULT_DESKTOP_SETTINGS, initialCapital: -1, maximumOrderNotional: 9_000_000, feeRate: 1, slippageBps: -5 });
    expect(normalized.initialCapital).toBe(100);
    expect(normalized.maximumOrderNotional).toBe(1_000_000);
    expect(normalized.feeRate).toBe(0.02);
    expect(normalized.slippageBps).toBe(0);
  });

  it("blocks invalid PAPER previews while always retaining the external-order lock", () => {
    const checks = paperOrderSafetyChecks(300, 250, false);
    expect(checks.find((item) => item.rule === "maximum_order_notional")?.allowed).toBe(false);
    expect(checks.find((item) => item.rule === "closed_candle_only")?.allowed).toBe(false);
    expect(checks.find((item) => item.rule === "external_execution_locked")?.allowed).toBe(true);
  });
});
