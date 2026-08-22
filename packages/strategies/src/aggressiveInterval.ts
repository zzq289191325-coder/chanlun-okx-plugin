import type { MultiTimeframeInput } from "../../core/src/multiTimeframe/engine.js";
import { replayResearchOpportunities, type ResearchReplayResult, type ResearchStrategyConfig } from "../../core/src/backtest/replay.js";

export const AGGRESSIVE_INTERVAL_STRATEGY_ID = "aggressive-interval-nesting";
export const AGGRESSIVE_INTERVAL_VERSION = "1.0.0-candidate";

export interface AggressiveIntervalConfig extends Partial<ResearchStrategyConfig> {
  maximumConsecutiveAttempts: number;
  executionTimeframe: "15m";
}

export const DEFAULT_AGGRESSIVE_INTERVAL_CONFIG: AggressiveIntervalConfig = {
  maximumConsecutiveAttempts: 3,
  executionTimeframe: "15m",
  maPeriod: 40,
  atrPeriod: 14,
  minimumAtrPercent: 0.15,
  minimumRiskReward: 2,
};

export function runAggressiveIntervalStrategy(input: MultiTimeframeInput, config: AggressiveIntervalConfig = DEFAULT_AGGRESSIVE_INTERVAL_CONFIG): ResearchReplayResult {
  const { maximumConsecutiveAttempts: _attemptLimit, executionTimeframe: _executionTimeframe, ...researchConfig } = config;
  return replayResearchOpportunities(input, researchConfig);
}
