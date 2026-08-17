# 搜索源基类模板契约（Source Contract）

> 所有搜索源脚本共用一套基类模板（`src/template/template.js`）。源脚本只需实现两个方法，其余（调度、校验、截断、公共工具）由模板统一处理。
> 模板以「内置常量」存在于 Host 代码中；若配置目录存在 `sources/_template.js` 则以文件内容覆盖（改坏时 Host 回退内置模板并在日志提示）。

## 1. 执行模型

Host 将模板与源脚本拼接（`program = 模板 + "\n" + 源脚本`）后，作为 `codeRuntime` 的 program 运行：

- program 是 **async 函数体**：支持顶层 `await` 与 `return`，返回值必须是可序列化 JSON；
- 源脚本**不得**直接访问网络/文件/进程（隔离沙箱），只能调用注入的 `api` 绑定；
- 模板在拼接文本的**尾部**注入调度器，根据 `api.mode()` 分派到粗搜或精搜。

## 2. 源脚本必须/可选实现

| 方法 | 必选 | 签名 | 返回 |
| --- | --- | --- | --- |
| `coarseSearch(api)` | ✅ | 异步函数 | `[{ title: string, url: string, snippet?: string, publishedAt?: string }]`（粗搜：标题等粗略信息） |
| `fineSearch(api, item)` | ⭕ 有默认实现 | 异步函数 | `{ text: string }`（精搜：输入粗搜条目，返回详细内容） |

- `fineSearch` 默认实现：`fetchPage(api, item.url)` 抓取页面并 `htmlToText` 提取正文（纯链接列表型源可只写 `coarseSearch`）。
- 模板会做归一化校验：粗搜结果必须是数组、每项必须有非空 `title` 与 `url`、按 `config.maxItems ?? 15` 截断、按 URL 去重；精搜结果必须是含非空 `text` 的对象，文本截断到 8000 字符。
- 源脚本**不得重新声明**模板中的名字（见第 4 节保留名清单）。

## 3. `api` 绑定（Host 注入，参数/返回值均为 JSON）

> ⚠️ **传参约定**：codeRuntime 的绑定调用必须**恰好传一个 JSON 参数**（无参调用会被判定为 `undefined` 而拒绝，报 `binding arguments must be lossless JSON`）。无参语义的接口请显式传 `null`，如 `api.config(null)`。

| 方法 | 说明 |
| --- | --- |
| `api.mode(null)` | `'titles' \| 'content'`，由调度器调用 |
| `api.config(null)` | 该 source 的配置对象（`id/name/query/maxItems/…`） |
| `api.item(null)` | content 模式下 Host 传入的候选条目（粗搜结果之一） |
| `api.search({ query, maxResults? })` | 网络搜索 → `{ sources: [{url, title?, snippet?, publishedAt?}] }`（DeepSeek 搜索服务） |
| `api.fetchContent({ url })` | 抓取页面 → `{ url, statusCode, body: {kind:'html'\|'text', content}, truncated }`（内部：`web.fetch` 优先，`curl` 回退，代理自动生效） |

## 4. 模板内置工具（基类方法，源脚本可直接调用）

| 工具 | 说明 |
| --- | --- |
| `searchWeb(api, query, maxResults)` | 包装 `api.search`，返回 `sources[]` |
| `fetchPage(api, url)` | 包装 `api.fetchContent` |
| `htmlToText(html, maxLen?)` | 去标签/解实体/压缩空行的通用 HTML→文本 |
| `decodeEntities(s)` | HTML 实体解码 |
| `jsonItems(list, opts)` | 将 JSON API 列表规整为 items；opts：`{titleKey, urlKey, snippetKey?, publishedAtKey?, urlFallback?}` |

**保留名（源脚本不要重新声明）**：`coarseSearch`、`fineSearch`、`searchWeb`、`fetchPage`、`htmlToText`、`decodeEntities`、`jsonItems`、`MAX_CONTENT_CHARS`、`DEFAULT_MAX_ITEMS`、`_normalizeTitles`、`_normalizeContent`、`_dshLivefeedDispatcher`、`api`。

## 5. 新增搜索源（三步）

1. 新建 `sources/<源id>.js`，实现 `coarseSearch`（及可选 `fineSearch`）；
2. `config.json` 的 `sources` 数组增加一行：`{ "id", "name", "script": "sources/<源id>.js", "query", "enabled": true }`；
   可选源级阈值：`maxItems`（粗搜上限，覆盖全局 `maxCoarseItems`，默认 15）、`maxCandidates`（精搜候选上限，覆盖全局 `maxCandidatesPerSource`，默认 5）；留空则用全局默认值；
3. 等待下一周期（或点面板「立即刷新」）生效；脚本报错会显示在面板状态行。

## 6. 完整示例：Linux.do（Discourse 论坛，受 Cloudflare 保护）

> ⚠️ linux.do 全站位于 Cloudflare 托管质询之后：纯 HTTP 客户端（web.fetch / Node fetch / curl）走代理也只会拿到 403「Just a moment…」挑战页，直连更是超时；无头浏览器会被识别且质询永不解开。本源在 config.json 配置 `"fetch": "browser"`，由 Host 用**系统 Edge（有头离屏窗口，playwright-core）**直连抓取，走系统代理，不依赖任何第三方服务。完整脚本见 [linuxdo.js](../examples/sources/linuxdo.js)，要点：

```js
// config.json 源行需带 fetch:"browser"（Host 侧跳过 web.fetch/node/curl 直接走浏览器）
// 粗搜两条路径：latest.json（最新 30 条）+ hot.json（热门，含较早但活跃的话题）；
// 合并去重、过滤置顶帖；search.json 对匿名请求限流 429，勿用。源行 maxItems 建议 ≥60。
async function coarseSearch(api) {
  const out = [];
  const seen = new Set();
  for (const listUrl of ['https://linux.do/latest.json', 'https://linux.do/hot.json']) {
    const page = await fetchPage(api, listUrl);
    const data = parseJsonBody(page.body.content, listUrl.split('/').pop());   // 见下
    const topics = (data.topic_list.topics || [])                              // 注意是 topic_list.topics
      .filter((t) => t && t.id && t.title && !t.pinned);                       // 过滤置顶帖
    for (const t of topics) {
      const itemUrl = 'https://linux.do/t/' + (t.slug ? t.slug + '/' : '') + t.id;
      if (seen.has(itemUrl)) continue;                                         // 跨列表去重
      seen.add(itemUrl);
      out.push({ title: t.title, url: itemUrl, snippet: t.blurb || '', publishedAt: t.created_at || undefined });
    }
  }
  return out;
}

// 精搜：话题 JSON → 首帖正文（cooked 为 HTML，用 htmlToText 转文本）
async function fineSearch(api, item) {
  const id = String(item.url).split('/').pop();
  const page = await fetchPage(api, 'https://linux.do/t/' + id + '.json');
  const data = parseJsonBody(page.body.content, 'topic ' + id);
  const first = data?.post_stream?.posts?.[0];
  if (!first) throw new Error('帖子内容为空: ' + item.url);
  return { text: htmlToText(first.cooked, 8000) };
}

// 浏览器直连的响应应为原始 JSON；若仍停在 CF 质询页，给出可读错误（状态行展示）
function parseJsonBody(content, what) {
  const raw = String(content || '');
  if (raw.indexOf('请稍候') >= 0 || raw.indexOf('Just a moment') >= 0 || raw.indexOf('cf-chl') >= 0) {
    throw new Error(what + ' 停留在 Cloudflare 质询页（请稍后重试）');
  }
  const start = raw.indexOf('{');
  if (start < 0) throw new Error(what + ' 响应不是 JSON: ' + raw.slice(0, 200));
  try { return JSON.parse(raw.slice(start)); } catch (e) {
    throw new Error(what + ' JSON 解析失败: ' + String((e && e.message) || e));
  }
}
```

另见示例：[search-ai.js](../examples/sources/search-ai.js)（搜索引擎型）、[hn.js](../examples/sources/hn.js)（news.ycombinator.com 直抓解析，不依赖第三方 API）。

## 7. 受 Cloudflare 保护站点的抓取

**识别**：`fetchPage` 返回的正文以 "Just a moment…" / "Enable JavaScript and cookies to continue"（中文版为「请稍候…」）开头（或含 `cf-chl` / `cType: 'managed'`），且/或状态码 403 → 站点在 Cloudflare 托管质询（Turnstile）之后。此类质询**无法**用加 header 或纯 HTTP 手段绕过（curl 即使带完整浏览器头也 403），无头浏览器会被识别且质询永不解开——必须由**真实有头浏览器**执行 JS。

**可行做法（按优先级）**：

1. **Host 浏览器抓取（首选，无第三方）**：源行配置 `"fetch": "browser"` → Host 用 playwright-core 调**系统 Edge/Chrome（有头、离屏窗口）**直连抓取，走系统代理（不硬编码代理地址）。实测对 linux.do 秒级放行；浏览器会话整周期复用、空闲 90s 自动关闭、profile 存于 `CONFIG_DIR\edge-profile`（cookie 持久）。代价：每周期短暂出现一个离屏 Edge 窗口（任务栏可见图标）；依赖 playwright-core（npm 锁版本）。
2. **Jina Reader 前缀**（零 Host 改动，第三方备选）：把 URL 前缀为 `https://r.jina.ai/<url>`。Jina 用服务器端真实浏览器渲染，通常能通过质询；响应包一层固定 Markdown 头（`Title:`/`URL Source:`/`Markdown Content:`），从首个 `{` 截取即可还原原始 JSON。免费档约 20 请求/分钟，注意控制每周期请求数；源站限流（`{"failed":…}` / "Target URL returned error NNN"）时给出可读报错。
3. 源站自身的 JSON 接口若被限流（Discourse 的 `search.json` 对匿名请求 429），改用无需查询词的列表接口（如 `latest.json`）并过滤置顶帖。

源脚本内不要硬编码代理地址：抓取始终走 `api.fetchContent` 的现有链路（curl 自动继承环境变量代理；浏览器走系统代理）。
