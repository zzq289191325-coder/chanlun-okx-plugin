import type { TradeSide } from "../../../contracts/src/index.js";
import type { CandidateSignal, ChanlunSnapshot } from "../chanlun/types.js";

export interface RiskConfig {
  minimumRiskReward: number;
  stopAtrBuffer: number;
  entryAtrWidth: number;
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  minimumRiskReward: 2,
  stopAtrBuffer: 0.15,
  entryAtrWidth: 0.1,
};

export interface RiskPlan {
  status: "VALID" | "PASS";
  side: TradeSide;
  candidate: CandidateSignal | null;
  entryMin: number | null;
  entryMax: number | null;
  stop: number | null;
  tp1: number | null;
  tp2: number | null;
  rr1: number | null;
  rr2: number | null;
  invalidation: string;
  reason: string;
  evidence: readonly string[];
}

function averageTrueRange(snapshot: ChanlunSnapshot, period = 14): number | null {
  const candles = snapshot.candles;
  if (candles.length < period + 1) return null;
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

function latestCandidate(snapshot: ChanlunSnapshot, side: TradeSide): CandidateSignal | null {
  return snapshot.signals.filter((signal) => signal.side === side).at(-1) ?? null;
}

function collectStructuralLevels(snapshots: readonly ChanlunSnapshot[]): number[] {
  const levels: number[] = [];
  for (const snapshot of snapshots) {
    levels.push(...snapshot.fractals.map((fractal) => fractal.price));
    for (const zone of snapshot.zones) levels.push(zone.coreLow, zone.coreHigh, zone.rangeLow, zone.rangeHigh);
  }
  return [...new Set(levels.filter(Number.isFinite))];
}

function pass(side: TradeSide, candidate: CandidateSignal | null, reason: string): RiskPlan {
  return {
    status: "PASS",
    side,
    candidate,
    entryMin: null,
    entryMax: null,
    stop: null,
    tp1: null,
    tp2: null,
    rr1: null,
    rr2: null,
    invalidation: "",
    reason,
    evidence: [],
  };
}

export function buildRiskPlan(
  side: TradeSide,
  execution: ChanlunSnapshot,
  context: readonly ChanlunSnapshot[],
  config: RiskConfig = DEFAULT_RISK_CONFIG,
): RiskPlan {
  const candidate = latestCandidate(execution, side);
  if (!candidate) return pass(side, null, "没有与多周期方向一致的已确认候选结构点");

  const entry = candidate.price;
  const atr = averageTrueRange(execution) ?? entry * 0.005;
  const levels = collectStructuralLevels([execution, ...context]);
  const invalidationLevels = levels.filter((level) => (side === "long" ? level < entry : level > entry));
  if (invalidationLevels.length === 0) return pass(side, candidate, "找不到结构失效位，无法计算风险");

  const structuralStop = side === "long" ? Math.max(...invalidationLevels) : Math.min(...invalidationLevels);
  const stop = side === "long" ? structuralStop - atr * config.stopAtrBuffer : structuralStop + atr * config.stopAtrBuffer;
  const risk = Math.abs(entry - stop);
  if (!Number.isFinite(risk) || risk <= entry * 0.0002) return pass(side, candidate, "结构止损距离无效或过窄");

  const targets = levels
    .filter((level) => (side === "long" ? level > entry : level < entry))
    .sort((left, right) => (side === "long" ? left - right : right - left));
  const qualified = targets.filter((target) => Math.abs(target - entry) / risk >= config.minimumRiskReward);
  const tp1 = qualified[0];
  if (tp1 === undefined) {
    return pass(side, candidate, `没有达到 ${config.minimumRiskReward.toFixed(1)}R 的结构目标位`);
  }
  const tp2 = qualified[1] ?? (side === "long" ? entry + risk * 3 : entry - risk * 3);
  const rr1 = Math.abs(tp1 - entry) / risk;
  const rr2 = Math.abs(tp2 - entry) / risk;
  if (rr1 < config.minimumRiskReward) {
    return pass(side, candidate, `风险收益比 ${rr1.toFixed(2)} 低于最低 ${config.minimumRiskReward.toFixed(2)}`);
  }

  return {
    status: "VALID",
    side,
    candidate,
    entryMin: entry - atr * config.entryAtrWidth,
    entryMax: entry + atr * config.entryAtrWidth,
    stop,
    tp1,
    tp2,
    rr1,
    rr2,
    invalidation: side === "long" ? `收盘跌破结构失效位 ${stop.toFixed(6)}` : `收盘突破结构失效位 ${stop.toFixed(6)}`,
    reason: "已找到结构止损和至少 2R 的结构目标；仍仅为候选分析计划。",
    evidence: [
      candidate.id,
      `structure stop ${structuralStop.toFixed(6)}`,
      `ATR buffer ${(atr * config.stopAtrBuffer).toFixed(6)}`,
      `RR1 ${rr1.toFixed(3)}`,
      `RR2 ${rr2.toFixed(3)}`,
    ],
  };
}
