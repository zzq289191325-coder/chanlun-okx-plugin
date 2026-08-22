import type { DesktopSettings, NavigationPage } from "./types.js";

export const NAVIGATION_PAGES: readonly NavigationPage[] = ["overview", "structure", "opportunities", "paper", "backtests", "laboratory", "learning", "review", "data", "settings"];

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  selectedSymbol: "BTC-USDT-SWAP",
  timezone: "Asia/Shanghai",
  initialCapital: 1_000,
  maximumOrderNotional: 250,
  maximumConsecutiveLosses: 3,
  minimumRiskReward: 2,
  feeRate: 0.0005,
  slippageBps: 5,
  autoRefreshSeconds: 30,
};

export function normalizeDesktopSettings(settings: DesktopSettings): DesktopSettings {
  return {
    ...settings,
    initialCapital: Math.max(100, Math.min(1_000_000, Number(settings.initialCapital))),
    maximumOrderNotional: Math.max(1, Math.min(1_000_000, Number(settings.maximumOrderNotional))),
    maximumConsecutiveLosses: Math.max(1, Math.min(20, Math.round(Number(settings.maximumConsecutiveLosses)))),
    minimumRiskReward: Math.max(1, Math.min(10, Number(settings.minimumRiskReward))),
    feeRate: Math.max(0, Math.min(0.02, Number(settings.feeRate))),
    slippageBps: Math.max(0, Math.min(500, Number(settings.slippageBps))),
    autoRefreshSeconds: Math.max(10, Math.min(3_600, Math.round(Number(settings.autoRefreshSeconds)))),
  };
}

export function paperOrderSafetyChecks(notional: number, maximumOrderNotional: number, closedCandleAvailable: boolean) {
  return [
    { rule: "positive_notional", allowed: Number.isFinite(notional) && notional > 0 },
    { rule: "maximum_order_notional", allowed: notional <= maximumOrderNotional },
    { rule: "closed_candle_only", allowed: closedCandleAvailable },
    { rule: "external_execution_locked", allowed: true },
  ] as const;
}
