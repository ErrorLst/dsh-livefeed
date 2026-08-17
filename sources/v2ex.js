/* LiveFeed 源：V2EX 热帖（www.v2ex.com）
 * - coarseSearch：官方公开 JSON API /api/topics/hot.json（无需登录/无 CF）
 *   → 热帖标题/链接/回复数/节点/发布时间
 * - fineSearch：基类默认实现（抓话题页提取正文）
 * 注意：V2EX 热榜含「推广」节点广告帖，是否收录交给模型筛选判断（snippet 含节点名）。
 */
async function coarseSearch(api) {
  const page = await fetchPage(api, 'https://www.v2ex.com/api/topics/hot.json');
  const raw = String(page.body.content || '');
  const start = raw.indexOf('[');
  if (start < 0) throw new Error('v2ex 响应不是 JSON 数组: ' + raw.slice(0, 200));
  let data = null;
  try { data = JSON.parse(raw.slice(start)); } catch (e) {
    throw new Error('v2ex JSON 解析失败: ' + String((e && e.message) || e));
  }
  const out = [];
  for (const t of (Array.isArray(data) ? data : [])) {
    if (!t || !t.id || !t.title) continue;
    const url = String(t.url || '').trim() || ('https://www.v2ex.com/t/' + t.id);
    const node = (t.node && t.node.title) ? (' · 节点 ' + t.node.title) : '';
    out.push({
      title: String(t.title).slice(0, 300),
      url,
      snippet: 'V2EX 热帖 · 回复 ' + (t.replies || 0) + node,
      publishedAt: t.created ? new Date(t.created * 1000).toISOString() : undefined,
    });
  }
  return out;
}
