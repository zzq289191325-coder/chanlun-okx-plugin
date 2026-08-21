import type { Candle } from "../../../contracts/src/index.js";
import type { Divergence, MacdPoint, PriceLeg, Segment, Stroke } from "./types.js";

interface LegMetrics {
  macdEnergy: number;
  volume: number;
  volumeEfficiency: number;
}

function legMetrics(
  leg: PriceLeg,
  candles: readonly Candle[],
  macdByCloseTime: ReadonlyMap<number, MacdPoint>,
): LegMetrics {
  const selected = candles.filter(
    (candle) => candle.openTime >= leg.startTime && candle.openTime <= leg.endTime,
  );
  const macdEnergy = selected.reduce((sum, candle) => {
    const histogram = macdByCloseTime.get(candle.closeTime)?.histogram ?? 0;
    return sum + (leg.direction === "up" ? Math.max(0, histogram) : Math.abs(Math.min(0, histogram)));
  }, 0);
  const volume = selected.reduce((sum, candle) => sum + candle.volume, 0);
  const move = Math.max(Math.abs(leg.high - leg.low), Number.EPSILON);
  return {
    macdEnergy,
    volume,
    volumeEfficiency: volume > 0 ? move / volume : 0,
  };
}

function toPriceLegs(input: readonly Stroke[] | readonly Segment[]): PriceLeg[] {
  return input.map((leg) => ({
    id: leg.id,
    direction: leg.direction,
    startTime: leg.startTime,
    endTime: leg.endTime,
    confirmedAt: leg.confirmedAt,
    high: leg.high,
    low: leg.low,
  }));
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function detectDivergences(
  input: readonly Stroke[] | readonly Segment[],
  level: Divergence["level"],
  candles: readonly Candle[],
  macd: readonly MacdPoint[],
): Divergence[] {
  const legs = toPriceLegs(input);
  const macdByCloseTime = new Map(macd.map((point) => [point.time, point]));
  const divergences: Divergence[] = [];

  for (let index = 0; index < legs.length; index += 1) {
    const current = legs[index];
    if (!current) continue;
    const previous = legs.slice(0, index).reverse().find((leg) => leg.direction === current.direction);
    if (!previous) continue;

    const extendsPrice = current.direction === "up" ? current.high > previous.high : current.low < previous.low;
    if (!extendsPrice) continue;

    const currentMetrics = legMetrics(current, candles, macdByCloseTime);
    const previousMetrics = legMetrics(previous, candles, macdByCloseTime);
    if (previousMetrics.macdEnergy <= 0 || previousMetrics.volumeEfficiency <= 0) continue;

    const macdRatio = currentMetrics.macdEnergy / previousMetrics.macdEnergy;
    const volumeEfficiencyRatio = currentMetrics.volumeEfficiency / previousMetrics.volumeEfficiency;
    const macdWeakens = macdRatio < 0.85;
    const volumeEfficiencyWeakens = volumeEfficiencyRatio < 0.95;
    if (!macdWeakens || !volumeEfficiencyWeakens) continue;

    const side = current.direction === "up" ? "top" : "bottom";
    divergences.push({
      id: `divergence:${level}:${side}:${current.id}`,
      side,
      level,
      legId: current.id,
      comparedWithLegId: previous.id,
      locationTime: current.endTime,
      confirmedAt: current.confirmedAt,
      price: side === "top" ? current.high : current.low,
      macdRatio,
      volumeEfficiencyRatio,
      score: clampScore(62 + (1 - macdRatio) * 22 + (1 - volumeEfficiencyRatio) * 16),
      evidence: [
        `price extended beyond ${previous.id}`,
        `MACD energy ratio ${macdRatio.toFixed(3)}`,
        `price/volume efficiency ratio ${volumeEfficiencyRatio.toFixed(3)}`,
      ],
    });
  }
  return divergences;
}
