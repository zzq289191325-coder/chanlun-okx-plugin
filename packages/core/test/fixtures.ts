import type { Candle, Timeframe } from "../../contracts/src/index.js";
import type { Divergence, Fractal, Stroke } from "../src/chanlun/types.js";

const STEP = 900_000;

export function candlesFromValues(
  values: readonly number[],
  timeframe: Timeframe = "15m",
  symbol = "TEST-USDT-SWAP",
): Candle[] {
  return values.map((value, index) => ({
    symbol,
    timeframe,
    openTime: index * STEP,
    closeTime: (index + 1) * STEP,
    open: value,
    high: value + 1,
    low: value - 1,
    close: value,
    volume: 100 + index * 3,
    closed: true,
  }));
}

function fractal(type: Fractal["type"], time: number, price: number, index: number): Fractal {
  return {
    id: `f:${type}:${time}`,
    type,
    index,
    locationTime: time,
    confirmedAt: time + 1,
    price,
    strength: 70,
  };
}

export function stroke(
  id: string,
  direction: Stroke["direction"],
  startTime: number,
  endTime: number,
  low: number,
  high: number,
): Stroke {
  const start =
    direction === "up"
      ? fractal("bottom", startTime, low, startTime)
      : fractal("top", startTime, high, startTime);
  const end =
    direction === "up"
      ? fractal("top", endTime, high, endTime)
      : fractal("bottom", endTime, low, endTime);
  return {
    id,
    direction,
    start,
    end,
    startTime,
    endTime,
    confirmedAt: endTime + 1,
    high,
    low,
    includedBars: endTime - startTime + 1,
  };
}

export function divergence(
  id: string,
  side: Divergence["side"],
  legId: string,
  locationTime: number,
  price: number,
): Divergence {
  return {
    id,
    side,
    level: "stroke",
    legId,
    comparedWithLegId: "previous",
    locationTime,
    confirmedAt: locationTime + 1,
    price,
    macdRatio: 0.6,
    volumeEfficiencyRatio: 0.7,
    score: 82,
    evidence: ["fixture"],
  };
}
