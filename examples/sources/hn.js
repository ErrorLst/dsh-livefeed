/* LiveFeed 示例源：Hacker News（直接抓取 news.ycombinator.com，不依赖第三方 API）
 *
 * - coarseSearch：抓取首页 HTML，解析 athing/subtext 行：
 *   标题 + 链接（Ask/Show HN 无外链时回退 item 页）+ 分数/评论数（作 snippet 供筛选参考）+ 发布时间（age title）
 * - fineSearch：HN 条目页（Ask/Show HN）→ 评论表单前的 toptext 正文；外部文章 → 基类默认实现
 * 说明：首页为热榜（按分数排序，更新较慢）；如需「最新」流，把 URL 换成 https://news.ycombinator.com/newest 即可。
 */
async function coarseSearch(api) {
  const page = await fetchPage(api, 'https://news.ycombinator.com/');
  const html = String(page.body.content || '');
  const items = [];
  // 行结构：<tr class="athing submission" id="…">标题列</tr><tr>…<td class="subtext">…</td></tr>
  const rowRe = /<tr class=(['"])athing submission\1 id=\1(\d+)\1>([\s\S]*?)<\/tr>\s*<tr>([\s\S]*?class=(['"])subtext\5[\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const titleCell = m[3] || '';
    const subtext = m[4] || '';
    const tl = titleCell.indexOf('class="titleline"');
    const anchor = tl >= 0 ? titleCell.slice(tl).match(/<a href=(['"])(.*?)\1>([\s\S]*?)<\/a>/) : null;
    if (!anchor) continue;
    let href = String(anchor[2] || '');
    const title = htmlToText(anchor[3] || '', 300);
    if (!href || !title) continue;
    if (href.indexOf('item?id=') === 0) href = 'https://news.ycombinator.com/' + href;
    else if (href.indexOf('//') === 0) href = 'https:' + href;
    else if (href.indexOf('http') !== 0) href = 'https://news.ycombinator.com/' + href;
    const age = subtext.match(/class=(['"])age\1[^>]*title=(['"])(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
    const score = subtext.match(/class=(['"])score\1[^>]*>([\d.]+) points/);
    const com = subtext.match(/>(\d+)&nbsp;comments/);
    items.push({
      title,
      url: href,
      snippet: 'HN ' + (score ? score[2] : '0') + ' points · ' + (com ? com[1] : '0') + ' comments',
      publishedAt: age ? age[3] : undefined,
    });
  }
  return items;
}

// 精搜：HN 条目页 → 评论表单前的 toptext（帖子正文）；外部文章 → 基类默认实现（抓取 item.url 提取正文）
async function fineSearch(api, item) {
  const m = String(item.url || '').match(/news\.ycombinator\.com\/item\?id=(\d+)/);
  if (m) {
    const page = await fetchPage(api, 'https://news.ycombinator.com/item?id=' + m[1]);
    const head = String(page.body.content || '').split('<form action="comment"')[0];
    const body = head.match(/class=(['"])toptext\1[^>]*>([\s\S]*?)<\/div>/);
    const text = body ? htmlToText(body[2], 8000) : '';
    if (!text) throw new Error('HN 条目无正文: ' + item.url);
    return { text };
  }
  const page = await fetchPage(api, item.url);
  return { text: htmlToText(page.body.content, 8000) };
}
