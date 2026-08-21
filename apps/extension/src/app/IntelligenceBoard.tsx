import { BrainCircuit, Maximize2, Minimize2, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import type { SignalDocument, SignalState } from "@intelligence/contracts";
import { formatPrice } from "@/utils/format";

interface IntelligenceBoardProps {
  signal: SignalDocument | null;
  defaultCollapsed?: boolean;
}

const SIGNAL_LABELS: Record<SignalState, string> = {
  PASS: "PASS / 放弃",
  WAIT: "WAIT / 等待",
  WATCH_LONG: "WATCH LONG / 关注多头",
  WATCH_SHORT: "WATCH SHORT / 关注空头",
  LONG_READY: "LONG READY / 多头条件就绪",
  SHORT_READY: "SHORT READY / 空头条件就绪",
  LONG_ACTIVE: "LONG ACTIVE / 多头结构跟踪",
  SHORT_ACTIVE: "SHORT ACTIVE / 空头结构跟踪",
  INVALIDATED: "INVALIDATED / 结构失效",
};

function valueOrDash(value: number | null) {
  return value === null ? "—" : formatPrice(value);
}

function rangeOrDash(min: number | null, max: number | null) {
  return min === null || max === null ? "—" : `${formatPrice(min)} – ${formatPrice(max)}`;
}

function rrOrDash(value: number | null) {
  return value === null ? "—" : `1 : ${value.toFixed(2)}`;
}

export function IntelligenceBoard({ signal, defaultCollapsed = false }: IntelligenceBoardProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  useEffect(() => setCollapsed(defaultCollapsed), [defaultCollapsed]);

  if (!signal) {
    return (
      <section className="cv-intelligence-board is-loading" aria-live="polite">
        <BrainCircuit size={15} />
        <span>多周期分析暂不可用；主图仍可查看，系统不会据此产生模拟动作。</span>
      </section>
    );
  }

  const tone = signal.signal.includes("LONG")
    ? "is-long"
    : signal.signal.includes("SHORT")
      ? "is-short"
      : signal.signal === "PASS" || signal.signal === "INVALIDATED"
        ? "is-pass"
        : "is-wait";

  return (
    <section className={`cv-intelligence-board ${tone} ${collapsed ? "is-collapsed" : ""}`} aria-label="多周期缠论分析面板">
      <div className="cv-intelligence-head">
        <div>
          <BrainCircuit size={15} />
          <strong>多周期缠论分析</strong>
          <span>{signal.symbol}</span>
        </div>
        <div className="cv-intelligence-score">
          <span>SCORE</span>
          <strong>{signal.score}</strong>
        </div>
        <div className="cv-intelligence-state">
          <span>SIGNAL</span>
          <strong>{SIGNAL_LABELS[signal.signal]}</strong>
        </div>
        <button
          type="button"
          className="cv-icon-btn"
          onClick={() => setCollapsed((value) => !value)}
          title={collapsed ? "展开多周期分析" : "折叠多周期分析"}
        >
          {collapsed ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
        </button>
      </div>

      {!collapsed && <><div className="cv-timeframe-strip" aria-label="Multi-Timeframe">
        <span><b>1D</b>{signal.daily}</span>
        <span><b>4H</b>{signal.h4}</span>
        <span><b>1H</b>{signal.h1}</span>
        <span><b>30M</b>{signal.m30}</span>
        <span><b>15M</b>{signal.m15}</span>
        <span><b>市场</b>{signal.marketRegime}</span>
      </div>

      <div className="cv-trade-plan">
        <div><span>Entry</span><strong>{rangeOrDash(signal.entryMin, signal.entryMax)}</strong></div>
        <div><span>Stop</span><strong>{valueOrDash(signal.stop)}</strong></div>
        <div><span>TP1</span><strong>{valueOrDash(signal.tp1)}</strong><em>{rrOrDash(signal.rr1)}</em></div>
        <div><span>TP2</span><strong>{valueOrDash(signal.tp2)}</strong><em>{rrOrDash(signal.rr2)}</em></div>
      </div>

      <div className="cv-intelligence-waiting">
        <ShieldAlert size={14} />
        <div>
          <strong>{signal.waitingFor.length > 0 ? "Waiting For" : "结构说明"}</strong>
          <span>{signal.waitingFor.join("；") || signal.invalidation || "等待新的已确认结构。"}</span>
        </div>
      </div>

      <p className="cv-intelligence-disclaimer">
        仅为确定性结构分析与风险提示，不构成投资建议；不读取 API Key，不连接或操作 OKX 下单。
      </p>
      </>}
    </section>
  );
}
