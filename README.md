# OKX Chanlun Visualizer Plugin

**版本：V1.0 First Generation**

OKX Chanlun Visualizer Plugin 是一个 Chrome Manifest V3 扩展，用于在 OKX / 欧意合约行情页面上显示缠论结构与多周期行情研究信息。

> 本插件仅用于行情研究和技术分析辅助，不构成投资建议。

## 功能介绍

- OKX 行情页面缠论辅助分析
- 使用 OKX 官方公共接口读取 K 线，不需要 API Key
- 自动识别当前 OKX 页面标的并跟随切换
- 自动识别走势结构
- 缠论分型、笔、线段和走势中枢可视化
- 支持 1D、4H、1H、30M、15M 等多周期观察
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
│   └── extension/
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
├── packages/
│   ├── contracts/               # K 线和结构化信号类型
│   └── core/                    # 缠论、多周期、市场状态和风险分析核心
├── CHANGELOG.md
├── LICENSE
├── package.json
└── README.md
```

## 本地开发

要求：Node.js 24 或更高版本、pnpm 11。

```text
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

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

Chrome 权限用于本地设置、侧边栏、当前页面通信及注入 TradingView 展示桥接，不包含账户交易权限。

## Roadmap

### V1.1

- 增加 15 分钟 / 30 分钟级别买卖点辅助
- 增加区间套分析
- 增加新闻影响分析

### V1.2

- 接入 AI 行情分析
- 自动分析市场新闻
- 结合宏观数据判断趋势

### V2.0

- 自动寻找盈亏比大于 1:2 的交易机会
- 模拟交易测试
- 风险控制模块
