import type { Candle, Timeframe } from "../../../contracts/src/index.js";
import { timeframeMilliseconds } from "../market/candles.js";

export type OkxCandleRow = readonly [
  timestamp: string,
  open: string,
  high: string,
  low: string,
  close: string,
  volume: string,
  volumeCurrency: string,
  volumeQuote: string,
  confirm: string,
];

export interface OkxEnvelope<T> {
  code: string;
  msg: string;
  data: T;
}

export function parseOkxCandle(symbol: string, timeframe: Timeframe, row: OkxCandleRow): Candle {
  const openTime = Number(row[0]);
  const duration = timeframeMilliseconds(timeframe);
  const candle: Candle = {
    symbol,
    timeframe,
    openTime,
    closeTime: openTime + duration,
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    closed: row[8] === "1",
  };
  return candle;
}

export function parseOkxCandles(
  symbol: string,
  timeframe: Timeframe,
  rows: readonly OkxCandleRow[],
): Candle[] {
  const byOpenTime = new Map<number, Candle>();
  for (const row of rows) {
    const candle = parseOkxCandle(symbol, timeframe, row);
    byOpenTime.set(candle.openTime, candle);
  }
  return [...byOpenTime.values()].sort((left, right) => left.openTime - right.openTime);
}
