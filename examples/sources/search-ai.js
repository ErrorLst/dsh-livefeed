/* LiveFeed 示例源：搜索引擎型（search-ai）
 * - coarseSearch：用 searchWeb（web.search 服务）按 config.query 粗搜，返回标题/链接
 * - fineSearch：不实现，使用基类默认实现（抓取 item.url 提取正文）
 */
async function coarseSearch(api) {
  const cfg = api.config();
  const r = await searchWeb(api, cfg.query, cfg.maxItems || 15);
  return r.map((s) => ({
    title: s.title || s.url,
    url: s.url,
    snippet: s.snippet || '',
    publishedAt: s.publishedAt || undefined,
  }));
}
