import type { Interval } from "@/chanlun/types";

export function toUtcTimestampSeconds(ms: number) {
  return Math.floor(ms / 1000);
}

export function formatDateTime(ts: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ts));
}

export function intervalToMs(interval: Interval) {
  const map: Record<Interval, number> = {
    "1m": 60_000,
    "5m": 5 * 60_000,
    "15m": 15 * 60_000,
    "30m": 30 * 60_000,
    "1H": 60 * 60_000,
    "4H": 4 * 60 * 60_000,
    "1D": 24 * 60 * 60_000,
  };
  return map[interval];
}
