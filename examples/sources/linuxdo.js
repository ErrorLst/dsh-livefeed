/* LiveFeed 源：Linux Do 论坛（linux.do，Discourse）—— 唯一固定源
 *
 * 背景：linux.do 全站位于 Cloudflare 托管质询之后，纯 HTTP 客户端一律 403。
 * config.json 本源行配置 "fetch": "browser" → Host 用系统 Edge（有头离屏，
 * playwright-core）直连抓取，走系统代理，不依赖任何第三方服务。
 *
 * 粗搜两条列表（顺序：最新 → 最热门；跨列表按 URL 去重；跳过置顶帖）：
 * 1. latest.json —— 全站最新话题（分页翻取）；
 * 2. hot.json —— 热门话题（heat 热度排序，含较早发布但仍在活跃的话题）。
 * cfg.maxItems = fetchCount：单次从两个列表共收集 target 条「新」话题（跳过已读/已采集与固定屏蔽标签）。
 * （linux.do 的 search.json 对匿名请求限流 429，故不使用搜索接口；query 留空）
 * 精搜：话题 JSON（/t/{id}.json）→ 首帖 cooked(HTML) 转文本
 *
 * 条目额外携带 replyCount/views/likes/tags 等字段，供 Host 的 AI 价值筛选使用。
 */
// 轻量 URL 归一化：去 scheme/fragment/尾斜杠（与 Host 的 seenUrls 比对口径一致，兼容 http/https 变体）
function normUrl(u) {
  return String(u || '').replace(/^https?:\/\//i, '').split('#')[0].replace(/\/+$/, '');
}

async function coarseSearch(api) {
  const cfg = await api.config(null);
  const target = Math.max(1, Number(cfg && cfg.maxItems) || 40); // 目标：收集 target 条「新」话题（= 拉取数量）
  const seenUrls = new Set((await api.seenUrls(null) || []).map(normUrl)); // 已读/已采集 URL（Host 传入，按 URL 去重不重复拉取）
  const blockTags = Array.isArray(cfg && cfg.blockTags) ? cfg.blockTags.map(String) : []; // 固定屏蔽标签
  const out = [];
  const seen = new Set();
  const listUrls = [
    'https://linux.do/latest.json',
    'https://linux.do/hot.json',
  ];
  for (const listUrl of listUrls) {
    if (out.length >= target) break;
    // Discourse 分页为 0 基：page=0（不带参数）才是第一页
    for (let page = 0; page <= 6 && out.length < target; page++) {
      const listPageUrl = page === 0 ? listUrl : listUrl + (listUrl.indexOf('?') >= 0 ? '&' : '?') + 'page=' + page;
      const data = parseJsonBody((await fetchPage(api, listPageUrl)).body.content, listUrl.split('/').pop() + ' p' + page);
      const topics = (data && data.topic_list && data.topic_list.topics) || [];
      if (!topics.length) break; // 翻到空页即止
      for (const t of topics) {
        if (out.length >= target) break;
        if (!t || !t.id || !t.title) continue;
        if (t.pinned) continue; // 置顶帖（论坛公告等）每周期重复出现，跳过
        const slug = String(t.slug || '');
        const itemUrl = 'https://linux.do/t/' + (slug ? slug + '/' : '') + t.id;
        if (seen.has(itemUrl)) continue; // 跨列表按 URL 去重（各列表常有重叠）
        seen.add(itemUrl);
        if (seenUrls.has(normUrl(itemUrl))) continue; // 已读/已采集 → 不重复拉取
        const title = String(t.title || '');
        const tags = Array.isArray(t.tags) ? t.tags.map(String) : [];
        // 固定屏蔽：只屏蔽「富可敌国」（标签含或标题任意位置含），其余一概不在此过滤
        if (blockTags.some((b) => tags.indexOf(b) >= 0 || title.indexOf(b) >= 0)) continue;
        out.push({
          title: title.slice(0, 300),
          url: itemUrl,
          snippet: String(t.blurb || '').slice(0, 500),
          publishedAt: t.created_at || undefined,
          replyCount: Number(t.reply_count) || 0,
          postsCount: Number(t.posts_count) || 0,
          views: Number(t.views) || 0,
          likes: Number(t.like_count) || 0,
          tags,
        });
      }
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
