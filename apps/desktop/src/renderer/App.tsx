import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, Archive, ArrowDownRight, ArrowUpRight, BarChart3, BookOpenCheck, Check, ChevronRight,
  CircleGauge, Clock3, Database, FlaskConical, History, Layers3, LoaderCircle, LockKeyhole, Moon,
  OctagonAlert, Play, RefreshCw, Save, Settings2, ShieldCheck, Sparkles, Sun, WalletCards, X,
} from "lucide-react";
import type {
  CandlePoint, DesktopActionResult, DesktopMode, DesktopSettings, NavigationPage, PaperAccountId, PaperOrderPreviewDto,
  ResearchWorkspace, TimeframeSummary,
} from "../shared/types.js";
import { markerGlyph, markerHorizontalOffset, markerPriceOnCandle } from "./chartMarkerGeometry.js";
import { positionDirection, summarizePositions } from "./positionPresentation.js";
import { AdaptiveLearningPage } from "./AdaptiveLearningPage.js";

const nav = [
  [CircleGauge, "总览", "overview"],
  [Layers3, "多周期结构", "structure"],
  [Sparkles, "候选机会", "opportunities"],
  [WalletCards, "模拟账户", "paper"],
  [BarChart3, "历史回测", "backtests"],
  [FlaskConical, "策略实验室", "laboratory"],
  [Activity, "自适应学习", "learning"],
  [BookOpenCheck, "深度复盘", "review"],
  [Database, "数据管理", "data"],
  [Settings2, "系统设置", "settings"],
] as const;

const pageCopy: Record<NavigationPage, { eyebrow: string; title: string; description: string }> = {
  overview: { eyebrow: "研究总览", title: "结构先于观点，风控先于订单。", description: "本地历史行情、点时审计与 PAPER 账户的统一工作台" },
  structure: { eyebrow: "市场结构", title: "多周期结构", description: "仅使用本地数据库中已经收盘的 K 线，比较 1D / 4H / 1H / 30m / 15m" },
  opportunities: { eyebrow: "研究标签", title: "候选机会", description: "候选1/2/3买卖仅作为研究标签，确认时间之前不可见" },
  paper: { eyebrow: "本地模拟", title: "模拟账户", description: "100% 本地 PAPER 账本；预览后必须再次确认，不连接 OKX 账户" },
  backtests: { eyebrow: "离线研究", title: "历史回测", description: "逐根 K 线推进、下一根 K 线开盘成交并保存可重复性信息" },
  laboratory: { eyebrow: "策略研究", title: "策略实验室", description: "参数敏感性实验只产生候选结论，不自动晋级或连接实盘" },
  learning: { eyebrow: "本地机器学习", title: "自适应行情学习", description: "基于点时可见数据训练挑战者模型；样本外验证通过前不晋级、不驱动本地 PAPER" },
  review: { eyebrow: "决策审计", title: "深度复盘", description: "分离程序错误、策略缺陷与正常试错，复盘笔记保存在本地" },
  data: { eyebrow: "本地仓库", title: "数据管理", description: "公共行情增量更新、完整性检查和 SQLite 一致性备份" },
  settings: { eyebrow: "研究边界", title: "系统设置", description: "资金、成本与风控参数保存在本机；DEMO / LIVE 始终锁定" },
};

const fmt = (value: number | null | undefined, digits = 2) => value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const dateTime = (value: number | null | undefined) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
const shortDate = (value: number | null | undefined) => value ? new Date(value).toLocaleDateString("zh-CN") : "—";
const directionLabel = (value: TimeframeSummary["direction"]) => ({ up: "偏强", down: "偏弱", range: "盘整", insufficient: "数据不足" })[value];
const dueLabel = (value: number | null) => value === null ? "不自动开仓" : value <= Date.now() ? "等待下一次检查" : `${Math.max(1, Math.ceil((value - Date.now()) / 60_000))} 分钟内`;

interface ChartMarker {
  id: string;
  time: number;
  price: number;
  side: "buy" | "sell";
  label: string;
  source: string;
  confirmedAt?: number | null;
}

function chartMarkers(workspace: ResearchWorkspace): ChartMarker[] {
  const candidates = workspace.candidates.map((item): ChartMarker => ({
    id: `signal:${item.signalId}`,
    time: item.locationTime,
    price: item.price,
    side: item.side === "long" ? "buy" : "sell",
    label: item.label,
    source: `${item.timeframe} 已确认候选`,
    confirmedAt: item.confirmedAt,
  }));
  const paperOrders = workspace.paperOrders.filter((item) => item.symbol === workspace.selectedSymbol).map((item): ChartMarker => ({
    id: `paper:${item.orderId}`,
    time: item.createdAt,
    price: Number(item.price),
    side: item.positionSide === "long" ? "buy" : "sell",
    label: item.positionSide === "long" ? "PAPER开多" : "PAPER开空",
    source: "本地模拟成交",
  }));
  const backtestEntries = workspace.reviewTrades.filter((item) => item.symbol === workspace.selectedSymbol).map((item): ChartMarker => ({
    id: `backtest:${item.tradeId}`,
    time: item.entryTime,
    price: item.entryPrice,
    side: item.side === "long" ? "buy" : "sell",
    label: item.candidateLabel ?? "回测入场",
    source: "历史回测入场",
    confirmedAt: item.confirmedAt,
  }));
  return [...candidates, ...paperOrders, ...backtestEntries].filter((item) => Number.isFinite(item.price) && item.price > 0).slice(0, 80);
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="empty"><span>EMPTY STATE</span><strong>{title}</strong><p>{detail}</p></div>;
}

function LineChart({ candles, label, markers = [] }: { candles: readonly CandlePoint[]; label: string; markers?: readonly ChartMarker[] }) {
  const geometry = useMemo(() => {
    const visible = candles.slice(-80);
    if (visible.length < 2) return null;
    const firstTime = visible[0]!.openTime;
    const lastTime = visible.at(-1)!.closeTime;
    const visibleMarkers = markers.filter((item) => item.time >= firstTime && item.time <= lastTime);
    const low = Math.min(...visible.map((item) => item.low));
    const high = Math.max(...visible.map((item) => item.high));
    const spread = Math.max(high - low, Math.abs(high) * 0.002, 1e-9);
    const y = (value: number) => 250 - ((value - low) / spread) * 190;
    const step = 900 / visible.length;
    const candleWidth = Math.max(2.4, Math.min(7.5, step * 0.58));
    const markerPositions = visibleMarkers.map((marker, markerIndex) => {
      let candleIndex = visible.findIndex((item) => marker.time >= item.openTime && marker.time <= item.closeTime);
      if (candleIndex < 0) candleIndex = visible.reduce((best, item, index) => Math.abs(item.openTime - marker.time) < Math.abs(visible[best]!.openTime - marker.time) ? index : best, 0);
      const candle = visible[candleIndex]!;
      const pointX = (candleIndex + .5) * step;
      const sameSideBefore = visibleMarkers.slice(0, markerIndex).filter((item) => item.side === marker.side && item.time >= candle.openTime && item.time <= candle.closeTime).length;
      const placement = markerPriceOnCandle(marker.price, marker.side, candle);
      const anchorY = y(placement.displayPrice);
      const markerX = pointX + markerHorizontalOffset(sameSideBefore);
      return { ...marker, pointX, markerX, anchorY, markerY: anchorY, displayPrice: placement.displayPrice, adjusted: placement.adjusted };
    });
    return { low, high, visible, y, step, candleWidth, markerPositions, last: visible.at(-1)!.close };
  }, [candles, markers]);
  if (!geometry) return <Empty title="暂无可绘制行情" detail="至少需要两根已收盘 K 线。可在数据管理中执行公共行情增量更新。"/>;
  return <div className="market-chart" aria-label={`${label} 已收盘K线走势`}>
    <div className="chart-axis"><span>{fmt(geometry.high)}</span><span>{fmt((geometry.high + geometry.low) / 2)}</span><span>{fmt(geometry.low)}</span></div>
    <svg viewBox="0 0 900 300" preserveAspectRatio="none">
      {geometry.visible.map((candle, index) => {
        const x = (index + .5) * geometry.step;
        const openY = geometry.y(candle.open);
        const closeY = geometry.y(candle.close);
        const rising = candle.close >= candle.open;
        return <g className={`candle ${rising ? "rising" : "falling"}`} key={candle.openTime}>
          <line className="candle-wick" x1={x} x2={x} y1={geometry.y(candle.high)} y2={geometry.y(candle.low)}/>
          <rect className="candle-body" x={x - geometry.candleWidth / 2} y={Math.min(openY, closeY)} width={geometry.candleWidth} height={Math.max(1.4, Math.abs(closeY - openY))}/>
        </g>;
      })}
      {geometry.markerPositions.map((marker) => <g className={`trade-marker ${marker.side}`} data-marker-side={marker.side} data-marker-price={marker.price} data-display-price={marker.displayPrice} data-adjusted={marker.adjusted} key={marker.id}>
        <title>{`${markerGlyph(marker.side)} ${marker.side === "buy" ? "买入位置" : "卖出位置"} · ${marker.label} · ${marker.source} · ${dateTime(marker.time)}${marker.confirmedAt ? ` · 确认 ${dateTime(marker.confirmedAt)}` : ""} · 记录价 ${fmt(marker.price, 4)}${marker.adjusted ? ` · 旧记录价超出该K线，已按${marker.side === "buy" ? "下沿" : "上沿"}定位` : ""}`}</title>
        {marker.markerX !== marker.pointX && <line className="marker-guide" x1={marker.pointX} x2={marker.markerX} y1={marker.anchorY} y2={marker.markerY}/>} 
        <line className="marker-price-tick" x1={marker.pointX - 5} x2={marker.pointX + 5} y1={marker.anchorY} y2={marker.anchorY}/>
        <circle className="marker-dot" cx={marker.markerX} cy={marker.markerY} r="10"/>
        <text className="marker-letter" x={marker.markerX} y={marker.markerY + 3.6} textAnchor="middle">{markerGlyph(marker.side)}</text>
      </g>)}
    </svg>
    <div className="chart-current"><span>最近收盘</span><strong>{fmt(geometry.last, 4)}</strong></div>
    <div className="chart-legend"><span className="buy"><b>B</b> 买入位置</span><span className="sell"><b>S</b> 卖出位置</span><span className="legend-note">悬停标记查看来源与时间</span></div>
    <div className="chart-range"><span>{dateTime(geometry.visible[0]?.openTime)}</span><span>{dateTime(geometry.visible.at(-1)?.closeTime)}</span></div>
  </div>;
}

function Metrics({ workspace }: { workspace: ResearchWorkspace }) {
  const latest = workspace.backtests[0];
  return <section className="metrics">
    <article><span>双账户总权益</span><strong>{fmt(Number(workspace.snapshot.equity))} <em>U</em></strong><small>激进短线 + 基本面长线</small></article>
    <article><span>合计可用资金</span><strong>{fmt(Number(workspace.snapshot.available))} <em>U</em></strong><small>{workspace.snapshot.positionCount} 个独立策略仓位</small></article>
    <article><span>历史 K 线</span><strong>{workspace.snapshot.database.candleCount.toLocaleString()}</strong><small>SQLite schema V{workspace.snapshot.database.version} · {workspace.snapshot.database.integrity}</small></article>
    <article><span>最近回测</span><strong>{latest ? `${fmt(latest.totalReturnPercent)}%` : "—"}</strong><small className={latest?.reliability.length ? "warning" : ""}>{latest ? `${latest.tradeCount} 笔 · ${latest.reliability[0] ?? "待复核"}` : "尚无回测结果"}</small></article>
  </section>;
}

function OverviewPage({ workspace, go, openPaperAccount }: { workspace: ResearchWorkspace; go: (page: NavigationPage) => void; openPaperAccount: (accountId: PaperAccountId) => void }) {
  const execution = workspace.timeframes.find((item) => item.timeframe === "15m") ?? workspace.timeframes[0];
  const markers = chartMarkers(workspace);
  const positions = workspace.snapshot.positions;
  const positionSummary = summarizePositions(positions);
  return <>
    <Metrics workspace={workspace}/>
    <section className="overview-grid">
      <div className="primary-surface">
        <div className="sectionhead"><div><span className="kicker">MARKET STRUCTURE</span><h2>{workspace.selectedSymbol} · 已收盘行情</h2></div><span className="source-pill">本地数据库</span></div>
        <LineChart candles={execution?.candles ?? []} label={`${workspace.selectedSymbol} ${execution?.timeframe ?? ""}`} markers={markers}/>
        <div className="timeframe-strip">{workspace.timeframes.map((item) => <button key={item.timeframe} onClick={() => go("structure")}><span>{item.timeframe}</span><strong className={item.direction}>{directionLabel(item.direction)}</strong><small>{fmt(item.changePercent)}%</small></button>)}</div>
      </div>
      <aside className="inspector overview-positions-panel">
        <div className="inspector-title"><WalletCards size={19}/><div><span>OPEN POSITIONS</span><h2>当前开仓 · {positions.length}</h2></div><span className={`market-live ${workspace.snapshot.market.connected ? "connected" : "stale"}`}><i/>{workspace.snapshot.market.connected ? "实时" : "暂缓"}</span></div>
        <div className="overview-position-summary">
          <div><span>本地 PAPER</span><strong>{positionSummary.longCount} 多 / {positionSummary.shortCount} 空</strong></div>
          <div><span>未实现盈亏</span><strong className={positionSummary.unrealizedPnl >= 0 ? "positive" : "negative"}>{positionSummary.unrealizedPnl >= 0 ? "+" : ""}{fmt(positionSummary.unrealizedPnl)} U</strong></div>
        </div>
        <div className="overview-account-list">{workspace.snapshot.paperAccounts.map((account) => <section className={`overview-account ${account.accountId === "paper-aggressive" ? "aggressive" : "fundamental"}`} key={account.accountId}>
          <button className="overview-account-head" onClick={() => openPaperAccount(account.accountId)}><span><strong>{account.name}</strong><small>{account.style}</small></span><span><b>{fmt(Number(account.equity))}U</b><small>{account.positionCount} 仓</small></span></button>
          {account.automaticPaperEntry && <div className={`frequency-line ${account.frequencyStatus}`}><span>自动试错 {account.tradesLastHour}/1 单 · 最近1小时</span><strong>{account.frequencyStatus === "on_target" ? "达标" : dueLabel(account.nextEntryDueAt)}</strong></div>}
          {account.positions.length === 0 ? <button className="account-empty-position" onClick={() => openPaperAccount(account.accountId)}>空仓 · 打开{account.name}账本</button> : <div className="overview-position-list">{account.positions.map((position) => {
            const direction = positionDirection(position.side);
            const pnl = Number(position.unrealizedPnl);
            return <button className={`overview-position-card ${direction.tone}`} key={`${account.accountId}:${position.symbol}`} data-position-symbol={position.symbol} aria-label={`查看 ${account.name} ${position.symbol} ${direction.label}仓位`} onClick={() => openPaperAccount(account.accountId)}>
              <span className={`overview-position-glyph ${direction.tone}`}>{direction.glyph}</span><span className="overview-position-copy"><span className="overview-position-head"><strong>{position.symbol}</strong><em className={direction.tone}>{direction.label}</em></span><span className="overview-position-grid"><span><small>数量</small><b>{position.quantity}</b></span><span><small>均价</small><b>{fmt(Number(position.averagePrice), 4)}</b></span><span><small>标记价</small><b>{fmt(Number(position.markPrice), 4)}</b></span><span><small>未实现</small><b className={pnl >= 0 ? "positive" : "negative"}>{pnl >= 0 ? "+" : ""}{fmt(pnl, 4)}U</b></span></span></span><ChevronRight className="overview-position-chevron" size={15}/>
            </button>;
          })}</div>}
        </section>)}</div>
        <div className="overview-market-time"><span>OKX 公共标记价格 · 每 2 秒更新</span><strong>{workspace.snapshot.market.updatedAt ? new Date(workspace.snapshot.market.updatedAt).toLocaleTimeString("zh-CN", { hour12: false }) : "等待行情"}</strong></div>
        <div className="overview-safety-strip"><ShieldCheck size={14}/><span>仅本地模拟</span><b>外部订单禁用</b><em>1× · ≤ {workspace.settings.maximumOrderNotional}U</em></div>
        <button className="primary-action" onClick={() => openPaperAccount("paper-aggressive")}><Activity size={16}/> 管理双策略模拟仓</button>
        <button className="secondary-action" onClick={() => go("opportunities")}><Sparkles size={16}/> 查看候选研究标签</button>
      </aside>
    </section>
  </>;
}

function StructurePage({ workspace }: { workspace: ResearchWorkspace }) {
  const [timeframe, setTimeframe] = useState("30m");
  const current = workspace.timeframes.find((item) => item.timeframe === timeframe) ?? workspace.timeframes[0];
  const markers = chartMarkers(workspace);
  return <div className="page-stack">
    <div className="timeframe-summary">{workspace.timeframes.map((item) => <button key={item.timeframe} className={item.timeframe === current?.timeframe ? "selected" : ""} onClick={() => setTimeframe(item.timeframe)}><span>{item.timeframe}</span><strong className={item.direction}>{directionLabel(item.direction)}</strong><small>{item.candleCount} 根 · 未收盘 {item.openCandleCount}</small></button>)}</div>
    <section className="split-workspace">
      <div className="primary-surface"><div className="sectionhead"><div><span className="kicker">{current?.timeframe} STRUCTURE</span><h2>{workspace.selectedSymbol}</h2></div><span className="source-pill">仅已收盘K线</span></div><LineChart candles={current?.candles ?? []} label={`${workspace.selectedSymbol} ${current?.timeframe}`} markers={markers}/></div>
      <aside className="inspector"><div className="inspector-title"><Layers3 size={19}/><div><span>POINT-IN-TIME</span><h2>当前周期摘要</h2></div></div><dl className="key-values">
        <div><dt>方向</dt><dd className={current?.direction}>{current ? directionLabel(current.direction) : "—"}</dd></div>
        <div><dt>最近收盘</dt><dd>{fmt(current?.lastClose, 4)}</dd></div><div><dt>MA40</dt><dd>{fmt(current?.ma40, 4)}</dd></div>
        <div><dt>区间变化</dt><dd>{fmt(current?.changePercent)}%</dd></div><div><dt>候选标签</dt><dd>{current?.candidateCount ?? 0}</dd></div>
        <div><dt>数据截止</dt><dd>{dateTime(current?.lastCloseTime)}</dd></div>
      </dl><p className="research-note">方向仅为 MA40 与收盘价的结构摘要，不是买卖建议。缠论候选点以 confirmedAt 为可见时点。</p></aside>
    </section>
  </div>;
}

function OpportunitiesPage({ workspace, openPaper }: { workspace: ResearchWorkspace; openPaper: (signalId: string) => void }) {
  const [side, setSide] = useState<"all" | "long" | "short">("all");
  const visible = workspace.candidates.filter((item) => side === "all" || item.side === side);
  return <div className="page-stack">
    <div className="toolbar"><div className="segmented">{[["all", "全部"], ["long", "候选买"], ["short", "候选卖"]].map(([value, label]) => <button key={value} className={side === value ? "selected" : ""} onClick={() => setSide(value as typeof side)}>{label}</button>)}</div><span className="toolbar-note">{visible.length} 条已确认研究标签</span></div>
    {visible.length === 0 ? <Empty title="当前没有已确认候选点" detail="候选点只会在 confirmedAt 到达后写入本地数据库。可先运行历史回测生成研究样本。"/> : <div className="table-wrap"><table><thead><tr><th>标签</th><th>方向</th><th>周期</th><th>位置时间</th><th>确认时间</th><th>价格</th><th>评分</th><th>行情阶段</th><th></th></tr></thead><tbody>{visible.map((item) => <tr key={item.signalId}><td><strong>{item.label}</strong><small>{item.reason}</small></td><td><span className={`side ${item.side}`}>{item.side === "long" ? "候选买" : "候选卖"}</span></td><td>{item.timeframe}</td><td>{dateTime(item.locationTime)}</td><td>{dateTime(item.confirmedAt)}</td><td>{fmt(item.price, 4)}</td><td>{fmt(item.score)}</td><td>{item.marketRegime ?? "—"}</td><td><button className="table-action" onClick={() => openPaper(item.signalId)}>PAPER预览</button></td></tr>)}</tbody></table></div>}
  </div>;
}

function PaperPage({ workspace, accountId, candidateId, preview, onAccountChange, onPreview, onConfirm, onReset, onClose, busy }: {
  workspace: ResearchWorkspace; accountId: PaperAccountId; candidateId: string | null; preview: PaperOrderPreviewDto | null; onAccountChange: (accountId: PaperAccountId) => void; onPreview: (accountId: PaperAccountId, side: "long" | "short", notional: number) => void; onConfirm: () => void; onReset: (accountId: PaperAccountId) => void; onClose: (accountId: PaperAccountId, symbol: string) => void; busy: boolean;
}) {
  const [positionSide, setPositionSide] = useState<"long" | "short">("short");
  const [notional, setNotional] = useState(100);
  const account = workspace.snapshot.paperAccounts.find((item) => item.accountId === accountId) ?? workspace.snapshot.paperAccounts[0]!;
  const candidate = workspace.candidates.find((item) => item.signalId === candidateId);
  const orders = workspace.paperOrders.filter((order) => order.accountId === account.accountId);
  useEffect(() => { if (!account.allowedSides.includes(positionSide)) setPositionSide(account.allowedSides[0] ?? "long"); }, [account, positionSide]);
  return <div className="page-stack">
    <div className="paper-account-switch">{workspace.snapshot.paperAccounts.map((item) => <button data-paper-account={item.accountId} className={item.accountId === account.accountId ? "selected" : ""} key={item.accountId} onClick={() => onAccountChange(item.accountId)}><span>{item.name}</span><strong>{fmt(Number(item.equity))} U</strong><small>{item.style} · 初始 {item.initialCapital}U</small></button>)}</div>
    <section className="paper-balance"><div><span>{account.name}权益</span><strong>{fmt(Number(account.equity))} U</strong></div><div><span>可用资金</span><strong>{fmt(Number(account.available))} U</strong></div><div><span>当前仓位</span><strong>{account.positionCount}</strong></div><div><span>{account.automaticPaperEntry ? "小时开仓频率" : "持仓风格"}</span><strong className={account.frequencyStatus === "due" ? "warning" : "positive"}>{account.automaticPaperEntry ? `${account.tradesLastHour}/1 单` : "长线"}</strong></div><button className="secondary-action compact" onClick={() => onReset(account.accountId)} disabled={busy}><RefreshCw size={15}/> 重置此账本为 {account.initialCapital}U</button></section>
    <div className={`account-risk-band ${account.accountId === "paper-aggressive" ? "aggressive" : "fundamental"}`}><div><span>{account.style}</span><strong>{account.automaticPaperEntry ? `软件运行时每小时至少 1 笔本地试错 · ${dueLabel(account.nextEntryDueAt)}` : "不自动开仓 · 仅做基本面长线研究"}</strong></div><dl><div><dt>单笔上限</dt><dd>{account.maximumOrderNotional}U</dd></div><div><dt>总敞口</dt><dd>{account.maximumExposure}U</dd></div><div><dt>最低盈亏比</dt><dd>{account.minimumRiskReward}:1</dd></div><div><dt>允许方向</dt><dd>{account.allowedSides.map((side) => side === "long" ? "多" : "空").join("/")}</dd></div></dl></div>
    <section className="split-workspace">
      <div className="primary-surface form-surface"><div className="sectionhead"><div><span className="kicker">ORDER PREVIEW</span><h2>{account.name} · 创建本地模拟预览</h2></div><span className="paper-badge">PAPER ONLY</span></div>
        {candidate && <div className="candidate-context"><Sparkles size={16}/><div><strong>{candidate.label} · {candidate.timeframe}</strong><span>确认于 {dateTime(candidate.confirmedAt)} · {candidate.reason}</span></div></div>}
        <div className="order-grid"><label><span>方向</span><div className="segmented full"><button disabled={!account.allowedSides.includes("long")} className={positionSide === "long" ? "selected" : ""} onClick={() => setPositionSide("long")}><ArrowUpRight size={15}/> 开多研究</button><button disabled={!account.allowedSides.includes("short")} className={positionSide === "short" ? "selected short" : ""} onClick={() => setPositionSide("short")}><ArrowDownRight size={15}/> 开空研究</button></div></label><label><span>名义金额（U）</span><input type="number" min="1" max={account.maximumOrderNotional} value={notional} onChange={(event) => setNotional(Number(event.target.value))}/><small>单笔上限 {account.maximumOrderNotional}U，总敞口 {account.maximumExposure}U，杠杆固定 1×</small></label></div>
        <button className="primary-action" disabled={busy} onClick={() => onPreview(account.accountId, positionSide, notional)}>{busy ? <LoaderCircle className="spin" size={16}/> : <Play size={16}/>} 生成模拟订单预览</button>
        {preview && <div className={`preview-box ${preview.allowed ? "allowed" : "blocked"}`}><div className="preview-head"><div><span>预览编号</span><strong>{preview.previewId.slice(0, 12)}</strong></div><div><span>参考价 / 数量</span><strong>{fmt(Number(preview.referencePrice), 4)} / {preview.quantity}</strong></div><div><span>费用 + 滑点</span><strong>{fmt(Number(preview.estimatedFee) + Number(preview.estimatedSlippage), 4)}U</strong></div></div>{preview.checks.map((check) => <div className="preview-check" key={check.rule}>{check.allowed ? <Check size={14}/> : <X size={14}/>}<span>{check.message}</span></div>)}<button className="confirm-action" disabled={!preview.allowed || busy} onClick={onConfirm}><ShieldCheck size={16}/> 再次确认并写入本地 PAPER 账本</button></div>}
      </div>
      <aside className="inspector"><div className="inspector-title"><WalletCards size={19}/><div><span>OPEN POSITIONS</span><h2>{account.name}仓位</h2></div></div>{account.positions.length === 0 ? <p className="muted-copy">此策略账本当前空仓。</p> : <div className="position-list">{account.positions.map((position) => <article key={`${account.accountId}:${position.symbol}`}><div><strong>{position.symbol}</strong><span className={`side ${position.side}`}>{position.side === "short" ? "空" : "多"}</span></div><dl><div><dt>数量</dt><dd>{position.quantity}</dd></div><div><dt>均价</dt><dd>{fmt(Number(position.averagePrice), 4)}</dd></div><div><dt>未实现</dt><dd className={Number(position.unrealizedPnl) >= 0 ? "positive" : "negative"}>{fmt(Number(position.unrealizedPnl), 4)}U</dd></div></dl><button className="table-action" onClick={() => onClose(account.accountId, position.symbol)}>本地平仓</button></article>)}</div>}</aside>
    </section>
    <div className="table-wrap"><table><thead><tr><th>时间</th><th>类型</th><th>标的</th><th>方向</th><th>数量</th><th>成交价</th><th>依据</th><th>状态</th></tr></thead><tbody>{orders.length ? orders.map((order) => <tr key={order.orderId}><td>{dateTime(order.createdAt)}</td><td>{order.reduceOnly ? "平仓" : "开仓"}</td><td>{order.symbol}</td><td>{order.positionSide}</td><td>{order.quantity}</td><td>{fmt(Number(order.price), 4)}</td><td>{order.candidateLabel ?? "—"}</td><td><span className="status success">{order.status}</span></td></tr>) : <tr><td colSpan={8}>此策略账本暂无本地模拟成交</td></tr>}</tbody></table></div>
  </div>;
}

function BacktestsPage({ workspace, run, busy }: { workspace: ResearchWorkspace; run: () => void; busy: boolean }) {
  return <div className="page-stack"><div className="toolbar"><div><strong>{workspace.selectedSymbol}</strong><span className="toolbar-note"> · 使用默认点时策略参数</span></div><button className="primary-action inline" onClick={run} disabled={busy}>{busy ? <LoaderCircle className="spin" size={16}/> : <Play size={16}/>} 运行本地回测</button></div>
    {workspace.backtests.length === 0 ? <Empty title="尚无回测批次" detail="运行后将保存参数、Git commit、数据哈希、算法版本和可靠性提示。"/> : <div className="run-list">{workspace.backtests.map((item) => <article key={item.runId}><header><div><span className={`status ${item.status === "success" ? "success" : "warning"}`}>{item.status}</span><strong>{item.name}</strong></div><time>{dateTime(item.startedAt)}</time></header><div className="run-metrics"><div><span>收益率</span><strong>{fmt(item.totalReturnPercent)}%</strong></div><div><span>最大回撤</span><strong>{fmt(item.maximumDrawdownPercent)}%</strong></div><div><span>胜率</span><strong>{fmt(item.winRatePercent)}%</strong></div><div><span>Profit Factor</span><strong>{fmt(item.profitFactor)}</strong></div><div><span>交易次数</span><strong>{item.tradeCount}</strong></div></div><footer><span>{shortDate(item.dataStart)} — {shortDate(item.dataEnd)}</span><span>{item.strategyVersion}</span></footer>{item.reliability.length > 0 && <div className="reliability"><OctagonAlert size={15}/>{item.reliability.join("；")}</div>}</article>)}</div>}
  </div>;
}

function LaboratoryPage({ workspace, run, busy }: { workspace: ResearchWorkspace; run: () => void; busy: boolean }) {
  return <div className="page-stack"><div className="strategy-panels">{workspace.strategies.map((strategy, index) => <article key={strategy.strategyId}><div className="strategy-letter">{String.fromCharCode(65 + index)}</div><div className="strategy-copy"><span>{strategy.style}</span><h2>{strategy.name}</h2><p>{strategy.description}</p><div className="parameter-list">{Object.entries(strategy.config).map(([key, value]) => <span key={key}>{key}: <strong>{String(value)}</strong></span>)}</div></div><div className="strategy-status"><span className={`status ${strategy.status === "PAPER" ? "success" : "warning"}`}>{strategy.status ?? "UNVERSIONED"}</span><small>v{strategy.version ?? "—"}</small></div></article>)}</div>
    <section className="experiment-panel"><div><span className="kicker">CONTROLLED EXPERIMENT</span><h2>参数敏感性研究</h2><p>调用本地逐根 K 线回测及 ±10% 参数敏感性检查。结果不会自动替换当前策略，也不会晋级到 DEMO / LIVE。</p></div><button className="primary-action inline" onClick={run} disabled={busy}>{busy ? <LoaderCircle className="spin" size={16}/> : <FlaskConical size={16}/>} 运行受控实验</button></section>
    <div className="table-wrap"><table><thead><tr><th>实验时间</th><th>策略</th><th>方法</th><th>试验数</th><th>通过数</th><th>状态</th></tr></thead><tbody>{workspace.optimizerRuns.length ? workspace.optimizerRuns.map((item) => <tr key={item.runId}><td>{dateTime(item.startedAt)}</td><td>{item.strategyId}</td><td>{item.method}</td><td>{item.trialCount}</td><td>{item.acceptedCount}</td><td><span className="status warning">{item.status}</span></td></tr>) : <tr><td colSpan={6}>尚无独立优化器批次；当前按钮运行回测自带的参数敏感性实验。</td></tr>}</tbody></table></div>
  </div>;
}

function ReviewPage({ workspace, addNote, busy }: { workspace: ResearchWorkspace; addNote: (note: string, category: string, tradeId?: string) => void; busy: boolean }) {
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("客观诊断");
  const [tradeId, setTradeId] = useState("");
  const selectedTrade = workspace.reviewTrades.find((item) => item.tradeId === tradeId);
  return <div className="page-stack"><section className="review-compose"><div><span className="kicker">LOCAL REVIEW NOTE</span><h2>记录客观复盘</h2><p>不会修改策略或自动优化参数。</p></div><label><span>分类</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option>客观诊断</option><option>程序问题</option><option>策略缺陷</option><option>正常亏损</option><option>待验证假设</option></select></label><label><span>关联交易</span><select value={tradeId} onChange={(event) => setTradeId(event.target.value)}><option value="">不关联具体交易</option>{workspace.reviewTrades.map((trade) => <option key={trade.tradeId} value={trade.tradeId}>{trade.symbol} · {dateTime(trade.entryTime)} · {fmt(trade.realizedPnl)}U</option>)}</select></label><label className="note-field"><span>复盘内容</span><textarea maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：信号已在 confirmedAt 后可见；亏损属于正常止损试错……"/></label><button className="primary-action inline" disabled={busy || !note.trim()} onClick={() => { addNote(note, category, selectedTrade?.tradeId); setNote(""); }}><Save size={16}/> 保存本地复盘</button></section>
    <div className="table-wrap"><table><thead><tr><th>入场时间</th><th>标的</th><th>方向/候选</th><th>入场→出场</th><th>净盈亏</th><th>成本</th><th>数据截止</th><th>退出依据</th></tr></thead><tbody>{workspace.reviewTrades.length ? workspace.reviewTrades.map((trade) => <tr key={trade.tradeId}><td>{dateTime(trade.entryTime)}</td><td>{trade.symbol}</td><td>{trade.side}<small>{trade.candidateLabel ?? "—"}</small></td><td>{fmt(trade.entryPrice, 4)} → {fmt(trade.exitPrice, 4)}</td><td className={(trade.realizedPnl ?? 0) >= 0 ? "positive" : "negative"}>{fmt(trade.realizedPnl, 4)}U</td><td>{fmt(trade.fee + trade.slippageCost + trade.fundingEstimate, 4)}U</td><td>{dateTime(trade.dataCutoff)}</td><td>{trade.exitReason ?? "—"}</td></tr>) : <tr><td colSpan={8}>暂无回测交易可复盘</td></tr>}</tbody></table></div>
    <section className="notes-list"><div className="sectionhead"><div><span className="kicker">REVIEW LOG</span><h2>最近复盘记录</h2></div></div>{workspace.reviewNotes.length ? workspace.reviewNotes.map((item) => <article key={item.noteId}><span>{item.category}</span><p>{item.note}</p><time>{dateTime(item.createdAt)}</time></article>) : <p className="muted-copy">尚无复盘笔记。</p>}</section>
  </div>;
}

function DataPage({ workspace, sync, integrity, backup, busy }: { workspace: ResearchWorkspace; sync: () => void; integrity: () => void; backup: () => void; busy: boolean }) {
  const issueTotal = workspace.dataSeries.reduce((sum, item) => sum + item.issueCount, 0);
  const openTotal = workspace.dataSeries.reduce((sum, item) => sum + item.openRows, 0);
  return <div className="page-stack"><section className="data-actions"><div><span>数据库位置</span><strong title={workspace.databasePath}>{workspace.databasePath}</strong></div><button className="primary-action inline" onClick={sync} disabled={busy}>{busy ? <LoaderCircle className="spin" size={16}/> : <RefreshCw size={16}/>} 更新当前标的公共行情</button><button className="secondary-action inline" onClick={integrity} disabled={busy}><ShieldCheck size={16}/> 完整性检查</button><button className="secondary-action inline" onClick={backup} disabled={busy}><Archive size={16}/> 创建备份</button></section>
    <div className="data-health"><div><span>数据系列</span><strong>{workspace.dataSeries.length}</strong></div><div><span>未收盘隔离</span><strong>{openTotal}</strong></div><div><span>未解决问题</span><strong className={issueTotal ? "negative" : "positive"}>{issueTotal}</strong></div><div><span>数据库状态</span><strong className={workspace.snapshot.database.integrity === "ok" ? "positive" : "negative"}>{workspace.snapshot.database.integrity}</strong></div></div>
    <div className="table-wrap"><table><thead><tr><th>标的</th><th>周期</th><th>总K线</th><th>已收盘</th><th>未收盘隔离</th><th>数据开始</th><th>最后数据</th><th>问题</th></tr></thead><tbody>{workspace.dataSeries.map((item) => <tr key={`${item.symbol}:${item.timeframe}`}><td>{item.symbol}</td><td>{item.timeframe}</td><td>{item.rows}</td><td>{item.closedRows}</td><td>{item.openRows}</td><td>{dateTime(item.firstOpenTime)}</td><td>{dateTime(item.lastOpenTime)}</td><td><span className={`status ${item.issueCount ? "warning" : "success"}`}>{item.issueCount}</span></td></tr>)}</tbody></table></div>
    <div className="table-wrap"><table><thead><tr><th>导入时间</th><th>标的</th><th>周期</th><th>接收</th><th>写入/更新</th><th>状态</th><th>错误</th></tr></thead><tbody>{workspace.imports.length ? workspace.imports.map((item) => <tr key={item.importId}><td>{dateTime(item.startedAt)}</td><td>{item.symbol}</td><td>{item.timeframe}</td><td>{item.rowsReceived}</td><td>{item.rowsUpserted}</td><td><span className={`status ${item.status === "success" ? "success" : "warning"}`}>{item.status}</span></td><td>{item.error ?? "—"}</td></tr>) : <tr><td colSpan={7}>暂无导入记录</td></tr>}</tbody></table></div>
  </div>;
}

function SettingsPage({ settings, save, busy }: { settings: DesktopSettings; save: (value: DesktopSettings) => void; busy: boolean }) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  const number = (key: keyof DesktopSettings, value: string) => setDraft((current) => ({ ...current, [key]: Number(value) }));
  return <div className="page-stack"><section className="settings-layout"><div className="settings-form"><div className="sectionhead"><div><span className="kicker">LOCAL PARAMETERS</span><h2>研究与 PAPER 参数</h2></div></div><div className="settings-grid">
    <label><span>默认标的</span><input value={draft.selectedSymbol} readOnly/></label><label><span>显示时区</span><select value={draft.timezone} onChange={(event) => setDraft({ ...draft, timezone: event.target.value as DesktopSettings["timezone"] })}><option value="Asia/Shanghai">北京时间</option><option value="UTC">UTC</option></select></label>
    <label><span>双策略初始资金</span><input value="激进 1000U / 基本面 1000U" readOnly/></label><label><span>旧版全局单笔上限（兼容）</span><input type="number" value={draft.maximumOrderNotional} onChange={(event) => number("maximumOrderNotional", event.target.value)}/></label>
    <label><span>连续亏损暂停（笔）</span><input type="number" value={draft.maximumConsecutiveLosses} onChange={(event) => number("maximumConsecutiveLosses", event.target.value)}/></label><label><span>最低目标盈亏比</span><input type="number" step="0.1" value={draft.minimumRiskReward} onChange={(event) => number("minimumRiskReward", event.target.value)}/></label>
    <label><span>手续费率</span><input type="number" step="0.0001" value={draft.feeRate} onChange={(event) => number("feeRate", event.target.value)}/></label><label><span>滑点（bps）</span><input type="number" step="1" value={draft.slippageBps} onChange={(event) => number("slippageBps", event.target.value)}/></label>
    <label><span>自动刷新（秒）</span><input type="number" value={draft.autoRefreshSeconds} onChange={(event) => number("autoRefreshSeconds", event.target.value)}/></label>
  </div><button className="primary-action inline" disabled={busy} onClick={() => save(draft)}><Save size={16}/> 保存本地设置</button></div>
    <aside className="inspector"><div className="inspector-title"><LockKeyhole size={19}/><div><span>HARD SAFETY</span><h2>不可在界面解除</h2></div></div><dl className="key-values"><div><dt>OKX API Key</dt><dd>不读取</dd></div><div><dt>OKX 私有接口</dt><dd>未连接</dd></div><div><dt>DEMO 模式</dt><dd>锁定</dd></div><div><dt>LIVE 模式</dt><dd>锁定</dd></div><div><dt>外部订单</dt><dd>禁止</dd></div></dl><div className="hardlock"><OctagonAlert size={17}/><p>此桌面版只能分析公共行情和记录本地 PAPER 交易。任何设置都不会改变该边界。</p></div></aside>
  </section></div>;
}

export function App() {
  const [active, setActive] = useState<NavigationPage>("overview");
  const [workspace, setWorkspace] = useState<ResearchWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("正在连接本地研究服务…");
  const [error, setError] = useState<string | null>(null);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PaperOrderPreviewDto | null>(null);
  const [paperAccountId, setPaperAccountId] = useState<PaperAccountId>("paper-aggressive");
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = window.localStorage.getItem("chanlun-desktop-theme");
    return saved === "dark" ? "dark" : "light";
  });
  const api = window.quantDesktop;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("chanlun-desktop-theme", theme);
  }, [theme]);

  const load = useCallback(async (symbol?: string) => {
    if (!api) { setError("桌面桥接未加载，请重新启动软件"); setLoading(false); return; }
    try { const next = await api.workspace(symbol); setWorkspace(next); setError(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!workspace?.settings.autoRefreshSeconds) return;
    const timer = window.setInterval(() => { void load(workspace.selectedSymbol); }, workspace.settings.autoRefreshSeconds * 1_000);
    return () => window.clearInterval(timer);
  }, [load, workspace?.selectedSymbol, workspace?.settings.autoRefreshSeconds]);
  useEffect(() => {
    if (!workspace?.snapshot.positions.length || !api) return;
    let disposed = false;
    let refreshing = false;
    const refreshMarks = async () => {
      if (disposed || refreshing) return;
      refreshing = true;
      try {
        const next = await api.refreshPaperMarket();
        if (!disposed) setWorkspace((current) => current ? { ...current, snapshot: next } : current);
      } finally { refreshing = false; }
    };
    void refreshMarks();
    const timer = window.setInterval(() => { void refreshMarks(); }, 2_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [api, workspace?.snapshot.positions.length]);

  const action = async (operation: () => Promise<DesktopActionResult | unknown>, success?: string) => {
    setBusy(true); setError(null);
    try {
      const result = await operation();
      if (result && typeof result === "object" && "ok" in result) {
        const typed = result as DesktopActionResult;
        if (!typed.ok) throw new Error(typed.message);
        setNotice(typed.path ? `${typed.message}：${typed.path}` : typed.message);
      } else if (success) setNotice(success);
      await load(workspace?.selectedSymbol);
    } catch (reason) { const message = reason instanceof Error ? reason.message : String(reason); setError(message); setNotice(`操作失败：${message}`); }
    finally { setBusy(false); }
  };

  const requestMode = async (mode: DesktopMode) => {
    if (!api) return;
    try { const result = await api.requestMode(mode); setNotice(result.message); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  const openPaper = (signalId: string) => { setPaperAccountId("paper-aggressive"); setCandidateId(signalId); setPreview(null); setActive("paper"); };
  const openPaperAccount = (accountId: PaperAccountId) => { setPaperAccountId(accountId); setCandidateId(null); setPreview(null); setActive("paper"); };
  const currentCopy = pageCopy[active];

  if (loading) return <div className="launch-state"><LoaderCircle className="spin"/><strong>正在加载本地研究工作台</strong><span>不会连接或操作 OKX 账户</span></div>;
  if (!workspace) return <div className="launch-state error-state"><OctagonAlert/><strong>本地研究工作台启动失败</strong><span>{error}</span><button onClick={() => void load()}>重试</button></div>;
  if (!api) return <div className="launch-state error-state"><OctagonAlert/><strong>桌面桥接未加载</strong><span>请完全退出后重新启动软件。</span></div>;

  const renderPage = () => {
    switch (active) {
      case "overview": return <OverviewPage workspace={workspace} go={setActive} openPaperAccount={openPaperAccount}/>;
      case "structure": return <StructurePage workspace={workspace}/>;
      case "opportunities": return <OpportunitiesPage workspace={workspace} openPaper={openPaper}/>;
      case "paper": return <PaperPage workspace={workspace} accountId={paperAccountId} candidateId={candidateId} preview={preview} busy={busy} onAccountChange={(accountId) => { setPaperAccountId(accountId); setCandidateId(null); setPreview(null); }} onPreview={(accountId, side, notional) => void action(async () => { const next = await api.previewPaperOrder({ accountId, symbol: workspace.selectedSymbol, positionSide: side, notional, candidateSignalId: candidateId }); setPreview(next); setNotice(`${workspace.snapshot.paperAccounts.find((item) => item.accountId === accountId)?.name ?? "本地策略"}模拟订单预览已生成`); return undefined; })} onConfirm={() => preview && void action(async () => { await api.confirmPaperOrder(preview.previewId); setPreview(null); return undefined; }, "本地 PAPER 成交已记录")} onReset={(accountId) => void action(() => api.resetPaper(accountId), "所选本地策略账本已重置为 1000U")} onClose={(accountId, symbol) => void action(() => api.closePaperPosition(accountId, symbol), "本地 PAPER 仓位已关闭")}/>;
      case "backtests": return <BacktestsPage workspace={workspace} busy={busy} run={() => void action(() => api.runBacktest(workspace.selectedSymbol))}/>;
      case "laboratory": return <LaboratoryPage workspace={workspace} busy={busy} run={() => void action(() => api.runBacktest(workspace.selectedSymbol))}/>;
      case "learning": return <AdaptiveLearningPage workspace={workspace} busy={busy} onTrain={(accountId) => void action(() => api.trainAdaptiveModel(accountId, workspace.selectedSymbol), "本地挑战者训练完成")} onWalkForward={(accountId) => void action(() => api.runAdaptiveWalkForward(accountId, workspace.selectedSymbol), "Walk-forward 样本外验证完成")} onToggle={(accountId, enabled) => void action(() => api.toggleAdaptiveLearning(accountId, enabled), enabled ? "自动学习已启动" : "自动学习已暂停")} onAudit={() => void action(() => api.auditAdaptiveLearning(), "自适应学习安全审计完成")}/>;
      case "review": return <ReviewPage workspace={workspace} busy={busy} addNote={(note, category, tradeId) => void action(() => api.addReviewNote({ runId: workspace.backtests[0]?.runId ?? null, tradeId: tradeId ?? null, category, note }))}/>;
      case "data": return <DataPage workspace={workspace} busy={busy} sync={() => void action(() => api.syncPublicData(workspace.selectedSymbol))} integrity={() => void action(() => api.runIntegrityCheck())} backup={() => void action(() => api.createBackup())}/>;
      case "settings": return <SettingsPage settings={workspace.settings} busy={busy} save={(value) => void action(() => api.saveSettings({ ...value, selectedSymbol: workspace.selectedSymbol }))}/>;
    }
  };

  return <div className="shell">
    <header className="modebar">
      <div className="window-dots" aria-hidden="true"><i className="window-dot close"/><i className="window-dot minimize"/><i className="window-dot maximize"/></div>
      <div className="brand"><div className="brandmark">缠</div><div><strong>CHANLUN QUANT</strong><span>TRADING DESKTOP · V1.1 LAB</span></div></div>
      <div className="modes" aria-label="账户模式">{(["PAPER", "DEMO", "LIVE"] as const).map((mode) => <button key={mode} className={`mode ${mode.toLowerCase()} ${mode === "PAPER" ? "selected" : "locked"}`} onClick={() => void requestMode(mode)}>{mode !== "PAPER" && <LockKeyhole size={13}/>} {mode}</button>)}</div>
      <div className="topstatus"><span className="connection"><span className="pulse"/>连接正常</span><span className="divider"/><Clock3 size={14}/><span>{new Date(workspace.snapshot.updatedAt).toLocaleTimeString("zh-CN", { hour12: false })}</span><button className="theme-toggle" type="button" aria-label={theme === "light" ? "切换深色主题" : "切换浅色主题"} title={theme === "light" ? "切换深色主题" : "切换浅色主题"} onClick={() => setTheme((current) => current === "light" ? "dark" : "light")}>{theme === "light" ? <Moon size={16}/> : <Sun size={16}/>}</button></div>
    </header>
    <aside className="sidebar"><div className="sectionlabel">研究工作台</div><nav>{nav.map(([Icon, label, page]) => <button data-page={page} key={page} className={active === page ? "active" : ""} onClick={() => { setActive(page); setPreview(null); }}><Icon size={18}/><span>{label}</span>{active === page && <ChevronRight size={15}/>}</button>)}</nav><div className="sidebar-account"><div><span>PAPER 账户</span><strong>模拟交易模式</strong></div><span className="sidebar-account-icon"><WalletCards size={17}/></span></div><div className="legal"><ShieldCheck size={17}/><p>数据仅供研究，不构成投资建议。</p></div></aside>
    <main data-active-page={active}>
      <div className="pagebar"><div><div className="eyebrow">{currentCopy.eyebrow} / {nav.find((item) => item[2] === active)?.[1]}</div><h1>{currentCopy.title}</h1><p>{currentCopy.description}</p></div><div className="page-controls"><label><span>研究标的</span><select aria-label="研究标的" value={workspace.selectedSymbol} onChange={(event) => void load(event.target.value)}>{workspace.symbols.map((symbol) => <option key={symbol}>{symbol}</option>)}</select></label><button title="刷新本地数据视图" onClick={() => void load(workspace.selectedSymbol)}><RefreshCw size={16}/></button><div className="timestamp"><span>最后刷新</span><strong>{new Date(workspace.snapshot.updatedAt).toLocaleTimeString("zh-CN", { hour12: false })}</strong></div></div></div>
      {error && <div className="error-banner"><OctagonAlert size={16}/><span>{error}</span><button onClick={() => setError(null)}><X size={15}/></button></div>}
      <div className="page-content">{renderPage()}</div>
    </main>
    <footer><span className="footer-notice">{busy ? "本地任务运行中，请稍候…" : notice}</span><span className="footer-status"><span><i className="status-dot"/>系统状态 <b>正常</b></span><span><ShieldCheck size={13}/>策略引擎 <b>PAPER</b></span><span><Database size={13}/>SQLite V{workspace.snapshot.database.version}</span><span><Clock3 size={13}/>系统时间 {new Date(workspace.snapshot.updatedAt).toLocaleTimeString("zh-CN", { hour12: false })}</span></span></footer>
  </div>;
}
