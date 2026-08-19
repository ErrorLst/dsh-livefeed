# dsh-livefeed · 实时讯息面板

> DSH（DeepSeek Harness）动态 Cordis 插件：在 GUI **右边缘的悬浮面板**（可折叠）中，每隔可配置的时间（默认 60 分钟）从可配置的「搜索源脚本」采集你感兴趣的内容，由大模型筛选并生成**摘要卡片**；点击卡片在新标签页打开原文。

![原型预览](prototype/prototype.html)

## 功能特性

- **右缘悬浮面板**：基于 `shell.overlay` 槽位注册，任意页面（含未打开会话的首页）可见；可折叠为单个浮动按钮。
- **完整采集管线**：粗搜（标题）→ 模型筛选 → 精搜（正文）→ 模型摘要 → 去重 → 卡片展示。
- **搜索源基类模板**：所有搜索源共用一套基类（`src/template/template.js`），追加新源只需实现两个方法。
- **全可配置**：刷新间隔、兴趣词、模型选择、每个源的开关/查询词均可在 `config.json` 中调整，下一周期自动生效；面板设置视图（齿轮）可直接修改**模型（含思考等级）/间隔/搜索源开关**并写回配置。
- **DSH 主题适配**：全部颜色使用 DSH 设计平台的 `--dsw-alias-*` / `--dsw-static-*` CSS 令牌，自动适配明暗主题。
- **四层分组**：卡片分「最新 / 未读 / 已读 / 不感兴趣」四组，分组头部可折叠；点击打开原文自动标记已读；状态行提供「全部已读」一键操作。
- **持久化**：所有未读与「不感兴趣」卡片完整持久化，插件重启后原样恢复（恢复的卡片计入「未读」，下一周期产生新的「最新」）。
- **左滑反馈**：任意卡片（未读或已读）左滑标记「不感兴趣」，「不感兴趣」组内左滑可移除标记（仅负面反馈，正向偏好由你配置的兴趣词表达，防止模型制造信息茧房）。
- **AI 过滤规则学习**：全量归档（`history.jsonl`）+ 有界反馈窗口 + AI 维护的规则文档（`preferences.json`）；每周期增量更新规则，积累后可抽样重训，防规则漂移（详见 [docs/design.md](docs/design.md#7-阅读状态用户反馈与过滤规则学习v2-新增)）。
- **事件聚类**：同事件多源自动合并为一张卡片（主链接 + 相关来源列表）。
- **被屏蔽内容可见可撤销**：设置页展示被过滤内容（关键词命中/模型筛选）与原因，可一键撤销（加入豁免并恢复为卡片）；状态行显示「本次 N → 精选 M → 屏蔽 K」统计。
- **词管理**：设置页直接编辑兴趣词与用户屏蔽词（与 AI 学习规则合并生效，互不覆盖）。
- **周期调度**：状态行可暂停/恢复采集（重启自动恢复）；周期失败按指数退避自动重试（最多 2 次）；上次成功采集时间持久化于 `state.json`，重启 dsh 后距上次采集不足间隔时自动跳过首轮采集。
- **归档有界**：`history.jsonl` 按 `archiveMaxEntries`（默认 5000 条）滚动截断。
- **状态可见**：面板头部显示运行状态、上次刷新时间与每个搜索源的错误信息。

## 快速开始

### 1. 安装

**方式 A0：一行安装（推荐）**

```
dsh plugin --profile web add github:ErrorLst/dsh-livefeed
```

安装成功后 reconcile 会自动识别包内的 `dsh.bundle.patch` 声明，把 `@dsh-external/dsh-livefeed` 追加进 web profile 的 `dsh.profile.bundles`（无需手动登记）；重启 dsh web 即挂载生效。

**方式 A：本地开发安装**

1. `git clone` 本仓库到本地目录（如 `C:\Users\you\dsh-livefeed`），在该目录执行 `pnpm install`；
2. 一行命令安装到 web profile：`dsh plugin --profile web add link:<仓库绝对路径>`（reconcile 自动登记 bundle 层，无需手动编辑 `dsh.profile.bundles`）；
3. 重启 dsh web，按下一节初始化运行目录即可。

**方式 B：动态 Cordis 插件（开发模式）**

1. 将 `src/host/plugin.js` 的函数体作为 `code.host`、`src/client/plugin.js` 的函数体作为 `code.client`，通过 `cordis_define` 定义插件（idPrefix 为 `live`）；
2. `cordis_run` 激活；首次运行需在 GUI 中批准 Client 包；
3. 插件启动约 15 秒后检查调度：距上次成功采集（持久化于 `state.json` 的 `lastRunAt`）超过间隔才执行采集，未超间隔则跳过、由定时器在间隔到期后自动执行——重启 dsh **不会**每次都重复采集。

> 部署细节与版本管理见 [docs/design.md](docs/design.md#部署与生命周期)。

### 2. 初始化运行目录（首次使用）

运行目录默认是 `~/.dsh/dsh-livefeed`（Windows 为 `%USERPROFILE%\.dsh\dsh-livefeed`；可用环境变量 `DSH_LIVEFEED_DIR` 覆盖，例如迁移历史数据时 `setx DSH_LIVEFEED_DIR <旧目录>`）。

首次使用需要两步：

1. 把本仓库 [`sources/`](sources/) 下的文件复制到运行目录的 `sources/`（内含基类模板 `_template.js` 与 5 个内置源：Hacker News / Linux Do / V2EX / Solidot / arXiv；基类模板缺失时会回退内置模板，但源脚本必须就位）；
2. 复制 [`examples/config.example.json`](examples/config.example.json) 为运行目录下的 `config.json`，按需修改兴趣词与模型（`model: null` 表示跟随 DSH 默认模型）。

重启 dsh web 后打开面板点「立即刷新」即可开始采集。

### 3. 配置文件

运行目录结构：

| 文件 | 说明 |
| --- | --- |
| `config.json` | 全局配置：刷新间隔、兴趣、模型、搜索源列表 |
| `sources/_template.js` | （可选）自定义基类模板；缺省回退内置模板 |
| `sources/<源id>.js` | 搜索源脚本，实现 `coarseSearch` / `fineSearch` |

示例配置见 [examples/config.example.json](examples/config.example.json)，示例源见 [examples/sources/](examples/sources/)。

### 4. 新增一个搜索源（三步）

1. 在运行目录的 `sources/` 下新建脚本文件；
2. 实现 `coarseSearch(api)`（必选）；`fineSearch(api, item)` 可选，默认实现为抓取 `item.url` 提取正文；
3. 在 `config.json` 的 `sources` 数组中加一行（`id`、`name`、`script`、`query`、`enabled`）。

契约详见 [docs/source-contract.md](docs/source-contract.md)。

## 项目结构

```
dsh-livefeed/
├── src/
│   ├── host/plugin.js          # Host 半（定时采集管线 + RPC）
│   ├── client/plugin.js        # Client 半（悬浮面板 UI + 轮询）
│   └── template/template.js    # 搜索源基类模板（内置常量的源头）
├── sources/                    # 初始运行载荷：复制到运行目录 sources/ 即可用
│   └── (基类模板 + 内置搜索源)
├── examples/
│   ├── config.example.json     # 配置示例（复制为运行目录 config.json）
│   └── sources/                # 示例搜索源参考（含 search-ai 搜索引擎型）
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
