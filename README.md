# LiveFeed · 实时讯息面板

> DSH（DeepSeek Harness）动态 Cordis 插件：在 GUI **右边缘的悬浮面板**（可折叠）中，每隔可配置的时间（默认 10 分钟）从可配置的「搜索源脚本」采集你感兴趣的内容，由大模型筛选并生成**摘要卡片**；点击卡片在新标签页打开原文。

![原型预览](prototype/prototype.html)

## 功能特性

- **右缘悬浮面板**：基于 `shell.overlay` 槽位注册，任意页面（含未打开会话的首页）可见；可折叠为单个浮动按钮。
- **完整采集管线**：粗搜（标题）→ 模型筛选 → 精搜（正文）→ 模型摘要 → 去重 → 卡片展示。
- **搜索源基类模板**：所有搜索源共用一套基类（`src/template/template.js`），追加新源只需实现两个方法。
- **全可配置**：刷新间隔、兴趣词、模型选择、每个源的开关/查询词均可在 `config.json` 中调整，下一周期自动生效；面板设置视图（齿轮）可直接修改**模型（含思考等级）/间隔/搜索源开关**并写回配置。
- **DSH 主题适配**：全部颜色使用 DSH 设计平台的 `--dsw-alias-*` / `--dsw-static-*` CSS 令牌，自动适配明暗主题。
- **三层分组**：卡片分「最新 / 未读 / 已读」三组；点击打开原文自动标记已读。
- **左滑反馈**：卡片左滑直接标记「不感兴趣」（仅负面反馈，正向偏好由你配置的兴趣词表达，防止模型制造信息茧房）。
- **AI 过滤规则学习**：全量归档（`history.jsonl`）+ 有界反馈窗口 + AI 维护的规则文档（`preferences.json`）；每周期增量更新规则，积累后可抽样重训，防规则漂移（详见 [docs/design.md](docs/design.md#7-阅读状态用户反馈与过滤规则学习v2-新增)）。
- **状态可见**：面板头部显示运行状态、上次刷新时间与每个搜索源的错误信息。

## 快速开始

### 1. 安装（动态 Cordis 插件）

本项目是插件的源码仓库；运行时代码以动态 Cordis 插件形式注入当前 DSH 进程：

1. 将 `src/host/plugin.js` 的函数体作为 `code.host`、`src/client/plugin.js` 的函数体作为 `code.client`，通过 `cordis_define` 定义插件（idPrefix 为 `live`）；
2. `cordis_run` 激活；首次运行需在 GUI 中批准 Client 包；
3. 插件启动约 15 秒后执行第一轮采集，之后按配置的间隔周期执行。

> 部署细节与版本管理见 [docs/design.md](docs/design.md#部署与生命周期)。

### 2. 配置文件

默认配置目录：`<工作区>\.dsh\livefeed\`（Host 源码中的常量，可按需修改）。

| 文件 | 说明 |
| --- | --- |
| `config.json` | 全局配置：刷新间隔、兴趣、模型、搜索源列表 |
| `sources/_template.js` | （可选）自定义基类模板；缺省使用内置模板 |
| `sources/<源id>.js` | 搜索源脚本，实现 `coarseSearch` / `fineSearch` |

示例配置见 [examples/config.example.json](examples/config.example.json)，示例源见 [examples/sources/](examples/sources/)。

### 3. 新增一个搜索源（三步）

1. 在 `sources/` 下新建脚本文件；
2. 实现 `coarseSearch(api)`（必选）；`fineSearch(api, item)` 可选，默认实现为抓取 `item.url` 提取正文；
3. 在 `config.json` 的 `sources` 数组中加一行（`id`、`name`、`script`、`query`、`enabled`）。

契约详见 [docs/source-contract.md](docs/source-contract.md)。

## 项目结构

```
livefeed/
├── src/
│   ├── host/plugin.js          # Host 半（定时采集管线 + RPC）
│   ├── client/plugin.js        # Client 半（悬浮面板 UI + 轮询）
│   └── template/template.js    # 搜索源基类模板（内置常量的源头）
├── examples/
│   ├── config.example.json     # 配置示例
│   └── sources/                # 示例搜索源（search-ai / hn / linuxdo）
├── docs/
│   ├── design.md               # 设计文档（架构、管线、契约、错误模型、决策记录）
│   └── source-contract.md      # 搜索源基类模板契约
├── prototype/
│   └── prototype.html          # HTML 原型（DSH 主题，可独立打开预览）
├── package.json
└── README.md
```

## 文档

- 设计文档：[docs/design.md](docs/design.md)
- 搜索源契约：[docs/source-contract.md](docs/source-contract.md)
- HTML 原型：[prototype/prototype.html](prototype/prototype.html)（浏览器直接打开，可切换明暗主题与各状态预览）

## License

MIT
