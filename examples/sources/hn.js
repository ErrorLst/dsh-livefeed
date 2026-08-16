/* LiveFeed 示例源：Hacker News（Algolia JSON API）
 *
 * - coarseSearch：search_by_date 按发布时间倒序拉取最新 story；
 *   query 留空 = 全站最新（配合面板兴趣/屏蔽规则 + LLM 过滤做筛选）；
 *   可选 cfg.minPoints（numericFilters=points>=N）过滤低质量条目。
 *   Ask HN / Show HN 无外链时 urlFallback 到 news.ycombinator.com/item?id=<objectID>。
 * - fineSearch：HN 条目页（Ask/Show HN 等无外链帖子）走 Algolia items/<id>
 *   接口取正文（避免默认实现抓整页评论区）；外部文章走基类默认实现。
 */
async function coarseSearch(api) {
  const cfg = api.config();
  const q = encodeURIComponent(cfg.query || '');
  const numeric = cfg.minPoints
    ? '&numericFilters=' + encodeURIComponent('points>=' + cfg.minPoints)
    : '';
  const page = await fetchPage(
    api,
    `https://hn.algolia.com/api/v1/search_by_date?query=${q}&tags=story${numeric}`
  );
  const data = JSON.parse(page.body.content);
  return jsonItems((data && data.hits) || [], {
    titleKey: 'title',
    urlKey: 'url',
    snippetKey: 'story_text',
    publishedAtKey: 'created_at',
    urlFallback: (h) => `https://news.ycombinator.com/item?id=${h.objectID}`,
  }).map((it) => ({ ...it, snippet: htmlToText(it.snippet, 500) }));
}

// 精搜：HN 条目页 → Algolia items 接口正文；外部文章 → 基类默认（抓取 item.url 提取正文）
async function fineSearch(api, item) {
  const m = String(item.url || '').match(/news\.ycombinator\.com\/item\?id=(\d+)/);
  if (m) {
    const page = await fetchPage(api, `https://hn.algolia.com/api/v1/items/${m[1]}`);
    const data = JSON.parse(page.body.content);
    const text = String((data && data.text) || item.snippet || '').trim();
    if (!text) throw new Error('HN 条目无正文: ' + item.url);
    return { text: htmlToText(text, 8000) };
  }
  const page = await fetchPage(api, item.url);
  return { text: htmlToText(page.body.content, 8000) };
}
