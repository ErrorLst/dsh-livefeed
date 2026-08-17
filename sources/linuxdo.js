/* LiveFeed 源：Linux Do 论坛（linux.do，Discourse）
 *
 * 背景：linux.do 全站位于 Cloudflare 托管质询之后，纯 HTTP 客户端一律 403。
 * config.json 本源行配置 "fetch": "browser" → Host 用系统 Edge（有头离屏，
 * playwright-core）直连抓取，走系统代理，不依赖任何第三方服务。
 *
 * 粗搜三条路径（顺序：最新 → 热门 → 本周排行；跨列表去重）：
 * 1. latest.json —— 全站最新 30 条话题；
 * 2. hot.json —— 热门话题（heat 热度排序，含较早发布但仍在活跃的话题）；
 * 3. top.json?period=weekly —— 本周排行（点赞/浏览量维度）。
 * 各列表均过滤置顶帖；config 的 maxItems 决定合并后送入筛选的总数（建议 ≥90）。
 * （linux.do 的 search.json 对匿名请求限流 429，故不使用搜索接口；query 留空）
 * 精搜：话题 JSON（/t/{id}.json）→ 首帖 cooked(HTML) 转文本
 */
async function coarseSearch(api) {
  const out = [];
  const seen = new Set();
  const listUrls = [
    'https://linux.do/latest.json',
    'https://linux.do/hot.json',
    'https://linux.do/top.json?period=weekly',
  ];
  for (const listUrl of listUrls) {
    const page = await fetchPage(api, listUrl);
    const data = parseJsonBody(page.body.content, listUrl.split('/').pop());
    const topics = (data && data.topic_list && data.topic_list.topics) || [];
    for (const t of topics) {
      if (!t || !t.id || !t.title) continue;
      if (t.pinned) continue; // 置顶帖（论坛公告等）每周期重复出现，跳过
      const slug = String(t.slug || '');
      const itemUrl = 'https://linux.do/t/' + (slug ? slug + '/' : '') + t.id;
      if (seen.has(itemUrl)) continue; // 跨列表按 URL 去重（各列表常有重叠）
      seen.add(itemUrl);
      out.push({
        title: String(t.title).slice(0, 300),
        url: itemUrl,
        snippet: String(t.blurb || '').slice(0, 500),
        publishedAt: t.created_at || undefined,
      });
    }
  }
  return out;
}

async function fineSearch(api, item) {
  const id = String(item.url || '').split('/').pop();
  const page = await fetchPage(api, 'https://linux.do/t/' + id + '.json');
  const data = parseJsonBody(page.body.content, 'topic ' + id);
  const first = data && data.post_stream && data.post_stream.posts && data.post_stream.posts[0];
  if (!first) throw new Error('linuxdo 帖子内容为空: ' + item.url);
  const text = htmlToText(first.cooked || '', 8000);
  if (!text) throw new Error('linuxdo 帖子正文为空: ' + item.url);
  return { text };
}

// 响应应为 JSON；若停在 CF 质询页或非 JSON，给出可读错误（状态行展示）
function parseJsonBody(content, what) {
  const raw = String(content || '');
  if (raw.indexOf('请稍候') >= 0 || raw.indexOf('Just a moment') >= 0 || raw.indexOf('cf-chl') >= 0) {
    throw new Error('linuxdo ' + what + ' 停留在 Cloudflare 质询页（请稍后重试）');
  }
  const start = raw.indexOf('{');
  if (start < 0) throw new Error('linuxdo ' + what + ' 响应不是 JSON: ' + raw.slice(0, 200));
  try {
    return JSON.parse(raw.slice(start));
  } catch (e) {
    throw new Error('linuxdo ' + what + ' JSON 解析失败: ' + String((e && e.message) || e));
  }
}
