/* ═══════════════════════════════════════════════════════════════════════════
 * LiveFeed Host 半 —— cordis_define(code.host) 的函数体
 * ═══════════════════════════════════════════════════════════════════════════
 * 实现状态：骨架。待 HTML 原型评审通过后，按 docs/design.md 第 3/5/6 节完成。
 *
 * 约定：
 * - 本文件内容整体作为 code.host 传入 cordis_define（不含外层 function 声明）；
 * - 仅可用 Builtins：ctx / harness / console / btoa / atob / TextEncoder / TextDecoder；
 *   不得使用 import/require/TS/JSX/全局 fetch/timer；
 * - 依赖服务：timer, web, llm, fs, agentDefaultModel（inject 硬依赖）；
 *   codeRuntime, shell（ctx.get 可选读取，缺失时降级/回退）。
 */
return {
  inject: ['timer', 'web', 'llm', 'fs', 'agentDefaultModel'],
  apply(ctx) {
    // ══ 常量 ══
    const CONFIG_DIR = 'C:\\Users\\zhoujin\\Pictures\\dsh-workspace\\.dsh\\dsh-livefeed';
    const CONFIG_FILE = CONFIG_DIR + '\\config.json';
    const TEMPLATE_FILE = CONFIG_DIR + '\\sources\\_template.js';
    const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
    const RECENT_URL_CAP = 5; // 去重：保留最近 N 个周期的 URL 集

    // ══ 内置基类模板常量（与 src/template/template.js 保持同步）══
    // TODO(评审后)：从 src/template/template.js 内联为模板字符串。
    const BUILTIN_TEMPLATE = '';

    // ══ 运行时状态（进程内存）══
    const state = {
      cards: [],          // [{id,title,summary,url,sourceName,publishedAt?,isNew}]
      running: false,
      lastRunAt: undefined,
      lastError: undefined,
      sourceErrors: [],   // [{sourceId, message}]
      recentUrls: [],     // 最近周期的 URL 集合（数组，容量 RECENT_URL_CAP）
      tick: 0,
    };

    // ══ 工具 ══
    function readConfig() {
      // TODO(评审后)：fs.resolve + fs.readText 读 CONFIG_FILE，解析失败返回内置默认配置
      return null;
    }

    function readFileText(absPath) {
      // TODO(评审后)：fs.resolve(absPath) → fs.readText；不存在返回 null
      return null;
    }

    function runSourceScript(program, args) {
      // TODO(评审后)：codeRuntime.run({program, bindings:[{global:'api', functions}], signal})
      //  codeRuntime 缺失 → shell.run('node <临时脚本>') 回退（解析 stdout JSON）
      return Promise.resolve(null);
    }

    function callModel(system, userText, maxTokens) {
      // TODO(评审后)：llm.stream({provider, model, reasoningEffort?,
      //   system, messages:[{id:'dsh-livefeed-<n>', role:'user',
      //     content:[{type:'text',text:userText}], source:{kind:'user'}}],
      //   maxTokens}) 收集 text-delta；容错 JSON 提取
      return Promise.resolve(null);
    }

    // ══ 管线阶段 ══
    async function stageCoarseSearch(source, script, template) {
      // 粗搜：runSourceScript(模板+脚本, {mode:'titles'}) → items
      return [];
    }

    async function stageJudgeTitles(source, items) {
      // 模型筛选：interests + 标题 JSON → selected indices（上限 maxCandidatesPerSource）
      return [];
    }

    async function stageFineSearch(source, script, template, item) {
      // 精搜：runSourceScript(模板+脚本, {mode:'content', item}) → {text}
      return null;
    }

    async function stageSummarize(source, candidates) {
      // 模型摘要：批量 → [{title, summary}]（summaryLanguage）
      return [];
    }

    // ══ 主周期 ══
    async function runCycle() {
      if (state.running) return; // 单飞
      state.running = true;
      state.sourceErrors = [];
      try {
        // TODO(评审后)：装载配置/模板/各源脚本 → 逐源执行 5 阶段 →
        //   去重（recentUrls）→ 落 state.cards（上限 maxCards）→ 更新状态
      } catch (err) {
        state.lastError = String((err && err.message) || err);
        console.error('[dsh-livefeed] cycle failed:', err);
      } finally {
        state.running = false;
        state.lastRunAt = Date.now();
        state.tick += 1;
      }
    }

    // ══ RPC（Package 私有，Client→Host）══
    harness.handle('dsh-livefeed/cards', async () => ({
      cards: state.cards,
      status: {
        running: state.running,
        lastRunAt: state.lastRunAt,
        lastError: state.lastError,
        sourceErrors: state.sourceErrors,
      },
    }));

    harness.handle('dsh-livefeed/refresh', async () => {
      if (state.running) return { accepted: false };
      runCycle(); // 异步触发，不阻塞
      return { accepted: true };
    });

    // ══ 定时器（随 fiber 自动清理）══
    const intervalMs = () => {
      // TODO(评审后)：取 config.intervalMinutes，缺省 DEFAULT_INTERVAL_MS
      return DEFAULT_INTERVAL_MS;
    };
    ctx.effect(() => ctx.interval(runCycle, intervalMs()));
    ctx.timeout(runCycle, 15 * 1000); // 启动后先跑第一轮
  },
};
