/* ═══════════════════════════════════════════════════════════════════════════
 * LiveFeed Client 半 —— cordis_define(code.client) 的函数体
 * ═══════════════════════════════════════════════════════════════════════════
 * 实现状态：骨架。待 HTML 原型评审通过后，按 docs/design.md 第 8 节与
 * prototype/prototype.html 的视觉规范完成（全部颜色使用 --dsw-alias-* 令牌）。
 *
 * 约定：
 * - 本文件内容整体作为 code.client 传入 cordis_define（不含外层 function 声明）；
 * - 仅可用 Builtins：ctx / React / host / styles / console；
 *   React 组件必须用 React.createElement，禁止 JSX；
 * - 样式经 styles.insert(css) 注入，颜色一律 var(--dsw-alias-*) / var(--dsw-static-*)。
 */
return {
  apply(ctx) {
    const slots = ctx.get('slots');
    if (slots === undefined) return;

    // ══ 面板组件 ══
    function LiveFeedPanel(props) {
      // TODO(评审后)：
      //  - 挂载时 host.call('livefeed/cards') 拉取，之后每 15s 轮询（ctx.interval）
      //  - 状态：{cards, status}；折叠态存 React state（页面级）
      //  - 头部：标题「实时讯息」+ 折叠按钮 + 立即刷新按钮 + 状态行
      //  - 卡片：<a href={card.url} target="_blank" rel="noreferrer">
      //      title(2行截断) + summary(3行截断) + 源标签 + 时间 + isNew 徽标
      //  - 空态/加载态/错误态/折叠窄条（对应 prototype 的 4 种预览状态）
      return React.createElement('div', { 'data-livefeed': 'panel' }, 'LiveFeed Panel');
    }

    // ══ 注册悬浮面板（root 作用域，任意页面可见）══
    slots.inject('shell.overlay', () =>
      slots.register(
        { name: 'shell.overlay', id: 'livefeed.panel', order: 100 },
        (props) => React.createElement(LiveFeedPanel, props)
      )
    );
  },
};
