import { create } from "zustand";
import { analyzeChanlun } from "@/chanlun/analyze";
import type { Candle, ChanlunAnalysis, ChartLayerVisibility, Interval } from "@/chanlun/types";
import { loadIntelligence, type IntelligenceLoadResult } from "@/intelligence/intelligenceService";
import {
  buildIntelligenceResult,
  isIntelligenceTimeframe,
  toLegacyAnalysis,
} from "@/intelligence/signalAdapter";
import { fetchOkxCandles } from "@/okx/okxRest";
import { OkxCandleWsClient, type WsStatus } from "@/okx/okxWs";
import {
  extractOkxInstIdsFromPage,
  normalizeInstIdList,
  resolveOkxInstId,
} from "@/okx/symbolResolver";
import { uniqueByTs } from "@/utils/format";
import { logger } from "@/utils/logger";

export interface ChanlunSettings {
  schemaVersion: number;
  instId: string;
  symbolMode: "page" | "watchlist";
  watchlist: string[];
  interval: Interval;
  panelVisible: boolean;
  collapsed: boolean;
  acknowledgedDisclaimer: boolean;
  realtime: boolean;
  chartLayers: ChartLayerVisibility;
  panelPosition: {
    x: number;
    y: number;
  };
}

interface ChanlunState {
  settings: ChanlunSettings;
  candles: Candle[];
  analysis: ChanlunAnalysis | null;
  intelligence: IntelligenceLoadResult | null;
  loadState: "idle" | "loading" | "ready" | "error";
  wsStatus: WsStatus;
  error: string | null;
  lastUpdated: number | null;
  loadSettings: () => Promise<void>;
  saveSettings: (partial: Partial<ChanlunSettings>) => Promise<void>;
  acknowledgeDisclaimer: () => Promise<void>;
  resolveSymbolFromPage: () => Promise<boolean>;
  loadInitialCandles: () => Promise<void>;
  connectRealtime: () => void;
  disconnectRealtime: () => void;
  upsertCandle: (candle: Candle) => void;
  selectWatchlistInstrument: (instId: string) => Promise<void>;
  addCurrentInstrumentToWatchlist: () => Promise<void>;
  removeWatchlistInstrument: (instId: string) => Promise<void>;
  setSymbolMode: (mode: ChanlunSettings["symbolMode"]) => Promise<void>;
  setVisible: (visible: boolean) => Promise<void>;
  toggleVisible: () => Promise<void>;
  setCollapsed: (collapsed: boolean) => Promise<void>;
}

const STORAGE_KEY = "chanlunSettings";
const INTELLIGENCE_REFRESH_MS = 10 * 60_000;

const DEFAULT_CHART_LAYERS: ChartLayerVisibility = {
  showFractals: false,
  showStructures: true,
  showSignals: true,
  bareK: false,
};

const DEFAULT_WATCHLIST = ["GOOGL-USDT-SWAP", "INTC-USDT-SWAP", "MU-USDT-SWAP"];

const defaultSettings: ChanlunSettings = {
  schemaVersion: 11,
  instId: "",
  symbolMode: "page",
  watchlist: DEFAULT_WATCHLIST,
  interval: "30m",
  panelVisible: true,
  collapsed: false,
  acknowledgedDisclaimer: false,
  realtime: true,
  chartLayers: DEFAULT_CHART_LAYERS,
  panelPosition: { x: 24, y: 88 },
};

let wsClient: OkxCandleWsClient | null = null;
let loadRequestSeq = 0;
let intelligenceRequestAt = 0;

function hasChromeStorage() {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

function mergeSettings(partial: Partial<ChanlunSettings> | undefined): ChanlunSettings {
  const storedVersion = partial?.schemaVersion ?? 0;
  const watchlist = normalizeInstIdList([
    ...(storedVersion < 6 ? ["GOOGL-USDT-SWAP"] : []),
    ...(storedVersion < 8 ? ["INTC-USDT-SWAP"] : []),
    ...(storedVersion < 9 ? ["MU-USDT-SWAP"] : []),
    ...(partial?.watchlist ?? []),
  ]);
  return {
    ...defaultSettings,
    ...partial,
    schemaVersion: defaultSettings.schemaVersion,
    symbolMode: storedVersion < 7 ? "page" : (partial?.symbolMode ?? "page"),
    watchlist,
    panelVisible: storedVersion < 4 ? true : (partial?.panelVisible ?? true),
    collapsed: storedVersion < 4 ? false : (partial?.collapsed ?? false),
    chartLayers: {
      ...DEFAULT_CHART_LAYERS,
      ...(storedVersion >= 4 ? (partial?.chartLayers ?? {}) : {}),
    },
    panelPosition: {
      ...defaultSettings.panelPosition,
      ...(partial?.panelPosition ?? {}),
    },
  };
}

async function readSettings(): Promise<ChanlunSettings> {
  if (hasChromeStorage()) {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return mergeSettings(stored[STORAGE_KEY] as Partial<ChanlunSettings> | undefined);
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? mergeSettings(JSON.parse(raw) as Partial<ChanlunSettings>) : defaultSettings;
}

async function writeSettings(settings: ChanlunSettings) {
  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [STORAGE_KEY]: settings });
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function analyzeLegacy(candles: Candle[]) {
  const confirmed = candles.filter((candle) => candle.closed !== false);
  return confirmed.length >= 10 ? analyzeChanlun(confirmed) : null;
}

async function loadIntelligenceSafe(
  instId: string,
  currentInterval?: Interval,
  currentCandles?: Promise<Candle[]>,
) {
  try {
    intelligenceRequestAt = Date.now();
    return await loadIntelligence(instId, currentInterval, currentCandles);
  } catch (error) {
    logger.warn("多周期分析暂时不可用", error);
    return null;
  }
}

function sameItems(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function updateIntelligenceForClosedCandle(
  current: IntelligenceLoadResult | null,
  instId: string,
  interval: Interval,
  candles: Candle[],
): IntelligenceLoadResult | null {
  if (!current || !isIntelligenceTimeframe(interval)) return current;
  const nextCandles = { ...current.candles, [interval]: candles };
  return {
    candles: nextCandles,
    analysis: buildIntelligenceResult(instId, nextCandles),
    loadedAt: Date.now(),
  };
}

export const useChanlunStore = create<ChanlunState>((set, get) => ({
  settings: defaultSettings,
  candles: [],
  analysis: null,
  intelligence: null,
  loadState: "idle",
  wsStatus: "idle",
  error: null,
  lastUpdated: null,

  async loadSettings() {
    set({ settings: await readSettings() });
  },

  async saveSettings(partial) {
    const settings = mergeSettings({ ...get().settings, ...partial });
    set({ settings });
    await writeSettings(settings);
  },

  async acknowledgeDisclaimer() {
    await get().saveSettings({ acknowledgedDisclaimer: true });
  },

  async resolveSymbolFromPage() {
    const resolved = resolveOkxInstId();
    const current = get().settings;
    const watchlist = normalizeInstIdList([
      ...current.watchlist,
      ...extractOkxInstIdsFromPage(),
      resolved ?? "",
    ]);
    const nextInstId = current.symbolMode === "page" && resolved ? resolved : current.instId;
    const changedInstId = nextInstId !== current.instId;
    if (!changedInstId && sameItems(watchlist, current.watchlist)) return false;
    await get().saveSettings({ instId: nextInstId, watchlist });
    return changedInstId;
  },

  async loadInitialCandles() {
    const { instId, interval, realtime } = get().settings;
    const requestSeq = (loadRequestSeq += 1);
    if (!instId) {
      set({ loadState: "error", error: "未识别交易对，请确认当前页面为 OKX 合约交易页。" });
      return;
    }

    wsClient?.disconnect();
    set({ loadState: "loading", error: null, wsStatus: "idle" });
    try {
      const candlesRequest = fetchOkxCandles(instId, interval, 300);
      const [candles, intelligence] = await Promise.all([
        candlesRequest,
        loadIntelligenceSafe(instId, interval, candlesRequest),
      ]);
      if (requestSeq !== loadRequestSeq) return;
      const analysis = intelligence && isIntelligenceTimeframe(interval)
        ? toLegacyAnalysis(intelligence.analysis.snapshots[interval])
        : analyzeLegacy(candles);
      set({
        candles,
        analysis,
        intelligence,
        loadState: "ready",
        lastUpdated: Date.now(),
      });
      if (realtime) get().connectRealtime();
    } catch (error) {
      if (requestSeq !== loadRequestSeq) return;
      logger.error("K 线加载失败", error);
      set({
        loadState: "error",
        error: error instanceof Error ? error.message : "加载 OKX K 线失败",
      });
    }
  },

  connectRealtime() {
    const { instId, interval, realtime } = get().settings;
    if (!realtime || !instId) return;
    wsClient?.disconnect();
    wsClient = new OkxCandleWsClient({
      instId,
      interval,
      onStatus: (wsStatus, detail) => {
        set({ wsStatus, error: wsStatus === "error" ? detail ?? "WebSocket 错误" : get().error });
      },
      onCandle: (candle) => get().upsertCandle(candle),
    });
    wsClient.connect();
  },

  disconnectRealtime() {
    wsClient?.disconnect();
    wsClient = null;
  },

  upsertCandle(candle) {
    const now = Date.now();
    if (now - Math.max(get().intelligence?.loadedAt ?? 0, intelligenceRequestAt) > INTELLIGENCE_REFRESH_MS) {
      const requestedInstId = get().settings.instId;
      void loadIntelligenceSafe(requestedInstId).then((intelligence) => {
        if (!intelligence || get().settings.instId !== requestedInstId) return;
        const interval = get().settings.interval;
        set({
          intelligence,
          ...(isIntelligenceTimeframe(interval)
            ? { analysis: toLegacyAnalysis(intelligence.analysis.snapshots[interval]) }
            : {}),
        });
      });
    }

    const candles = uniqueByTs([...get().candles, candle]).slice(-300);
    let intelligence = get().intelligence;
    if (candle.closed === true) {
      try {
        intelligence = updateIntelligenceForClosedCandle(
          intelligence,
          get().settings.instId,
          get().settings.interval,
          candles,
        );
      } catch (error) {
        logger.warn("已收盘 K 线的结构更新失败", error);
      }
    }
    const interval = get().settings.interval;
    const analysis = intelligence && isIntelligenceTimeframe(interval)
      ? toLegacyAnalysis(intelligence.analysis.snapshots[interval])
      : analyzeLegacy(candles);
    set({ candles, analysis, intelligence, lastUpdated: now });
  },

  async selectWatchlistInstrument(instId) {
    const [normalized] = normalizeInstIdList([instId]);
    if (!normalized) return;
    await get().saveSettings({
      instId: normalized,
      symbolMode: "watchlist",
      watchlist: normalizeInstIdList([...get().settings.watchlist, normalized]),
    });
  },

  async addCurrentInstrumentToWatchlist() {
    const [normalized] = normalizeInstIdList([get().settings.instId]);
    if (!normalized) return;
    await get().saveSettings({
      watchlist: normalizeInstIdList([...get().settings.watchlist, normalized]),
    });
  },

  async removeWatchlistInstrument(instId) {
    const [normalized] = normalizeInstIdList([instId]);
    if (!normalized) return;
    await get().saveSettings({
      watchlist: get().settings.watchlist.filter((item) => item !== normalized),
    });
  },

  async setSymbolMode(mode) {
    await get().saveSettings({ symbolMode: mode });
  },

  async setVisible(visible) {
    await get().saveSettings({ panelVisible: visible });
  },

  async toggleVisible() {
    await get().setVisible(!get().settings.panelVisible);
  },

  async setCollapsed(collapsed) {
    await get().saveSettings({ collapsed });
  },
}));
