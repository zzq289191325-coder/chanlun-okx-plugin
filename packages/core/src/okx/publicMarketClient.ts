import type { Candle, Timeframe } from "../../../contracts/src/index.js";
import { parseOkxCandles, type OkxCandleRow, type OkxEnvelope } from "./candles.js";

export interface OkxPublicMarketClientOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMilliseconds?: number;
  retries?: number;
  minimumRequestIntervalMilliseconds?: number;
}

export interface CandleRequest {
  symbol: string;
  timeframe: Timeframe;
  limit?: number;
  history?: boolean;
  after?: number;
  before?: number;
}

export class OkxPublicMarketError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "OkxPublicMarketError";
  }
}

class RequestGate {
  private nextRequestAt = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly minimumInterval: number) {}

  async wait(): Promise<void> {
    const operation = this.chain.then(async () => {
      const delay = Math.max(0, this.nextRequestAt - Date.now());
      if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
      this.nextRequestAt = Date.now() + this.minimumInterval;
    });
    this.chain = operation.catch(() => undefined);
    await operation;
  }
}

function retryDelay(attempt: number): number {
  return Math.min(2_000, 150 * 2 ** attempt);
}

export class OkxPublicMarketClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMilliseconds: number;
  private readonly retries: number;
  private readonly gate: RequestGate;

  constructor(options: OkxPublicMarketClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "https://www.okx.com";
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.timeoutMilliseconds = options.timeoutMilliseconds ?? 8_000;
    this.retries = options.retries ?? 2;
    this.gate = new RequestGate(options.minimumRequestIntervalMilliseconds ?? 60);
  }

  async getCandles(request: CandleRequest): Promise<Candle[]> {
    const limit = Math.max(1, Math.min(300, request.limit ?? 300));
    const path = request.history ? "/api/v5/market/history-candles" : "/api/v5/market/candles";
    const url = new URL(path, this.baseUrl);
    url.searchParams.set("instId", request.symbol);
    url.searchParams.set("bar", request.timeframe);
    url.searchParams.set("limit", String(limit));
    if (request.after !== undefined) url.searchParams.set("after", String(request.after));
    if (request.before !== undefined) url.searchParams.set("before", String(request.before));

    const payload = await this.request<OkxEnvelope<OkxCandleRow[]>>(url);
    if (payload.code !== "0") {
      throw new OkxPublicMarketError(`OKX public market error: ${payload.msg || payload.code}`, false);
    }
    return parseOkxCandles(request.symbol, request.timeframe, payload.data).slice(-limit);
  }

  private async request<T>(url: URL): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      await this.gate.wait();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMilliseconds);
      try {
        const response = await this.fetcher(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new OkxPublicMarketError(
            `OKX public market HTTP ${response.status}`,
            response.status === 429 || response.status >= 500,
            response.status,
          );
        }
        return (await response.json()) as T;
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof OkxPublicMarketError ? error.retryable : error instanceof TypeError || isAbortError(error);
        if (!retryable || attempt >= this.retries) throw normalizeError(error);
        await new Promise<void>((resolve) => setTimeout(resolve, retryDelay(attempt)));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw normalizeError(lastError);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function normalizeError(error: unknown): OkxPublicMarketError {
  if (error instanceof OkxPublicMarketError) return error;
  if (isAbortError(error)) return new OkxPublicMarketError("OKX public market request timed out", true);
  return new OkxPublicMarketError(
    error instanceof Error ? `OKX public market request failed: ${error.message}` : "OKX public market request failed",
    true,
  );
}
