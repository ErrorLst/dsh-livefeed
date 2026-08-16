const name = "dsh-livefeed";
const inject = ["timer", "web", "llm", "fs", "agentDefaultModel", "webServer"];
function apply(ctx) {
    // ══ 常量 ══
    const CONFIG_DIR = 'C:\\Users\\zhoujin\\Pictures\\dsh-workspace\\.dsh\\dsh-livefeed';
    const CONFIG_FILE = CONFIG_DIR + '\\config.json';
    const STATE_FILE = CONFIG_DIR + '\\state.json';
    const HISTORY_FILE = CONFIG_DIR + '\\history.jsonl';
    const PREFERENCES_FILE = CONFIG_DIR + '\\preferences.json';
    const TEMPLATE_FILE = CONFIG_DIR + '\\sources\\_template.js';
    const ROUTE_PATH = '/api/dsh-livefeed';
    const DEFAULT_INTERVAL_MIN = 60;
    const DEFAULT_MAX_CARDS = 8;
    const DEFAULT_MAX_CANDIDATES = 5;
    const DEFAULT_MAX_ITEMS = 15; // 粗搜默认上限（与模板 DEFAULT_MAX_ITEMS 同值）
    const DEFAULT_ARCHIVE_MAX = 5000;
    const FEEDBACK_WINDOW = 50;
    const FILTER_LOG_CAP = 200;
    const RETRY_MAX = 2;
    const RETRY_BASE_MS = 5 * 60 * 1000;
    const TICK_MS = 30 * 1000; // 调度器基础节拍（实际周期由 config.intervalMinutes 决定）

    // ══ 基类模板 ══
    // 基类模板：以运行目录 sources/_template.js 为主要来源（项目初始化时已就位）。
    // 如需内置常量兜底：将 src/template/template.js 的内容 btoa 后内联到此处。
    const BUILTIN_TEMPLATE = '';

    // ══ 运行时状态（进程内存）══
    const state = {
      config: null,          // 当前配置（加载失败时用内置默认）
      cards: [],             // 面板卡片（未读 + 不感兴趣 + 有界已读）
      seenUrls: new Set(),   // 持久去重集合（启动装载，周期追加）
      archive: [],           // history.jsonl 内存镜像（有界）
      preferences: null,     // 规则文档（AI 维护 + 用户可编辑）
      exemptUrls: new Set(), // 豁免集（撤销屏蔽）
      feedbackQueue: [],     // 未消费的「不感兴趣」标记（有界，规则学习消费）
      filterLog: [],         // 被屏蔽内容（内存，有界；标题为 AI 译文）
      pendingRejected: [],   // 本周期待翻译的被拒条目（周期结束批量翻译后写入 filterLog）
      titleCache: new Map(), // 标题译文缓存（url(normalized) → 译文，防重复翻译）
      cycleStats: null,      // {scanned, selected, filtered}
      running: false,
      paused: false,
      retrying: 0,
      lastRunAt: undefined,
      lastError: undefined,
      sourceErrors: [],
      tick: 0,
      mid: 0,                // 消息 id 计数器
    };
    let disposed = false;

    // ══ fs 工具 ══
    async function fsRead(absPath) {
      try {
        const target = await ctx.fs.resolve(absPath);
        return await ctx.fs.readText(target);
      } catch (_) {
        return null;
      }
    }
    async function fsWrite(absPath, content) {
      try {
        const target = await ctx.fs.resolve(absPath);
        await ctx.fs.writeText(target, content);
        return true;
      } catch (err) {
        console.error('[dsh-livefeed] write failed:', absPath, String(err && err.message || err));
        return false;
      }
    }
    function parseJson(text, fallback) {
      try {
        return text ? JSON.parse(text) : fallback;
      } catch (_) {
        return fallback;
      }
    }
    // RPC 返回必须是无损 JSON：递归把 undefined 归一为 null（Date 等非常规对象不会出现在载荷中）
    function jsonSafe(v) {
      if (v === undefined) return null;
      if (v === null || typeof v !== 'object') return v;
      if (Array.isArray(v)) return v.map(jsonSafe);
      const out = {};
      for (const k of Object.keys(v)) out[k] = jsonSafe(v[k]);
      return out;
    }

    // ══ 默认值 ══
    function defaultConfig() {
      return {
        intervalMinutes: DEFAULT_INTERVAL_MIN,
        maxCards: DEFAULT_MAX_CARDS,
        maxCandidatesPerSource: DEFAULT_MAX_CANDIDATES,
        maxCoarseItems: DEFAULT_MAX_ITEMS,
        summaryLanguage: 'zh-CN',
        interests: [],
        blockWords: [],
        archiveMaxEntries: DEFAULT_ARCHIVE_MAX,
        model: null,
        sources: [],
      };
    }
    function defaultPreferences() {
      return { version: 1, updatedAt: undefined, prefer: [], block: [], sourceWeights: {}, semanticNotes: '' };
    }
    function mergeConfig(base, cfg) {
      if (!cfg || typeof cfg !== 'object') return base;
      const out = {};
      for (const k of Object.keys(base)) out[k] = cfg[k] !== undefined ? cfg[k] : base[k];
      if (!Array.isArray(out.sources)) out.sources = [];
      if (!Array.isArray(out.interests)) out.interests = [];
      if (!Array.isArray(out.blockWords)) out.blockWords = [];
      return out;
    }

    // ══ URL 归一化（正则实现）══
    function normalizeUrl(raw) {
      let s = String(raw || '').trim();
      if (!s) return s;
      s = s.split('#')[0].replace(/\/+$/, '');
      const m = s.match(/^https?:\/\/([^\/]+)(.*)$/i);
      if (m) s = 'http://' + m[1].toLowerCase() + m[2];
      return s;
    }

    // ══ 模型调用（llm.stream + 手工构造消息）══
    function resolveModel() {
      const cfgModel = state.config && state.config.model;
      if (cfgModel && cfgModel.provider && cfgModel.model) {
        return { provider: cfgModel.provider, model: cfgModel.model, reasoningEffort: cfgModel.reasoningEffort };
      }
      const sel = ctx.agentDefaultModel.currentSelection();
      return { provider: sel.provider, model: sel.model, reasoningEffort: sel.reasoningEffort };
    }
    async function callModel(system, userText, maxTokens) {
      const sel = resolveModel();
      const opts = {
        provider: sel.provider,
        model: sel.model,
        system: system || '',
        maxTokens: maxTokens || 3000,
        messages: [{
          id: 'dsh-livefeed-' + (++state.mid),
          role: 'user',
          content: [{ type: 'text', text: userText }],
          source: { kind: 'user' },
        }],
      };
      if (sel.reasoningEffort) opts.reasoningEffort = sel.reasoningEffort;
      let text = '';
      let failure = null;
      try {
        for await (const ch of ctx.llm.stream(opts)) {
          if (ch.type === 'text-delta') text += ch.text;
          else if (ch.type === 'finish' && (ch.reason.kind === 'error' || ch.reason.kind === 'aborted')) {
            failure = (ch.reason.failure && ch.reason.failure.message) || ch.reason.kind;
          }
        }
      } catch (err) {
        failure = String((err && err.message) || err);
      }
      if (failure) throw new Error('模型调用失败: ' + failure);
      return text;
    }

    // 容错 JSON 提取（首个平衡 {…}）
    function extractJson(text) {
      const s = String(text || '');
      const start = s.indexOf('{');
      if (start < 0) return null;
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            try { return JSON.parse(s.slice(start, i + 1)); } catch (_) { return null; }
          }
        }
      }
      return null;
    }
    // 容错 JSON 数组提取（首个平衡 […]）
    function extractJsonArr(text) {
      const s = String(text || '');
      const start = s.indexOf('[');
      if (start < 0) return null;
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '[') depth++;
        else if (ch === ']') {
          depth--;
          if (depth === 0) {
            try { return JSON.parse(s.slice(start, i + 1)); } catch (_) { return null; }
          }
        }
      }
      return null;
    }

    // ══ 正文抓取：web.fetch → Node fetch → curl 回退 ══
    async function fetchContentImpl(url) {
      try {
        const r = await ctx.web.fetch({ url: String(url) });
        return { url: r.url, statusCode: r.statusCode, body: r.body, truncated: !!r.truncated };
      } catch (_) {
        try {
          return await fetchViaNode(String(url));
        } catch (_) {
          return fetchViaCurl(String(url));
        }
      }
    }
    // Node 内置 fetch（bundle 模式运行在真实 Node 进程）：免 bash/curl/沙箱依赖，
    // 本机直连即可；动态模式无 fetch 全局时自动跳过。
    async function fetchViaNode(url) {
      if (typeof fetch !== 'function') throw new Error('Node fetch 不可用');
      const res = await fetch(url, {
        signal: AbortSignal.timeout(20000),
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; dsh-livefeed/1.0)' },
      });
      let text = await res.text();
      let truncated = false;
      if (text.length > 1200000) { text = text.slice(0, 1200000); truncated = true; }
      const lower = text.slice(0, 2000).toLowerCase();
      const kind = /<html|<head|<body/i.test(lower) ? 'html' : 'text';
      return { url: String(url), statusCode: res.status, body: { kind, content: text }, truncated };
    }
    async function fetchViaCurl(url) {
      const shell = ctx.get('shell');
      if (shell === undefined) throw new Error('web.fetch 与 shell 均不可用');
      const safeUrl = String(url).replace(/"/g, '%22');
      // 本机 shell 服务是 PowerShell（dsh-pwsh-sandbox）：`curl` 会被解析成 Invoke-WebRequest 别名，
      // 因此必须显式用 `curl.exe` 调用真实 curl。
      // 本机沙箱后端（windows-acl）要求临时目录在 workspace 之外；当 workspace 位于用户主目录时不可用，
      // 部署默认的 workspace-write 策略会直接失败。此处仅对本抓取调用显式使用 danger-full-access
      // （pwsh-sandbox 对 danger-full-access 直接放行、不套沙箱），不改动部署默认策略。
      const spec = shell.resolve({
        command: 'curl.exe -sL --max-time 20 --compressed "' + safeUrl + '"',
        timeoutMs: 30000,
        stdoutMaxBytes: 1200000,
        sandboxPolicy: {
          mode: 'danger-full-access',
          workspaceRoot: (typeof process !== 'undefined' && process.cwd && process.cwd()) || CONFIG_DIR,
        },
      });
      const res = await shell.run(spec);
      if (res.exitCode !== 0) {
        const stderr = ((res.stderr && res.stderr.text) || '').slice(0, 300);
        throw new Error('curl 失败 exit=' + res.exitCode + (stderr ? ' (' + stderr.trim() + ')' : ''));
      }
      const text = (res.stdout && res.stdout.text) || '';
      if (!text) throw new Error('curl 返回空内容');
      const lower = text.slice(0, 2000).toLowerCase();
      const kind = /<html|<head|<body/i.test(lower) ? 'html' : 'text';
      return { url: String(url), statusCode: 200, body: { kind, content: text }, truncated: !!(res.stdout && res.stdout.truncated) };
    }

    // ══ 源脚本执行（codeRuntime；缺失时报错并跳过该源）══
    function buildProgram(template, script) {
      return template + '\n' + (script || '');
    }
    async function loadTemplateAndScript(source) {
      let template = BUILTIN_TEMPLATE;
      const custom = await fsRead(TEMPLATE_FILE);
      if (custom && custom.indexOf('_dshLivefeedDispatcher') >= 0) template = custom;
      else if (custom) console.error('[dsh-livefeed] sources/_template.js 缺少调度器标记，回退内置模板');
      if (!template) throw new Error('基类模板缺失：请确认运行目录存在 sources/_template.js');
      let script = '';
      if (source && source.script) {
        const abs = CONFIG_DIR + '\\' + String(source.script).replace(/\//g, '\\');
        const sp = await fsRead(abs);
        if (sp === null) throw new Error('源脚本不存在: ' + source.script);
        script = sp;
      }
      return buildProgram(template, script);
    }
    async function runSourceScript(program, args) {
      const codeRuntime = ctx.get('codeRuntime');
      if (codeRuntime === undefined) throw new Error('codeRuntime 服务不可用：无法执行源脚本');
      const bindings = [{
        global: 'api',
        functions: {
          mode: async () => args.mode,
          config: async () => (args.config || {}),
          item: async () => (args.item || null),
          search: async (a) => {
            const req = a || {};
            return ctx.web.search({ query: String(req.query || ''), maxResults: req.maxResults });
          },
          fetchContent: async (a) => fetchContentImpl((a || {}).url),
        },
      }];
      const run = await codeRuntime.run({ program, bindings });
      if (run.error) throw new Error('脚本执行失败: ' + run.error.message);
      return run.value;
    }

    // ══ 屏蔽日志 ══
    // 被拒条目先入 pendingRejected，周期结束时批量翻译标题后再写入 filterLog（译文直接存进日志）
    function queueRejected(it, source, reason) {
      state.pendingRejected.push({
        title: String(it.title || ''),
        url: String(it.url || ''),
        sourceId: source ? String(source.id || '') : '',
        reason,
        ts: new Date().toISOString(),
      });
    }

    // ══ 管线阶段 ══
    async function stageCoarse(source) {
      const program = await loadTemplateAndScript(source);
      // 粗搜上限：优先源级 maxItems，否则全局 maxCoarseItems，模板兜底 DEFAULT_MAX_ITEMS
      const effective = Object.assign({}, source || {}, {
        maxItems: (source && source.maxItems) || state.config.maxCoarseItems || DEFAULT_MAX_ITEMS,
      });
      const items = await runSourceScript(program, { mode: 'titles', config: effective });
      return Array.isArray(items) ? items : [];
    }

    async function stageJudge(source, items) {
      const effectiveBlock = (state.config.blockWords || []).concat(state.preferences.block || []);
      // 确定性过滤
      const kept = [];
      for (const it of items) {
        const urlKey = normalizeUrl(it.url);
        if (state.exemptUrls.has(urlKey)) { kept.push(it); continue; }
        const title = String(it.title || '').toLowerCase();
        const hit = (effectiveBlock || []).find((w) => w && title.indexOf(String(w).toLowerCase()) >= 0);
        if (hit) { queueRejected(it, source, 'block-keyword'); continue; }
        kept.push(it);
      }
      if (!kept.length) return [];
      // 语义过滤
      const list = kept.map((it, i) => ({ i, title: it.title, url: it.url, snippet: String(it.snippet || '').slice(0, 200) }));
      const recent = state.feedbackQueue.slice(-10).map((f) => '【不感兴趣】' + f.title);
      const system =
        '你是信息筛选助手。用户配置的兴趣与规则如下，判断哪些条目值得精读并生成摘要卡片。' +
        '\n兴趣: ' + JSON.stringify(state.config.interests || []) +
        '\n规则: ' + JSON.stringify({ prefer: state.preferences.prefer || [], block: effectiveBlock, semanticNotes: state.preferences.semanticNotes || '' }) +
        '\n最近不感兴趣样本: ' + JSON.stringify(recent) +
        '\n只输出 JSON: {"selected":[{"index":0,"reason":"一句话理由"}]}。宁可少选，不选明显无关或与样本相似的内容。';
      const raw = await callModel(system, JSON.stringify(list, null, 1), 2000);
      const parsed = extractJson(raw);
      const selected = new Set();
      if (parsed && Array.isArray(parsed.selected)) {
        for (const s of parsed.selected) {
          const idx = Number(s && s.index);
          if (Number.isInteger(idx) && idx >= 0 && idx < kept.length) selected.add(idx);
        }
      } else {
        throw new Error('筛选结果解析失败');
      }
      const out = [];
      for (let i = 0; i < kept.length; i++) {
        if (selected.has(i)) out.push(kept[i]);
        else queueRejected(kept[i], source, 'model-filter');
      }
      // 精搜上限：优先源级 maxCandidates，否则全局 maxCandidatesPerSource。
      // 被截断的选中项记入屏蔽日志（reason=max-candidates），保证统计数字与屏蔽列表可核对。
      const cap = (source && source.maxCandidates) || state.config.maxCandidatesPerSource || DEFAULT_MAX_CANDIDATES;
      for (let i = cap; i < out.length; i++) queueRejected(out[i], source, 'max-candidates');
      return out.slice(0, cap);
    }

    // ══ 屏蔽日志标题翻译（周期末尾批量执行，译文直接写入 filterLog）══
    async function stageTranslateRejected() {
      const pending = state.pendingRejected;
      state.pendingRejected = [];
      if (!pending.length) return;
      // 按 URL 去重（保留最新）；同一内容每周期重复被拒时只留一条
      const seen = new Set();
      const unique = [];
      for (const e of pending) {
        const key = normalizeUrl(e.url);
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(e);
      }
      const byUrl = new Map();
      const need = [];
      for (const e of unique) {
        const key = normalizeUrl(e.url);
        const cached = state.titleCache.get(key);
        if (cached !== undefined) byUrl.set(key, cached);
        else need.push({ url: e.url, title: e.title });
      }
      if (need.length) {
        try {
          const lang = state.config.summaryLanguage || 'zh-CN';
          const system =
            '将以下标题翻译成「' + lang + '」。专有名词/产品名/品牌名可保留原文；已是目标语言的标题原样返回。' +
            '只输出 JSON 数组，顺序对应输入：[{"url":"…","title":"翻译后的标题"}]';
          const raw = await callModel(system, JSON.stringify(need.map((m) => ({ url: m.url, title: m.title }))), 2500);
          const parsed = extractJsonArr(raw);
          if (Array.isArray(parsed)) {
            for (const p of parsed) {
              if (!p || !p.url) continue;
              const t = String(p.title || '').trim();
              if (t) state.titleCache.set(normalizeUrl(String(p.url)), t);
            }
          }
        } catch (err) {
          console.error('[dsh-livefeed] title translate failed:', String((err && err.message) || err));
        }
        for (const e of need) {
          const key = normalizeUrl(e.url);
          if (!state.titleCache.has(key)) state.titleCache.set(key, e.title);
          byUrl.set(key, state.titleCache.get(key));
        }
      }
      // 缓存有界（简单淘汰）
      if (state.titleCache.size > 500) {
        const firstKey = state.titleCache.keys().next().value;
        if (firstKey !== undefined) state.titleCache.delete(firstKey);
      }
      // 写入屏蔽日志：同 URL 旧条目替换为最新（标题=译文）
      for (const e of unique) {
        const key = normalizeUrl(e.url);
        state.filterLog = state.filterLog.filter((x) => normalizeUrl(x.url) !== key);
        state.filterLog.push({
          title: byUrl.get(key) || e.title,
          url: e.url,
          sourceId: e.sourceId,
          reason: e.reason,
          ts: e.ts,
        });
      }
      if (state.filterLog.length > FILTER_LOG_CAP) state.filterLog.splice(0, state.filterLog.length - FILTER_LOG_CAP);
    }

    async function stageCluster(candidates) {
      if (candidates.length <= 1) return candidates.map((c) => ({ members: [c] }));
      const list = candidates.map((c, i) => ({ i, title: c.item.title, url: c.item.url, source: c.source.name }));
      const system =
        '将以下条目按“同一事件/话题”聚类（不同网站报道同一新闻算同一簇）。' +
        '只输出 JSON: {"clusters":[{"members":[0,2]}]}。每个条目只能属于一个簇；无法归并的条目单独成簇 [i]。';
      const raw = await callModel(system, JSON.stringify(list, null, 1), 1500);
      const parsed = extractJson(raw);
      const clusters = [];
      const used = new Set();
      if (parsed && Array.isArray(parsed.clusters)) {
        for (const cl of parsed.clusters) {
          const members = (Array.isArray(cl && cl.members) ? cl.members : [])
            .map((m) => Number(m))
            .filter((m) => Number.isInteger(m) && m >= 0 && m < candidates.length && !used.has(m));
          if (!members.length) continue;
          for (const m of members) used.add(m);
          clusters.push({ members: members.map((m) => candidates[m]) });
        }
      }
      for (let i = 0; i < candidates.length; i++) {
        if (!used.has(i)) clusters.push({ members: [candidates[i]] });
      }
      return clusters;
    }

    function pickMain(members) {
      const weights = state.preferences.sourceWeights || {};
      let best = members[0];
      for (const m of members) {
        const w1 = weights[m.source.id] || 1;
        const w2 = weights[best.source.id] || 1;
        if (w1 > w2) { best = m; continue; }
        if (w1 === w2) {
          const t1 = m.item.publishedAt ? Date.parse(m.item.publishedAt) : NaN;
          const t2 = best.item.publishedAt ? Date.parse(best.item.publishedAt) : NaN;
          if ((isNaN(t2) && !isNaN(t1)) || (!isNaN(t1) && !isNaN(t2) && t1 < t2)) best = m;
        }
      }
      return best;
    }

    // 安全验证页/反爬拦截页识别：这类页面文本非空但内容无效，
    // 命中后视为「正文为空」→ 卡片直接丢弃（不生成拦截提示类摘要）
    function isBlockPage(text) {
      const t = String(text || '').toLowerCase();
      // 强特征：出现即判定（几乎不会出现在正常正文）
      const strong = [
        'attention required', 'checking your browser', 'verify you are human',
        'enable javascript and cookies', 'just a moment', 'access denied',
        'you have been blocked', 'cf-chl', 'captcha', 'puzzle',
        'your current connection has been blocked', 'we have detected unusual activity',
        '异常活动', '安全系统阻止', '检测到异常', '安全验证',
      ];
      for (const m of strong) if (t.indexOf(m) >= 0) return true;
      // 弱特征：短页面（拦截页通常很小）且命中多个才判定，避免误杀正常长文
      const weak = ['cloudflare', 'akamai', 'security check', 'bot', 'challenge', 'reference number', 'permission', 'blocked', '被阻止', '安全系统'];
      let w = 0;
      if (t.length < 12000) {
        for (const m of weak) if (t.indexOf(m) >= 0) w++;
      }
      return w >= 2;
    }

    async function stageFineAndSummarize(cluster) {
      const main = pickMain(cluster.members);
      let content = null;
      try {
        const program = await loadTemplateAndScript(main.source);
        const out = await runSourceScript(program, { mode: 'content', config: main.source, item: main.item });
        if (out && out.text) {
          if (isBlockPage(out.text)) {
            console.log('[dsh-livefeed] block-page content skipped:', main.item.url);
            content = null;
          } else {
            content = out.text;
          }
        }
      } catch (err) {
        console.error('[dsh-livefeed] fineSearch failed:', String(err && err.message || err));
      }
      const snippets = cluster.members.map((m) => (m.item.snippet || '')).filter(Boolean).join('\n');
      const fallbackText = content || snippets;
      if (!fallbackText) return null;
      let title = main.item.title;
      let summary = '';
      const lang = state.config.summaryLanguage || 'zh-CN';
      // 无论是否抓到正文（有片段也算），都交给模型生成目标语言标题+摘要；
      // 明确要求标题翻译，专有名词/产品名可保留原文，避免模型「最准确的标题=原标题」而保留英文。
      const sourceText = content || snippets;
      try {
        const system =
          '你是资讯摘要助手。把给定内容压缩成 2-3 句「' + lang +
          '」摘要，并给出更准确的标题。标题必须翻译成「' + lang +
          '」（专有名词/产品名/品牌名可保留原文）。只输出 JSON: {"title":"…","summary":"…"}';
        const parsed = extractJson(await callModel(system, '标题: ' + main.item.title + '\n内容:\n' + sourceText.slice(0, 6000), 1500));
        if (parsed && parsed.title && parsed.summary) { title = parsed.title; summary = parsed.summary; }
        else summary = fallbackText.slice(0, 300);
      } catch (_) {
        summary = fallbackText.slice(0, 300);
      }
      return {
        title,
        summary,
        url: main.item.url,
        sourceName: main.source.name,
        publishedAt: main.item.publishedAt,
        relatedUrls: cluster.members
          .filter((m) => m.item.url !== main.item.url)
          .map((m) => ({ url: m.item.url, sourceName: m.source.name })),
      };
    }

    async function stageLand(cards) {
      const newCards = [];
      for (const card of cards) {
        if (!card || !card.url) continue;
        const key = normalizeUrl(card.url);
        if (state.seenUrls.has(key)) continue;
        state.seenUrls.add(key);
        const full = {
          id: 'c' + state.tick + '-' + newCards.length + '-' + Math.random().toString(36).slice(2, 8),
          title: card.title,
          summary: card.summary,
          url: card.url,
          sourceName: card.sourceName || '',
          publishedAt: card.publishedAt,
          relatedUrls: card.relatedUrls || [],
          read: false,
          feedback: null,
          isNew: true,
          createdAt: Date.now(),
        };
        newCards.push(full);
        state.cards.push(full);
      }
      // 有界：裁剪最老的「已读且非不感兴趣」卡片（仅入归档）
      const bound = (state.config.maxCards || DEFAULT_MAX_CARDS) * 3;
      if (state.cards.length > bound) {
        const removable = state.cards.filter((c) => c.read && c.feedback !== 'dislike');
        let over = state.cards.length - bound;
        for (const r of removable) {
          if (over <= 0) break;
          const idx = state.cards.indexOf(r);
          if (idx >= 0) { state.cards.splice(idx, 1); over--; }
        }
      }
      // 归档（有界滚动）
      for (const c of newCards) {
        state.archive.push({ id: c.id, title: c.title, url: c.url, summary: c.summary, sourceName: c.sourceName, publishedAt: c.publishedAt, createdAt: c.createdAt });
      }
      await saveArchive();
      return newCards;
    }

    async function stageRules() {
      if (!state.feedbackQueue.length) return;
      const recent = state.feedbackQueue;
      state.feedbackQueue = [];
      try {
        const system =
          '你是过滤规则维护助手。根据用户最近标记的「不感兴趣」内容更新规则文档。' +
          '规则只允许增加负面规则（block / semanticNotes），禁止推断用户的正向偏好（防止信息茧房）。' +
          '只输出 JSON: {"block":["关键词","…"],"semanticNotes":"一句话"}。block 是合并去重后的完整列表（含原有条目），semanticNotes 是更新后的完整文本。';
        const user =
          '当前规则: ' + JSON.stringify({ block: state.preferences.block, semanticNotes: state.preferences.semanticNotes }) +
          '\n新增不感兴趣: ' + JSON.stringify(recent.map((r) => r.title));
        const parsed = extractJson(await callModel(system, user, 1500));
        if (parsed && Array.isArray(parsed.block)) {
          state.preferences.block = parsed.block.filter((b) => b && String(b).trim()).map((b) => String(b).trim());
          state.preferences.semanticNotes = String(parsed.semanticNotes || state.preferences.semanticNotes || '');
          state.preferences.version = (state.preferences.version || 1) + 1;
          state.preferences.updatedAt = new Date().toISOString();
          await savePreferences();
        }
      } catch (err) {
        console.error('[dsh-livefeed] rules update failed:', String(err && err.message || err));
      }
    }

    // ══ 规则重训（抽样归档）══
    async function runRerunRules() {
      if (state.running) return;
      state.running = true;
      try {
        const sample = state.archive.filter((x) => x.feedback === 'dislike').slice(-30).map((d) => d.title);
        const system =
          '你是过滤规则维护助手。基于用户历史「不感兴趣」样本重写规则。只允许负面规则（block / semanticNotes），禁止推断正向偏好。' +
          '只输出 JSON: {"block":["关键词","…"],"semanticNotes":"一句话"}。';
        const parsed = extractJson(await callModel(system, '不感兴趣样本: ' + JSON.stringify(sample), 1500));
        if (parsed && Array.isArray(parsed.block)) {
          state.preferences.block = parsed.block.map((b) => String(b).trim()).filter(Boolean);
          state.preferences.semanticNotes = String(parsed.semanticNotes || '');
          state.preferences.version = (state.preferences.version || 1) + 1;
          state.preferences.updatedAt = new Date().toISOString();
          await savePreferences();
        }
      } catch (err) {
        console.error('[dsh-livefeed] rerun rules failed:', String(err && err.message || err));
      } finally {
        state.running = false;
      }
    }

    // ══ 持久化 ══
    async function saveState() {
      const panelCards = state.cards.filter((c) => !c.read || c.feedback === 'dislike');
      await fsWrite(STATE_FILE, JSON.stringify({
        cards: panelCards,
        exemptUrls: Array.from(state.exemptUrls),
        feedbackQueue: state.feedbackQueue.slice(-FEEDBACK_WINDOW),
      }, null, 2));
    }
    async function saveConfig() {
      await fsWrite(CONFIG_FILE, JSON.stringify(state.config, null, 2));
    }
    async function savePreferences() {
      await fsWrite(PREFERENCES_FILE, JSON.stringify(state.preferences, null, 2));
    }
    async function saveArchive() {
      const max = state.config.archiveMaxEntries || DEFAULT_ARCHIVE_MAX;
      if (state.archive.length > max) state.archive = state.archive.slice(-max);
      await fsWrite(HISTORY_FILE, state.archive.map((x) => JSON.stringify(x)).join('\n'));
    }

    async function loadAll() {
      const cfgText = await fsRead(CONFIG_FILE);
      state.config = mergeConfig(defaultConfig(), parseJson(cfgText, null));
      state.preferences = parseJson(await fsRead(PREFERENCES_FILE), defaultPreferences());
      if (!Array.isArray(state.preferences.block)) state.preferences.block = [];
      if (!Array.isArray(state.preferences.prefer)) state.preferences.prefer = [];
      if (!state.preferences.sourceWeights || typeof state.preferences.sourceWeights !== 'object') state.preferences.sourceWeights = {};
      const st = parseJson(await fsRead(STATE_FILE), null);
      state.cards = (st && Array.isArray(st.cards) ? st.cards : [])
        .filter((c) => c && c.url && (!c.read || c.feedback === 'dislike'))
        .map((c) => Object.assign({ relatedUrls: [], isNew: false, createdAt: Date.now() }, c, { isNew: false }));
      state.exemptUrls = new Set(st && Array.isArray(st.exemptUrls) ? st.exemptUrls : []);
      state.feedbackQueue = st && Array.isArray(st.feedbackQueue) ? st.feedbackQueue.slice(-FEEDBACK_WINDOW) : [];
      state.archive = [];
      state.seenUrls = new Set();
      const histText = await fsRead(HISTORY_FILE);
      if (histText) {
        for (const line of histText.split('\n')) {
          const t = line.trim();
          if (!t) continue;
          const item = parseJson(t, null);
          if (!item || !item.url) continue;
          state.archive.push(item);
          state.seenUrls.add(normalizeUrl(item.url));
        }
      }
      for (const c of state.cards) state.seenUrls.add(normalizeUrl(c.url));
    }

    // ══ 主周期 ══
    async function runCycle() {
      if (disposed || state.running) return;
      if (state.paused) return;
      state.running = true;
      state.sourceErrors = [];
      state.cycleStats = null;
      state.retrying = 0;
      state.pendingRejected = [];
      try {
        await loadAll();
        const stats = { scanned: 0, selected: 0, filtered: 0 };
        const candidates = [];
        for (const source of state.config.sources || []) {
          if (!source || !source.enabled) continue;
          try {
            const items = await stageCoarse(source);
            stats.scanned += items.length;
            const picked = await stageJudge(source, items);
            stats.filtered += items.length - picked.length;
            stats.selected += picked.length;
            for (const it of picked) candidates.push({ item: it, source });
          } catch (err) {
            state.sourceErrors.push({ sourceId: String(source.id || ''), message: String((err && err.message) || err) });
            console.error('[dsh-livefeed] source failed:', source.id, err);
          }
        }
        if (candidates.length) {
          const clusters = await stageCluster(candidates);
          const cards = [];
          for (const cl of clusters) {
            const card = await stageFineAndSummarize(cl);
            if (card) cards.push(card);
          }
          await stageLand(cards);
        }
        // 被拒条目批量翻译标题后写入屏蔽日志（译文即数据）
        await stageTranslateRejected();
        await stageRules();
        await saveState();
        state.cycleStats = stats;
        state.lastError = undefined;
        state.lastRunAt = Date.now();
        state.tick += 1;
      } catch (err) {
        state.lastError = String((err && err.message) || err);
        console.error('[dsh-livefeed] cycle failed:', err);
        scheduleRetry();
      } finally {
        state.running = false;
      }
    }

    function scheduleRetry() {
      if (disposed || state.paused) return;
      if (state.retrying >= RETRY_MAX) { state.retrying = 0; return; }
      state.retrying += 1;
      const delay = RETRY_BASE_MS * Math.pow(2, state.retrying - 1);
      console.log('[dsh-livefeed] schedule retry', state.retrying, 'delay ms', delay);
      ctx.timeout(() => {
        if (!disposed) runCycle();
      }, delay);
    }

    // ══ 调度器 ══
    function intervalMs() {
      const m = Number(state.config && state.config.intervalMinutes) || DEFAULT_INTERVAL_MIN;
      return Math.max(1, m) * 60 * 1000;
    }
    function tick() {
      if (disposed || state.paused || state.running) return;
      if (state.lastRunAt !== undefined && Date.now() - state.lastRunAt < intervalMs()) return;
      runCycle();
    }

    // ══ RPC 处理器表（HTTP 路由与动态 harness 共用）══
    const handlers = {
      'cards': async () => jsonSafe({
        cards: state.cards.slice(-300).map((c) => ({
          id: c.id, title: c.title, summary: c.summary, url: c.url,
          sourceName: c.sourceName, publishedAt: c.publishedAt,
          relatedUrls: c.relatedUrls || [],
          isNew: !!c.isNew, read: !!c.read, feedback: c.feedback || null,
        })),
        status: {
          running: state.running,
          paused: state.paused,
          retrying: state.retrying,
          lastRunAt: state.lastRunAt,
          lastError: state.lastError,
          sourceErrors: state.sourceErrors,
          cycleStats: state.cycleStats,
          tick: state.tick,
        },
      }),
      'config': async () => jsonSafe({
        config: state.config ? {
          intervalMinutes: state.config.intervalMinutes,
          maxCards: state.config.maxCards,
          maxCandidatesPerSource: state.config.maxCandidatesPerSource,
          maxCoarseItems: state.config.maxCoarseItems,
          summaryLanguage: state.config.summaryLanguage,
          interests: state.config.interests || [],
          blockWords: state.config.blockWords || [],
          archiveMaxEntries: state.config.archiveMaxEntries,
          model: state.config.model || null,
          sources: state.config.sources || [],
        } : null,
      }),
      'refresh': async () => {
        if (state.running) return { accepted: false };
        runCycle();
        return { accepted: true };
      },
      'mark': async (args) => {
        const a = args || {};
        const card = state.cards.find((c) => c.id === a.cardId);
        if (card) {
          if (a.read === true) { card.read = true; card.isNew = false; }
          if (a.feedback === 'dislike') {
            if (card.feedback !== 'dislike') {
              state.feedbackQueue.push({ title: card.title, url: card.url, ts: Date.now() });
              if (state.feedbackQueue.length > FEEDBACK_WINDOW) state.feedbackQueue.shift();
            }
            card.feedback = 'dislike';
            card.read = true;
            card.isNew = false;
          } else if (a.feedback === null) {
            card.feedback = null;
          }
          const key = normalizeUrl(card.url);
          const ae = state.archive.find((x) => normalizeUrl(x.url) === key);
          if (ae) ae.feedback = card.feedback;
          await saveState();
          await saveArchive();
        }
        return { ok: true };
      },
      'mark-all-read': async () => {
        let changed = false;
        for (const c of state.cards) {
          if (!c.read) { c.read = true; c.isNew = false; changed = true; }
        }
        if (changed) await saveState();
        return { ok: true };
      },
      'set-paused': async (args) => {
        state.paused = !!(args && args.paused);
        return { ok: true, paused: state.paused };
      },
      'update-settings': async (args) => {
        const a = args || {};
        const cfg = state.config || defaultConfig();
        if (typeof a.intervalMinutes === 'number' && a.intervalMinutes >= 1 && a.intervalMinutes <= 1440) cfg.intervalMinutes = Math.round(a.intervalMinutes);
        if (a.model !== undefined) {
          cfg.model = (a.model === null) ? null : {
            provider: String((a.model && a.model.provider) || ''),
            model: String((a.model && a.model.model) || ''),
            reasoningEffort: (a.model && a.model.reasoningEffort) || undefined,
          };
        }
        if (Array.isArray(a.interests)) cfg.interests = a.interests.map(String);
        if (Array.isArray(a.blockWords)) cfg.blockWords = a.blockWords.map(String);
        if (typeof a.archiveMaxEntries === 'number' && a.archiveMaxEntries >= 100) cfg.archiveMaxEntries = Math.round(a.archiveMaxEntries);
        if (typeof a.maxCoarseItems === 'number' && a.maxCoarseItems >= 1 && a.maxCoarseItems <= 100) cfg.maxCoarseItems = Math.round(a.maxCoarseItems);
        if (typeof a.maxCandidatesPerSource === 'number' && a.maxCandidatesPerSource >= 1 && a.maxCandidatesPerSource <= 20) cfg.maxCandidatesPerSource = Math.round(a.maxCandidatesPerSource);
        if (Array.isArray(a.sources)) {
          for (const s of a.sources) {
            const target = cfg.sources.find((x) => x.id === s.id);
            if (target) {
              if (typeof s.enabled === 'boolean') target.enabled = s.enabled;
              if (typeof s.query === 'string') target.query = s.query;
              // 源级阈值：数字覆盖全局；null 清除覆盖回退全局默认
              if (typeof s.maxItems === 'number') target.maxItems = Math.max(1, Math.min(100, Math.round(s.maxItems)));
              else if (s.maxItems === null) delete target.maxItems;
              if (typeof s.maxCandidates === 'number') target.maxCandidates = Math.max(1, Math.min(20, Math.round(s.maxCandidates)));
              else if (s.maxCandidates === null) delete target.maxCandidates;
            }
          }
        }
        state.config = cfg;
        await saveConfig();
        return { ok: true };
      },
      'update-words': async (args) => {
        const a = args || {};
        if (Array.isArray(a.interests)) state.config.interests = a.interests.map(String);
        if (Array.isArray(a.blockWords)) state.config.blockWords = a.blockWords.map(String);
        await saveConfig();
        return { ok: true };
      },
      'model-catalog': async () => {
        const providers = [];
        try {
          for (const p of ctx.llm.listProviders()) {
            let models = [];
            try { models = await ctx.llm.listModels(p.id); } catch (_) { models = []; }
            const modelEntries = [];
            for (const m of models) {
              const entry = { id: m.id, name: m.name, efforts: null };
              try {
                // 每个模型的思考等级来自其能力元数据（resolveModelInfo），不是全局固定列表
                const info = await ctx.llm.resolveModelInfo(p.id, m.id);
                if (info && info.reasoning && Array.isArray(info.reasoning.efforts) && info.reasoning.efforts.length) {
                  entry.efforts = info.reasoning.efforts.map((x) => ({ id: x.id, name: x.name }));
                }
              } catch (_) { /* 能力解析失败则无 efforts，客户端回退固定列表 */ }
              modelEntries.push(entry);
            }
            providers.push({ id: p.id, name: p.name, models: modelEntries });
          }
        } catch (_) { /* 目录失败返回空 */ }
        return { providers };
      },
      'rules': async () => jsonSafe({ rules: state.preferences }),
      'rerun-rules': async () => {
        if (state.running) return { accepted: false };
        runRerunRules();
        return { accepted: true };
      },
      'filter-log': async () => ({
        items: state.filterLog.slice(-FILTER_LOG_CAP).reverse(),
      }),
      'debug-log': async () => ({ items: requestLog.slice(-200).reverse() }),
      'unblock': async (args) => {
        const url = String((args && args.url) || '');
        if (!url) return { ok: false };
        const key = normalizeUrl(url);
        const log = state.filterLog.find((l) => normalizeUrl(l.url) === key);
        state.exemptUrls.add(key);
        state.seenUrls.add(key);
        // 撤销后从「被屏蔽内容」列表移除该条，避免「已撤销仍显示」的混淆
        state.filterLog = state.filterLog.filter((l) => normalizeUrl(l.url) !== key);
        const existing = state.cards.find((c) => normalizeUrl(c.url) === key);
        if (!existing) {
          state.cards.push({
            id: 'u' + Date.now().toString(36),
            title: log ? log.title : url,
            summary: '（已撤销屏蔽，暂以标题展示；下一周期将正常采集正文）',
            url,
            sourceName: log ? log.sourceId : '',
            read: false,
            feedback: null,
            isNew: true,
            createdAt: Date.now(),
          });
        }
        await saveState();
        return { ok: true };
      },
    };

    function readBody(req) {
      return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
          size += chunk.length;
          if (size > 1024 * 1024) { reject(new Error('payload too large')); req.destroy(); return; }
          chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
      });
    }

    // 请求日志（内存，有界）：诊断浏览器侧是否真的到达本路由
    const requestLog = [];
    function logRequest(req, method, ok, info) {
      requestLog.push({
        ts: new Date().toISOString(),
        httpMethod: req.method,
        url: String(req.url || ''),
        method,
        ok: !!ok,
        info: String(info || ''),
      });
      if (requestLog.length > 200) requestLog.splice(0, requestLog.length - 200);
    }

    // ══ 启动：装载 + HTTP 路由 + 动态 harness + 定时器（随 fiber 自动清理）══
    ctx.effect(() => {
      loadAll();

      // HTTP API（bundle 模式客户端使用）
      const stopRoute = ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_PATH,
        handler: async (req, res) => {
          const send = (status, payload) => {
            res.writeHead(status, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            });
            res.end(JSON.stringify(jsonSafe(payload)));
          };
          let payload = {};
          if (req.method === 'POST') {
            try { payload = JSON.parse(await readBody(req)) || {}; } catch (_) { payload = {}; }
          } else if (req.method === 'GET' || req.method === 'HEAD') {
            // GET 诊断：/api/dsh-livefeed?method=model-catalog —— 浏览器地址栏可直接打开验证
            try {
              const u = new URL(req.url || '/', 'http://local');
              payload = { method: String(u.searchParams.get('method') || ''), args: {} };
            } catch (_) { payload = {}; }
          }
          const method = String(payload.method || '');
          const handler = handlers[method];
          if (!handler) { logRequest(req, method, false, 'unknown method'); send(404, { ok: false, error: 'unknown method: ' + method }); return; }
          try {
            const data = await handler(payload.args || {});
            logRequest(req, method, true, 'ok');
            send(200, { ok: true, data });
          } catch (err) {
            logRequest(req, method, false, String((err && err.message) || err));
            send(500, { ok: false, error: String((err && err.message) || err) });
          }
        },
      });

      // 动态模式（cordis_define）兼容：harness 为动态 Builtin，真实宿主中不存在
      let stopHarness = null;
      if (typeof harness !== 'undefined') {
        const disposers = Object.keys(handlers).map((m) =>
          harness.handle('dsh-livefeed/' + m, (args) => handlers[m](args)));
        stopHarness = () => disposers.forEach((d) => { try { d(); } catch (_) { /* ignore */ } });
      }

      const stopInterval = ctx.interval(tick, TICK_MS);
      const stopBoot = ctx.timeout(() => { if (!disposed) runCycle(); }, 15 * 1000);
      return () => {
        disposed = true;
        if (stopRoute) stopRoute();
        if (stopHarness) stopHarness();
        if (stopInterval) stopInterval();
        if (stopBoot) stopBoot();
      };
    });
}
export { apply, inject, name };
