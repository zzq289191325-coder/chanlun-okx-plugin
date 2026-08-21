# OKX Chanlun Visualizer Plugin

**版本：V1.1 Multi-Timeframe Research**

OKX Chanlun Visualizer Plugin 是一个 Chrome Manifest V3 扩展，用于在 OKX / 欧意合约行情页面上显示缠论结构与多周期行情研究信息。

> 本插件仅用于行情研究和技术分析辅助，不构成投资建议。

## 功能介绍

- OKX 行情页面缠论辅助分析
- 使用 OKX 官方公共接口读取 K 线，不需要 API Key
- 自动识别当前 OKX 页面标的并跟随切换
- 自动识别走势结构
- 缠论分型、笔、线段和走势中枢可视化
- 支持 1D、4H、1H、30M、15M 等多周期观察
- 30M 候选结构与 15M 确认结构的区间套校验：同向、确认顺序、结构区间和时效性
- 本地新闻文本影响研究：正向、负向、中性/混合与高影响事件等待提示
- 显示候选买卖结构区域、WAIT/WATCH/PASS 和风险提示
- 支持顶底、结构、候选点位和裸 K 图层开关
- 支持 OKX 原生 TradingView 图表吸附；连接失败时暂停吸附绘图
- 支持悬浮、折叠及 `Alt+C` 显示/隐藏

## 安全边界

- 不读取、不保存、不请求 OKX API Key、Secret 或 Passphrase
- 不调用 OKX 私有交易接口
- 不点击或操作 OKX 买入、卖出、开多、开空按钮
- 不提交真实盘或 OKX 模拟盘订单
- 所有“候选买/候选卖”均为结构研究标签，不是确定性交易建议
- 无法确认原生图表坐标时不会绘制假匹配覆盖层
- 新闻文本只由用户手动录入并保存在本机，不新增第三方新闻接口或权限

## 技术栈

- Chrome Manifest V3
- TypeScript
- React
- Vite
- Zustand
- lightweight-charts
- Vitest

## 项目结构

```text
chanlun-okx-plugin-v1/
├── apps/
│   ├── extension/
│       ├── public/              # 插件图标和安装说明
│       ├── src/
│       │   ├── app/             # 面板、工具栏和图表 UI
│       │   ├── chanlun/         # 图表兼容层及小周期结构处理
│       │   ├── content/         # Shadow DOM 注入与 TradingView 页面桥接
│       │   ├── intelligence/    # 多周期核心与 UI 数据适配
│       │   ├── okx/             # OKX 公共 REST / WebSocket 与标的识别
│       │   ├── popup/           # 扩展弹窗
│       │   ├── sidepanel/       # Chrome 侧边栏
│       │   ├── store/           # 状态和本地设置
│       │   └── utils/           # 通用工具
│       ├── manifest.json
│       └── vite.config.ts
│   └── research-service/        # Python 本地历史数据库、同步、审计和备份
├── packages/
│   ├── contracts/               # K 线和结构化信号类型
│   └── core/                    # 缠论、多周期、市场状态和风险分析核心
├── CHANGELOG.md
├── LICENSE
├── package.json
└── README.md
```

## 本地开发

要求：Node.js 24 或更高版本、pnpm 11、Python 3.11 或更高版本。

```text
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm research:test
pnpm research:init
pnpm research:sync
pnpm research:audit
pnpm research:backtest
```

其中测试包含固定 OKX 公共历史行情样本的结构回归，以及 15M/30M 截止时间、未来数据扰动、未收盘 K 线和确认时间约束检查。测试运行不访问网络。

## 本地历史行情数据库

V1.1 使用独立 Python 研究服务和 SQLite 主库管理历史数据，不把大型行情放入 `chrome.storage`。默认数据库为 `data/chanlun_research.sqlite3`；数据库包含版本迁移、复合唯一键 UPSERT、断点游标、数据质量审计以及 SQLite 一致性备份。Chrome 插件仍只负责展示，不直接管理数据库。

## V1.1 本地策略回测

`pnpm research:backtest` 会对默认的 BTC、GOOGL、INTC、MU 永续合约逐一执行离线 paper trading。回放以 15M K 线逐根推进；每个时点只向策略提供已经收盘且不晚于 cutoff 的 1D、4H、1H、30M、15M 数据。分型、笔、线段、中枢和候选结构均须在各自 `confirmedAt` 后才可见，默认在确认后的下一根 15M K 线开盘价成交。

默认研究配置位于 `apps/research-service/config/backtest_default.json`，可调整初始资金、仓位比例、手续费、滑点、资金费率估算、止盈止损同柱冲突规则、MA/ATR 参数、候选类型和可靠性阈值。系统不会调用真实盘或 OKX 模拟盘下单接口，也不会使用未来新闻或未来实际资金费率。

每次回测会将参数、Git commit、算法版本、数据范围、数据摘要哈希、逐笔依据、确认时间、退出依据、数据截止时间和资金曲线写入本地 SQLite，并在 `data/reports/` 生成 Markdown 报告。报告同时检查样本量、最大回撤和参数敏感性；条件不满足时会明确标记为不可靠。

详细设计和命令参见：`apps/research-service/DATABASE_DESIGN.md` 与 `apps/research-service/README.md`。

构建完成后，Chrome 本地加载目录为：

```text
apps/extension/dist
```

不要在 Chrome 中加载源码根目录。

## Chrome 安装

1. 打开 `chrome://extensions/`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择 `apps/extension/dist`。
5. 打开或刷新 OKX 合约交易页面。

## 数据来源与权限

插件只访问以下公开地址：

- `https://www.okx.com/api/v5/market/candles`
- OKX 公共行情 WebSocket

本地研究服务只访问 `https://www.okx.com/api/v5/market/history-candles`，不发送认证信息。

Chrome 权限用于本地设置、侧边栏、当前页面通信及注入 TradingView 展示桥接，不包含账户交易权限。

## Roadmap

### V1.1（当前）

- 扩充更多品种与行情阶段的离线历史基准样本
- 继续校准候选结构时效窗口和区间容差
- 完善本地新闻事件录入与结构风险提示

### V1.2

- 接入 AI 行情分析
- 自动分析市场新闻
- 结合宏观数据判断趋势

### V2.0

- 自动寻找盈亏比大于 1:2 的交易机会
- 模拟交易测试
- 风险控制模块
