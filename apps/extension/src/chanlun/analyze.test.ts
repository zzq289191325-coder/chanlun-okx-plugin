import { describe, expect, it } from "vitest";
import { analyzeChanlun } from "./analyze";
import { buildBi } from "./bi";
import { detectFractals } from "./fractal";
import { processIncludes } from "./includeProcessor";
import { detectSignals } from "./signals";
import { detectZhongshu } from "./zhongshu";
import type { Bi, Candle, Fractal, Zhongshu } from "./types";

function candle(index: number, high: number, low: number): Candle {
  const mid = (high + low) / 2;
  return {
    ts: 1_700_000_000_000 + index * 60_000,
    open: mid,
    high,
    low,
    close: mid,
    volume: 100 + index,
    closed: true,
  };
}

function fractal(type: Fractal["type"], index: number, ts: number, price: number): Fractal {
  return {
    id: `${type}-${index}`,
    type,
    index,
    ts,
    price,
    strength: 80,
  };
}

function bi(direction: Bi["direction"], start: Fractal, end: Fractal): Bi {
  return {
    id: `${direction}-${start.ts}-${end.ts}`,
    direction,
    start,
    end,
    high: Math.max(start.price, end.price),
    low: Math.min(start.price, end.price),
    startTs: start.ts,
    endTs: end.ts,
  };
}

describe("chanlun pure analysis", () => {
  it("merges include relationships without reordering bars", () => {
    const result = processIncludes([candle(0, 10, 5), candle(1, 9, 6), candle(2, 12, 8)]);

    expect(result).toHaveLength(2);
    expect(result[0]?.sourceStartTs).toBe(1_700_000_000_000);
    expect(result[0]?.sourceEndTs).toBe(1_700_000_060_000);
    expect(result[1]?.index).toBe(1);
  });

  it("detects alternating top and bottom fractals", () => {
    const bars = processIncludes([
      candle(0, 10, 5),
      candle(1, 12, 7),
      candle(2, 9, 4),
      candle(3, 11, 6),
      candle(4, 8, 3),
      candle(5, 13, 9),
    ]);

    const fractals = detectFractals(bars);

    expect(fractals.some((item) => item.type === "top")).toBe(true);
    expect(fractals.some((item) => item.type === "bottom")).toBe(true);
  });

  it("builds bi and zhongshu structures from valid swings", () => {
    const fractals = [
      { id: "b0", type: "bottom" as const, index: 0, ts: 0, price: 90, strength: 70 },
      { id: "t4", type: "top" as const, index: 4, ts: 4, price: 110, strength: 70 },
      { id: "b8", type: "bottom" as const, index: 8, ts: 8, price: 95, strength: 70 },
      { id: "t12", type: "top" as const, index: 12, ts: 12, price: 108, strength: 70 },
      { id: "b16", type: "bottom" as const, index: 16, ts: 16, price: 96, strength: 70 },
      { id: "t20", type: "top" as const, index: 20, ts: 20, price: 112, strength: 70 },
    ];
    const bis = buildBi([], fractals);
    const zones = detectZhongshu(bis);

    expect(bis.length).toBeGreaterThan(1);
    expect(zones.every((zone) => zone.low < zone.high)).toBe(true);
  });

  it("returns a stable analysis object for chart rendering", () => {
    const bars = Array.from({ length: 80 }, (_, index) => {
      const wave = Math.sin(index / 4) * 8;
      const trend = index * 0.12;
      const base = 100 + trend + wave;
      return candle(index, base + 3, base - 3);
    });

    const analysis = analyzeChanlun(bars);

    expect(analysis.included.length).toBeGreaterThan(20);
    expect(analysis.macd).toHaveLength(analysis.included.length);
    expect(["up", "down", "range"]).toContain(analysis.direction);
    expect(analysis.signals.every((signal) => signal.score >= 0 && signal.score <= 100)).toBe(true);
  });

  it("adds candidate 1/2/3 buy structure price levels", () => {
    const zone: Zhongshu = {
      id: "zs-1",
      startTs: 0,
      endTs: 10,
      high: 110,
      low: 100,
      level: "bi",
      direction: "range",
    };
    const bis = [
      bi("down", fractal("top", 1, 5, 116), fractal("bottom", 2, 12, 98)),
      bi("down", fractal("top", 3, 16, 108), fractal("bottom", 4, 22, 104)),
      bi("down", fractal("top", 5, 26, 122), fractal("bottom", 6, 32, 112)),
    ];

    const signals = detectSignals({
      bis,
      segments: [],
      zhongshu: [zone],
      macd: [],
    });

    expect(signals.map((signal) => signal.label)).toEqual(["候选1买", "候选2买", "候选3买"]);
    for (const signal of signals) {
      expect(signal.point).toBeDefined();
      expect(Number.isFinite(signal.point?.structurePrice)).toBe(true);
      expect(signal.point?.triggerLow).toBeLessThanOrEqual(signal.point?.triggerHigh ?? Number.NEGATIVE_INFINITY);
      expect(Number.isFinite(signal.point?.riskPrice)).toBe(true);
    }
  });
});
