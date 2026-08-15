# LiveFeed 设计文档

> 状态：设计定稿 · 实现进行中（原型评审后完成 Host/Client 代码）
> 关联文档：[搜索源基类模板契约](source-contract.md) · [HTML 原型](../prototype/prototype.html)

## 1. 背景与目标

用户在 DSH Web GUI 中希望有一块「右侧实时讯息区」：周期性（默认 10 分钟）从若干**可配置的搜索源**采集内容，由大模型判断重要性并生成摘要，以**卡片**形式展示在右侧区域；点击卡片打开原文链接。搜索源必须易于追加，因此所有源共用一套**基类模板**，源脚本只需实现「粗搜（返回标题等粗略信息）」与「精搜（输入粗搜结果、返回详细内容）」两个方法。

### 非目标（本期不做）

- 卡片「不再显示」等用户偏好持久化
- 桌面通知（已有 dsh-notify-windows 可后续联动）
- 面板宽度拖拽、配置图形化 UI
- 每源独立刷新周期

## 2. 总体架构

```
┌─ Client（浏览器）──────────────────────────────────┐
│ shell.overlay 槽位 → 悬浮面板（position:fixed 右缘）     │
│ 15s 轮询 host.call('livefeed/cards')；卡片=<a target=_blank> │
└──────────────▲──────────────────▲──────────────────┘
    host.call('livefeed/refresh')   host.call('livefeed/cards')
┌──────────────┴──────────────────┴──────────────────┐
│ Host（定时管线，每 intervalMinutes 一个周期）               │
│ ①读配置/脚本(fs) → ②粗搜(模板+源脚本,codeRuntime)          │
│ ③模型筛选(llm) → ④精搜(模板+源脚本,codeRuntime)            │
│ ⑤模型摘要(llm) → ⑥去重、内存态、RPC 查询                    │
└────────────────────────────────────────────────────┘
```

## 3. 采集管线（每周期）

按 `sources[]` 顺序逐个执行；单飞标志防止周期重叠（tick 时若仍在运行则跳过）。

| 阶段 | 动作 | 失败处理 |
| --- | --- | --- |
| 0 装载 | `fs.readText` 读 `config.json`（失败→内置默认源）与各源脚本（失败→该源报错跳过）；`_template.js` 存在则覆盖内置模板 | 状态行提示 |
| 1 粗搜 | `codeRuntime.run({program: 模板+源脚本, bindings: api, mode:'titles'})` → items `[{title,url,snippet?,publishedAt?}]` | 脚本异常→`sourceErrors` 记录，跳过该源 |
| 2 模型筛选 | 一次 `llm.stream`：system=筛选指令+interests+**规则文档（preferences.json）+最近反馈示例**；user=标题 JSON。输出 `{selected:[{index,reason}]}`，上限 `maxCandidatesPerSource`。先做**确定性过滤**（block 关键词直接丢弃、prefer 关键词提权），再做语义过滤 | 解析失败→跳过该源本轮 |
| 3 精搜 | 对每个候选 `codeRuntime.run(mode:'content', item)` → `{text}`（≤8000 字符） | 失败且有 snippet → 降级为 snippet 摘要卡片；否则跳过 |
| 4 模型摘要 | 候选**批量**一次 `llm.stream`：输出 `[{title,summary}]`（2–3 句，`summaryLanguage`） | 失败→保留粗搜标题+正文截断兜底出卡 |
| 5 落库 | URL 去重（内存保留最近 5 周期 URL 集）；新卡 `isNew`；上限 `maxCards`；更新 `lastRunAt`/状态 | — |
| 6 规则学习 | 若 `feedbackQueue` 有未消费的新标记：一次 `llm.stream` 增量更新规则文档（`preferences.json`）；标记积累超阈值或用户手动触发时改为**抽样重训** | 失败→保留旧规则并提示 |

### 模型调用

- 模型默认取 `agentDefaultModel.currentSelection()`（当前：deepseek-modlens / deepseek-v4-flash / reasoning max）；`config.model` 非空时覆盖 `{provider, model, reasoningEffort?}`。
- 消息手工构造（动态插件无 import 能力，无法使用 `createUserMessage` 工厂，但形状一致）：

```js
{ id: 'livefeed-<n>', role: 'user',
  content: [{ type: 'text', text: '…' }],
  source: { kind: 'user' } }
```

- 输出解析：容错 JSON 提取（定位首个平衡 `{...}` 后 `JSON.parse`），失败按阶段兜底。

### 正文抓取策略（`api.fetchContent` 绑定内部）

1. 先尝试 `web.fetch`（本部署当前未挂载 fetch provider，将抛 `WebError`）；
2. 捕获后回退 `shell.run`：`curl -sL --max-time 20 <url>`（`stdoutMaxBytes` 约 1MB；代理经进程环境变量自动生效），stdout 作为 `{kind:'html'|'text', content}`；
3. 两者都失败 → 抛错，由阶段 3 的降级策略处理。

## 4. 配置（config.json）

```jsonc
{
  "intervalMinutes": 10,          // 刷新周期（分钟）
  "maxCards": 8,                  // 面板卡片上限
  "maxCandidatesPerSource": 5,    // 每源进入精搜的候选上限
  "summaryLanguage": "zh-CN",     // 摘要语言
  "interests": ["AI Agent", "DeepSeek", "编程工具"],  // 模型筛选依据
  "model": null,                  // null=跟随当前默认模型；或 {provider, model, reasoningEffort?}
  "sources": [
    { "id": "linuxdo", "name": "Linux.do", "script": "sources/linuxdo.js", "query": "AI", "enabled": true }
  ]
}
```

每周期重新读取，改动即生效。示例见 `examples/config.example.json`。

## 5. 部署与生命周期

- 动态插件定义：`cordis_define`（idPrefix `live`），Host 半 = `src/host/plugin.js` 函数体，Client 半 = `src/client/plugin.js` 函数体；`cordis_run` 激活。
- 依赖注入：`inject: ['timer','web','llm','fs','agentDefaultModel']`；`codeRuntime`、`shell` 用 `ctx.get()` 可选读取（`codeRuntime` 缺失时回退 `shell.run('node <script>')` 执行源脚本、解析 stdout JSON）。
- 副作用归属：定时器经 `ctx.effect(() => ctx.interval(...))`；RPC 经 `harness.handle`；UI 经 `slots.inject` 注册 —— 插件 stop/update 时全部自动清理。
- 配置目录常量：`C:\Users\zhoujin\Pictures\dsh-workspace\.dsh\livefeed`（可改）。

## 6. RPC 契约（Package 私有）

| method | 入参 | 返回 |
| --- | --- | --- |
| `livefeed/cards` | — | `{ cards: [{id,title,summary,url,sourceName,publishedAt?,isNew}], status: {running, lastRunAt?, sourceErrors:[{sourceId,message}]} }` |
| `livefeed/refresh` | — | `{ accepted: boolean }`（运行中则幂等拒绝） |
| `livefeed/model-catalog` | — | `{ providers: [{id, name, models: [{id, name, efforts: [{id, name}]}]}] }`（面板「模型选择」级联数据源，来自 `llm.listProviders()/listModels()/resolveModelInfo()`） |
| `livefeed/update-settings` | `{ intervalMinutes?, model?, sources?: [{id, enabled}] }` | `{ ok: boolean, error? }`（增量合并写回 `config.json`，下一周期生效） |
| `livefeed/mark` | `{ cardId, read?, feedback? }` | `{ ok }`（写 `state.json`：已读/感兴趣/不感兴趣） |
| `livefeed/rules` | — | `{ rules }`（当前规则文档 `preferences.json`） |
| `livefeed/rerun-rules` | — | `{ accepted }`（触发一次规则重训，运行中则幂等拒绝） |

### 6.1 面板设置

头部齿轮按钮进入设置视图（见 [HTML 原型](../prototype/prototype.html)），包含三块：

1. **模型选择**：提供商 → 模型 → 思考等级（reasoning effort）级联下拉；「跟随当前默认模型」开关对应 `config.model = null`（用 `agentDefaultModel.currentSelection()`）。级联数据来自 `livefeed/model-catalog`。
2. **刷新间隔**：分钟数输入（1–1440），对应 `config.intervalMinutes`。
3. **搜索源管理**：每个源一行 + 开关，对应 `sources[].enabled`；关闭的源在周期 0 装载阶段跳过。

保存经 `livefeed/update-settings` 增量合并写回 `config.json`（`fs.writeText`），不覆盖脚本字段（`script/query` 等保留）。

## 7. 阅读状态、用户反馈与过滤规则学习（v2 新增）

### 7.1 阅读状态与分组

- 每张卡片有 `read: boolean`；点击卡片（打开原文）后自动置为已读（Client 在 `<a>` 的 click 中先调 `livefeed/mark` 再放行新标签页）。
- 面板列表分「未读 / 已读」两组（原型已验证），`isNew` 徽标仅未读卡片显示；已读卡片标题降饱和。

### 7.2 用户反馈（左滑）

- 卡片**左滑**露出「感兴趣 / 不感兴趣」两个按钮（原型已验证手势：拖拽 ≥42px 松手即吸附露出）；标记后卡片视为已处理（进入「已读」组）并显示反馈标签。
- 反馈持久化：`state.json` 保存每张卡片的状态；`feedbackQueue`（有界，最近 50 条）供规则学习消费。

### 7.3 过滤规则学习（分层架构）

**决策：全量归档 + 有界反馈窗口 + AI 维护的规则文档。** 不采用「每次把全部历史完整喂给 AI」——上下文与 token 成本随周期无限增长，必然撑爆窗口且增量价值趋近于零；也不采用「只靠 AI 生成的规则」——规则是有损压缩，易漏细微偏好且会漂移。

| 层 | 文件 | 作用 | 进入每周期提示词 |
| --- | --- | --- | --- |
| 全量归档 | `history.jsonl` | 所有条目+标记，追加式 | 否（仅重训时抽样读取） |
| 反馈窗口 | `state.json` 内 `feedbackQueue` | 最近 50 条已标记条目 | 是（有界） |
| 规则文档 | `preferences.json` | AI 维护的结构化规则 | 是（紧凑） |

规则文档结构（示意）：

```json
{
  "version": 3,
  "updatedAt": "…",
  "prefer": ["AI Agent 框架", "长上下文模型", "本地优先工具"],
  "block": ["营销软文", "招聘帖", "纯转载"],
  "sourceWeights": { "hn": 1.2, "linuxdo": 1.0 },
  "semanticNotes": "用户偏好工程向实操内容，排斥泛泛而谈的综述"
}
```

- **确定性过滤（代码层）**：`block` 关键词命中直接丢弃（零模型成本）；`prefer` 命中提升排序。
- **语义过滤（模型层）**：阶段 2 筛选提示词 = interests + 规则文档 + 最近反馈示例（标题+标记），输出格式不变。
- **增量学习**：每周期末尾，`feedbackQueue` 有未消费标记时，一次 llm 调用：输入=当前规则+新增标记 → 输出=更新后规则（增量合并、版本号+1），写回 `preferences.json`。
- **规则重训（防漂移）**：标记积累超阈值（默认 200 条）或用户手动触发（设置页「立即重新学习」）时，从 `history.jsonl` 抽样（每类各约 30 条）重写规则。

### 7.4 持久化文件（livefeed 配置目录下）

| 文件 | 说明 |
| --- | --- |
| `config.json` | 原有配置（间隔/模型/源） |
| `state.json` | 卡片状态（read/feedback）+ feedbackQueue |
| `history.jsonl` | 全量归档，追加式，每行一条 |
| `preferences.json` | 规则文档（AI 维护，可人工编辑） |

写入均经 `fs.writeText`（原子）；失败降级为内存态并在面板状态行提示。

## 8. 安全与隔离

- 源脚本在 `codeRuntime`（worker-thread）中执行：无网络、无文件访问；只能调用注入的 `api` 绑定。
- `api` 绑定仅暴露 `mode/config/item/search/fetchContent` 五类能力，不暴露 fs/shell 等 Host 能力。
- 正文/标题均做长度截断，防止异常源输出超限。

## 9. 主题适配

面板全部颜色使用 DSH 设计平台令牌（源：`dsh-client-ui-theme/lib/styles/design-platform.css`）：

| 用途 | 令牌（明/暗由宿主自动切换） |
| --- | --- |
| 面板底色 | `--dsw-alias-bg-layer-1` |
| 分隔线 | `--dsw-alias-border-l1` / `--dsw-alias-border-l2` |
| 标题文字 | `--dsw-alias-label-primary` |
| 次要/辅助文字 | `--dsw-alias-label-secondary` / `--dsw-alias-label-tertiary` |
| 品牌强调（运行态） | `--dsw-alias-state-business-primary` |
| 成功/新徽标 | `--dsw-alias-state-success-primary` |
| 错误 | `--dsw-alias-state-error-primary` |
| 警告 | `--dsw-alias-state-warn-primary` |
| 悬停底色 | `--dsw-alias-interactive-bg-hover` |
| 源标签底色/文字 | `--dsw-specific-bubble` / `--dsw-alias-state-business-primary` |
| 阴影 | `--dsw-alias-bg-mask-2` |

原型 `prototype/prototype.html` 内嵌了明暗两套静态值以便独立预览；真实插件直接引用 `var(--dsw-alias-*)`，由宿主注入。

## 10. 关键技术决策记录

| 决策 | 选择 | 原因（已核实） |
| --- | --- | --- |
| 面板位置 | `shell.overlay` 悬浮面板 | root 作用域、additive、`replaceRisk:none`，任意页面可见；`details` 列无会话时宽度为 0 且替换工具详情面板 |
| 点击开链接 | 原生 `<a target="_blank">` | Client 无 `window` 全局（Builtins 已核对） |
| 源脚本执行 | `codeRuntime`（worker-thread） | 隔离、结构化返回 JSON、`dsh-web-app` 已依赖 `dsh-code-runtime-worker-thread`；回退：`shell.run node` |
| 搜索 | `web.search`（DeepSeek provider 已挂载） | 直连服务调用，无审批负担 |
| 正文抓取 | `web.fetch` 优先，`curl`（`shell.run`）回退 | 本部署未挂载 fetch provider；插件自身无 fetch 全局 |
| 模型调用 | `llm.stream` + 手工构造消息 | `GenerateOptions`/`ContentBlock` 形状已核对（dsh-llm） |
| 数据推送 | Client 15s 轮询 RPC | Package RPC 为 Client→Host 单向，无推送通道 |

## 11. 已知限制与扩展点

- 悬浮面板与详情列（details）同时打开时会覆盖其右缘 → 可折叠面板缓解。
- 示例源依赖站点可用性与反爬策略，失败按第 3 节表格降级。
- 扩展：桌面通知联动、卡片偏好持久化、面板宽度拖拽、配置 UI、模板 TS 类型声明。
