/* LiveFeed 示例源：Linux.do 论坛（Discourse）
 * - coarseSearch：Discourse 搜索 JSON 接口 → 话题标题 + 链接（粗搜）
 * - fineSearch：话题 JSON 接口 → 首帖正文 cooked(HTML) 转文本（精搜）
 */
async function coarseSearch(api) {
  const cfg = api.config();
  const q = encodeURIComponent(cfg.query || '');
  const page = await fetchPage(api, `https://linux.do/search.json?q=${q}&order=latest`);
  const data = JSON.parse(page.body.content);
  return (data.topics || []).map((t) => ({
    title: t.title,
    url: `https://linux.do/t/${t.slug}/${t.id}`,
    snippet: t.blurb || '',
    publishedAt: t.created_at || undefined,
  }));
}

async function fineSearch(api, item) {
  const id = String(item.url).split('/').pop();
  const page = await fetchPage(api, `https://linux.do/t/${id}.json`);
  const data = JSON.parse(page.body.content);
  const first = data && data.post_stream && data.post_stream.posts && data.post_stream.posts[0];
  if (!first) throw new Error('帖子内容为空: ' + item.url);
  return { text: htmlToText(first.cooked, 8000) };
}
