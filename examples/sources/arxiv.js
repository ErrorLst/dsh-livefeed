/* LiveFeed 源：arXiv 论文预印本（rss.arxiv.org）
 * - 粗搜：config.query 逗号分隔的分类（默认 "cs.AI,cs.CV,cs.LG"），逐类抓 RSS
 *   → 标题/abs 链接/摘要（Abstract 部分）/发布时间，跨分类按 URL 去重
 * - fineSearch：基类默认实现（抓 arxiv.org/abs/… 页面提取正文）
 */
async function coarseSearch(api) {
  const cfg = api.config(null);
  const cats = String(cfg.query || 'cs.AI,cs.CV,cs.LG').split(',').map((s) => s.trim()).filter(Boolean);
  if (!cats.length) throw new Error('arxiv 未配置分类（query 逗号分隔，如 cs.AI,cs.CV,cs.LG）');
  const out = [];
  const seen = new Set();
  for (const cat of cats) {
    const page = await fetchPage(api, 'https://rss.arxiv.org/rss/' + cat);
    const raw = String(page.body.content || '');
    const itemRe = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = itemRe.exec(raw)) !== null) {
      const title = rssField(m[1], 'title');
      const url = rssField(m[1], 'link');
      if (!title || !url || seen.has(url)) continue;
      seen.add(url);
      const pub = rssField(m[1], 'pubDate');
      const desc = rssField(m[1], 'description');
      const absPos = desc.indexOf('Abstract:');
      const abs = (absPos >= 0 ? desc.slice(absPos + 9) : desc).replace(/\s+/g, ' ').trim();
      out.push({
        title: title.slice(0, 300),
        url,
        snippet: ('arXiv ' + cat + ' · ' + abs).slice(0, 500),
        publishedAt: pub ? new Date(pub).toISOString() : undefined,
      });
    }
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
