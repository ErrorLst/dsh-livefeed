/* ═══════════════════════════════════════════════════════════════════════════
 * dsh-livefeed Client 半（v2：Linux Do 专用精简版）
 * ═══════════════════════════════════════════════════════════════════════════
 * - 面板只有「未读 / 已读」两个组件；
 * - 设置视图只有两个参数：拉取数量（fetchCount）、输出数量（outputCount）；
 * - 点击卡片打开原文并自动标记已读。
 * 约定：
 * - 真实 client 插件环境（bundle）：浏览器全局可用（fetch/document）；
 *   lib/client.js 由此文件生成（window.__ModuleLoader__.load 包装，React 经 require 注入）；
 * - React 用 createElement，禁止 JSX；颜色一律 var(--dsw-alias-*) / var(--dsw-static-*)；
 * - 与 Host 通信走 HTTP：POST /api/dsh-livefeed（body: {method, args}）。
 */
return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots');
    if (slots === undefined) return;
    const h = React.createElement;

    const CSS = `
* { box-sizing: border-box; }
.lf-panel {
  position: fixed; top: 0; right: 0; bottom: 0; width: 340px; max-width: 92vw;
  display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-layer-1);
  border-left: 1px solid var(--dsw-alias-border-l1);
  z-index: 100;
  font-size: 13px; line-height: 1.5;
  color: var(--dsw-alias-label-primary);
  transition: transform .18s ease;
}
.lf-panel.lf-hidden { transform: translateX(105%); pointer-events: none; }
.lf-header {
  flex: none; height: 48px; padding: 0 10px 0 14px;
  display: flex; align-items: center; gap: 6px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.lf-title { flex: 1; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 7px; min-width: 0; }
.lf-logo {
  width: 16px; height: 16px; flex: none; border-radius: 5px;
  background: var(--dsw-alias-state-business-primary);
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--dsw-alias-label-primary-foreground);
}
.lf-logo svg { width: 10px; height: 10px; }
.lf-iconbtn {
  width: 26px; height: 26px; flex: none; border: none; border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background .12s, color .12s;
}
.lf-iconbtn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.lf-iconbtn:active { background: var(--dsw-alias-interactive-bg-active); }
.lf-iconbtn svg { width: 14px; height: 14px; }
.lf-iconbtn.lf-spin svg { animation: lf-spin .8s linear infinite; }
@keyframes lf-spin { to { transform: rotate(360deg); } }
.lf-status {
  flex: none; display: flex; align-items: center; gap: 6px;
  padding: 6px 10px; font-size: 11px; color: var(--dsw-alias-label-tertiary);
  border-bottom: 1px solid var(--dsw-alias-border-l1); white-space: nowrap;
}
.lf-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; background: var(--dsw-alias-state-success-primary); }
.lf-status[data-phase="running"] .lf-dot { background: var(--dsw-alias-state-business-primary); animation: lf-pulse 1.2s ease-in-out infinite; }
.lf-status[data-phase="error"] .lf-dot, .lf-status[data-phase="error"] { color: var(--dsw-alias-state-error-primary); }
.lf-status[data-phase="error"] .lf-dot { background: var(--dsw-alias-state-error-primary); }
.lf-status[data-phase="paused"] .lf-dot { background: var(--dsw-alias-state-warn-primary); }
@keyframes lf-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
.lf-status-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; cursor: help; }
.lf-cycle-stats { flex: none; font-size: 10px; cursor: help; }
.lf-mark-all {
  flex: none; border: none; background: none;
  color: var(--dsw-alias-state-business-primary); font-size: 11px;
  padding: 2px 6px; border-radius: 4px; cursor: pointer; white-space: nowrap;
}
.lf-mark-all:hover { background: var(--dsw-alias-interactive-bg-hover); }
.lf-tabs { display: flex; gap: 2px; padding: 6px 10px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); flex: none; }
.lf-tab {
  flex: 1; height: 30px; border: none; background: none;
  color: var(--dsw-alias-label-tertiary); font-size: 12px; cursor: pointer;
  border-bottom: 2px solid transparent; display: flex; align-items: center; justify-content: center; gap: 3px;
}
.lf-tab:hover { color: var(--dsw-alias-label-secondary); }
.lf-tab.lf-on { color: var(--dsw-alias-label-primary); border-bottom-color: var(--dsw-alias-state-business-primary); font-weight: 600; }
.lf-tab .lf-tab-count { font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.lf-scroll { flex: 1; overflow-y: auto; padding: 8px; min-height: 0; scrollbar-gutter: stable; }
.lf-scroll::-webkit-scrollbar { width: 8px; }
.lf-scroll::-webkit-scrollbar-thumb { background: var(--dsw-alias-scrollbar-bg-l1); border-radius: 4px; }
.lf-group {
  display: flex; align-items: center; gap: 4px;
  width: 100%; border: none; background: none; text-align: left;
  padding: 6px 10px; margin: 2px 4px 0; border-radius: 6px;
  font-size: 11px; color: var(--dsw-alias-label-tertiary);
  user-select: none; cursor: pointer;
}
.lf-group:hover { background: var(--dsw-alias-interactive-bg-hover); }
.lf-group .lf-group-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lf-group .lf-group-count { font-size: 10px; }
.lf-group .lf-group-chevron { flex: none; font-size: 10px; }
.lf-group.lf-collapsed { opacity: .72; }
.lf-cycle-body {
  margin: 0 6px 4px 16px;
  padding-left: 10px;
  border-left: 1px solid var(--dsw-alias-border-l1);
  display: flex; flex-direction: column; gap: 2px;
}
.lf-cycle-body .lf-card-wrap { border-radius: 6px; }
.lf-src-err {
  flex: none; padding: 4px 10px; font-size: 11px;
  color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-interactive-bg-hover-danger);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  display: flex; flex-direction: column; gap: 2px;
}
.lf-src-err-item { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lf-card-wrap { position: relative; overflow: hidden; border-radius: 8px; }
.lf-card {
  display: block; text-decoration: none; color: inherit;
  padding: 10px 12px; border-radius: 8px;
  border: 1px solid transparent;
  position: relative; z-index: 1;
  background: var(--dsw-alias-bg-layer-1);
  transition: background .12s;
  cursor: pointer;
}
.lf-card:hover { background: var(--dsw-alias-interactive-bg-hover-solid); }
.lf-card.lf-read .lf-card-title { color: var(--dsw-alias-label-secondary); }
.lf-card.lf-read .lf-card-summary { opacity: .75; }
.lf-card-title-row { display: flex; align-items: flex-start; gap: 6px; }
.lf-card-title {
  flex: 1; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  word-break: break-word;
}
.lf-badge {
  flex: none; margin-top: 1px; font-size: 10px; line-height: 1.4; font-weight: 600;
  padding: 1px 6px; border-radius: 999px;
  background: var(--dsw-alias-state-success-primary);
  color: var(--dsw-alias-label-primary-foreground);
}
.lf-card-summary {
  margin-top: 4px; font-size: 12px; color: var(--dsw-alias-label-secondary);
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
  word-break: break-word;
}
.lf-card-meta { margin-top: 8px; display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.lf-source-tag {
  font-size: 10px; padding: 1px 6px; border-radius: 4px;
  background: var(--dsw-specific-bubble); color: var(--dsw-alias-state-business-primary);
}
.lf-skeleton { padding: 10px 12px; }
.lf-skeleton .sk { background: var(--dsw-alias-bg-skeleton); border-radius: 6px; margin-bottom: 8px; height: 12px; }
.lf-skeleton .sk.w70 { width: 70%; }
.lf-empty {
  height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 24px; text-align: center;
}
.lf-empty-icon {
  width: 40px; height: 40px; border-radius: 50%;
  background: var(--dsw-alias-interactive-bg-hover);
  display: flex; align-items: center; justify-content: center;
  color: var(--dsw-alias-label-tertiary);
}
.lf-empty p { margin: 0; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.lf-empty .sub { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.lf-ghostbtn {
  margin-top: 4px; height: 28px; padding: 0 14px; border-radius: 7px;
  border: 1px solid var(--dsw-alias-border-l2); background: transparent;
  color: var(--dsw-alias-label-primary); font-size: 12px; cursor: pointer;
}
.lf-ghostbtn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.lf-settings { flex: 1; display: flex; flex-direction: column; min-height: 0; position: relative; }
.lf-settings .lf-scroll { padding: 4px 0 16px; }
.lf-sec { padding: 14px 14px 4px; }
.lf-sec + .lf-sec { border-top: 1px solid var(--dsw-alias-border-l1); margin-top: 4px; }
.lf-sec-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); margin-bottom: 10px; }
.lf-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.lf-field > span { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.lf-field input[type="number"] {
  width: 100%; height: 30px; padding: 0 8px; border-radius: 7px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-specific-input-major); color: var(--dsw-alias-label-primary);
  font-size: 12px; font-family: inherit; outline: none;
}
.lf-field input:focus { border-color: var(--dsw-alias-state-business-primary); }
.lf-save-row { display: flex; align-items: center; gap: 8px; padding: 14px; }
.lf-primarybtn {
  height: 30px; padding: 0 18px; border: none; border-radius: 8px;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
  font-size: 12px; font-weight: 600; cursor: pointer;
}
.lf-primarybtn:hover { background: var(--dsw-alias-button-primary-hover); }
.lf-settings-note { margin: -6px 14px 8px; font-size: 10px; color: var(--dsw-alias-label-tertiary); line-height: 1.5; }
.lf-fab {
  position: fixed; bottom: 24px; right: 12px;
  width: 38px; height: 38px; border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-state-business-primary);
  display: none; align-items: center; justify-content: center;
  cursor: pointer; z-index: 100;
}
.lf-fab.lf-visible { display: flex; }
.lf-fab:hover { background: var(--dsw-alias-interactive-bg-hover); }
.lf-fab svg { width: 16px; height: 16px; }
.lf-fab .lf-fab-dot {
  position: absolute; top: 6px; right: 6px; width: 7px; height: 7px;
  border-radius: 50%; background: var(--dsw-alias-state-success-primary);
  border: 1.5px solid var(--dsw-alias-bg-layer-1);
}
.lf-tooltip {
  position: fixed; z-index: 300; pointer-events: none;
  max-width: 320px; padding: 8px 10px; border-radius: 8px;
  background: var(--dsw-alias-tooltip-bg); color: var(--dsw-static-neutral-bluish-00);
  font-size: 11px; line-height: 1.7;
}
.lf-tooltip .tt-title { font-weight: 600; margin-bottom: 2px; }
.lf-tooltip .tt-row { color: rgba(255, 255, 255, .82); white-space: nowrap; }
.lf-tooltip .tt-ok { color: var(--dsw-alias-state-success-primary); }
.lf-tooltip .tt-err { color: var(--dsw-alias-state-error-primary); }
.lf-toast {
  position: absolute; left: 10px; right: 10px; bottom: 10px; z-index: 320;
  padding: 8px 12px; border-radius: 8px;
  background: var(--dsw-alias-toast-bg); color: var(--dsw-static-neutral-bluish-00);
  font-size: 11px;
}
`;
    function ensureStyle() {
      if (typeof document === 'undefined') return;
      if (document.getElementById('dsh-livefeed-style') !== null) return;
      const tag = document.createElement('style');
      tag.id = 'dsh-livefeed-style';
      tag.dataset.plugin = '@dsh-external/dsh-livefeed';
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }
    ensureStyle();

    /* Host 通信：POST /api/dsh-livefeed（bundle 模式） */
    async function rpc(method, args) {
      const res = await fetch('/api/dsh-livefeed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, args: args || {} }),
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (_) { json = null; }
      if (!json || json.ok !== true) {
        const ct = res.headers.get('content-type') || '';
        throw new Error('HTTP ' + res.status + ' [' + ct + '] ' + text.slice(0, 120));
      }
      return json.data;
    }

    function fmtTime(ts) {
      if (!ts) return '';
      const diff = Date.now() - ts;
      if (diff < 60 * 1000) return '刚刚';
      if (diff < 3600 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
      if (diff < 86400 * 1000) return Math.floor(diff / 3600000) + ' 小时前';
      const d = new Date(ts);
      return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    }

    function iconSvg(path, size) {
      return h('svg', { viewBox: '0 0 24 24', width: size || 14, height: size || 14, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('path', { d: path }));
    }

    /* ── 单张卡片（点击打开原文并自动标记已读）── */
    function CardItem(props) {
      const card = props.card;
      const compact = props.compact; // 已读标签页：仅显示标题，容纳更多条目
      function onClick(e) {
        if (!card.read) props.onMarkRead(card.id);
      }
      return h('div', { className: 'lf-card-wrap' },
        h('a', {
          className: 'lf-card' + (card.read ? ' lf-read' : '') + (compact ? ' lf-compact' : ''),
          href: card.url, target: '_blank', rel: 'noreferrer',
          title: '在新标签页打开原文',
          onClick,
        },
          h('div', { className: 'lf-card-title-row' },
            h('span', { className: 'lf-card-title' }, card.title),
            (card.isNew && !card.read) ? h('span', { className: 'lf-badge' }, '新') : null,
          ),
          (card.summary && !compact) ? h('div', { className: 'lf-card-summary' }, card.summary) : null,
          h('div', { className: 'lf-card-meta' },
            card.sourceName ? h('span', { className: 'lf-source-tag' }, card.sourceName) : null,
            h('span', { className: 'lf-card-time' }, fmtTime(card.createdAt) || card.publishedAt || ''),
            h('span', { className: 'lf-card-time' }, card.read ? '已读' : '打开原文 ↗'),
          ),
        ),
      );
    }

    /* ── 主面板 ── */
    function LiveFeedPanel() {
      const [data, setData] = React.useState(null);
      const [tip, setTip] = React.useState(null);
      const [collapsed, setCollapsed] = React.useState(false);
      const [settingsOpen, setSettingsOpen] = React.useState(false);
      const [toast, setToast] = React.useState(null);
      const toastTimer = React.useRef(null);
      const [tab, setTab] = React.useState('unread');
      const [collapsedCycles, setCollapsedCycles] = React.useState(null);
      const lastTickRef = React.useRef(null);

      const refresh = React.useCallback(async () => {
        try {
          const res = await rpc('cards');
          if (res && res.status) setData(res);
        } catch (_) { /* 轮询失败静默 */ }
      }, []);

      React.useEffect(() => {
        refresh();
        let stop = null;
        try { stop = ctx.interval(refresh, 5000); } catch (_) { /* ignore */ }
        return () => { if (stop) stop(); };
      }, [refresh]);

      function showToast(msg) {
        setToast(msg);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 2600);
      }
      async function call(method, args) {
        try { return await rpc(String(method).replace(/^dsh-livefeed\//, ''), args || {}); } catch (e) { console.error('[dsh-livefeed] rpc failed', method, e); return null; }
      }
      function showTip(e, html) {
        const r = e.currentTarget.getBoundingClientRect();
        setTip({ left: Math.max(8, r.right - 200), top: r.bottom + 6, html });
      }

      const cards = (data && data.cards) || [];
      const status = (data && data.status) || {};
      const phase = status.paused ? 'paused' : (status.running ? 'running' : (status.lastError ? 'error' : 'idle'));
      const stats = status.cycleStats;

      React.useEffect(() => {
        if (lastTickRef.current !== status.tick) {
          lastTickRef.current = status.tick;
          setCollapsedCycles(null);
        }
      }, [status.tick]);

      const unreadCards = cards.filter((c) => !c.read);
      const readCards = cards.filter((c) => c.read);
      const tabDefs = [
        { id: 'unread', label: '未读', count: unreadCards.length },
        { id: 'read', label: '已读', count: readCards.length },
      ];

      const STAGE_LABELS = { coarse: '拉取', judge: '价值筛选', fine: '摘要', land: '落卡' };
      const prog = status.progress || {};
      const runningText = '采集中 · ' + (STAGE_LABELS[prog.stage] || '整理') + (prog.detail ? ' · ' + prog.detail : '');

      const statusText = status.paused
        ? '已暂停 · 上次刷新 ' + (status.lastRunAt ? fmtTime(status.lastRunAt) : '—')
        : (status.running ? runningText
          : (status.lastError ? '上次周期失败' + ((status.retrying || 0) > 0 ? ' · 重试中(' + status.retrying + '/2)' : '')
            : '上次刷新 ' + (status.lastRunAt ? fmtTime(status.lastRunAt) : '—') + ' · ' +
              ((status.sourceErrors || []).length ? (status.sourceErrors.length + ' 个源出错') : (cards.length ? '正常' : '等待首次采集'))));

      const statusTip =
        '<div class="tt-title">采集状态</div>' +
        '<div class="tt-row">上次刷新：' + (status.lastRunAt ? new Date(status.lastRunAt).toLocaleString() : '—') + '</div>' +
        '<div class="tt-row">运行周期：' + (status.tick || 0) + ' · 状态：' + (status.paused ? '已暂停' : (status.running ? '采集中 · ' + (STAGE_LABELS[prog.stage] || '整理') + (prog.detail ? ' · ' + prog.detail : '') : (status.lastError ? '出错' : '正常'))) + '</div>' +
        '<div class="tt-row">源：' + ((status.sourceErrors || []).length ? '<span class="tt-err">Linux Do 出错</span>' : '<span class="tt-ok">Linux Do 正常</span>') + '</div>' +
        (status.lastError ? '<div class="tt-row tt-err">错误：' + status.lastError + '</div>' : '') +
        (status.sourceErrors || []).map((s) => '<div class="tt-row">· ' + s.sourceId + ' — ' + s.message + '</div>').join('');
      const statsTip =
        '<div class="tt-title">本次周期统计</div>' +
        '<div class="tt-row">拉取 ' + (stats ? stats.scanned : 0) + ' 条 → 输出 ' + (stats ? stats.selected : 0) + ' 条（过滤 ' + (stats ? stats.filtered : 0) + ' 条）</div>';

      // ── 按刷新周期分组（cycle 为刷新事件时间戳；缺失/历史条目归入「更早」）──
      function groupItems(items, timeOf) {
        const map = new Map();
        for (const it of items) {
          const c = (it.cycle === undefined || it.cycle === null) ? -1 : it.cycle;
          if (!map.has(c)) map.set(c, { cycle: c, items: [], time: 0 });
          const g = map.get(c);
          g.items.push(it);
          const t = timeOf(it) || 0;
          if (t > g.time) g.time = t;
        }
        return Array.from(map.values()).sort((a, b) => b.cycle - a.cycle);
      }
      function isCycleCollapsed(cycle, groups) {
        if (collapsedCycles !== null) return collapsedCycles.has(cycle);
        const newest = groups.length ? groups[0].cycle : null;
        return cycle !== newest;
      }
      function toggleCycle(cycle, groups) {
        setCollapsedCycles((prev) => {
          const newest = groups.length ? groups[0].cycle : null;
          const set = prev !== null ? new Set(prev) : new Set(groups.map((g) => g.cycle).filter((c) => c !== newest));
          if (set.has(cycle)) set.delete(cycle); else set.add(cycle);
          return set;
        });
      }
      function cycleGroup(g, groups, children) {
        const collapsed = isCycleCollapsed(g.cycle, groups);
        const label = g.cycle < 0 ? '更早' : ('刷新于 ' + (g.time ? fmtTime(g.time) : ''));
        return h('div', { key: 'g' + g.cycle },
          h('button', {
            className: 'lf-group' + (collapsed ? ' lf-collapsed' : ''),
            title: g.cycle < 0 ? '无法确定刷新时间的条目' : (new Date(g.cycle).toLocaleString() + ' 的刷新 · 点击' + (collapsed ? '展开' : '折叠')),
            onClick: () => toggleCycle(g.cycle, groups),
          },
            h('span', { className: 'lf-group-label' }, label),
            h('span', { className: 'lf-group-count' }, g.items.length + ' 条'),
            h('span', { className: 'lf-group-chevron' }, collapsed ? '▸' : '▾'),
          ),
          collapsed ? null : h('div', { className: 'lf-cycle-body' }, children),
        );
      }

      function renderCard(c, compact) {
        return h(CardItem, {
          key: c.id, card: c, compact,
          onMarkRead: async (id) => { await call('dsh-livefeed/mark', { cardId: id, read: true }); refresh(); },
        });
      }

      function emptyEl(main, sub, withRefresh) {
        return h('div', { className: 'lf-empty' },
          h('div', { className: 'lf-empty-icon' }, iconSvg('M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z', 18)),
          h('p', null, main),
          sub ? h('p', { className: 'sub' }, sub) : null,
          withRefresh ? h('button', { className: 'lf-ghostbtn', onClick: async () => { const r4 = await call('dsh-livefeed/refresh'); showToast(r4 && r4.accepted === false ? (r4.reason === 'paused' ? '已暂停，请先恢复' : '采集进行中') : '已触发刷新'); } }, '立即刷新') : null,
        );
      }

      function listContent() {
        if (tab === 'unread') {
          if (!unreadCards.length) {
            return emptyEl('暂无未读内容', status.paused ? '采集已暂停' : '点击「立即刷新」从 Linux Do 拉取话题', true);
          }
          const groups = groupItems(unreadCards, (c) => c.createdAt || 0);
          return h('div', null, groups.map((g) => cycleGroup(g, groups, g.items.map((c) => renderCard(c, false)))));
        }
        if (!readCards.length) return emptyEl('暂无已读内容', '', false);
        const groups = groupItems(readCards, (c) => c.createdAt || 0);
        return h('div', null, groups.map((g) => cycleGroup(g, groups, g.items.map((c) => renderCard(c, true)))));
      }

      return h('div', null,
        h('div', { className: 'lf-panel' + (collapsed ? ' lf-hidden' : ''), 'data-livefeed': 'panel' },
          h('div', { className: 'lf-header' },
            h('div', { className: 'lf-title' },
              h('span', { className: 'lf-logo' }, iconSvg('M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z', 10)),
              h('span', null, settingsOpen ? '面板设置' : '实时讯息'),
            ),
            h('button', {
              className: 'lf-iconbtn',
              title: settingsOpen ? '返回' : '面板设置',
              onClick: () => setSettingsOpen(!settingsOpen),
            }, iconSvg(settingsOpen ? 'M15 6l-6 6 6 6' : 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z', 14)),
            settingsOpen ? null : h('button', {
              className: 'lf-iconbtn',
              title: '立即刷新',
              onClick: async () => { const r3 = await call('dsh-livefeed/refresh'); showToast(r3 && r3.accepted === false ? (r3.reason === 'paused' ? '已暂停，请先恢复' : '采集进行中') : '已触发刷新'); },
            }, iconSvg('M21 12a9 9 0 1 1-2.64-6.36' + 'M21 3v6h-6', 14)),
            settingsOpen ? null : h('button', {
              className: 'lf-iconbtn',
              title: collapsed ? '展开面板' : '折叠面板',
              onClick: () => setCollapsed(!collapsed),
            }, iconSvg(collapsed ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6', 14)),
          ),
          settingsOpen ? null : h('div', { className: 'lf-status', 'data-phase': phase },
            h('span', { className: 'lf-dot' }),
            h('span', { className: 'lf-status-text', onMouseEnter: (e) => showTip(e, statusTip), onMouseLeave: () => setTip(null) }, statusText),
            stats ? h('span', { className: 'lf-cycle-stats', onMouseEnter: (e) => showTip(e, statsTip), onMouseLeave: () => setTip(null) },
              '本次 ' + stats.scanned + '→' + stats.selected) : null,
            h('button', { className: 'lf-mark-all', onClick: async () => { await call('dsh-livefeed/set-paused', { paused: !status.paused }); refresh(); } },
              status.paused ? '恢复' : '暂停'),
            h('button', { className: 'lf-mark-all', onClick: async () => { await call('dsh-livefeed/mark-all-read'); refresh(); showToast('已全部标记已读 ✓'); } }, '全部已读'),
          ),
          settingsOpen ? null : ((status.sourceErrors || []).length ? h('div', { className: 'lf-src-err' },
            (status.sourceErrors || []).map((s, i) => h('div', { key: i, className: 'lf-src-err-item' },
              h('b', null, String(s.sourceId || '') + '：'), String(s.message || '').slice(0, 100), '（点右上角「立即刷新」重试）',
            )),
          ) : null),
          settingsOpen ? null : h('div', { className: 'lf-tabs' },
            tabDefs.map((t) => h('button', {
              key: t.id,
              className: 'lf-tab' + (tab === t.id ? ' lf-on' : ''),
              onClick: () => setTab(t.id),
            },
              t.label,
              h('span', { className: 'lf-tab-count' }, String(t.count)),
            )),
          ),
          settingsOpen
            ? h(SettingsView, { key: 'settings', status, refresh, showToast, onBack: () => setSettingsOpen(false) })
            : h('div', { className: 'lf-scroll' }, listContent()),
          toast ? h('div', { className: 'lf-toast' }, toast) : null,
        ),
        h('button', {
          className: 'lf-fab' + (collapsed ? ' lf-visible' : ''),
          title: '展开实时讯息',
          onClick: () => setCollapsed(false),
        },
          iconSvg('M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z', 16),
          h('span', { className: 'lf-fab-dot' }),
        ),
        tip ? h('div', { className: 'lf-tooltip', style: { left: tip.left + 'px', top: tip.top + 'px' } },
          h('div', { dangerouslySetInnerHTML: { __html: tip.html } })) : null,
      );
    }

    /* ── 设置视图（拉取数量 / 输出数量 / 已读保留天数）── */
    function SettingsView(props) {
      const [cfg, setCfg] = React.useState(null);
      const [fetchCount, setFetchCount] = React.useState(40);
      const [outputCount, setOutputCount] = React.useState(8);
      const [retentionDays, setRetentionDays] = React.useState(3);
      const [loadError, setLoadError] = React.useState(null);

      React.useEffect(() => {
        (async () => {
          try {
            const c = await rpc('config');
            if (c && c.config) {
              setCfg(c.config);
              setFetchCount(Number(c.config.fetchCount) || 40);
              setOutputCount(Number(c.config.outputCount) || 8);
              setRetentionDays(Number(c.config.retentionDays) || 3);
            }
          } catch (e) { setLoadError('配置加载失败：' + String((e && e.message) || e)); }
        })();
      }, []);

      async function saveAll() {
        // 客户端先行钳制（服务端同样有边界校验，双保险）
        const fc = Math.max(1, Math.min(200, Math.round(Number(fetchCount) || 1)));
        const oc = Math.max(1, Math.min(50, Math.round(Number(outputCount) || 1)));
        const rd = Math.max(1, Math.min(90, Math.round(Number(retentionDays) || 3)));
        try {
          await rpc('update-settings', {
            fetchCount: fc,
            outputCount: oc,
            retentionDays: rd,
          });
          props.showToast('设置已保存 ✓ · 下一刷新周期生效');
          props.refresh();
          props.onBack();
        } catch (e) {
          props.showToast('保存失败：' + String((e && e.message) || e));
        }
      }

      return h('div', { className: 'lf-settings' },
        h('div', { className: 'lf-scroll' },
          h('div', { className: 'lf-sec' },
            h('div', { className: 'lf-sec-title' }, '采集参数'),
            loadError ? h('div', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 11, marginBottom: 8 } }, loadError) : null,
            h('label', { className: 'lf-field' },
              h('span', null, '拉取数量（单次从「最新 + 最热门」共拉取的话题数）'),
              h('input', {
                type: 'number', min: 1, max: 200, value: fetchCount,
                onChange: (e) => setFetchCount(Number(e.target.value) || 1),
              }),
            ),
            h('label', { className: 'lf-field' },
              h('span', null, '输出数量（AI 按价值筛选后输出的卡片数）'),
              h('input', {
                type: 'number', min: 1, max: 50, value: outputCount,
                onChange: (e) => setOutputCount(Number(e.target.value) || 1),
              }),
            ),
            h('label', { className: 'lf-field' },
              h('span', null, '已读卡片保留（天）'),
              h('input', {
                type: 'number', min: 1, max: 90, value: retentionDays,
                onChange: (e) => setRetentionDays(Number(e.target.value) || 3),
              }),
            ),
          ),
          h('div', { className: 'lf-save-row' },
            h('button', { className: 'lf-primarybtn', onClick: saveAll }, '保存'),
            h('button', { className: 'lf-ghostbtn', onClick: () => { setFetchCount(40); setOutputCount(8); setRetentionDays(3); } }, '恢复默认'),
          ),
          h('p', { className: 'lf-settings-note' },
            '源固定为 Linux Do；带「富可敌国」标签的推广话题自动屏蔽；' +
            '其余话题由 AI 按价值筛选（回复数/内容质量等，不按主题过滤）；' +
            '已读/已采集的话题不会重复拉取；已读卡片按「保留天数」过期清除（默认 3 天）。刷新间隔与模型可在 config.json 中调整。',
          ),
        ),
      );
    }

    // ══ 注册悬浮面板（root 作用域，任意页面可见）══
    slots.inject('shell.overlay', () =>
      slots.register(
        { name: 'shell.overlay', id: 'dsh-livefeed.panel', order: 100 },
        (props) => h(LiveFeedPanel, props)
      )
    );
  },
};
