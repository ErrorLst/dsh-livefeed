/* LiveFeed 源：Solidot（www.solidot.org，奇客资讯）
 * - coarseSearch：官方 RSS /index.rss（20 条，CDATA 包裹标题/链接/摘要/时间）
 * - fineSearch：基类默认实现（抓 /story?sid=… 页面提取正文）
 */
async function coarseSearch(api) {
  const page = await fetchPage(api, 'https://www.solidot.org/index.rss');
  const raw = String(page.body.content || '');
  const out = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(raw)) !== null) {
    const title = rssField(m[1], 'title');
    const url = rssField(m[1], 'link');
    if (!title || !url) continue;
    const pub = rssField(m[1], 'pubDate');
    out.push({
      title: title.slice(0, 300),
      url,
      snippet: rssField(m[1], 'description').slice(0, 500),
      publishedAt: pub ? new Date(pub).toISOString() : undefined,
    });
  }
  return out;
}

// RSS 字段提取（自动剥 CDATA）
function rssField(xml, name) {
  const m = xml.match(new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>'));
  if (!m) return '';
  let v = m[1].trim();
  if (v.indexOf('<![CDATA[') === 0 && v.slice(-3) === ']]>') v = v.slice(9, -3);
  return decodeEntities(v).trim();
}
