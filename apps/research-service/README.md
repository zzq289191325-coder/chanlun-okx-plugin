# Chanlun OKX Local Research Service

该服务只管理 OKX 公共历史K线、本地研究批次、离线回测记录与复盘记录，不连接任何真实或 OKX 模拟盘交易接口。

## 快速开始

在项目根目录运行：

```text
pnpm research:init
pnpm research:sync
pnpm research:audit
pnpm research:test
```

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
