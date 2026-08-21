import { clampScore } from "@/utils/format";
import type { Bi, ChanlunSignal, MacdPoint, Segment, Zhongshu } from "./types";

interface DetectSignalInput {
  bis: Bi[];
  segments: Segment[];
  zhongshu: Zhongshu[];
  macd: MacdPoint[];
}

type SignalLabel = ChanlunSignal["label"];

function macdEnergy(macd: MacdPoint[], startTs: number, endTs: number, direction: "up" | "down") {
  return macd
    .filter((item) => item.ts >= startTs && item.ts <= endTs)
    .reduce((sum, item) => {
      if (direction === "up") return sum + Math.max(0, item.histogram);
      return sum + Math.abs(Math.min(0, item.histogram));
    }, 0);
}

function findPreviousSameDirection(segments: Segment[], latest: Segment) {
  return segments
    .slice(0, -1)
    .reverse()
    .find((segment) => segment.direction === latest.direction);
}

function divergenceSignal(segments: Segment[], macd: MacdPoint[]): ChanlunSignal | null {
  const latest = segments.at(-1);
  if (!latest) return null;
  const previous = findPreviousSameDirection(segments, latest);
  if (!previous) return null;

  const priceExtended =
    latest.direction === "up" ? latest.high > previous.high : latest.low < previous.low;
  if (!priceExtended) return null;

  const latestEnergy = macdEnergy(macd, latest.startTs, latest.endTs, latest.direction);
  const previousEnergy = macdEnergy(macd, previous.startTs, previous.endTs, previous.direction);
  if (previousEnergy <= 0 || latestEnergy >= previousEnergy * 0.88) return null;

  const bearish = latest.direction === "up";
  return {
    id: `div-${latest.startTs}-${latest.endTs}`,
    kind: "divergence_warning",
    label: "背驰警示",
    score: clampScore(55 + (1 - latestEnergy / previousEnergy) * 35),
    ts: latest.endTs,
    price: bearish ? latest.high : latest.low,
    explanation: bearish
      ? "价格刷新段内高点，但同向 MACD 能量弱于前一上行段，属于顶背驰警示。"
      : "价格刷新段内低点，但同向 MACD 能量弱于前一下行段，属于底背驰警示。",
  };
}

function signalPoint(
  label: SignalLabel,
  price: number,
  zone: Zhongshu,
): NonNullable<ChanlunSignal["point"]> {
  const width = Math.max(zone.high - zone.low, Math.abs(price) * 0.001, Number.EPSILON);
  const pad = width * 0.12;

  if (label === "候选1买") {
    return {
      structurePrice: price,
      triggerLow: Math.min(price, zone.low),
      triggerHigh: Math.max(price + pad, zone.low),
      riskPrice: price - width * 0.35,
      note: "中枢下沿下方的底分型结构观察位；跌破风险观察位则结构弱化。",
    };
  }

  if (label === "候选2买") {
    return {
      structurePrice: price,
      triggerLow: Math.max(zone.low, price - pad),
      triggerHigh: Math.min(zone.high, price + pad),
      riskPrice: zone.low,
      note: "中枢内回落不破下沿的底分型结构观察位；跌回中枢下沿下方则结构弱化。",
    };
  }

  if (label === "候选3买") {
    return {
      structurePrice: price,
      triggerLow: zone.high,
      triggerHigh: Math.max(price + pad, zone.high + pad),
      riskPrice: zone.high,
      note: "离开中枢后的回踩不破上沿结构观察位；跌回中枢上沿下方则结构弱化。",
    };
  }

  if (label === "候选1卖") {
    return {
      structurePrice: price,
      triggerLow: Math.min(price - pad, zone.high),
      triggerHigh: Math.max(price, zone.high),
      riskPrice: price + width * 0.35,
      note: "中枢上沿上方的顶分型结构观察位；突破风险观察位则结构弱化。",
    };
  }

  if (label === "候选2卖") {
    return {
      structurePrice: price,
      triggerLow: Math.max(zone.low, price - pad),
      triggerHigh: Math.min(zone.high, price + pad),
      riskPrice: zone.high,
      note: "中枢内反弹不破上沿的顶分型结构观察位；重新站上中枢上沿则结构弱化。",
    };
  }

  return {
    structurePrice: price,
    triggerLow: Math.min(price - pad, zone.low - pad),
    triggerHigh: zone.low,
    riskPrice: zone.low,
    note: "离开中枢后的反抽不回中枢下沿结构观察位；重新进入中枢下沿上方则结构弱化。",
  };
}

function addPoint(signal: Omit<ChanlunSignal, "point">, zone: Zhongshu): ChanlunSignal {
  return {
    ...signal,
    point: signalPoint(signal.label, signal.price, zone),
  };
}

function candidateFromBi(
  latestBi: Bi,
  recentZone: Zhongshu | undefined,
  hasDivergence: boolean,
): ChanlunSignal | null {
  if (!recentZone) return null;

  const price = latestBi.end.price;
  const width = Math.max(recentZone.high - recentZone.low, Number.EPSILON);
  const nearLow = Math.abs(price - recentZone.low) / width;
  const nearHigh = Math.abs(price - recentZone.high) / width;

  if (latestBi.direction === "down" && latestBi.end.type === "bottom") {
    if (price <= recentZone.low) {
      return addPoint(
        {
        id: `candidate-1buy-${latestBi.endTs}`,
        kind: "candidate_buy",
        label: "候选1买",
        score: clampScore((hasDivergence ? 72 : 62) + Math.max(0, 1 - nearLow) * 18),
        ts: latestBi.endTs,
        price,
        explanation: hasDivergence
          ? "下行笔触及或跌破最近中枢下沿，同时出现底背驰警示，标记为候选1买结构点。"
          : "下行笔触及或跌破最近中枢下沿并出现底分型，标记为候选1买观察点；需结合背驰和后续确认。",
        },
        recentZone,
      );
    }
    if (price > recentZone.low && price < recentZone.high) {
      return addPoint(
        {
        id: `candidate-2buy-${latestBi.endTs}`,
        kind: "candidate_buy",
        label: "候选2买",
        score: clampScore(58 + Math.max(0, 1 - nearLow) * 22),
        ts: latestBi.endTs,
        price,
        explanation: "回落仍在最近中枢内部并出现底分型，标记为候选2买观察点。",
        },
        recentZone,
      );
    }
    if (price >= recentZone.high) {
      return addPoint(
        {
        id: `candidate-3buy-${latestBi.endTs}`,
        kind: "candidate_buy",
        label: "候选3买",
        score: clampScore(62 + Math.min(nearHigh, 1) * 18),
        ts: latestBi.endTs,
        price,
        explanation: "向上离开中枢后的回落未跌回中枢上沿，标记为候选3买结构点。",
        },
        recentZone,
      );
    }
  }

  if (latestBi.direction === "up" && latestBi.end.type === "top") {
    if (price >= recentZone.high) {
      return addPoint(
        {
        id: `candidate-1sell-${latestBi.endTs}`,
        kind: "candidate_sell",
        label: "候选1卖",
        score: clampScore((hasDivergence ? 72 : 62) + Math.max(0, 1 - nearHigh) * 18),
        ts: latestBi.endTs,
        price,
        explanation: hasDivergence
          ? "上行笔触及或突破最近中枢上沿，同时出现顶背驰警示，标记为候选1卖结构点。"
          : "上行笔触及或突破最近中枢上沿并出现顶分型，标记为候选1卖观察点；需结合背驰和后续确认。",
        },
        recentZone,
      );
    }
    if (price < recentZone.high && price > recentZone.low) {
      return addPoint(
        {
        id: `candidate-2sell-${latestBi.endTs}`,
        kind: "candidate_sell",
        label: "候选2卖",
        score: clampScore(58 + Math.max(0, 1 - nearHigh) * 22),
        ts: latestBi.endTs,
        price,
        explanation: "反弹仍在最近中枢内部并出现顶分型，标记为候选2卖观察点。",
        },
        recentZone,
      );
    }
    if (price <= recentZone.low) {
      return addPoint(
        {
        id: `candidate-3sell-${latestBi.endTs}`,
        kind: "candidate_sell",
        label: "候选3卖",
        score: clampScore(62 + Math.min(nearLow, 1) * 18),
        ts: latestBi.endTs,
        price,
        explanation: "向下离开中枢后的反弹未重新进入中枢下沿，标记为候选3卖结构点。",
        },
        recentZone,
      );
    }
  }

  return null;
}

function relevantZoneForBi(zones: Zhongshu[], bi: Bi) {
  return zones
    .slice()
    .reverse()
    .find((zone) => zone.startTs <= bi.endTs);
}

function latestByLabel(signals: ChanlunSignal[]) {
  const byLabel = new Map<SignalLabel, ChanlunSignal>();
  for (const signal of signals) {
    const previous = byLabel.get(signal.label);
    if (!previous || signal.ts >= previous.ts) byLabel.set(signal.label, signal);
  }
  return [...byLabel.values()];
}

export function detectSignals(input: DetectSignalInput): ChanlunSignal[] {
  const signals: ChanlunSignal[] = [];
  const divergence = divergenceSignal(input.segments, input.macd);
  if (divergence) signals.push(divergence);

  const candidateSignals: ChanlunSignal[] = [];
  for (const bi of input.bis.slice(-24)) {
    const zone = relevantZoneForBi(input.zhongshu, bi);
    const candidate = candidateFromBi(bi, zone, divergence !== null && divergence.ts >= bi.startTs);
    if (candidate) signals.push(candidate);
    if (candidate) candidateSignals.push(candidate);
  }

  return [...signals.filter((signal) => signal.kind === "divergence_warning"), ...latestByLabel(candidateSignals)]
    .sort((a, b) => a.ts - b.ts);
}
