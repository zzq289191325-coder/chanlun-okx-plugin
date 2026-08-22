import { Activity, BrainCircuit, CheckCircle2, FlaskConical, Pause, Play, ScanSearch, ShieldAlert } from "lucide-react";
import type { PaperAccountId, ResearchWorkspace } from "../shared/types.js";
import "./adaptive-learning.css";

const pct = (value: number | null | undefined, digits = 1) => value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
const number = (value: unknown, digits = 3) => typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
const dateTime = (value: number | null | undefined) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";

const ACCOUNTS: readonly { id: PaperAccountId; name: string; remit: string; boundary: string }[] = [
  { id: "paper-aggressive", name: "激进短线学习器", remit: "30M / 15M · 多空候选", boundary: "单笔≤120U · 总敞口≤300U · 最低2R" },
  { id: "paper-fundamental", name: "基本面长线学习器", remit: "1D / 4H · 仅做多候选", boundary: "单笔≤250U · 总敞口≤500U · 最低3R" },
];

interface Props {
  workspace: ResearchWorkspace;
  busy: boolean;
  onTrain(accountId: PaperAccountId): void;
  onWalkForward(accountId: PaperAccountId): void;
  onToggle(accountId: PaperAccountId, enabled: boolean): void;
  onAudit(): void;
}

export function AdaptiveLearningPage({ workspace, busy, onTrain, onWalkForward, onToggle, onAudit }: Props) {
  return <div className="learning-stack">
    <section className="learning-boundary">
      <div><span className="kicker">POINT-IN-TIME LEARNING</span><h2>自适应行情学习</h2><p>只读取已收盘公共行情和在截止时间前已录入的本地事件。模型先成为挑战者，只有样本外门槛全部通过才可能晋级 Champion。</p></div>
      <div className="learning-lock"><ShieldAlert size={18}/><span>当前只写入本地研究与 PAPER 决策审计；不读取密钥，不连接私有交易接口。</span></div>
    </section>

    <div className="learning-models">
      {ACCOUNTS.map((account) => {
        const runtime = workspace.adaptiveRuntime.find((item) => item.accountId === account.id);
        const model = workspace.adaptiveModels.find((item) => item.accountId === account.id && item.symbol === workspace.selectedSymbol);
        const champion = workspace.adaptiveModels.find((item) => item.accountId === account.id && item.state === "champion");
        const prediction = workspace.adaptivePredictions.find((item) => item.accountId === account.id);
        const freshnessMs = prediction ? Date.now() - prediction.featureCutoff : null;
        const stale = prediction?.dataQuality.stale === true;
        return <article className="learning-model" key={account.id} data-account={account.id}>
          <header>
            <div className="learning-icon"><BrainCircuit size={20}/></div>
            <div><h3>{account.name}</h3><p>{account.remit}</p></div>
            <span className={`learning-model-state ${model?.state ?? "untrained"}`}>{model?.state?.toUpperCase() ?? "未训练"}</span>
          </header>
          <dl className="learning-facts">
            <div><dt>Champion</dt><dd>{champion ? champion.version : "尚无；预测不可驱动PAPER"}</dd></div>
            <div><dt>训练样本</dt><dd>{model?.sampleCount ?? 0}</dd></div>
            <div><dt>训练区间</dt><dd>{model ? `${dateTime(model.trainingStart)} — ${dateTime(model.trainingEnd)}` : "—"}</dd></div>
            <div><dt>数据新鲜度</dt><dd className={stale ? "negative" : "positive"}>{freshnessMs === null ? "—" : `${Math.max(0, Math.round(freshnessMs / 60_000))} 分钟${stale ? " · 已阻断" : ""}`}</dd></div>
          </dl>
          <div className="prediction-strip">
            <div><span>最新判断</span><strong>{prediction?.decision ?? "等待训练"}</strong></div>
            <div><span>做多</span><strong>{pct(prediction?.longProbability)}</strong></div>
            <div><span>做空</span><strong>{pct(prediction?.shortProbability)}</strong></div>
            <div><span>观望</span><strong>{pct(prediction?.holdProbability)}</strong></div>
            <div><span>置信度</span><strong>{pct(prediction?.confidence)}</strong></div>
            <div><span>风险</span><strong className={prediction?.riskLevel === "BLOCKED" ? "negative" : ""}>{prediction?.riskLevel ?? "—"}</strong></div>
          </div>
          <div className="learning-explanation">
            <span>主要解释因子</span>
            {prediction?.explanation.length ? <ol>{prediction.explanation.slice(0, 4).map((item) => <li key={item.feature}><code>{item.feature}</code><b className={item.contribution >= 0 ? "positive" : "negative"}>{item.contribution >= 0 ? "+" : ""}{item.contribution.toFixed(3)}</b></li>)}</ol> : <p>训练后显示特征贡献；缺失资金费率或持仓量时会保留缺失标志。</p>}
          </div>
          <div className="learning-actions">
            <button className="primary-action inline" disabled={busy} onClick={() => onTrain(account.id)}><Play size={15}/> 立即训练挑战者</button>
            <button className="secondary-action inline" disabled={busy} onClick={() => onWalkForward(account.id)}><FlaskConical size={15}/> Walk-forward</button>
            <button className="secondary-action inline" disabled={busy} onClick={() => onToggle(account.id, !runtime?.enabled)}>{runtime?.enabled ? <Pause size={15}/> : <Activity size={15}/>} {runtime?.enabled ? "暂停自动学习" : "启动自动学习"}</button>
          </div>
          <footer><span>{account.boundary}</span><span>上次调度：{dateTime(runtime?.lastSchedulerAt)}</span></footer>
        </article>;
      })}
    </div>

    <section className="learning-audit">
      <div><span className="kicker">VALIDATION & PROMOTION</span><h2>样本外验证与晋级审计</h2></div>
      <button className="secondary-action inline" disabled={busy} onClick={onAudit}><ScanSearch size={16}/> 运行安全审计</button>
      <div className="audit-summary"><div><span>模型版本</span><strong>{workspace.adaptiveModels.length}</strong></div><div><span>预测记录</span><strong>{workspace.adaptivePredictions.length}</strong></div><div><span>晋级检查</span><strong>{workspace.adaptivePromotions.length}</strong></div><div><span>PAPER决策审计</span><strong>{workspace.adaptiveDecisions.length}</strong></div></div>
    </section>

    <div className="table-wrap"><table><thead><tr><th>时间</th><th>账户</th><th>挑战者</th><th>结果</th><th>门槛</th><th>原因</th></tr></thead><tbody>{workspace.adaptivePromotions.length ? workspace.adaptivePromotions.map((item) => <tr key={item.promotionRunId}><td>{dateTime(item.createdAt)}</td><td>{item.accountId}</td><td>{item.challengerModelId.slice(0, 8)}</td><td><span className={`status ${item.approved ? "success" : "warning"}`}>{item.approved ? "已晋级" : "保留挑战者"}</span></td><td>{Object.values(item.gates).filter(Boolean).length}/{Object.keys(item.gates).length}</td><td>{item.reason}</td></tr>) : <tr><td colSpan={6}>尚无晋级检查。立即训练后会保存每一道门槛及拒绝原因。</td></tr>}</tbody></table></div>

    <div className="table-wrap"><table><thead><tr><th>决策时间</th><th>账户</th><th>标的</th><th>模型判断</th><th>数据截止</th><th>PAPER准入</th><th>审计说明</th></tr></thead><tbody>{workspace.adaptiveDecisions.length ? workspace.adaptiveDecisions.map((item) => <tr key={item.eventId}><td>{dateTime(item.createdAt)}</td><td>{item.accountId}</td><td>{item.symbol}</td><td>{item.decision}</td><td>{dateTime(item.dataCutoff)}</td><td>{item.allowed ? <span className="status success"><CheckCircle2 size={12}/>可进风控预览</span> : <span className="status warning">阻断</span>}</td><td>{item.reason}</td></tr>) : <tr><td colSpan={7}>尚无模型决策。实验模型不会绕过 Champion 与新鲜度检查。</td></tr>}</tbody></table></div>

    {workspace.adaptiveModels[0] && <p className="learning-disclaimer">最近模型：测试集 Macro-F1 {number(workspace.adaptiveModels[0].metrics.macro_f1)} · Log Loss {number(workspace.adaptiveModels[0].metrics.log_loss)} · 交易样本 {String(workspace.adaptiveModels[0].metrics.trade_count ?? "—")}。这些是离线研究指标，不代表未来收益，也不构成投资建议。</p>}
  </div>;
}
