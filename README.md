# dsh-livefeed · 实时讯息面板（Linux Do 版）

> DSH（DeepSeek Harness）动态 Cordis 插件：在 GUI **右边缘的悬浮面板**（可折叠）中，每隔可配置的时间（默认 30 分钟）从 **Linux Do 论坛**（linux.do）的「最新 + 最热门」拉取话题，由大模型按**价值**筛选并生成**摘要卡片**；点击卡片在新标签页打开原文并自动标记已读。

## 功能特性

- **源固定为 Linux Do**：只从 linux.do 的 `latest.json`（最新）与 `hot.json`（最热门）拉取话题，无其他源；linux.do 位于 Cloudflare 质询之后，插件用系统 Edge（有头离屏）直连抓取，走系统代理。
- **固定屏蔽**：标题或标签含「富可敌国」的话题确定性屏蔽，不经 AI，不占输出名额；其余话题一律交给 AI 按价值筛选。
- **AI 价值筛选**：其余话题由大模型按价值判断是否输出——综合回复数、浏览量/点赞、内容质量与讨论热度等；**不按主题/关键词过滤**（任何主题都可能是高价值的）。
- **两个参数**：`fetchCount`（拉取数量：单次从最新+最热门共拉取的话题数）与 `outputCount`（输出数量：AI 筛选后输出的卡片数）；每次输出数量贴近预设，拉取数量 ≤ 输出数量时跳过 AI 过滤直接输出。
- **按已读 URL 去重**：拉取时根据已读/已采集的 URL（`seenUrls`，持久化于 `history.jsonl`）跳过重复话题，不重复采集。
- **未读 / 已读两个组件**：面板只有两个标签页；点击卡片打开原文自动标记已读；状态行提供「全部已读」一键操作。
- **周期调度**：状态行可暂停/恢复采集（重启自动恢复）；周期失败按指数退避自动重试（最多 2 次）；上次成功采集时间持久化于 `state.json`，重启 dsh 后距上次采集不足间隔时自动跳过首轮采集。
- **右缘悬浮面板**：基于 `shell.overlay` 槽位注册，任意页面（含未打开会话的首页）可见；可折叠为单个浮动按钮。
- **DSH 主题适配**：全部颜色使用 DSH 设计平台的 `--dsw-alias-*` / `--dsw-static-*` CSS 令牌，自动适配明暗主题。

## 快速开始

### 1. 安装

**方式 A0：一行安装（推荐）**

~~~
dsh plugin --profile web add github:ErrorLst/dsh-livefeed
~~~

安装成功后 reconcile 会自动识别包内的 `dsh.bundle.patch` 声明，把 `@dsh-external/dsh-livefeed` 追加进 web profile 的 `dsh.profile.bundles`（无需手动登记）；重启 dsh web 即挂载生效。

**方式 A：本地开发安装**

1. `git clone` 本仓库到本地目录（如 `C:\Users\you\dsh-livefeed`），在该目录执行 `pnpm install`；
2. 一行命令安装到 web profile：`dsh plugin --profile web add link:<仓库绝对路径>`（reconcile 自动登记 bundle 层，无需手动编辑 `dsh.profile.bundles`）；
3. 重启 dsh web，按下一节初始化运行目录即可。

### 2. 初始化运行目录（首次使用）

运行目录默认是 `~/.dsh/dsh-livefeed`（Windows 为 `%USERPROFILE%\.dsh\dsh-livefeed`；可用环境变量 `DSH_LIVEFEED_DIR` 覆盖）。

首次使用需要两步：

1. 把本仓库 `sources/` 下的 `linuxdo.js` 与 `_template.js` 复制到运行目录的 `sources/`；
2. 复制 `examples/config.example.json` 为运行目录下的 `config.json`，按需修改（模型留 `null` 表示跟随 DSH 默认模型）。

重启 dsh web 后打开面板点「立即刷新」即可开始采集。

### 3. 配置文件

运行目录结构：

| 文件 | 说明 |
| --- | --- |
| `config.json` | 全局配置：拉取数量、输出数量、刷新间隔、模型 |
| `sources/_template.js` | （可选）自定义基类模板；缺省回退内置模板 |
| `sources/linuxdo.js` | Linux Do 源脚本（唯一源） |

`config.json` 说明：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `fetchCount` | 40 | **拉取数量**：单次从「最新 + 最热门」共拉取的话题数（1–200） |
| `outputCount` | 8 | **输出数量**：AI 按价值筛选后输出的卡片数（1–50） |
| `retentionDays` | 3 | **已读卡片保留天数**（1–90，过期卡片每次采集前清除；未读不清除） |
| `intervalMinutes` | 30 | **刷新间隔（分钟）**（1–1440，设置面板可调） |
| `summaryLanguage` | zh-CN | 摘要标题语言 |
| `model` | null | null=跟随默认模型；或 `{provider, model, reasoningEffort?}` |
| `sources` | [linuxdo] | 固定为 Linux Do 一项，勿删 |

### 4. 改动源码后重新构建

Host/Client 代码在 `src/`，构建产物在 `lib/`（bundle 挂载用）：

~~~
npm run build
~~~

重新构建后**重启 dsh web** 生效。

## 项目结构

~~~
dsh-livefeed/
├── src/
│   ├── host/plugin.js          # Host 半（定时采集管线 + RPC）
│   ├── client/plugin.js        # Client 半（悬浮面板 UI + 轮询）
│   └── template/template.js    # 搜索源基类模板（内置常量的源头）
├── sources/                    # 运行载荷：复制到运行目录 sources/ 即可用
│   ├── _template.js            # 基类模板
│   └── linuxdo.js              # Linux Do 源（唯一固定源）
├── examples/
│   └── config.example.json     # 配置示例（复制为运行目录 config.json）
├── docs/
│   ├── design.md               # 设计文档
│   └── source-contract.md      # 搜索源基类模板契约
├── prototype/
│   └── prototype.html          # HTML 原型（DSH 主题，可独立打开预览）
├── package.json
└── README.md
~~~

## License

MIT
