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

## 6. 完整示例：Linux.do（Discourse 论坛）

```js
// sources/linuxdo.js
// 粗搜：Discourse JSON 搜索接口 → 话题标题 + 链接
async function coarseSearch(api) {
  const q = encodeURIComponent(api.config(null).query || '');
  const page = await fetchPage(api, `https://linux.do/search.json?q=${q}&order=latest`);
  const data = JSON.parse(page.body.content);
  return (data.topics || []).map((t) => ({
    title: t.title,
    url: `https://linux.do/t/${t.slug}/${t.id}`,
    snippet: t.blurb || '',
    publishedAt: t.created_at || undefined,
  }));
}

// 精搜：话题 JSON 接口 → 首帖正文（cooked 为 HTML，用 htmlToText 转文本）
async function fineSearch(api, item) {
  const id = String(item.url).split('/').pop();
  const page = await fetchPage(api, `https://linux.do/t/${id}.json`);
  const data = JSON.parse(page.body.content);
  const first = data?.post_stream?.posts?.[0];
  if (!first) throw new Error('帖子内容为空: ' + item.url);
  return { text: htmlToText(first.cooked, 8000) };
}
```

另见示例：[search-ai.js](../examples/sources/search-ai.js)（搜索引擎型）、[hn.js](../examples/sources/hn.js)（news.ycombinator.com 直抓解析，不依赖第三方 API）、[linuxdo.js](../examples/sources/linuxdo.js)。
