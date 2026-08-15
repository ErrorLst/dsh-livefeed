/* LiveFeed 示例源：Hacker News（Algolia JSON API）
 * - coarseSearch：抓取 search_by_date JSON，用 jsonItems 规整为 items
 * - fineSearch：不实现，使用基类默认实现（抓取 item.url 提取正文）
 */
async function coarseSearch(api) {
  const cfg = api.config();
  const q = encodeURIComponent(cfg.query || '');
  const page = await fetchPage(
    api,
    `https://hn.algolia.com/api/v1/search_by_date?query=${q}&tags=story`
  );
  const data = JSON.parse(page.body.content);
  return jsonItems((data && data.hits) || [], {
    titleKey: 'title',
    urlKey: 'url',
    snippetKey: 'story_text',
    publishedAtKey: 'created_at',
    urlFallback: (h) => `https://news.ycombinator.com/item?id=${h.objectID}`,
  });
}
