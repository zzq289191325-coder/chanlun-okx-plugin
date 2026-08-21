import type { Candle, Interval } from "@/chanlun/types";
import { normalizeOkxCandle } from "./okxRest";

export type WsStatus = "idle" | "connecting" | "connected" | "reconnecting" | "closed" | "error";

interface OkxWsMessage {
  event?: string;
  arg?: {
    channel?: string;
    instId?: string;
  };
  data?: string[][];
  msg?: string;
}

interface OkxCandleWsClientOptions {
  instId: string;
  interval: Interval;
  onCandle: (candle: Candle) => void;
  onStatus: (status: WsStatus, detail?: string) => void;
}

const WS_URL = "wss://ws.okx.com:8443/ws/v5/business";

export class OkxCandleWsClient {
  private socket: WebSocket | null = null;
  private retryCount = 0;
  private reconnectTimer: number | null = null;
  private manuallyClosed = false;
  private readonly options: OkxCandleWsClientOptions;

  constructor(options: OkxCandleWsClientOptions) {
    this.options = options;
  }

  connect() {
    this.manuallyClosed = false;
    this.clearReconnectTimer();
    this.options.onStatus(this.retryCount > 0 ? "reconnecting" : "connecting");

    this.socket = new WebSocket(WS_URL);
    this.socket.addEventListener("open", () => {
      this.retryCount = 0;
      this.options.onStatus("connected");
      this.subscribe();
    });
    this.socket.addEventListener("message", (event) => this.handleMessage(event));
    this.socket.addEventListener("close", () => {
      if (this.manuallyClosed) {
        this.options.onStatus("closed");
        return;
      }
      this.scheduleReconnect();
    });
    this.socket.addEventListener("error", () => {
      this.options.onStatus("error", "WebSocket connection error");
    });
  }

  disconnect() {
    this.manuallyClosed = true;
    this.clearReconnectTimer();
    this.socket?.close();
    this.socket = null;
    this.options.onStatus("closed");
  }

  private subscribe() {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(
      JSON.stringify({
        op: "subscribe",
        args: [{ channel: `candle${this.options.interval}`, instId: this.options.instId }],
      }),
    );
  }

  private handleMessage(event: MessageEvent<string>) {
    const payload = JSON.parse(event.data) as OkxWsMessage;
    if (payload.event === "error") {
      this.options.onStatus("error", payload.msg || "OKX subscription error");
      return;
    }

    if (!payload.data?.length) return;
    for (const row of payload.data) {
      this.options.onCandle(normalizeOkxCandle(row));
    }
  }

  private scheduleReconnect() {
    this.retryCount += 1;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.retryCount, 5));
    this.options.onStatus("reconnecting", `retry in ${Math.round(delay / 1000)}s`);
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
