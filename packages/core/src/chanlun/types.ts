import type { Candle, Direction, Timeframe, TradeSide } from "../../../contracts/src/index.js";

export interface IncludedBar {
  id: string;
  index: number;
  symbol: string;
  timeframe: Timeframe;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  mergeDirection: Exclude<Direction, "range">;
  sourceCount: number;
}

export interface Fractal {
  id: string;
  type: "top" | "bottom";
  index: number;
  locationTime: number;
  confirmedAt: number;
  price: number;
  strength: number;
}

export interface Stroke {
  id: string;
  direction: Exclude<Direction, "range">;
  start: Fractal;
  end: Fractal;
  startTime: number;
  endTime: number;
  confirmedAt: number;
  high: number;
  low: number;
  includedBars: number;
}

export interface Segment {
  id: string;
  direction: Exclude<Direction, "range">;
  startTime: number;
  endTime: number;
  confirmedAt: number;
  high: number;
  low: number;
  strokeIds: readonly string[];
  ruleVersion: "confirmed-three-stroke-v1";
}

export interface CentralZone {
  id: string;
  level: "stroke" | "segment";
  startTime: number;
  endTime: number;
  confirmedAt: number;
  coreLow: number;
  coreHigh: number;
  rangeLow: number;
  rangeHigh: number;
  legIds: readonly string[];
  state: "forming" | "extended" | "left_up" | "left_down";
}

export interface MacdPoint {
  time: number;
  dif: number;
  dea: number;
  histogram: number;
}

export interface Divergence {
  id: string;
  side: "top" | "bottom";
  level: "stroke" | "segment";
  legId: string;
  comparedWithLegId: string;
  locationTime: number;
  confirmedAt: number;
  price: number;
  macdRatio: number;
  volumeEfficiencyRatio: number;
  score: number;
  evidence: readonly string[];
}

export type CandidateKind =
  | "candidate_1_buy"
  | "candidate_2_buy"
  | "candidate_3_buy"
  | "candidate_1_sell"
  | "candidate_2_sell"
  | "candidate_3_sell";

export interface CandidateSignal {
  id: string;
  kind: CandidateKind;
  label: "候选1买" | "候选2买" | "候选3买" | "候选1卖" | "候选2卖" | "候选3卖";
  side: TradeSide;
  locationTime: number;
  confirmedAt: number;
  price: number;
  score: number;
  evidenceIds: readonly string[];
  reason: string;
}

export interface ChanlunSnapshot {
  symbol: string;
  timeframe: Timeframe;
  dataCutoff: number;
  candles: readonly Candle[];
  includedBars: readonly IncludedBar[];
  fractals: readonly Fractal[];
  strokes: readonly Stroke[];
  segments: readonly Segment[];
  zones: readonly CentralZone[];
  macd: readonly MacdPoint[];
  divergences: readonly Divergence[];
  signals: readonly CandidateSignal[];
  direction: Direction;
}

export interface PriceLeg {
  id: string;
  direction: Exclude<Direction, "range">;
  startTime: number;
  endTime: number;
  confirmedAt: number;
  high: number;
  low: number;
}
