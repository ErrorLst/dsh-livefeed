/* LiveFeed 示例源：Linux Do 论坛（linux.do，Discourse）
 *
 * 背景：linux.do 全站位于 Cloudflare 托管质询之后，纯 HTTP 客户端一律 403。
 * config.json 本源行配置 "fetch": "browser" → Host 用系统 Edge（有头离屏，
 * playwright-core）直连抓取，走系统代理，不依赖任何第三方服务。
 *
 * - coarseSearch：latest.json（全站最新话题，约 30 条）→ 过滤置顶帖 → 标题/链接/简介/时间
 *   （linux.do 的 search.json 对匿名请求限流 429，故不使用搜索接口；config 的 query 留空）
 * - fineSearch：话题 JSON（/t/{id}.json）→ 首帖 cooked(HTML) 转文本
 */
async function coarseSearch(api) {
  const page = await fetchPage(api, 'https://linux.do/latest.json');
  const data = parseJsonBody(page.body.content, 'latest.json');
  const topics = (data && data.topic_list && data.topic_list.topics) || [];
  const out = [];
  for (const t of topics) {
    if (!t || !t.id || !t.title) continue;
    if (t.pinned) continue; // 置顶帖（论坛公告等）每周期重复出现，跳过
    const slug = String(t.slug || '');
    out.push({
      title: String(t.title).slice(0, 300),
      url: 'https://linux.do/t/' + (slug ? slug + '/' : '') + t.id,
      snippet: String(t.blurb || '').slice(0, 500),
      publishedAt: t.created_at || undefined,
    });
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
