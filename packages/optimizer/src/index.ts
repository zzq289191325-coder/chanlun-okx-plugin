export type OptimizerMethod = "grid" | "random";

export interface TimeRange { start: number; end: number; }
export interface WalkForwardSplit { train: TimeRange; validation: TimeRange; test: TimeRange; }

export interface TrialMetrics {
  totalReturnPercent: number;
  maximumDrawdownPercent: number;
  profitFactor: number;
  expectancy: number;
  tradeCount: number;
  tailLossPercent: number;
  netAfterCosts: number;
}

export interface RobustnessEvidence {
  parameterStability: number;
  crossSymbolConsistency: number;
  crossRegimeConsistency: number;
  costStressPassed: boolean;
  reproducible: boolean;
  futureDataDetected: boolean;
}

export interface EvaluatedTrial {
  trialIndex: number;
  parameters: Readonly<Record<string, number>>;
  train: TrialMetrics;
  validation: TrialMetrics;
  test: TrialMetrics;
  robustness: RobustnessEvidence;
  accepted: boolean;
  rejectionReasons: readonly string[];
  objectiveScore: number;
}

export interface ExperimentResult {
  method: OptimizerMethod;
  seed: number;
  split: WalkForwardSplit;
  trials: readonly EvaluatedTrial[];
  selectedCandidate: EvaluatedTrial | null;
  deploymentStatus: "CANDIDATE_REVIEW_REQUIRED";
}

export function chronologicalSplit(start: number, end: number, trainRatio = 0.6, validationRatio = 0.2): WalkForwardSplit {
  if (!(start < end) || trainRatio <= 0 || validationRatio <= 0 || trainRatio + validationRatio >= 1) throw new Error("Invalid chronological split");
  const duration = end - start;
  const trainEnd = Math.floor(start + duration * trainRatio);
  const validationEnd = Math.floor(start + duration * (trainRatio + validationRatio));
  return { train: { start, end: trainEnd }, validation: { start: trainEnd + 1, end: validationEnd }, test: { start: validationEnd + 1, end } };
}

function combinations(searchSpace: Readonly<Record<string, readonly number[]>>): Readonly<Record<string, number>>[] {
  let result: Readonly<Record<string, number>>[] = [{}];
  for (const [name, values] of Object.entries(searchSpace)) result = result.flatMap((partial) => values.map((value) => ({ ...partial, [name]: value })));
  return result;
}

function seededShuffle<T>(values: readonly T[], seed: number): T[] {
  const result = [...values];
  let state = seed >>> 0;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    const target = state % (index + 1);
    [result[index], result[target]] = [result[target]!, result[index]!];
  }
  return result;
}

function assess(train: TrialMetrics, validation: TrialMetrics, test: TrialMetrics, robustness: RobustnessEvidence): { reasons: string[]; score: number } {
  const reasons: string[] = [];
  if (validation.tradeCount < 20 || test.tradeCount < 10) reasons.push("样本量不足");
  if (validation.maximumDrawdownPercent > 20 || test.maximumDrawdownPercent > 20) reasons.push("最大回撤超过阈值");
  if (train.totalReturnPercent > 0 && validation.totalReturnPercent <= 0) reasons.push("训练集良好但验证集失效");
  if (validation.netAfterCosts <= 0 || test.netAfterCosts <= 0) reasons.push("计入成本后失效");
  if (robustness.parameterStability < 0.65) reasons.push("参数敏感性过高");
  if (robustness.crossSymbolConsistency < 0.5) reasons.push("仅在少数标的有效");
  if (robustness.crossRegimeConsistency < 0.5) reasons.push("仅在少数行情阶段有效");
  if (!robustness.costStressPassed) reasons.push("成本压力测试失败");
  if (!robustness.reproducible) reasons.push("数据版本无法复现");
  if (robustness.futureDataDetected) reasons.push("检测到未来数据");
  const score = validation.totalReturnPercent * 0.2 + test.totalReturnPercent * 0.25 + Math.min(validation.profitFactor, 3) * 8 + Math.min(test.profitFactor, 3) * 10 + validation.expectancy * 5 + test.expectancy * 6 - validation.maximumDrawdownPercent * 0.5 - test.maximumDrawdownPercent * 0.75 - Math.abs(test.tailLossPercent) * 0.5 + robustness.parameterStability * 10 + robustness.crossSymbolConsistency * 8 + robustness.crossRegimeConsistency * 8;
  return { reasons, score };
}

export function runOfflineExperiment(
  method: OptimizerMethod,
  searchSpace: Readonly<Record<string, readonly number[]>>,
  split: WalkForwardSplit,
  evaluator: (parameters: Readonly<Record<string, number>>, split: WalkForwardSplit) => { train: TrialMetrics; validation: TrialMetrics; test: TrialMetrics; robustness: RobustnessEvidence },
  options: { seed?: number; maximumTrials?: number } = {},
): ExperimentResult {
  const seed = options.seed ?? 7;
  const all = combinations(searchSpace);
  const ordered = method === "random" ? seededShuffle(all, seed) : all;
  const selected = ordered.slice(0, options.maximumTrials ?? ordered.length);
  const trials = selected.map((parameters, trialIndex): EvaluatedTrial => {
    const result = evaluator(parameters, split);
    const assessment = assess(result.train, result.validation, result.test, result.robustness);
    return { trialIndex, parameters, ...result, accepted: assessment.reasons.length === 0, rejectionReasons: assessment.reasons, objectiveScore: assessment.score };
  });
  const selectedCandidate = trials.filter((item) => item.accepted).sort((left, right) => right.objectiveScore - left.objectiveScore)[0] ?? null;
  return { method, seed, split, trials, selectedCandidate, deploymentStatus: "CANDIDATE_REVIEW_REQUIRED" };
}

export function monteCarloTradeOrder(pnls: readonly number[], iterations: number, seed = 17): readonly number[] {
  const drawdowns: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const shuffled = seededShuffle(pnls, seed + iteration);
    let equity = 0;
    let peak = 0;
    let maximum = 0;
    for (const pnl of shuffled) { equity += pnl; peak = Math.max(peak, equity); maximum = Math.max(maximum, peak - equity); }
    drawdowns.push(maximum);
  }
  return drawdowns;
}
