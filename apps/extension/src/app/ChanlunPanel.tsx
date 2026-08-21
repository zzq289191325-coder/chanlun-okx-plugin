import {
  ChevronDown,
  ChevronUp,
  LineChart,
  Magnet,
  Maximize2,
  Minimize2,
  Move,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { normalizeInstId, resolveOkxInstId } from "@/okx/symbolResolver";
import { useChanlunStore } from "@/store/useChanlunStore";
import type { Interval } from "@/chanlun/types";
import { ChartView, type ChartViewHandle } from "./ChartView";
import { IntelligenceBoard } from "./IntelligenceBoard";
import { SettingsModal } from "./SettingsModal";
import { StatusBar } from "./StatusBar";
import { Toolbar } from "./Toolbar";
import { WatchlistBar } from "./WatchlistBar";

interface ChanlunPanelProps {
  embedded?: boolean;
  attached?: boolean;
}

const SYNC_OKX_INTERVAL_EVENT = "chanlun:sync-okx-interval";

export function ChanlunPanel({ embedded = false, attached = false }: ChanlunPanelProps) {
  const {
    settings,
    candles,
    analysis,
    intelligence,
    loadState,
    wsStatus,
    error,
    lastUpdated,
    loadSettings,
    saveSettings,
    acknowledgeDisclaimer,
    resolveSymbolFromPage,
    loadInitialCandles,
    disconnectRealtime,
    selectWatchlistInstrument,
    addCurrentInstrumentToWatchlist,
    removeWatchlistInstrument,
    setSymbolMode,
    setVisible,
    toggleVisible,
    setCollapsed,
  } = useChanlunStore();
  const chartRef = useRef<ChartViewHandle | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pageInstId, setPageInstId] = useState("");
  const [position, setPosition] = useState(settings.panelPosition);
  const dragState = useRef<{ dx: number; dy: number } | null>(null);
  const draggable = !embedded && !attached;

  useEffect(() => {
    void (async () => {
      await loadSettings();
      setPageInstId(resolveOkxInstId() ?? "");
      await resolveSymbolFromPage();
      await loadInitialCandles();
    })();

    return () => disconnectRealtime();
  }, [disconnectRealtime, loadInitialCandles, loadSettings, resolveSymbolFromPage]);

  useEffect(() => {
    if (embedded) return;

    let stopped = false;
    let syncing = false;
    const syncPageSymbol = async () => {
      if (syncing) return;
      syncing = true;
      try {
        setPageInstId(resolveOkxInstId() ?? "");
        const changed = await resolveSymbolFromPage();
        if (changed && !stopped) await loadInitialCandles();
      } finally {
        syncing = false;
      }
    };

    const onRouteChange = () => {
      void syncPageSymbol();
    };
    const timer = window.setInterval(() => void syncPageSymbol(), 2_000);
    window.addEventListener("popstate", onRouteChange);
    window.addEventListener("hashchange", onRouteChange);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("popstate", onRouteChange);
      window.removeEventListener("hashchange", onRouteChange);
    };
  }, [embedded, loadInitialCandles, resolveSymbolFromPage]);

  useEffect(() => {
    setPosition(settings.panelPosition);
  }, [settings.panelPosition]);

  useEffect(() => {
    if (!attached) return;
    window.dispatchEvent(new CustomEvent(SYNC_OKX_INTERVAL_EVENT, { detail: { interval: settings.interval } }));
  }, [attached, settings.interval]);

  useEffect(() => {
    if (embedded) return;

    const toggle = () => {
      void toggleVisible();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.altKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        void toggleVisible();
      }
    };

    window.addEventListener("chanlun:toggle-panel", toggle);
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("chanlun:toggle-panel", toggle);
      window.removeEventListener("keydown", keydown);
    };
  }, [embedded, toggleVisible]);

  const updateInstId = async (value: string) => {
    await saveSettings({ instId: normalizeInstId(value) });
  };

  const updateInterval = async (interval: Interval) => {
    if (attached) {
      window.dispatchEvent(new CustomEvent(SYNC_OKX_INTERVAL_EVENT, { detail: { interval } }));
    }
    await saveSettings({ interval });
    await loadInitialCandles();
  };

  const selectWatchInstrument = async (instId: string) => {
    await selectWatchlistInstrument(instId);
    await loadInitialCandles();
  };

  const followPageInstrument = async () => {
    await setSymbolMode("page");
    await resolveSymbolFromPage();
    await loadInitialCandles();
  };

  const refresh = async () => {
    await loadInitialCandles();
  };

  const startDrag = (event: React.PointerEvent) => {
    if (!draggable) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      dx: event.clientX - position.x,
      dy: event.clientY - position.y,
    };
  };

  const moveDrag = (event: React.PointerEvent) => {
    if (!dragState.current) return;
    const next = {
      x: Math.max(8, event.clientX - dragState.current.dx),
      y: Math.max(8, event.clientY - dragState.current.dy),
    };
    setPosition(next);
  };

  const endDrag = () => {
    if (!dragState.current) return;
    dragState.current = null;
    void saveSettings({ panelPosition: position });
  };

  if (!embedded && !settings.panelVisible) {
    return (
      <button
        type="button"
        className={attached ? "cv-floating-button cv-floating-button-attached" : "cv-floating-button"}
        style={attached ? undefined : { transform: `translate(${position.x}px, ${position.y}px)` }}
        onClick={() => void setVisible(true)}
        title={attached ? "显示吸附图层" : "打开缠论面板"}
      >
        <LineChart size={20} />
      </button>
    );
  }

  const panelClassName = [
    "cv-panel",
    embedded ? "cv-panel-embedded" : "",
    attached ? "cv-panel-attached" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const watchlistDetachedFromNativeChart =
    attached && settings.symbolMode === "watchlist" && Boolean(pageInstId) && pageInstId !== settings.instId;

  return (
    <section
      className={panelClassName}
      style={embedded || attached ? undefined : { transform: `translate(${position.x}px, ${position.y}px)` }}
    >
      <header
        className="cv-panel-head"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="cv-title">
          {attached ? <Magnet size={15} /> : !embedded && <Move size={15} />}
          <strong>Chanlun OKX</strong>
          <span>{attached ? `吸附主图 / ${settings.instId || "未识别"}` : settings.instId || "未识别"}</span>
        </div>
        <div className="cv-head-actions">
          <button
            type="button"
            className="cv-icon-btn"
            onClick={() => void setCollapsed(!settings.collapsed)}
            title={settings.collapsed ? "展开" : "折叠"}
          >
            {settings.collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
          {!embedded && (
            <button
              type="button"
              className="cv-icon-btn"
              onClick={() => void setVisible(false)}
              title="关闭"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </header>

      {!settings.collapsed && (
        <>
          <Toolbar
            instId={settings.instId}
            interval={settings.interval}
            chartLayers={settings.chartLayers}
            wsStatus={wsStatus}
            onInstIdChange={(value) => void updateInstId(value)}
            onIntervalChange={(interval) => void updateInterval(interval)}
            onChartLayersChange={(chartLayers) => void saveSettings({ chartLayers })}
            onRefresh={() => void refresh()}
            onScreenshot={() => chartRef.current?.exportPng()}
            onOpenSettings={() => setSettingsOpen(true)}
          />
          <WatchlistBar
            instId={settings.instId}
            symbolMode={settings.symbolMode}
            watchlist={settings.watchlist}
            onSelect={(instId) => void selectWatchInstrument(instId)}
            onAddCurrent={() => void addCurrentInstrumentToWatchlist()}
            onRemove={(instId) => void removeWatchlistInstrument(instId)}
            onFollowPage={() => void followPageInstrument()}
          />
          {watchlistDetachedFromNativeChart && (
            <div className="cv-watchlist-detached-pill" aria-live="polite">
              <strong>自选模式</strong>
              <span>吸附暂停</span>
            </div>
          )}
          <div className="cv-chart-section">
            {loadState === "loading" && <div className="cv-loading">加载 K 线...</div>}
            {!watchlistDetachedFromNativeChart && (
              <ChartView
                ref={chartRef}
                candles={candles}
                analysis={analysis}
                chartLayers={settings.chartLayers}
                resetKey={`${settings.instId}:${settings.interval}`}
                attached={attached}
              />
            )}
          </div>
          <StatusBar
            analysis={analysis}
            loadState={loadState}
            wsStatus={wsStatus}
            lastUpdated={lastUpdated}
            error={error}
          />
          <IntelligenceBoard signal={intelligence?.analysis.signal ?? null} defaultCollapsed={attached} />
        </>
      )}

      {!settings.acknowledgedDisclaimer && (
        <div className="cv-modal-backdrop" role="dialog" aria-modal="true">
          <div className="cv-modal">
            <div className="cv-modal-icon">
              <Maximize2 size={18} />
              <Minimize2 size={18} />
            </div>
            <h2>免责声明</h2>
            <p>本插件仅用于结构可视化学习与复盘，不构成投资建议，不自动交易。</p>
            <button type="button" className="cv-primary-btn" onClick={() => void acknowledgeDisclaimer()}>
              我已了解
            </button>
          </div>
        </div>
      )}

      {settingsOpen && (
        <SettingsModal
          settings={settings}
          onClose={() => {
            setSettingsOpen(false);
            void refresh();
          }}
          onSave={(partial) => void saveSettings(partial)}
        />
      )}
    </section>
  );
}
