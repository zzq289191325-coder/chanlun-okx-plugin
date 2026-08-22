import type { Candle, TradeSide } from "../../contracts/src/index.js";
import { analyzeChanlun } from "../../core/src/chanlun/engine.js";

export const FUNDAMENTAL_STRUCTURAL_STRATEGY_ID = "fundamental-structural-position";
export const FUNDAMENTAL_STRUCTURAL_VERSION = "1.0.0-candidate";

export interface FundamentalObservation {
  observationId: string;
  symbol: string;
  metric: string;
  numericValue: number | null;
  effectiveAt: number;
  publishedAt: number;
  recordedAt: number;
  revisionAt: number | null;
  dataVersion: string;
}

export interface FundamentalStructuralConfig {
  maFastPeriod: number;
  maSlowPeriod: number;
  minimumFundamentalScore: number;
  maximumCapitalPercent: number;
  maximumHoldingDays: number;
  earningsRiskWindowDays: number;
  metricWeights: Readonly<Record<string, number>>;
}

export const DEFAULT_FUNDAMENTAL_STRUCTURAL_CONFIG: FundamentalStructuralConfig = {
  maFastPeriod: 40,
  maSlowPeriod: 120,
  minimumFundamentalScore: 0.55,
  maximumCapitalPercent: 25,
  maximumHoldingDays: 180,
  earningsRiskWindowDays: 7,
  metricWeights: {
    revenue_growth: 1,
    profit_growth: 1,
    gross_margin: 0.8,
    free_cash_flow_growth: 1,
    debt_ratio: -0.8,
    analyst_revision: 0.5,
    industry_cycle: 0.5,
    macro_rate_environment: -0.4,
  },
};

export interface FundamentalDecision {
  state: "LONG_WATCH" | "SHORT_WATCH" | "WAIT";
  side: TradeSide | null;
  score: number;
  cutoff: number;
  visibleObservationIds: readonly string[];
  reasons: readonly string[];
}

function average(candles: readonly Candle[], period: number): number | null {
  if (candles.length < period) return null;
  return candles.slice(-period).reduce((sum, candle) => sum + candle.close, 0) / period;
}

export function visibleFundamentalObservations(observations: readonly FundamentalObservation[], cutoff: number): FundamentalObservation[] {
  return observations
    .filter((item) => item.publishedAt <= cutoff && item.recordedAt <= cutoff && (item.revisionAt === null || item.revisionAt <= cutoff))
    .sort((left, right) => left.recordedAt - right.recordedAt);
}

export function evaluateFundamentalStructuralPosition(
  dailyCandles: readonly Candle[],
  h4Candles: readonly Candle[],
  observations: readonly FundamentalObservation[],
  cutoff: number,
  config: FundamentalStructuralConfig = DEFAULT_FUNDAMENTAL_STRUCTURAL_CONFIG,
): FundamentalDecision {
  const daily = dailyCandles.filter((item) => item.closed && item.closeTime <= cutoff);
  const h4 = h4Candles.filter((item) => item.closed && item.closeTime <= cutoff);
  const visible = visibleFundamentalObservations(observations, cutoff);
  const latestByMetric = new Map<string, FundamentalObservation>();
  for (const item of visible) latestByMetric.set(item.metric, item);
  let weighted = 0;
  let weightTotal = 0;
  for (const [metric, weight] of Object.entries(config.metricWeights)) {
    const value = latestByMetric.get(metric)?.numericValue;
    if (value === null || value === undefined) continue;
    weighted += Math.max(-1, Math.min(1, value)) * weight;
    weightTotal += Math.abs(weight);
  }
  const fundamentalScore = weightTotal === 0 ? 0 : weighted / weightTotal;
  const fast = average(daily, config.maFastPeriod);
  const slow = average(daily, config.maSlowPeriod);
  if (daily.length === 0 || h4.length === 0 || fast === null || slow === null) {
    return { state: "WAIT", side: null, score: fundamentalScore, cutoff, visibleObservationIds: visible.map((item) => item.observationId), reasons: ["长期历史数据不足，等待 MA40/MA120 和 4H 结构"] };
  }
  const dailySnapshot = analyzeChanlun(daily);
  const h4Snapshot = analyzeChanlun(h4);
  const trendUp = fast > slow && dailySnapshot.direction !== "down";
  const trendDown = fast < slow && dailySnapshot.direction !== "up";
  const pullback = h4Snapshot.direction !== dailySnapshot.direction;
  if (fundamentalScore >= config.minimumFundamentalScore && trendUp && pullback) {
    return { state: "LONG_WATCH", side: "long", score: fundamentalScore, cutoff, visibleObservationIds: visible.map((item) => item.observationId), reasons: ["点时基本面评分通过", "日线 MA40 位于 MA120 上方", "4H 处于回调观察阶段"] };
  }
  if (fundamentalScore <= -config.minimumFundamentalScore && trendDown && pullback) {
    return { state: "SHORT_WATCH", side: "short", score: fundamentalScore, cutoff, visibleObservationIds: visible.map((item) => item.observationId), reasons: ["点时基本面负向评分通过", "日线 MA40 位于 MA120 下方", "4H 处于反弹观察阶段"] };
  }
  return { state: "WAIT", side: null, score: fundamentalScore, cutoff, visibleObservationIds: visible.map((item) => item.observationId), reasons: ["基本面、大周期趋势与 4H 入场阶段尚未同时满足"] };
}
