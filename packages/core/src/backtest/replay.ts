import type { Candle, MarketRegime, Timeframe, TradeSide } from "../../../contracts/src/index.js";
import { analyzeMultiTimeframe, type MultiTimeframeInput } from "../multiTimeframe/engine.js";
import { detectMarketRegime } from "../regime/marketRegime.js";
import { buildRiskPlan, type RiskConfig } from "../risk/riskEngine.js";
import { generateSignalDocument } from "../signal/signalEngine.js";
import type { CandidateKind } from "../chanlun/types.js";

export const RESEARCH_STRATEGY_VERSION = "chanlun-mtf-paper-v1.1";
export const CHANLUN_ALGORITHM_VERSION = "chanlun-core-confirmed-v1.1";

const TIMEFRAMES = ["1D", "4H", "1H", "30m", "15m"] as const satisfies readonly Timeframe[];
const ALL_CANDIDATE_KINDS: readonly CandidateKind[] = [
  "candidate_1_buy",
  "candidate_2_buy",
  "candidate_3_buy",
  "candidate_1_sell",
  "candidate_2_sell",
  "candidate_3_sell",
];

export interface ResearchStrategyConfig extends RiskConfig {
  maPeriod: number;
  atrPeriod: number;
  minimumAtrPercent: number;
  minimumExecutionBars: number;
  allowedCandidateKinds: readonly CandidateKind[];
}

export const DEFAULT_RESEARCH_STRATEGY_CONFIG: ResearchStrategyConfig = {
  minimumRiskReward: 2,
  stopAtrBuffer: 0.15,
  entryAtrWidth: 0.1,
  maPeriod: 40,
  atrPeriod: 14,
  minimumAtrPercent: 0.15,
  minimumExecutionBars: 60,
  allowedCandidateKinds: ALL_CANDIDATE_KINDS,
};

export interface ExecutionFilterState {
  movingAverage: number | null;
  atr: number | null;
  atrPercent: number | null;
  maAligned: boolean;
  atrAligned: boolean;
}

export interface ResearchOpportunity {
  opportunityId: string;
  symbol: string;
  side: TradeSide;
  candidateKind: CandidateKind;
  candidateLabel: string;
  candidatePrice: number;
  locationTime: number;
  confirmedAt: number;
  dataCutoff: number;
  entryMin: number;
  entryMax: number;
  stop: number;
  target: number;
  target2: number;
  plannedRiskReward: number;
  marketRegime: MarketRegime;
  ma40: number;
  atr: number;
  atrPercent: number;
  m30CandidateLabel: string;
  m15CandidateLabel: string;
  evidence: readonly string[];
}

export interface ResearchReplayResult {
  algorithmVersion: typeof CHANLUN_ALGORITHM_VERSION;
  strategyVersion: typeof RESEARCH_STRATEGY_VERSION;
  opportunities: readonly ResearchOpportunity[];
  diagnostics: {
    executionBars: number;
    evaluatedBars: number;
    readySignals: number;
    rejectedByMa: number;
    rejectedByAtr: number;
    rejectedByCandidateKind: number;
  };
}

function average(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function movingAverage(candles: readonly Candle[], period: number): number | null {
  if (period <= 0 || candles.length < period) return null;
  return average(candles.slice(-period).map((candle) => candle.close));
}

function averageTrueRange(candles: readonly Candle[], period: number): number | null {
  if (period <= 0 || candles.length < period + 1) return null;
  let total = 0;
  for (let index = candles.length - period; index < candles.length; index += 1) {
    const candle = candles[index];
    const previous = candles[index - 1];
    if (!candle || !previous) return null;
    total += Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previous.close),
      Math.abs(candle.low - previous.close),
    );
  }
  return total / period;
}

export function evaluateExecutionFilters(
  candles: readonly Candle[],
  side: TradeSide,
  config: ResearchStrategyConfig = DEFAULT_RESEARCH_STRATEGY_CONFIG,
): ExecutionFilterState {
  const close = candles.at(-1)?.close;
  const ma = movingAverage(candles, config.maPeriod);
  const atr = averageTrueRange(candles, config.atrPeriod);
  const atrPercent = close && atr !== null ? (atr / close) * 100 : null;
  return {
    movingAverage: ma,
    atr,
    atrPercent,
    maAligned: close !== undefined && ma !== null && (side === "long" ? close > ma : close < ma),
    atrAligned: atrPercent !== null && atrPercent >= config.minimumAtrPercent,
  };
}

function closedPrefix(input: readonly Candle[], cutoff: number): Candle[] {
  return input
    .filter((candle) => candle.closed && candle.closeTime <= cutoff)
    .sort((left, right) => left.openTime - right.openTime);
}

function validateConfig(config: ResearchStrategyConfig): void {
  if (config.maPeriod < 2 || config.atrPeriod < 2 || config.minimumExecutionBars < config.maPeriod) {
    throw new Error("Invalid MA/ATR execution configuration");
  }
  if (config.minimumRiskReward < 1 || config.minimumAtrPercent < 0) {
    throw new Error("Invalid risk or ATR threshold");
  }
}

export function replayResearchOpportunities(
  input: MultiTimeframeInput,
  partialConfig: Partial<ResearchStrategyConfig> = {},
): ResearchReplayResult {
  const config: ResearchStrategyConfig = {
    ...DEFAULT_RESEARCH_STRATEGY_CONFIG,
    ...partialConfig,
    allowedCandidateKinds: partialConfig.allowedCandidateKinds ?? ALL_CANDIDATE_KINDS,
  };
  validateConfig(config);
  const execution = closedPrefix(input["15m"], Number.POSITIVE_INFINITY);
  const seen = new Set<string>();
  const opportunities: ResearchOpportunity[] = [];
  let evaluatedBars = 0;
  let readySignals = 0;
  let rejectedByMa = 0;
  let rejectedByAtr = 0;
  let rejectedByCandidateKind = 0;

  for (let index = config.minimumExecutionBars - 1; index < execution.length; index += 1) {
    const executionCandle = execution[index];
    if (!executionCandle) continue;
    const cutoff = executionCandle.closeTime;
    const prefix = Object.fromEntries(
      TIMEFRAMES.map((timeframe) => [timeframe, closedPrefix(input[timeframe], cutoff)]),
    ) as unknown as MultiTimeframeInput;
    if (TIMEFRAMES.some((timeframe) => prefix[timeframe].length === 0)) continue;
    evaluatedBars += 1;
    const multiTimeframe = analyzeMultiTimeframe(prefix);
    const side = multiTimeframe.preferredSide;
    if (!side || multiTimeframe.intervalNesting.state !== "ALIGNED") continue;
    const risk = buildRiskPlan(side, multiTimeframe.snapshots["15m"], [
      multiTimeframe.snapshots["30m"],
      multiTimeframe.snapshots["1H"],
      multiTimeframe.snapshots["4H"],
      multiTimeframe.snapshots["1D"],
    ], config);
    const regime = detectMarketRegime(prefix["1H"]);
    const document = generateSignalDocument({
      multiTimeframe,
      regime,
      risk,
      generatedAt: cutoff,
    });
    const ready = document.signal === "LONG_READY" || document.signal === "SHORT_READY";
    if (!ready || risk.status !== "VALID" || !risk.candidate) continue;
    readySignals += 1;
    if (!config.allowedCandidateKinds.includes(risk.candidate.kind)) {
      rejectedByCandidateKind += 1;
      continue;
    }
    const filters = evaluateExecutionFilters(prefix["15m"], side, config);
    if (!filters.maAligned) {
      rejectedByMa += 1;
      continue;
    }
    if (!filters.atrAligned) {
      rejectedByAtr += 1;
      continue;
    }
    const m30Candidate = multiTimeframe.intervalNesting.m30Candidate;
    const m15Candidate = multiTimeframe.intervalNesting.m15Candidate;
    if (
      !m30Candidate
      || !m15Candidate
      || risk.entryMin === null
      || risk.entryMax === null
      || risk.stop === null
      || risk.tp1 === null
      || risk.tp2 === null
      || risk.rr1 === null
      || filters.movingAverage === null
      || filters.atr === null
      || filters.atrPercent === null
    ) continue;
    const confirmation = Math.max(m30Candidate.confirmedAt, m15Candidate.confirmedAt, risk.candidate.confirmedAt);
    if (confirmation > cutoff) continue;
    const opportunityId = `${executionCandle.symbol}:${m30Candidate.label}:${m30Candidate.confirmedAt}:${m15Candidate.label}:${m15Candidate.confirmedAt}`;
    if (seen.has(opportunityId)) continue;
    seen.add(opportunityId);
    opportunities.push({
      opportunityId,
      symbol: executionCandle.symbol,
      side,
      candidateKind: risk.candidate.kind,
      candidateLabel: risk.candidate.label,
      candidatePrice: risk.candidate.price,
      locationTime: risk.candidate.locationTime,
      confirmedAt: confirmation,
      dataCutoff: cutoff,
      entryMin: risk.entryMin,
      entryMax: risk.entryMax,
      stop: risk.stop,
      target: risk.tp1,
      target2: risk.tp2,
      plannedRiskReward: risk.rr1,
      marketRegime: regime.regime,
      ma40: filters.movingAverage,
      atr: filters.atr,
      atrPercent: filters.atrPercent,
      m30CandidateLabel: m30Candidate.label,
      m15CandidateLabel: m15Candidate.label,
      evidence: [
        ...risk.evidence,
        `MA${config.maPeriod} ${filters.movingAverage.toFixed(6)}`,
        `ATR${config.atrPeriod} ${filters.atr.toFixed(6)} (${filters.atrPercent.toFixed(4)}%)`,
        `point-in-time cutoff ${cutoff}`,
      ],
    });
  }

  return {
    algorithmVersion: CHANLUN_ALGORITHM_VERSION,
    strategyVersion: RESEARCH_STRATEGY_VERSION,
    opportunities,
    diagnostics: {
      executionBars: execution.length,
      evaluatedBars,
      readySignals,
      rejectedByMa,
      rejectedByAtr,
      rejectedByCandidateKind,
    },
  };
}
