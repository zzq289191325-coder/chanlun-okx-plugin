import { Camera, Eye, EyeOff, Layers, RefreshCcw, Settings, Target, Wifi, WifiOff } from "lucide-react";
import type { ChartLayerVisibility, Interval } from "@/chanlun/types";
import type { WsStatus } from "@/okx/okxWs";

const intervals: Interval[] = ["1m", "5m", "15m", "30m", "1H", "4H", "1D"];

interface ToolbarProps {
  instId: string;
  interval: Interval;
  chartLayers: ChartLayerVisibility;
  wsStatus: WsStatus;
  onInstIdChange: (instId: string) => void;
  onIntervalChange: (interval: Interval) => void;
  onChartLayersChange: (chartLayers: ChartLayerVisibility) => void;
  onRefresh: () => void;
  onScreenshot: () => void;
  onOpenSettings: () => void;
}

export function Toolbar({
  instId,
  interval,
  chartLayers,
  wsStatus,
  onInstIdChange,
  onIntervalChange,
  onChartLayersChange,
  onRefresh,
  onScreenshot,
  onOpenSettings,
}: ToolbarProps) {
  const layerActive = (key: keyof Omit<ChartLayerVisibility, "bareK">) =>
    !chartLayers.bareK && chartLayers[key];
  const toggleLayer = (key: keyof Omit<ChartLayerVisibility, "bareK">) => {
    onChartLayersChange({
      ...chartLayers,
      bareK: false,
      [key]: chartLayers.bareK ? true : !chartLayers[key],
    });
  };
  const toggleBareK = () => {
    onChartLayersChange({
      ...chartLayers,
      bareK: !chartLayers.bareK,
    });
  };

  return (
    <div className="cv-toolbar">
      <input
        className="cv-symbol-input"
        value={instId}
        onChange={(event) => onInstIdChange(event.target.value.toUpperCase())}
        spellCheck={false}
        placeholder="BTC-USDT-SWAP"
        aria-label="OKX instId"
      />
      <div className="cv-segmented" aria-label="周期">
        {intervals.map((item) => (
          <button
            key={item}
            type="button"
            className={item === interval ? "is-active" : ""}
            onClick={() => onIntervalChange(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <button type="button" className="cv-icon-btn" onClick={onRefresh} title="刷新">
        <RefreshCcw size={15} />
      </button>
      <div className="cv-layer-controls" aria-label="图层显示">
        <button
          type="button"
          className={`cv-layer-toggle ${layerActive("showFractals") ? "is-active" : ""}`}
          onClick={() => toggleLayer("showFractals")}
          title="显示/隐藏顶底分型"
        >
          <Eye size={13} />
          <span>顶底</span>
        </button>
        <button
          type="button"
          className={`cv-layer-toggle ${layerActive("showStructures") ? "is-active" : ""}`}
          onClick={() => toggleLayer("showStructures")}
          title="显示/隐藏笔、线段、中枢"
        >
          <Layers size={13} />
          <span>结构</span>
        </button>
        <button
          type="button"
          className={`cv-layer-toggle ${layerActive("showSignals") ? "is-active" : ""}`}
          onClick={() => toggleLayer("showSignals")}
          title="显示/隐藏候选买卖点"
        >
          <Target size={13} />
          <span>点位</span>
        </button>
        <button
          type="button"
          className={`cv-layer-toggle cv-layer-bare ${chartLayers.bareK ? "is-active" : ""}`}
          onClick={toggleBareK}
          title="一键裸K"
        >
          <EyeOff size={13} />
          <span>裸K</span>
        </button>
      </div>
      <button type="button" className="cv-icon-btn" onClick={onScreenshot} title="导出截图">
        <Camera size={15} />
      </button>
      <button type="button" className="cv-icon-btn" onClick={onOpenSettings} title="设置">
        <Settings size={15} />
      </button>
      <span className={`cv-ws cv-ws-${wsStatus}`} title={`WebSocket: ${wsStatus}`}>
        {wsStatus === "connected" ? <Wifi size={14} /> : <WifiOff size={14} />}
      </span>
    </div>
  );
}
