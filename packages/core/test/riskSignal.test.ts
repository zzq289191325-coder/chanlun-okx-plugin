import { describe, expect, it } from "vitest";
import type { Timeframe } from "../../contracts/src/index.js";
import type { CandidateSignal, ChanlunSnapshot, Fractal } from "../src/chanlun/types.js";
import type { MultiTimeframeAnalysis } from "../src/multiTimeframe/engine.js";
import { buildRiskPlan, type RiskPlan } from "../src/risk/riskEngine.js";
import { generateSignalDocument } from "../src/signal/signalEngine.js";
import { candlesFromValues } from "./fixtures.js";

function fractal(type: "top" | "bottom", price: number, index: number): Fractal {
  return {
    id: `f:${type}:${index}`,
    type,
    index,
    locationTime: index,
    confirmedAt: index + 1,
    price,
    strength: 75,
  };
}

const candidate: CandidateSignal = {
  id: "candidate-long",
  kind: "candidate_2_buy",
  label: "候选2买",
  side: "long",
  locationTime: 10,
  confirmedAt: 11,
  price: 100,
  score: 80,
  evidenceIds: ["fixture"],
  reason: "fixture",
};

function snapshot(timeframe: Timeframe, target = 115, includeCandidate = true): ChanlunSnapshot {
  const candles = candlesFromValues(Array.from({ length: 30 }, () => 100), timeframe);
  return {
    symbol: "TEST-USDT-SWAP",
    timeframe,
    dataCutoff: candles.at(-1)!.closeTime,
    candles,
    includedBars: [],
    fractals: [fractal("bottom", 95, 1), fractal("top", target, 2)],
    strokes: [],
    segments: [],
    zones: [],
    macd: [],
    divergences: [],
    signals: includeCandidate ? [candidate] : [],
    direction: "up",
  };
}

function multiTimeframe(execution: ChanlunSnapshot): MultiTimeframeAnalysis {
  const snapshots = {
    "1D": snapshot("1D", 130, false),
    "4H": snapshot("4H", 125, false),
    "1H": snapshot("1H", 120, false),
    "30m": { ...snapshot("30m"), signals: [candidate] },
    "15m": execution,
  } satisfies Record<Timeframe, ChanlunSnapshot>;
  return {
    symbol: "TEST-USDT-SWAP",
    dataCutoff: Math.min(...Object.values(snapshots).map((item) => item.dataCutoff)),
    snapshots,
    daily: "BULL",
    h4: "BULLISH_PULLBACK",
    h1: "LONG_WATCH_ZONE",
    m30: "CANDIDATE_2_BUY",
    m15: "CANDIDATE_2_BUY_CONFIRMED",
    preferredSide: "long",
    alignmentScore: 80,
    waitingFor: [],
  };
}

describe("risk and signal engines", () => {
  it("validates a plan only when a structural target reaches at least 2R", () => {
    const execution = snapshot("15m", 115);
    const plan = buildRiskPlan("long", execution, []);
    expect(plan.status).toBe("VALID");
    expect(plan.rr1).toBeGreaterThanOrEqual(2);
    expect(plan.stop).toBeLessThan(candidate.price);
  });

  it("returns PASS when no structural target reaches 2R", () => {
    const plan = buildRiskPlan("long", snapshot("15m", 104), []);
    expect(plan.status).toBe("PASS");
    expect(plan.reason).toContain("2.0R");
  });

  it("generates a structured ready state without any execution instruction", () => {
    const execution = snapshot("15m", 115);
    const risk = buildRiskPlan("long", execution, []);
    const document = generateSignalDocument({
      multiTimeframe: multiTimeframe(execution),
      regime: {
        regime: "TREND_UP",
        atrPercent: 1,
        movingAverageSlopePercent: 0.2,
        trendStrength: 1,
        evidence: [],
      },
      risk,
      generatedAt: 123,
    });
    expect(document.signal).toBe("LONG_READY");
    expect(document.rr1).toBeGreaterThanOrEqual(2);
    expect(document).not.toHaveProperty("order");
    expect(document).not.toHaveProperty("apiKey");
  });

  it("forces PASS for insufficient RR and WAIT around a high-impact event", () => {
    const execution = snapshot("15m", 115);
    const mtf = multiTimeframe(execution);
    const passRisk: RiskPlan = {
      status: "PASS",
      side: "long",
      candidate,
      entryMin: null,
      entryMax: null,
      stop: null,
      tp1: null,
      tp2: null,
      rr1: null,
      rr2: null,
      invalidation: "",
      reason: "没有达到 2.0R 的结构目标位",
      evidence: [],
    };
    const regime = {
      regime: "TREND_UP" as const,
      atrPercent: 1,
      movingAverageSlopePercent: 0.2,
      trendStrength: 1,
      evidence: [],
    };
    expect(generateSignalDocument({ multiTimeframe: mtf, regime, risk: passRisk }).signal).toBe("PASS");
    const valid = buildRiskPlan("long", execution, []);
    expect(
      generateSignalDocument({ multiTimeframe: mtf, regime, risk: valid, highImpactEventSoon: true }).signal,
    ).toBe("WAIT");
  });
});
