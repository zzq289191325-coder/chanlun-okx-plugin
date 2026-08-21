export type Interval = "1m" | "5m" | "15m" | "30m" | "1H" | "4H" | "1D";

export interface ChartLayerVisibility {
  showFractals: boolean;
  showStructures: boolean;
  showSignals: boolean;
  bareK: boolean;
}

export interface Candle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed?: boolean;
}

export interface IncludedCandle extends Candle {
  index: number;
  sourceStartTs: number;
  sourceEndTs: number;
}

export interface Fractal {
  id: string;
  type: "top" | "bottom";
  index: number;
  ts: number;
  price: number;
  strength: number;
}

export interface Bi {
  id: string;
  direction: "up" | "down";
  start: Fractal;
  end: Fractal;
  high: number;
  low: number;
  startTs: number;
  endTs: number;
}

export interface Segment {
  id: string;
  direction: "up" | "down";
  start: Fractal;
  end: Fractal;
  bis: Bi[];
  high: number;
  low: number;
  startTs: number;
  endTs: number;
}

export interface Zhongshu {
  id: string;
  startTs: number;
  endTs: number;
  high: number;
  low: number;
  level: "bi" | "segment";
  direction: "up" | "down" | "range";
}

export interface MacdPoint {
  ts: number;
  close: number;
  dif: number;
  dea: number;
  histogram: number;
}

export interface ChanlunSignal {
  id: string;
  kind: "candidate_buy" | "candidate_sell" | "divergence_warning";
  label:
    | "候选1买"
    | "候选2买"
    | "候选3买"
    | "候选1卖"
    | "候选2卖"
    | "候选3卖"
    | "背驰警示";
  score: number;
  explanation: string;
  ts: number;
  price: number;
  point?: {
    structurePrice: number;
    triggerLow: number;
    triggerHigh: number;
    riskPrice: number;
    note: string;
  };
}

export interface ChanlunAnalysis {
  included: IncludedCandle[];
  fractals: Fractal[];
  bis: Bi[];
  segments: Segment[];
  zhongshu: Zhongshu[];
  macd: MacdPoint[];
  signals: ChanlunSignal[];
  direction: "up" | "down" | "range";
  recentZhongshu?: Zhongshu;
  recentSignal?: ChanlunSignal;
  updatedAt: number;
}
