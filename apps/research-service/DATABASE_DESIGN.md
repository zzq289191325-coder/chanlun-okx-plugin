# 本地历史行情数据库设计

## 技术选择

V1.1 使用 SQLite 作为主数据库。Python 标准库直接支持 SQLite，不增加第三方运行依赖；它具备事务、唯一约束、UPSERT、外键、版本迁移、完整性检查和在线备份能力，适合当前单机写入与可重复研究。DuckDB 对大规模列式扫描和 Parquet 分析更有优势，但不作为本阶段的事务主库；后续可把 SQLite 中的已确认K线导出为 Parquet，再由 DuckDB 只读分析。

数据库不会放入 Chrome `storage`。默认文件为项目根目录 `data/chanlun_research.sqlite3`，由本地 Python 服务独占管理，Chrome 插件仍只负责展示。

## 时间与唯一性

- 所有时间统一保存为 UTC Unix 毫秒时间戳。
- `candles` 使用 `(symbol, timeframe, open_time)` 复合主键。
- 重复下载使用 UPSERT 更新同一根K线。
- 研究和回测查询必须同时满足 `closed = 1` 与 `close_time <= data_cutoff`。
- `location_time` 表示结构所在K线，`confirmed_at` 表示结构最早可见时间，两者不得混用。

## 迁移方案

- `001_initial.sql`：创建标的、K线、导入批次、缠论分析、候选结构、回测、模拟成交、资金曲线、新闻和复盘表。
- `002_sync_quality.sql`：增加增量同步游标和数据质量审计字段。
- `003_backtest_reproducibility.sql`：增加回测数据摘要、结果签名、可靠性结论，以及逐笔 confirmedAt、data cutoff、成本和退出依据字段。
- `002_sync_quality.sql`：创建可断点续传的同步任务和数据质量问题表。
- `schema_migrations` 记录已执行版本和 SQL 摘要。启动时只按顺序执行未应用迁移；已应用迁移不会重跑，也不通过删除数据库升级。

## 同步与故障恢复

- 只访问 `GET /api/v5/market/history-candles`，不发送认证请求头。
- 每页最多 300 条，使用 `after=<最早open_time>` 向更早历史分页。
- 每成功写入一页，就在同一事务中更新同步游标和导入统计；中断后从最后成功游标继续。
- 网络请求发生在数据库事务之外；页面校验或写入失败会回滚当前页，已有数据保持不变。
- 每次导入在 `data_imports` 中记录 `running/success/failed`、游标、行数和错误。

## 数据质量与备份

- 审计包含 SQLite `integrity_check`、重复检查、时间缺口、OHLC 关系、负成交量及未收盘K线统计。
- 原始缺口会被记录，但股票类合约的非交易时段缺口需要在复盘时结合交易时段解释。
- 备份使用 SQLite Backup API 生成一致性快照；恢复前先验证备份完整性，默认拒绝覆盖已有目标文件。

## 安全边界

- 无 API Key、Secret、Passphrase 或账户表。
- 无订单、持仓或 OKX 真实/模拟盘接口。
- `simulated_trades` 只保存离线回测产生的虚拟成交。
- 候选1/2/3买卖只是结构研究标签，不构成投资建议。
