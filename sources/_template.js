/* ═══════════════════════════════════════════════════════════════════════════
 * dsh-livefeed 搜索源基类模板（Base Template）
 * ═══════════════════════════════════════════════════════════════════════════
 * Host 将本模板与源脚本拼接（program = 模板 + "\n" + 源脚本）后，作为
 * codeRuntime 的 program 运行。源脚本只需实现：
 *
 *   async function coarseSearch(api)   // 必选：粗搜，返回 [{title, url, snippet?, publishedAt?, replyCount?, views?, likes?, tags?}]
 *   async function fineSearch(api, item) // 可选：精搜，返回 { text }（默认实现见下）
 *
 * 模板在文件尾部注入调度器，依据 api.mode() 分派；归一化/截断/去重由模板统一完成。
 * 源脚本请勿重新声明第 4 节保留名（见 docs/source-contract.md）。
 * 本文件是 Host 内置模板常量的源头：修改后需同步到 Host 代码中的模板常量。
 */
'use strict';

// ────────────────────────────────────────────────────────────────────────────
// 常量
// ────────────────────────────────────────────────────────────────────────────
const MAX_CONTENT_CHARS = 8000;   // 精搜正文上限（字符）
const DEFAULT_MAX_ITEMS = 15;     // 粗搜默认条目上限

// ────────────────────────────────────────────────────────────────────────────
// 子类契约：coarseSearch 必选，fineSearch 可选（有默认实现）
// ────────────────────────────────────────────────────────────────────────────
async function coarseSearch(api) {
  // 默认粗搜：通用 web.search 型（源脚本未实现且未配置 query 时抛错提示）
  const cfg = await api.config(null);
  const q = String((cfg && cfg.query) || '').trim();
  if (!q) {
    throw new Error('[dsh-livefeed] 未实现 coarseSearch 且源未配置 query');
  }
  const r = await searchWeb(api, q, (cfg && cfg.maxItems) || DEFAULT_MAX_ITEMS);
  return r.map((s) => ({
    title: s.title || s.url,
    url: s.url,
    snippet: s.snippet || '',
    publishedAt: s.publishedAt || undefined,
  }));
}

async function fineSearch(api, item) {
  // 默认精搜：抓取条目 URL 并提取正文（纯链接列表型源无需覆盖）
  const page = await fetchPage(api, item.url);
  return { text: htmlToText(page.body.content, MAX_CONTENT_CHARS) };
}

// ────────────────────────────────────────────────────────────────────────────
// 公共工具（基类方法，源脚本可直接调用）
// ────────────────────────────────────────────────────────────────────────────
/** 包装 api.search，返回 sources[] */
async function searchWeb(api, query, maxResults) {
  const r = await api.search({
    query: String(query),
    maxResults: maxResults || DEFAULT_MAX_ITEMS,
  });
  return (r && Array.isArray(r.sources) ? r.sources : []);
}

/** 包装 api.fetchContent */
async function fetchPage(api, url) {
  return api.fetchContent({ url: String(url) });
}

/** HTML 实体解码（含 <br> 换行、去标签、数字/十六进制实体如 &#x2F;） */
function decodeEntities(s) {
  return String(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/gi, '&');
}

/** 通用 HTML→文本：去标签、压缩空白，可选截断 */
function htmlToText(html, maxLen) {
  let text = decodeEntities(html)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (maxLen && text.length > maxLen) text = text.slice(0, maxLen) + '…';
  return text;
}

/** 取值辅助（字符串键或函数） */
function pick(obj, key) {
  if (key === null || key === undefined) return '';
  if (typeof key === 'function') return key(obj);
  const v = obj[key];
  return v === null || v === undefined ? '' : String(v);
}

/** 将 JSON API 列表规整为 items：{titleKey, urlKey, snippetKey?, publishedAtKey?, urlFallback?} */
function jsonItems(list, opts) {
  const o = opts || {};
  return (Array.isArray(list) ? list : []).map((x) => ({
    title: pick(x, o.titleKey),
    url: pick(x, o.urlKey) || (typeof o.urlFallback === 'function' ? pick(x, o.urlFallback) : ''),
    snippet: o.snippetKey ? pick(x, o.snippetKey) : '',
    publishedAt: o.publishedAtKey ? pick(x, o.publishedAtKey) || undefined : undefined,
  }));
}

// ────────────────────────────────────────────────────────────────────────────
// 归一化（模板内部）
// ────────────────────────────────────────────────────────────────────────────
function _normalizeTitles(items, cfg) {
  if (!Array.isArray(items)) {
    throw new Error('[dsh-livefeed] coarseSearch 必须返回数组');
  }
  const max = (cfg && cfg.maxItems) || DEFAULT_MAX_ITEMS;
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const url = String(it.url || '').trim();
    const title = String(it.title || '').trim();
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    out.push({
      title,
      url,
      snippet: it.snippet ? String(it.snippet).slice(0, 500) : '',
      publishedAt: typeof it.publishedAt === 'string' ? it.publishedAt : undefined,
      // 附加字段（源脚本可携带，供 Host 的 AI 价值筛选使用；缺失时安全回退）
      replyCount: Number(it.replyCount) || 0,
      postsCount: Number(it.postsCount) || 0,
      views: Number(it.views) || 0,
      likes: Number(it.likes) || 0,
      tags: Array.isArray(it.tags) ? it.tags.map(String) : [],
    });
    if (out.length >= max) break;
  }
  return out;
}

function _normalizeContent(out) {
  if (!out || typeof out !== 'object') {
    throw new Error('[dsh-livefeed] fineSearch 必须返回 { text }');
  }
  const text = String(out.text || '').trim();
  if (!text) throw new Error('[dsh-livefeed] fineSearch 返回的正文为空');
  return { text: text.slice(0, MAX_CONTENT_CHARS) };
}

// ────────────────────────────────────────────────────────────────────────────
// 调度器（模板内置；源脚本无需关心）
// ────────────────────────────────────────────────────────────────────────────
async function _dshLivefeedDispatcher() {
  const mode = await api.mode(null);
  if (mode === 'titles') {
    return _normalizeTitles(await coarseSearch(api), await api.config(null));
  }
  if (mode === 'content') {
    const item = await api.item(null);
    return _normalizeContent(await fineSearch(api, item));
  }
  throw new Error('[dsh-livefeed] 未知模式: ' + String(mode));
}

return await _dshLivefeedDispatcher();
