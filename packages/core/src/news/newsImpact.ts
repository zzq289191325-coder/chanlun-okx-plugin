export type NewsBias = "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "MIXED";
export type NewsRiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface ResearchNewsItem {
  id: string;
  headline: string;
  publishedAt: number;
  eventAt?: number;
}

export interface NewsImpactResult {
  bias: NewsBias;
  riskLevel: NewsRiskLevel;
  score: number;
  highImpactEventSoon: boolean;
  itemsAnalyzed: number;
  matchedKeywords: readonly string[];
  summary: string;
  dataCutoff: number;
}

const POSITIVE_TERMS = [
  "beat",
  "beats",
  "上调",
  "超预期",
  "增长",
  "获批",
  "回购",
  "合作",
  "盈利",
];
const NEGATIVE_TERMS = [
  "miss",
  "下调",
  "低于预期",
  "亏损",
  "调查",
  "诉讼",
  "召回",
  "裁员",
  "违约",
];
const HIGH_IMPACT_TERMS = [
  "cpi",
  "fomc",
  "非农",
  "利率决议",
  "美联储",
  "财报",
  "earnings",
  "停牌",
  "监管调查",
];
const EVENT_WINDOW_MS = 24 * 60 * 60_000;

function matches(text: string, terms: readonly string[]) {
  const normalized = text.toLowerCase();
  return terms.filter((term) => normalized.includes(term.toLowerCase()));
}

function clampScore(score: number) {
  return Math.max(-100, Math.min(100, score));
}

export function analyzeNewsImpact(
  items: readonly ResearchNewsItem[],
  dataCutoff = Date.now(),
): NewsImpactResult {
  const visible = items.filter((item) => item.publishedAt <= dataCutoff);
  let score = 0;
  let highImpactEventSoon = false;
  const keywordSet = new Set<string>();

  for (const item of visible) {
    const positive = matches(item.headline, POSITIVE_TERMS);
    const negative = matches(item.headline, NEGATIVE_TERMS);
    const highImpact = matches(item.headline, HIGH_IMPACT_TERMS);
    positive.forEach((term) => keywordSet.add(term));
    negative.forEach((term) => keywordSet.add(term));
    highImpact.forEach((term) => keywordSet.add(term));
    score += positive.length * 18;
    score -= negative.length * 18;
    if (
      highImpact.length > 0 &&
      item.eventAt !== undefined &&
      item.eventAt >= dataCutoff &&
      item.eventAt - dataCutoff <= EVENT_WINDOW_MS
    ) {
      highImpactEventSoon = true;
    }
  }

  score = clampScore(score);
  const hasPositive = score > 0;
  const hasNegative = score < 0;
  const allText = visible.map((item) => item.headline).join(" ");
  const containsPositive = matches(allText, POSITIVE_TERMS).length > 0;
  const containsNegative = matches(allText, NEGATIVE_TERMS).length > 0;
  const bias: NewsBias =
    containsPositive && containsNegative
      ? "MIXED"
      : hasPositive
        ? "POSITIVE"
        : hasNegative
          ? "NEGATIVE"
          : "NEUTRAL";
  const riskLevel: NewsRiskLevel = highImpactEventSoon
    ? "HIGH"
    : keywordSet.size >= 3 || Math.abs(score) >= 36
      ? "MEDIUM"
      : "LOW";
  const summary =
    visible.length === 0
      ? "未录入本地新闻文本"
      : highImpactEventSoon
        ? "24小时内存在已录入的高影响事件，结构信号进入等待"
        : `本地文本影响：${bias}，风险等级：${riskLevel}`;

  return {
    bias,
    riskLevel,
    score,
    highImpactEventSoon,
    itemsAnalyzed: visible.length,
    matchedKeywords: [...keywordSet],
    summary,
    dataCutoff,
  };
}

const SCHEDULE_PATTERN =
  /^\s*(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})\s*\|\s*(.+)$/;

export function parseLocalNewsText(
  text: string,
  recordedAt = Date.now(),
): ResearchNewsItem[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const scheduled = SCHEDULE_PATTERN.exec(line);
      if (!scheduled) {
        return {
          id: `local-news:${recordedAt}:${index}`,
          headline: line,
          publishedAt: recordedAt,
        };
      }
      const eventAt = new Date(`${scheduled[1]}T${scheduled[2]}:00`).getTime();
      return {
        id: `local-news:${recordedAt}:${index}`,
        headline: scheduled[3]!,
        publishedAt: recordedAt,
        ...(Number.isFinite(eventAt) ? { eventAt } : {}),
      };
    });
}
