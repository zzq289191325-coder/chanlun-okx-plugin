import {
  analyzeMultiTimeframe,
  analyzeNewsImpact,
  buildRiskPlan,
  detectMarketRegime,
  generateSignalDocument,
  parseLocalNewsText,
  type ChanlunSnapshot,
  type MultiTimeframeInput,
  type RiskPlan,
} from "@intelligence/core";
import type {
  Candle as IntelligenceCandle,
  SignalDocument,
  Timeframe,
  TradeSide,
} from "@intelligence/contracts";
import type {
  Bi,
  Candle,
  ChanlunAnalysis,
  ChanlunSignal,
  Fractal,
  Interval,
} from "@/chanlun/types";

export const INTELLIGENCE_TIMEFRAMES = ["1D", "4H", "1H", "30m", "15m"] as const;

export type IntelligenceCandles = Record<Timeframe, Candle[]>;

export interface IntelligenceResult {
  signal: SignalDocument;
  risk: RiskPlan;
  snapshots: Readonly<Record<Timeframe, ChanlunSnapshot>>;
}

export interface LocalNewsResearchInput {
  text: string;
  recordedAt: number;
}

const INTERVAL_MS: Record<Timeframe, number> = {
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1H": 60 * 60_000,
  "4H": 4 * 60 * 60_000,
  "1D": 24 * 60 * 60_000,
};

export function isIntelligenceTimeframe(interval: Interval): interval is Timeframe {
  return INTELLIGENCE_TIMEFRAMES.some((item) => item === interval);
}

function toCoreCandles(
  symbol: string,
  timeframe: Timeframe,
  candles: readonly Candle[],
): IntelligenceCandle[] {
  return candles
    .filter((candle) => candle.closed !== false)
    .map((candle) => ({
      symbol,
      timeframe,
      openTime: candle.ts,
      closeTime: candle.ts + INTERVAL_MS[timeframe] - 1,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      closed: true,
    }));
}

export function buildIntelligenceResult(
  symbol: string,
  candles: IntelligenceCandles,
  localNews?: LocalNewsResearchInput,
): IntelligenceResult {
  const input = Object.fromEntries(
    INTELLIGENCE_TIMEFRAMES.map((timeframe) => [
      timeframe,
      toCoreCandles(symbol, timeframe, candles[timeframe]),
    ]),
  ) as unknown as MultiTimeframeInput;
  const multiTimeframe = analyzeMultiTimeframe(input);
  const preferredSide: TradeSide = multiTimeframe.preferredSide ?? "long";
  const risk = buildRiskPlan(preferredSide, multiTimeframe.snapshots["15m"], [
    multiTimeframe.snapshots["30m"],
    multiTimeframe.snapshots["1H"],
    multiTimeframe.snapshots["4H"],
    multiTimeframe.snapshots["1D"],
  ]);
  const regime = detectMarketRegime(input["1H"]);
  const newsCutoff = Date.now();
  const newsImpact = analyzeNewsImpact(
    localNews?.text ? parseLocalNewsText(localNews.text, localNews.recordedAt) : [],
    newsCutoff,
  );
  const signal = generateSignalDocument({ multiTimeframe, regime, risk, newsImpact });
  return { signal, risk, snapshots: multiTimeframe.snapshots };
}

function legacyFractal(fractal: ChanlunSnapshot["fractals"][number]): Fractal {
  return {
    id: fractal.id,
    type: fractal.type,
    index: fractal.index,
    ts: fractal.locationTime,
    price: fractal.price,
    strength: fractal.strength,
  };
}

function nearestFractal(fractals: Fractal[], time: number): Fractal | undefined {
  return fractals.reduce<Fractal | undefined>((nearest, item) => {
    if (!nearest) return item;
    return Math.abs(item.ts - time) < Math.abs(nearest.ts - time) ? item : nearest;
  }, undefined);
}

function legacySignal(
  signal: ChanlunSnapshot["signals"][number],
  snapshot: ChanlunSnapshot,
): ChanlunSignal {
  const side = signal.side;
  const reference = snapshot.candles.find((candle) => candle.openTime === signal.locationTime);
  const pad = Math.max(
    (reference ? reference.high - reference.low : signal.price * 0.002) * 0.2,
    signal.price * 0.0005,
  );
  const invalidationFractal = snapshot.fractals
    .filter(
      (item) =>
        item.confirmedAt <= signal.confirmedAt &&
        item.type === (side === "long" ? "bottom" : "top"),
    )
    .at(-1);
  const riskPrice =
    invalidationFractal?.price ??
    (side === "long" ? signal.price - pad * 2 : signal.price + pad * 2);
  return {
    id: signal.id,
    kind: side === "long" ? "candidate_buy" : "candidate_sell",
    label: signal.label,
    score: signal.score,
    explanation: signal.reason,
    ts: signal.locationTime,
    price: signal.price,
    point: {
      structurePrice: signal.price,
      triggerLow: signal.price - pad,
      triggerHigh: signal.price + pad,
      riskPrice,
      note: `${signal.reason}（确认时间 ${new Date(signal.confirmedAt).toLocaleString("zh-CN")}）`,
    },
  };
}

export function toLegacyAnalysis(snapshot: ChanlunSnapshot): ChanlunAnalysis {
  const fractals = snapshot.fractals.map(legacyFractal);
  const byId = new Map(fractals.map((item) => [item.id, item]));
  const bis: Bi[] = snapshot.strokes.flatMap((stroke) => {
    const start = byId.get(stroke.start.id);
    const end = byId.get(stroke.end.id);
    if (!start || !end) return [];
    return [
      {
        id: stroke.id,
        direction: stroke.direction,
        start,
        end,
        high: stroke.high,
        low: stroke.low,
        startTs: stroke.startTime,
        endTs: stroke.endTime,
      },
    ];
  });
  const biById = new Map(bis.map((item) => [item.id, item]));
  const segments = snapshot.segments.flatMap((segment) => {
    const start = nearestFractal(fractals, segment.startTime);
    const end = nearestFractal(fractals, segment.endTime);
    if (!start || !end) return [];
    return [
      {
        id: segment.id,
        direction: segment.direction,
        start,
        end,
        bis: segment.strokeIds.flatMap((id) => {
          const bi = biById.get(id);
          return bi ? [bi] : [];
        }),
        high: segment.high,
        low: segment.low,
        startTs: segment.startTime,
        endTs: segment.endTime,
      },
    ];
  });
  const zhongshu = snapshot.zones.map((zone) => ({
    id: zone.id,
    startTs: zone.startTime,
    endTs: zone.endTime,
    high: zone.coreHigh,
    low: zone.coreLow,
    level: zone.level === "stroke" ? ("bi" as const) : ("segment" as const),
    direction:
      zone.state === "left_up"
        ? ("up" as const)
        : zone.state === "left_down"
          ? ("down" as const)
          : ("range" as const),
  }));
  const signals = snapshot.signals.map((signal) => legacySignal(signal, snapshot));
  const analysis: ChanlunAnalysis = {
    included: snapshot.includedBars.map((bar) => ({
      ts: bar.openTime,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      closed: true,
      index: bar.index,
      sourceStartTs: bar.openTime,
      sourceEndTs: bar.closeTime,
    })),
    fractals,
    bis,
    segments,
    zhongshu,
    macd: snapshot.macd.map((point) => ({
      ts: point.time,
      close: snapshot.candles.find((candle) => candle.openTime === point.time)?.close ?? 0,
      dif: point.dif,
      dea: point.dea,
      histogram: point.histogram,
    })),
    signals,
    direction: snapshot.direction,
    updatedAt: snapshot.dataCutoff,
  };
  const recentZhongshu = zhongshu.at(-1);
  const recentSignal = signals.at(-1);
  if (recentZhongshu) analysis.recentZhongshu = recentZhongshu;
  if (recentSignal) analysis.recentSignal = recentSignal;
  return analysis;
}
