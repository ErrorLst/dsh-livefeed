/* LiveFeed 示例源：Linux Do 论坛（linux.do，Discourse）
 *
 * 背景：linux.do 全站位于 Cloudflare 托管质询（managed challenge）之后，
 * 纯 HTTP 客户端（web.fetch / Node fetch / curl）直连或走代理均返回 403
 * 「Just a moment…」；本机直连亦超时。本源通过 Jina Reader
 * （https://r.jina.ai/<url>，服务器端真实浏览器渲染）抓取 Discourse JSON 接口绕过质询。
 *
 * - coarseSearch：latest.json（全站最新话题，约 30 条）→ 过滤置顶帖 → 标题/链接/简介/时间
 *   （linux.do 的 search.json 对匿名请求限流 429，故不使用搜索接口；config 的 query 留空）
 * - fineSearch：话题 JSON（/t/{id}.json）→ 首帖 cooked(HTML) 转文本
 */
async function coarseSearch(api) {
  const page = await fetchPage(api, 'https://r.jina.ai/https://linux.do/latest.json');
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
  const page = await fetchPage(api, 'https://r.jina.ai/https://linux.do/t/' + id + '.json');
  const data = parseJsonBody(page.body.content, 'topic ' + id);
  const first = data && data.post_stream && data.post_stream.posts && data.post_stream.posts[0];
  if (!first) throw new Error('linuxdo 帖子内容为空: ' + item.url);
  const text = htmlToText(first.cooked || '', 8000);
  if (!text) throw new Error('linuxdo 帖子正文为空: ' + item.url);
  return { text };
}

// jina 响应为「固定 Markdown 头 + 原始 JSON」；源站错误/限流时返回可读提示 —— 统一识别
function parseJsonBody(content, what) {
  const raw = String(content || '');
  if (raw.indexOf('Target URL returned error') >= 0) {
    const m = raw.match(/error (\d+)/);
    throw new Error('linuxdo ' + what + ' 源站错误' + (m ? ' HTTP ' + m[1] : '') + '（可能被限流，请稍后重试）');
  }
  if (raw.indexOf('"failed"') >= 0 || raw.indexOf('"FAILED"') >= 0) {
    throw new Error('linuxdo ' + what + ' Jina 抓取失败: ' + raw.slice(0, 200));
  }
  const start = raw.indexOf('{');
  if (start < 0) throw new Error('linuxdo ' + what + ' 响应不是 JSON: ' + raw.slice(0, 200));
  try {
    return JSON.parse(raw.slice(start));
  } catch (e) {
    throw new Error('linuxdo ' + what + ' JSON 解析失败: ' + String((e && e.message) || e));
  }
}
