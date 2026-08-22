import { describe, expect, it } from "vitest";
import type { BrokerHealth, OrderIntent } from "../../broker-contracts/src/index.js";
import { evaluateOrderRisk, LIVE_RISK_LIMITS, PAPER_RISK_LIMITS } from "../src/index.js";

const health: BrokerHealth = { connected: true, accountMode: "PAPER", readOnly: false, websocketConnected: true, dataAgeMs: 0, databaseHealthy: true, strategyVersionMatches: true, dataHashMatches: true, message: "ok" };
const intent: OrderIntent = { clientOrderId: "risk-1", accountMode: "PAPER", strategyId: "aggressive", strategyVersion: "1", signalId: null, symbol: "BTC-USDT-SWAP", side: "buy", positionSide: "long", orderType: "market", quantity: "1", referencePrice: "100", limitPrice: null, reduceOnly: false, candidateLabel: "候选1买", locationTime: 1, confirmedAt: 2, dataCutoff: 3, createdAt: 4 };

describe("fail-closed risk engine", () => {
  it("allows a bounded PAPER intent", () => {
    const result = evaluateOrderRisk(intent, { mode: "PAPER", accountEquity: 1_000, dailyPnl: 0, consecutiveLosses: 0, ordersLastHour: 0, leverage: 1, estimatedSlippageBps: 5, spreadBps: 5, stopPrice: 95, positions: [], health, killSwitchActive: false, modeUnlocked: false, now: 10 }, PAPER_RISK_LIMITS);
    expect(result.allowed).toBe(true);
  });

  it("rejects kill switch, daily stop and locked LIVE", () => {
    const liveIntent = { ...intent, accountMode: "LIVE" as const };
    const result = evaluateOrderRisk(liveIntent, { mode: "LIVE", accountEquity: 1_000, dailyPnl: -10, consecutiveLosses: 3, ordersLastHour: 0, leverage: 1, estimatedSlippageBps: 5, spreadBps: 5, stopPrice: 99, positions: [], health: { ...health, accountMode: "LIVE" }, killSwitchActive: true, modeUnlocked: false, now: 10 }, LIVE_RISK_LIMITS);
    expect(result.allowed).toBe(false);
    expect(result.checks.filter((item) => !item.allowed).map((item) => item.rule)).toEqual(expect.arrayContaining(["mode_unlock", "kill_switch", "daily_loss", "consecutive_losses"]));
  });
});
