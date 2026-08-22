const OKX_PUBLIC_MARK_URL = "https://www.okx.com/api/v5/public/mark-price";

interface OkxMarkPriceRow {
  instId?: string;
  markPx?: string;
  ts?: string;
}

interface OkxMarkPriceEnvelope {
  code?: string;
  msg?: string;
  data?: OkxMarkPriceRow[];
}

export interface PublicMarkPrice {
  symbol: string;
  price: number;
  timestamp: number;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function publicMarkPriceUrl(symbol: string): URL {
  if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(symbol)) throw new Error("Invalid OKX public instrument ID");
  const url = new URL(OKX_PUBLIC_MARK_URL);
  url.searchParams.set("instType", "SWAP");
  url.searchParams.set("instId", symbol);
  return url;
}

export async function fetchPublicMarkPrice(symbol: string, request: FetchLike = fetch): Promise<PublicMarkPrice> {
  const response = await request(publicMarkPriceUrl(symbol), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`OKX public mark price HTTP ${response.status}`);
  const payload = await response.json() as OkxMarkPriceEnvelope;
  const row = payload.data?.[0];
  const price = Number(row?.markPx);
  const timestamp = Number(row?.ts);
  if (payload.code !== "0" || row?.instId !== symbol || !Number.isFinite(price) || price <= 0 || !Number.isFinite(timestamp)) {
    throw new Error(payload.msg || "OKX public mark price response is invalid");
  }
  return { symbol, price, timestamp };
}
