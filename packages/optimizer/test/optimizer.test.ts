import { describe, expect, it } from "vitest";
import { chronologicalSplit, monteCarloTradeOrder, runOfflineExperiment, type TrialMetrics } from "../src/index.js";

const good: TrialMetrics = { totalReturnPercent: 10, maximumDrawdownPercent: 5, profitFactor: 1.6, expectancy: 0.4, tradeCount: 30, tailLossPercent: 2, netAfterCosts: 8 };

describe("offline optimizer", () => {
  it("uses chronological train/validation/test and never deploys automatically", () => {
    const split = chronologicalSplit(0, 1_000);
    expect(split.train.end).toBeLessThan(split.validation.start);
    expect(split.validation.end).toBeLessThan(split.test.start);
    const result = runOfflineExperiment("grid", { ma: [30, 40], atr: [12, 14] }, split, () => ({ train: good, validation: good, test: good, robustness: { parameterStability: 0.8, crossSymbolConsistency: 0.8, crossRegimeConsistency: 0.8, costStressPassed: true, reproducible: true, futureDataDetected: false } }));
    expect(result.trials).toHaveLength(4);
    expect(result.selectedCandidate).not.toBeNull();
    expect(result.deploymentStatus).toBe("CANDIDATE_REVIEW_REQUIRED");
  });

  it("rejects future data and fragile results and keeps Monte Carlo reproducible", () => {
    const split = chronologicalSplit(0, 1_000);
    const result = runOfflineExperiment("random", { ma: [30, 40] }, split, () => ({ train: good, validation: { ...good, totalReturnPercent: -1, netAfterCosts: -2 }, test: { ...good, tradeCount: 2 }, robustness: { parameterStability: 0.2, crossSymbolConsistency: 0.2, crossRegimeConsistency: 0.2, costStressPassed: false, reproducible: false, futureDataDetected: true } }), { seed: 5 });
    expect(result.selectedCandidate).toBeNull();
    expect(result.trials[0]?.rejectionReasons).toContain("检测到未来数据");
    expect(monteCarloTradeOrder([1, -2, 3, -1], 10, 2)).toEqual(monteCarloTradeOrder([1, -2, 3, -1], 10, 2));
  });
});
