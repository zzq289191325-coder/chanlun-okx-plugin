import type { ChanlunAnalysis } from "@/chanlun/types";
import type { WsStatus } from "@/okx/okxWs";
import { formatPrice } from "@/utils/format";
import { formatDateTime } from "@/utils/time";

interface StatusBarProps {
  analysis: ChanlunAnalysis | null;
  loadState: string;
  wsStatus: WsStatus;
  lastUpdated: number | null;
  error: string | null;
}

const directionLabel = {
  up: "上行",
  down: "下行",
  range: "震荡",
};

export function StatusBar({ analysis, loadState, wsStatus, lastUpdated, error }: StatusBarProps) {
  const zone = analysis?.recentZhongshu;
  const signal = analysis?.recentSignal;

  return (
    <div className="cv-status">
      <div>
        <span>方向</span>
        <strong>{analysis ? directionLabel[analysis.direction] : "-"}</strong>
      </div>
      <div>
        <span>最近中枢</span>
        <strong>{zone ? `${formatPrice(zone.low)} - ${formatPrice(zone.high)}` : "-"}</strong>
      </div>
      <div>
        <span>候选结构点</span>
        <strong>{signal ? `${signal.label} ${signal.score}` : "-"}</strong>
      </div>
      <div>
        <span>状态</span>
        <strong>{error ?? `${loadState}/${wsStatus}`}</strong>
      </div>
      <div>
        <span>更新时间</span>
        <strong>{lastUpdated ? formatDateTime(lastUpdated) : "-"}</strong>
      </div>
    </div>
  );
}
