import type { PaperAccountId, PaperAccountPolicy } from "./types.js";

export const AGGRESSIVE_ENTRY_INTERVAL_MS = 55 * 60 * 1_000;

export const PAPER_ACCOUNT_POLICIES: Readonly<Record<PaperAccountId, PaperAccountPolicy>> = {
  "paper-aggressive": {
    accountId: "paper-aggressive",
    strategyId: "aggressive-interval-nesting",
    strategyVersionId: "aggressive-interval-nesting:1.1.0-paper",
    name: "激进短线",
    style: "30M / 15M 区间套",
    initialCapital: 1_000,
    maximumOrderNotional: 120,
    maximumExposure: 300,
    minimumRiskReward: 2,
    allowedSides: ["long", "short"],
    autoEntryTargetPerHour: 1,
    automaticPaperEntry: true,
  },
  "paper-fundamental": {
    accountId: "paper-fundamental",
    strategyId: "fundamental-structural-position",
    strategyVersionId: "fundamental-structural-position:1.1.0-paper",
    name: "基本面长线",
    style: "1D / 4H + 本地基本面",
    initialCapital: 1_000,
    maximumOrderNotional: 250,
    maximumExposure: 500,
    minimumRiskReward: 3,
    allowedSides: ["long"],
    autoEntryTargetPerHour: 0,
    automaticPaperEntry: false,
  },
};

export const PAPER_ACCOUNT_IDS = Object.keys(PAPER_ACCOUNT_POLICIES) as PaperAccountId[];

export function aggressiveEntryDue(lastOpenedAt: number | null, now: number): boolean {
  return lastOpenedAt === null || now - lastOpenedAt >= AGGRESSIVE_ENTRY_INTERVAL_MS;
}

export function aggressiveDirection(closes: readonly number[]): "long" | "short" | null {
  const valid = closes.filter((value) => Number.isFinite(value) && value > 0);
  if (valid.length < 40) return null;
  const recent = valid.slice(-40);
  const ma40 = recent.reduce((sum, value) => sum + value, 0) / recent.length;
  return recent[recent.length - 1]! >= ma40 ? "long" : "short";
}
