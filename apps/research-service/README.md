# Chanlun OKX Local Research Service

该服务只管理 OKX 公共历史K线、本地研究批次、离线回测记录与复盘记录，不连接任何真实或 OKX 模拟盘交易接口。

## 快速开始

在项目根目录运行：

```text
pnpm research:init
pnpm research:sync
pnpm research:audit
pnpm research:test
pnpm research:backtest
```

## V1.1 自适应行情学习

学习模块使用确定性的多分类 Softmax 回归作为可解释基线，不使用黑箱深度学习。特征只从 `feature_cutoff` 前已经收盘的 K 线、已经确认的候选结构、公开资金费率/持仓量观察，以及满足 `published_at <= cutoff AND recorded_at <= cutoff` 的本地新闻事件生成。

```text
node apps/research-service/run-python.mjs apps/research-service/research.py sync-public-context --symbol BTC-USDT-SWAP
node apps/research-service/run-python.mjs apps/research-service/research.py ml-train --account paper-aggressive --symbol BTC-USDT-SWAP
node apps/research-service/run-python.mjs apps/research-service/research.py ml-walk-forward --account paper-aggressive --symbol BTC-USDT-SWAP
node apps/research-service/run-python.mjs apps/research-service/research.py ml-audit
```

训练按时间顺序切分并在训练/测试之间保留与标签跨度一致的 embargo。新模型默认是 `challenger`；即使所有门槛通过，命令未显式启用自动晋级时也不会替换 Champion。没有新鲜 Champion、数据漂移过大或输出为 HOLD 时，系统只保存阻断审计，不进入本地 PAPER 风控预览。

模型文件默认保存在 `data/models/`；桌面安装版保存在应用用户目录的 `models/`。SQLite 保存模型哈希、特征版本、训练区间、数据摘要、Git commit、样本外指标、晋级门槛、预测解释与 PAPER 决策审计。模型文件不包含 API Key 或账户凭证。

默认数据库：

```text
data/chanlun_research.sqlite3
```

首次同步默认给 4 个标的、5 个周期各下载一页（最多 300 根）。再次执行 `backfill` 会从保存的 `after` 游标继续下载更早数据：

```text
python apps/research-service/research.py sync --pages 5
```

只更新最新一页：

```text
python apps/research-service/research.py sync --mode latest
```

限定标的和周期：

```text
python apps/research-service/research.py sync --symbol BTC-USDT-SWAP --timeframe 15m --pages 3
```

## 数据审计

```text
python apps/research-service/research.py audit --save-issues
```

审计输出数据库完整性、时间范围、已收盘/未收盘数量、重复、OHLC异常和原始时间缺口。股票类合约的非交易时段会形成正常缺口，需要结合交易时段解释。

## 备份与恢复

```text
python apps/research-service/research.py backup
python apps/research-service/research.py --db data/restored.sqlite3 restore --backup data/backups/备份文件.sqlite3
```

恢复默认拒绝覆盖已有目标。确需覆盖时显式增加 `--force`，并提前保留备份。

## 回测读取约束

回测代码只能通过等价于以下条件的数据查询：

```text
closed = 1 AND close_time <= data_cutoff
```

数据库中的 `simulated_trades` 仅用于离线虚拟成交记录。服务不包含账户、API Key、真实订单或 OKX 模拟盘订单能力。

## V1.1 离线回测

先完成构建，再执行默认四标的回测：

```text
pnpm build
pnpm research:backtest
```

只运行一个标的或限定 UTC 毫秒时间范围：

```text
node apps/research-service/run-python.mjs apps/research-service/research.py backtest --symbol BTC-USDT-SWAP --start 1767225600000 --end 1769817600000
```

默认参数在 `config/backtest_default.json`。其中 `intrabar_conflict_policy` 可设为 `stop_first`（默认、保守）或 `target_first`。手续费率、滑点基点、固定资金费率估算、初始资金、仓位比例、最低盈亏比、MA/ATR 参数和可靠性阈值均可配置。

回测使用以下时点约束：

- 以 15M 执行周期逐根推进，只读取各周期已经收盘且 `close_time <= cutoff` 的数据。
- 结构和候选点只有在 `confirmedAt <= cutoff` 后才可见。
- 信号确认后的下一根 15M K 线开盘成交，不使用信号柱的最高价或最低价。
- 不读取未来新闻和未来实际资金费率；资金费率仅按配置中的固定研究假设估算。
- 虚拟仓位及入场手续费不会超过可用的本地模拟资金。

每个标的单独建立一个 `backtest_runs` 批次并从 1000U 起算。结果写入 `analysis_runs`、`candidate_signals`、`simulated_trades`、`equity_snapshots` 和 `backtest_runs`，报告写入 `data/reports/`。报告含收益、回撤、胜率、盈亏比、Profit Factor、期望、连续盈亏、多空/标的/周期/行情阶段统计、成本影响和逐笔数据截止时间，并在样本过少、回撤过大或参数敏感时标记不可靠。
