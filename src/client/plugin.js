/* ═══════════════════════════════════════════════════════════════════════════
 * dsh-livefeed Client 半（v1.2：bundle 化）
 * ═══════════════════════════════════════════════════════════════════════════
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
.lf-scroll { flex: 1; overflow-y: auto; padding: 8px; min-height: 0; }
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
/* 折叠组内容区：缩进 + 引导竖线，树状层级（卡片在折叠按钮“内部”，不与其平级） */
.lf-cycle-body {
  margin: 0 6px 4px 16px;
  padding-left: 10px;
  border-left: 1px solid var(--dsw-alias-border-l1);
  display: flex; flex-direction: column; gap: 2px;
}
.lf-cycle-body .lf-card-wrap, .lf-cycle-body .lf-filter-item { border-radius: 6px; }
.lf-cycle-body .lf-filter-item { padding-left: 8px; padding-right: 4px; }
.lf-src-err {
  flex: none; padding: 4px 10px; font-size: 11px;
  color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-interactive-bg-hover-danger);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  display: flex; flex-direction: column; gap: 2px;
}
.lf-src-err-item { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lf-card-wrap { position: relative; overflow: hidden; border-radius: 8px; }
.lf-card-swipe {
  position: absolute; top: 0; right: 0; bottom: 0; width: 84px;
  background: var(--dsw-alias-state-error-primary); color: #fff;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
  font-size: 10px; font-weight: 600;
}
.lf-card-swipe.lf-remove { background: var(--dsw-alias-label-tertiary); color: var(--dsw-alias-label-primary-foreground); }
.lf-card-swipe svg { width: 14px; height: 14px; }
.lf-card {
  display: block; text-decoration: none; color: inherit;
  padding: 10px 12px; border-radius: 8px;
  border: 1px solid transparent;
  position: relative; z-index: 1;
  background: var(--dsw-alias-bg-layer-1);
  transition: background .12s, transform .18s ease;
  touch-action: pan-y; user-select: none; cursor: pointer;
}
.lf-card:hover { background: var(--dsw-alias-interactive-bg-hover-solid); }
.lf-card.lf-dragging { transition: none; cursor: grabbing; }
.lf-card.lf-swiped { transform: translateX(-120%); opacity: 0; }
.lf-card.lf-read .lf-card-title { color: var(--dsw-alias-label-secondary); }
.lf-card.lf-read .lf-card-summary { opacity: .75; }
/* 紧凑模式（不感兴趣/屏蔽标签页）：仅标题，容纳更多条目 */
.lf-card.lf-compact { padding: 8px 12px; }
.lf-card.lf-compact .lf-card-title { -webkit-line-clamp: 1; font-size: 12.5px; }
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
.lf-related { font-size: 10px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
.lf-feedback-tag { font-size: 10px; padding: 1px 6px; border-radius: 4px; font-weight: 600; }
.lf-feedback-tag.lf-dislike { background: var(--dsw-alias-interactive-bg-hover-danger); color: var(--dsw-alias-state-error-primary); }
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
.lf-field select, .lf-field input[type="number"] {
  width: 100%; height: 30px; padding: 0 8px; border-radius: 7px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-specific-input-major); color: var(--dsw-alias-label-primary);
  font-size: 12px; font-family: inherit; outline: none;
}
.lf-field select:focus, .lf-field input:focus { border-color: var(--dsw-alias-state-business-primary); }
.lf-field select:disabled, .lf-field input:disabled { opacity: .5; }
.lf-check { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--dsw-alias-label-secondary); cursor: pointer; user-select: none; }
.lf-check input { accent-color: var(--dsw-alias-state-business-primary); }
.lf-check .hint { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.lf-source-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.lf-source-row:last-of-type { border-bottom: none; }
.lf-source-info { flex: 1; min-width: 0; }
.lf-source-name { font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lf-source-id { font-size: 11px; color: var(--dsw-alias-label-tertiary); margin-top: 1px; }
.lf-source-row.lf-disabled .lf-source-name, .lf-source-row.lf-disabled .lf-source-id { opacity: .55; }
.lf-switch { position: relative; flex: none; width: 32px; height: 18px; cursor: pointer; display: inline-block; }
.lf-switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.lf-switch .lf-switch-track {
  position: absolute; inset: 0; border-radius: 999px;
  background: var(--dsw-alias-border-l3); transition: background .15s;
}
.lf-switch .lf-switch-track::after {
  content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
  border-radius: 50%; background: #fff; transition: transform .15s;
}
.lf-switch input:checked + .lf-switch-track { background: var(--dsw-alias-state-business-primary); }
.lf-switch input:checked + .lf-switch-track::after { transform: translateX(14px); }
.lf-thresh-global { display: flex; gap: 12px; margin: 0 0 4px; }
.lf-thresh { display: flex; gap: 6px; flex: none; align-items: flex-end; }
.lf-thresh-item { display: flex; flex-direction: column; gap: 2px; }
.lf-thresh-item > span { font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.lf-thresh-item input[type="number"] {
  width: 56px; height: 26px; padding: 0 6px; border-radius: 7px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-specific-input-major); color: var(--dsw-alias-label-primary);
  font-size: 11px; font-family: inherit; outline: none;
}
.lf-thresh-item input:focus { border-color: var(--dsw-alias-state-business-primary); }
.lf-sec-title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.lf-sec-title-row .lf-sec-title { margin-bottom: 0; }
.lf-gearbtn { flex: none; border: none; background: none; cursor: pointer; font-size: 13px; line-height: 1; color: var(--dsw-alias-label-tertiary); padding: 3px 5px; border-radius: 6px; }
.lf-gearbtn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.lf-thresh-body { flex: 1; overflow-y: auto; padding: 4px 14px 10px; }
.lf-thresh-src { display: flex; align-items: flex-end; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.lf-thresh-src:last-of-type { border-bottom: none; }
.lf-thresh-src-name { flex: 1; min-width: 0; font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lf-thresh-note { font-size: 10px; color: var(--dsw-alias-label-tertiary); margin: 0 0 6px; }
.lf-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.lf-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 999px; font-size: 11px;
  background: var(--dsw-specific-bubble); color: var(--dsw-alias-state-business-primary);
}
.lf-chip button { border: none; background: none; color: inherit; cursor: pointer; padding: 0; font-size: 12px; line-height: 1; opacity: .7; }
.lf-chip button:hover { opacity: 1; }
.lf-chip-add { display: flex; gap: 6px; }
.lf-chip-add input {
  flex: 1; min-width: 0; height: 26px; padding: 0 8px; border-radius: 7px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-specific-input-major); color: var(--dsw-alias-label-primary);
  font-size: 12px; font-family: inherit; outline: none;
}
.lf-chip-add input:focus { border-color: var(--dsw-alias-state-business-primary); }
.lf-rules-box {
  background: var(--dsw-alias-interactive-bg-hover);
  border-radius: 8px; padding: 8px 10px;
  font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.7;
}
.lf-rules-meta { color: var(--dsw-alias-label-tertiary); font-size: 10px; }
.lf-filter-item { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.lf-filter-item:last-child { border-bottom: none; }
.lf-filter-info { flex: 1; min-width: 0; }
.lf-filter-title { font-size: 11.5px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; text-decoration: none; }
.lf-filter-title:hover { color: var(--dsw-alias-state-business-primary); }
.lf-filter-meta { font-size: 10px; color: var(--dsw-alias-label-tertiary); margin-top: 1px; }
.lf-filter-reason { font-size: 10px; padding: 0 5px; border-radius: 4px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-tertiary); }
.lf-unblock {
  flex: none; border: none; background: none;
  color: var(--dsw-alias-state-business-primary); font-size: 11px;
  padding: 2px 6px; border-radius: 4px; cursor: pointer;
}
.lf-unblock:hover { background: var(--dsw-alias-interactive-bg-hover); }
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
/* 摘要弹窗（未读/已读点击后） */
.lf-modal {
  position: absolute; inset: 0; z-index: 150;
  display: flex; align-items: center; justify-content: center;
  background: var(--dsw-alias-bg-mask-2); padding: 16px;
}
.lf-modal-card {
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px;
  width: 100%; max-height: 82%; display: flex; flex-direction: column; overflow: hidden;
}
.lf-modal-head { display: flex; align-items: flex-start; gap: 8px; padding: 14px 12px 8px 14px; }
.lf-modal-title { flex: 1; font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); line-height: 1.5; }
.lf-modal-meta { padding: 0 14px 6px; display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.lf-modal-summary {
  flex: 1; overflow-y: auto; padding: 4px 14px 12px;
  font-size: 12.5px; line-height: 1.7; color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap; word-break: break-word;
}
.lf-modal-related { padding: 0 14px 10px; display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 10px; }
.lf-modal-related-title { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.lf-modal-related-link { font-size: 12px; color: var(--dsw-alias-state-business-primary); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lf-modal-related-link:hover { text-decoration: underline; }
.lf-modal-actions { padding: 8px 14px 14px; display: flex; justify-content: flex-end; }
.lf-modal-actions .lf-primarybtn { text-decoration: none; display: inline-flex; align-items: center; }
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

    /* 思考等级兜底列表（模型未提供 efforts 元数据时使用） */
    const FALLBACK_EFFORTS = [
      { id: 'none', name: 'none（关闭思考）' },
      { id: 'low', name: 'low' },
      { id: 'medium', name: 'medium' },
      { id: 'high', name: 'high' },
      { id: 'max', name: 'max' },
    ];

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

    /* ── 单张卡片（含左滑手势）── */
    function CardItem(props) {
      const card = props.card;
      const drag = React.useRef({ startX: 0, startY: 0, dx: 0, moved: false, dragging: false });
      const ref = React.useRef(null);

      function reset() {
        const d = drag.current;
        d.dragging = false;
        const el = ref.current;
        if (el) { el.classList.remove('lf-dragging'); el.style.transform = ''; }
      }
      function onPointerDown(e) {
        if (e.button !== 0) return;
        const d = drag.current;
        d.startX = e.clientX; d.startY = e.clientY; d.dx = 0; d.moved = false; d.dragging = false;
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      }
      function onPointerMove(e) {
        const d = drag.current;
        if (e.buttons === 0) { if (d.dragging || d.moved) reset(); return; }
        const mx = e.clientX - d.startX;
        const my = e.clientY - d.startY;
        if (!d.moved && Math.abs(mx) < 6 && Math.abs(my) < 6) return;
        d.moved = true;
        e.preventDefault();
        if (!d.dragging) { d.dragging = true; const el = ref.current; if (el) el.classList.add('lf-dragging'); }
        d.dx = Math.max(-120, Math.min(0, mx));
        const el = ref.current;
        if (el) el.style.transform = 'translateX(' + d.dx + 'px)';
      }
      function onPointerUp(e) {
        const d = drag.current;
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        if (d.dragging) {
          const out = d.dx <= -60;
          reset();
          if (out) {
            const el = ref.current;
            if (el) el.classList.add('lf-swiped');
            setTimeout(() => props.onFeedback(card.id, card.feedback === 'dislike' ? null : 'dislike'), 200);
          }
        }
      }
      function onClick(e) {
        const d = drag.current;
        if (d.moved) { d.moved = false; e.preventDefault(); return; }
        if (props.detailClick) {
          // 未读/已读：弹窗展示摘要，不直接跳转
          e.preventDefault();
          if (!card.read) props.onMarkRead(card.id);
          if (props.onDetail) props.onDetail(card);
          return;
        }
        // 不感兴趣：直接跳转原文（不阻止默认行为）
        if (!card.read) props.onMarkRead(card.id);
      }

      const isDislike = card.feedback === 'dislike';
      const compact = !!props.compact; // 紧凑模式：仅显示标题（不感兴趣/屏蔽 标签页）
      const badge = card.isNew && !card.read ? h('span', { className: 'lf-badge' }, '新') : null;
      const fbTag = isDislike ? h('span', { className: 'lf-feedback-tag lf-dislike' }, '不感兴趣') : null;
      const related = card.relatedUrls && card.relatedUrls.length
        ? h('span', { className: 'lf-related' }, '+' + card.relatedUrls.length + ' 来源') : null;
      const cls = 'lf-card' + (card.read ? ' lf-read' : '') + (isDislike ? ' lf-dislike' : '') + (compact ? ' lf-compact' : '');
      return h('div', { className: 'lf-card-wrap' },
        h('div', { className: 'lf-card-swipe' + (isDislike ? ' lf-remove' : '') },
          iconSvg(isDislike ? 'M18 6 6 18' + 'M6 6l12 12' : 'M17 14V2' + 'M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z', 14),
          h('span', null, isDislike ? '移除' : '不感兴趣'),
        ),
        h('a', {
          ref,
          className: cls,
          href: card.url,
          target: '_blank',
          rel: 'noreferrer',
          draggable: false,
          onPointerDown, onPointerMove, onPointerUp, onClick,
        },
          h('div', { className: 'lf-card-title-row' },
            h('span', { className: 'lf-card-title' }, card.title),
            badge,
          ),
          card.summary && !compact ? h('div', { className: 'lf-card-summary' }, card.summary) : null,
          compact
            ? h('div', { className: 'lf-card-meta' },
                card.sourceName ? h('span', { className: 'lf-source-tag' }, card.sourceName) : null,
                h('span', { className: 'lf-card-time' }, card.read ? '已读' : '打开原文 ↗'),
              )
            : h('div', { className: 'lf-card-meta' },
                card.sourceName ? h('span', { className: 'lf-source-tag' }, card.sourceName) : null,
                related,
                h('span', { className: 'lf-card-time' }, fmtTime(card.createdAt) || card.publishedAt || ''),
                fbTag,
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
      const [filterLog, setFilterLog] = React.useState([]);
      const [detail, setDetail] = React.useState(null); // 摘要弹窗当前卡片
      const [collapsedCycles, setCollapsedCycles] = React.useState(null); // 折叠的刷新周期集合（null=默认：仅最新一轮展开）
      const lastTickRef = React.useRef(null);

      const refresh = React.useCallback(async () => {
        try {
          const res = await rpc('cards');
          if (res && res.status) setData(res);
        } catch (_) { /* 轮询失败静默 */ }
        try {
          const fl = await rpc('filter-log');
          if (fl && Array.isArray(fl.items)) setFilterLog(fl.items);
        } catch (_) { /* 屏蔽列表失败静默 */ }
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

      // 刷新事件完成（tick 变化）后：折叠旧周期，仅展开最新一轮；用户可单独点击展开/折叠
      React.useEffect(() => {
        if (lastTickRef.current !== status.tick) {
          lastTickRef.current = status.tick;
          setCollapsedCycles(null);
        }
      }, [status.tick]);

      const latestCards = cards.filter((c) => !c.read && c.isNew);
      const unreadCards = cards.filter((c) => !c.read && !c.isNew);
      const readCards = cards.filter((c) => c.read && c.feedback !== 'dislike');
      const dislikeCards = cards.filter((c) => c.feedback === 'dislike');
      const tabDefs = [
        { id: 'unread', label: '未读', count: latestCards.length + unreadCards.length },
        { id: 'read', label: '已读', count: readCards.length },
        { id: 'dislike', label: '不感兴趣', count: dislikeCards.length },
        { id: 'blocked', label: '屏蔽', count: filterLog.length },
      ];

      const STAGE_LABELS = { coarse: '粗搜', judge: '筛选', cluster: '聚类', fine: '精读摘要', land: '落卡', translate: '翻译屏蔽标题', rules: '规则学习', done: '完成' };
      const prog = status.progress || {};
      const runningText = '采集中 · ' + (STAGE_LABELS[prog.stage] || '整理') + (prog.detail ? ' · ' + prog.detail : '');

      const statusText = status.paused
        ? '已暂停 · 上次刷新 ' + (status.lastRunAt ? fmtTime(status.lastRunAt) : '—')
        : (status.running ? runningText
          : (status.lastError ? '上次周期失败 · 重试中(' + (status.retrying || 1) + '/2)'
            : '上次刷新 ' + (status.lastRunAt ? fmtTime(status.lastRunAt) : '—') + ' · ' +
              ((status.sourceErrors || []).length ? (status.sourceErrors.length + ' 个源出错') : (status.sourceErrors && cards.length ? '正常' : '待配置'))));

      const statusTip =
        '<div class="tt-title">采集状态</div>' +
        '<div class="tt-row">上次刷新：' + (status.lastRunAt ? new Date(status.lastRunAt).toLocaleString() : '—') + '</div>' +
        '<div class="tt-row">运行周期：' + (status.tick || 0) + ' · 状态：' + (status.paused ? '已暂停' : (status.running ? '采集中 · ' + (STAGE_LABELS[prog.stage] || '整理') + (prog.detail ? ' · ' + prog.detail : '') : (status.lastError ? '出错' : '正常'))) + '</div>' +
        '<div class="tt-row">搜索源：' + ((status.sourceErrors || []).length ? '<span class="tt-err">' + status.sourceErrors.length + ' 出错</span>' : '<span class="tt-ok">正常</span>') + '</div>' +
        (status.lastError ? '<div class="tt-row tt-err">错误：' + status.lastError + '</div>' : '') +
        (status.sourceErrors || []).map((s) => '<div class="tt-row">· ' + s.sourceId + ' — ' + s.message + '</div>').join('');
      const statsTip =
        '<div class="tt-title">本次周期统计</div>' +
        '<div class="tt-row">扫描 ' + (stats ? stats.scanned : 0) + ' 条 → 精选 ' + (stats ? stats.selected : 0) + ' 条 → 屏蔽 ' + (stats ? stats.filtered : 0) + ' 条</div>';

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
        return cycle !== newest; // 默认：仅最新一轮展开
      }
      function toggleCycle(cycle, groups) {
        setCollapsedCycles((prev) => {
          const newest = groups.length ? groups[0].cycle : null;
          const set = prev !== null ? new Set(prev) : new Set(groups.map((g) => g.cycle).filter((c) => c !== newest));
          if (set.has(cycle)) set.delete(cycle); else set.add(cycle);
          return set;
        });
      }
      // 周期组头：显示该轮刷新的相对时间；点击展开/折叠
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

      function renderCard(c) {
        return h(CardItem, {
          key: c.id, card: c, compact: tab === 'dislike',
          detailClick: tab !== 'dislike', // 未读/已读弹窗预览；不感兴趣直接跳原文
          onMarkRead: (id) => { call('dsh-livefeed/mark', { cardId: id, read: true }); refresh(); },
          onFeedback: (id, fb) => { call('dsh-livefeed/mark', { cardId: id, feedback: fb }); refresh(); },
          onDetail: (c) => setDetail(c),
        });
      }

      function emptyEl(main, sub, withRefresh) {
        return h('div', { className: 'lf-empty' },
          h('div', { className: 'lf-empty-icon' }, iconSvg('M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z', 18)),
          h('p', null, main),
          sub ? h('p', { className: 'sub' }, sub) : null,
          withRefresh ? h('button', { className: 'lf-ghostbtn', onClick: () => { call('dsh-livefeed/refresh'); showToast('已触发刷新'); } }, '立即刷新') : null,
        );
      }

      function listContent() {
        if (tab === 'blocked') {
          if (!filterLog.length) return emptyEl('暂无被屏蔽内容', '被过滤掉的条目会显示在这里，可撤销恢复', false);
          const groups = groupItems(filterLog, (it) => (it.ts ? Date.parse(it.ts) : 0));
          return h('div', null, groups.map((g) => cycleGroup(g, groups,
            g.items.map((it, i) => h('div', { key: i, className: 'lf-filter-item' },
              h('div', { className: 'lf-filter-info' },
                h('a', { className: 'lf-filter-title', href: it.url, target: '_blank', rel: 'noreferrer', title: '在新标签页打开原文' }, it.title),
                h('div', { className: 'lf-filter-meta' }, it.sourceId + ' · ' + (it.reason === 'block-keyword' ? '屏蔽词命中' : (it.reason === 'max-candidates' ? '候选上限截断' : '模型筛选')) + ' · ' + fmtTime(it.ts ? Date.parse(it.ts) : 0)),
              ),
              h('button', { className: 'lf-unblock', onClick: async () => {
                await call('dsh-livefeed/unblock', { url: it.url });
                refresh();
                showToast('已撤销：该条目已恢复为未读卡片 ✓');
              } }, '撤销'),
            )),
          )));
        }
        if (tab === 'unread') {
          const unread = cards.filter((c) => !c.read);
          if (!unread.length) {
            return emptyEl('暂无未读内容', status.paused ? '采集已暂停' : '在设置中启用搜索源后开始采集', true);
          }
          const groups = groupItems(unread, (c) => c.createdAt || 0);
          return h('div', null, groups.map((g) => cycleGroup(g, groups, g.items.map(renderCard))));
        }
        if (tab === 'read') {
          if (!readCards.length) return emptyEl('暂无已读内容', '', false);
          const groups = groupItems(readCards, (c) => c.createdAt || 0);
          return h('div', null, groups.map((g) => cycleGroup(g, groups, g.items.map(renderCard))));
        }
        // dislike：不折叠，平铺展示（用户主动标记的内容需要一眼可见）
        if (!dislikeCards.length) return emptyEl('暂无不感兴趣内容', '在未读/已读中左滑卡片即可标记', false);
        return h('div', null, dislikeCards.map(renderCard));
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
              onClick: () => { call('dsh-livefeed/refresh'); showToast('已触发刷新'); },
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
              '本次 ' + stats.scanned + '→' + stats.selected + '→' + stats.filtered) : null,
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
          // 摘要弹窗（未读/已读卡片点击后展示）
          detail ? h('div', { className: 'lf-modal', onClick: () => setDetail(null) },
            h('div', { className: 'lf-modal-card', onClick: (e) => e.stopPropagation() },
              h('div', { className: 'lf-modal-head' },
                h('div', { className: 'lf-modal-title' }, detail.title),
                h('button', { className: 'lf-iconbtn', title: '关闭', onClick: () => setDetail(null) },
                  iconSvg('M18 6 6 18' + 'M6 6l12 12', 14)),
              ),
              h('div', { className: 'lf-modal-meta' },
                detail.sourceName ? h('span', { className: 'lf-source-tag' }, detail.sourceName) : null,
                h('span', null, fmtTime(detail.createdAt) || detail.publishedAt || ''),
              ),
              h('div', { className: 'lf-modal-summary' }, detail.summary || '（暂无摘要内容）'),
              detail.relatedUrls && detail.relatedUrls.length
                ? h('div', { className: 'lf-modal-related' },
                    h('div', { className: 'lf-modal-related-title' }, '相关来源（同一事件的其他报道）'),
                    detail.relatedUrls.map((r, i) =>
                      h('a', { key: i, className: 'lf-modal-related-link', href: r.url, target: '_blank', rel: 'noreferrer' }, (r.sourceName || r.url) + ' ↗')),
                  )
                : null,
              h('div', { className: 'lf-modal-actions' },
                h('a', { className: 'lf-primarybtn', href: detail.url, target: '_blank', rel: 'noreferrer' }, '跳转原文 ↗'),
              ),
            ),
          ) : null,
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

    /* ── 设置视图 ── */
    function SettingsView(props) {
      const [cfg, setCfg] = React.useState(null);
      const [catalog, setCatalog] = React.useState(null);
      const [rules, setRules] = React.useState(null);
      const [useDefault, setUseDefault] = React.useState(true);
      const [provider, setProvider] = React.useState('');
      const [model, setModel] = React.useState('');
      const [effort, setEffort] = React.useState('');
      const [intervalMin, setIntervalMin] = React.useState(60);
      const [archiveMax, setArchiveMax] = React.useState(5000);
      const [maxCoarse, setMaxCoarse] = React.useState(15);
      const [maxFine, setMaxFine] = React.useState(5);
      const [srcMax, setSrcMax] = React.useState({}); // { [sourceId]: { coarse, fine } }，null 表示跟随全局
      const [threshOpen, setThreshOpen] = React.useState(false);
      const [toggles, setToggles] = React.useState({});
      const [interests, setInterests] = React.useState([]);
      const [blockWords, setBlockWords] = React.useState([]);
      const [interestInput, setInterestInput] = React.useState('');
      const [blockInput, setBlockInput] = React.useState('');
      const [wordDirty, setWordDirty] = React.useState(false);
      const [loadError, setLoadError] = React.useState(null);
      const [catalogMsg, setCatalogMsg] = React.useState('加载中…');
      const [reloadTick, setReloadTick] = React.useState(0);

      React.useEffect(() => {
        (async () => {
          try {
            const c = await rpc('config');
            if (c && c.config) {
              setCfg(c.config);
              setIntervalMin(c.config.intervalMinutes || 60);
              setArchiveMax(c.config.archiveMaxEntries || 5000);
              setMaxCoarse(c.config.maxCoarseItems || 15);
              setMaxFine(c.config.maxCandidatesPerSource || 5);
              setUseDefault(!c.config.model);
              if (c.config.model) { setProvider(c.config.model.provider || ''); setModel(c.config.model.model || ''); setEffort(c.config.model.reasoningEffort || ''); }
              setInterests(c.config.interests || []);
              setBlockWords(c.config.blockWords || []);
              const t = {};
              const m = {};
              (c.config.sources || []).forEach((s) => { t[s.id] = !!s.enabled; m[s.id] = { coarse: typeof s.maxItems === 'number' ? s.maxItems : null, fine: typeof s.maxCandidates === 'number' ? s.maxCandidates : null }; });
              setToggles(t);
              setSrcMax(m);
            }
          } catch (e) { setLoadError('配置加载失败：' + String((e && e.message) || e)); }
          setCatalogMsg('加载中…');
          try {
            const cat = await rpc('model-catalog');
            if (cat && Array.isArray(cat.providers)) {
              setCatalog(cat.providers);
              setCatalogMsg(cat.providers.length + ' 个提供商可用');
            } else {
              setCatalogMsg('返回了空目录');
            }
          } catch (e) { setCatalogMsg('加载失败：' + String((e && e.message) || e)); }
          try {
            const r = await rpc('rules');
            if (r && r.rules) setRules(r.rules);
          } catch (_) { /* 规则预览失败不阻塞 */ }
        })();
      }, [reloadTick]);

      const sources = (cfg && cfg.sources) || [];
      // catalog 存的是数组（setCatalog(cat.providers)）
      const providers = Array.isArray(catalog) ? catalog : ((catalog && catalog.providers) || []);
      const models = providers.find((p) => p.id === provider) || { models: [] };
      const currentModel = models.models.find((m) => m.id === model) || null;
      // 思考等级跟随所选模型的能力（efforts），无元数据时回退固定列表
      const effortOptions = (currentModel && Array.isArray(currentModel.efforts) && currentModel.efforts.length)
        ? currentModel.efforts
        : FALLBACK_EFFORTS;

      async function saveAll() {
        const payload = {
          intervalMinutes: intervalMin,
          archiveMaxEntries: archiveMax,
          maxCoarseItems: maxCoarse,
          maxCandidatesPerSource: maxFine,
          model: useDefault ? null : { provider, model, reasoningEffort: effort || undefined },
          interests,
          blockWords,
          sources: sources.map((s) => ({
            id: s.id,
            enabled: toggles[s.id] !== undefined ? toggles[s.id] : !!s.enabled,
            maxItems: (srcMax[s.id] && srcMax[s.id].coarse) || null,
            maxCandidates: (srcMax[s.id] && srcMax[s.id].fine) || null,
          })),
        };
        await rpc('update-settings', payload);
        if (wordDirty) await rpc('update-words', { interests, blockWords });
        props.showToast('设置已保存 ✓ · 下一刷新周期生效');
        props.refresh();
        props.onBack();
      }
      function addChip(list, setList, input, setInput, kind) {
        const v = input.trim();
        if (v && list.indexOf(v) < 0) { setList(list.concat([v])); setWordDirty(true); }
        setInput('');
      }
      function removeChip(list, setList, i) {
        const next = list.slice(); next.splice(i, 1); setList(next); setWordDirty(true);
      }

      return h('div', { className: 'lf-settings' },
        h('div', { className: 'lf-scroll' },
          // 模型选择
          h('div', { className: 'lf-sec' },
            h('div', { className: 'lf-sec-title' }, '模型选择'),
            loadError ? h('div', { className: 'lf-rules-box', style: { color: 'var(--dsw-alias-state-error-primary)' } }, loadError) : null,
            h('div', { className: 'lf-rules-meta', style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: catalogMsg.indexOf('失败') >= 0 || catalogMsg === '返回了空目录' ? 'var(--dsw-alias-state-error-primary)' : undefined } },
              h('span', null, '模型目录：' + catalogMsg),
              h('button', { className: 'lf-unblock', onClick: () => setReloadTick(reloadTick + 1) }, '重新加载'),
            ),
            h('label', { className: 'lf-field' }, h('span', null, '提供商'), h('select', {
              value: provider, disabled: useDefault,
              onChange: (e) => { setProvider(e.target.value); setModel(''); setEffort(''); },
            },
              h('option', { value: '' }, useDefault ? '（跟随默认模型）' : '选择提供商'),
              providers.map((p) => h('option', { key: p.id, value: p.id }, p.name || p.id)))),
            h('label', { className: 'lf-field' }, h('span', null, '模型'), h('select', {
              value: model, disabled: useDefault,
              onChange: (e) => { setModel(e.target.value); setEffort(''); },
            },
              h('option', { value: '' }, useDefault ? '（跟随默认模型）' : '选择模型'),
              models.models.map((m) => h('option', { key: m.id, value: m.id }, m.name || m.id)))),
            h('label', { className: 'lf-field' }, h('span', null, '思考等级（reasoning effort）'), h('select', {
              value: effort, disabled: useDefault || !provider || !model,
              onChange: (e) => setEffort(e.target.value),
            },
              h('option', { value: '' }, '跟随默认'),
              effortOptions.map((x) => h('option', { key: x.id, value: x.id }, x.name)))),
            h('label', { className: 'lf-check' },
              h('input', { type: 'checkbox', checked: useDefault, onChange: (e) => setUseDefault(e.target.checked) }),
              h('span', null, '跟随当前默认模型'),
              h('span', { className: 'hint' }, '（不填时用会话默认模型+等级）'),
            ),
          ),
          // 刷新间隔
          h('div', { className: 'lf-sec' },
            h('div', { className: 'lf-sec-title' }, '刷新间隔'),
            h('label', { className: 'lf-field' }, h('span', null, '间隔时间（分钟）'), h('input', {
              type: 'number', min: 1, max: 1440, value: intervalMin,
              onChange: (e) => setIntervalMin(Number(e.target.value) || 10),
            })),
          ),
          // 搜索源管理（阈值设置收进 ⚙ 弹卡）
          h('div', { className: 'lf-sec' },
            h('div', { className: 'lf-sec-title-row' },
              h('div', { className: 'lf-sec-title' }, '搜索源管理'),
              h('button', { className: 'lf-gearbtn', title: '阈值设置（粗搜/精搜上限）', onClick: () => setThreshOpen(true) }, '⚙'),
            ),
            sources.length ? sources.map((s) => h('div', { key: s.id, className: 'lf-source-row' + (toggles[s.id] === false ? ' lf-disabled' : '') },
              h('div', { className: 'lf-source-info' },
                h('div', { className: 'lf-source-name' }, s.name || s.id),
                h('div', { className: 'lf-source-id' }, s.id + ' · 查询：' + (s.query || '全量抓取（无关键词）')),
              ),
              h('label', { className: 'lf-switch' },
                h('input', { type: 'checkbox', checked: toggles[s.id] !== false, onChange: (e) => setToggles(Object.assign({}, toggles, { [s.id]: e.target.checked })) }),
                h('span', { className: 'lf-switch-track' }),
              ),
            )) : h('p', { className: 'lf-rules-meta' }, '暂无搜索源，可手动编辑 config.json 添加'),
          ),
          // 智能过滤
          h('div', { className: 'lf-sec' },
            h('div', { className: 'lf-sec-title' }, '智能过滤（AI 学习）'),
            h('div', { className: 'lf-rules-box' },
              h('div', null, '屏蔽：' + ((rules && rules.block || []).join(' · ') || '暂无')),
              h('div', { className: 'lf-rules-meta' }, '最近学习：' + (rules && rules.updatedAt ? new Date(rules.updatedAt).toLocaleString() : '—') + ' · 仅记录「不感兴趣」标记，正向偏好由兴趣词表达，避免信息茧房'),
            ),
            h('div', { style: { display: 'flex', gap: 8, marginTop: 10 } },
              h('button', { className: 'lf-ghostbtn', onClick: async () => { await rpc('rerun-rules'); props.showToast('规则重训已触发'); } }, '立即重新学习'),
            ),
          ),
          // 兴趣词
          h('div', { className: 'lf-sec' },
            h('div', { className: 'lf-sec-title' }, '兴趣词（正向偏好，写入 config.json）'),
            h('div', { className: 'lf-chips' },
              interests.map((w, i) => h('span', { key: w, className: 'lf-chip' }, w, h('button', { onClick: () => removeChip(interests, setInterests, i) }, '×'))),
            ),
            h('div', { className: 'lf-chip-add' },
              h('input', { value: interestInput, placeholder: '添加兴趣词，回车确认', onChange: (e) => setInterestInput(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') addChip(interests, setInterests, interestInput, setInterestInput); } }),
              h('button', { className: 'lf-ghostbtn', style: { margin: 0, height: 26 }, onClick: () => addChip(interests, setInterests, interestInput, setInterestInput) }, '添加'),
            ),
          ),
          // 屏蔽词
          h('div', { className: 'lf-sec' },
            h('div', { className: 'lf-sec-title' }, '屏蔽词（用户层，与 AI 学习合并生效）'),
            h('div', { className: 'lf-chips' },
              blockWords.map((w, i) => h('span', { key: w, className: 'lf-chip' }, w, h('button', { onClick: () => removeChip(blockWords, setBlockWords, i) }, '×'))),
            ),
            h('div', { className: 'lf-chip-add' },
              h('input', { value: blockInput, placeholder: '添加屏蔽词，回车确认', onChange: (e) => setBlockInput(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') addChip(blockWords, setBlockWords, blockInput, setBlockInput); } }),
              h('button', { className: 'lf-ghostbtn', style: { margin: 0, height: 26 }, onClick: () => addChip(blockWords, setBlockWords, blockInput, setBlockInput) }, '添加'),
            ),
          ),
          // 被屏蔽内容已迁至面板「屏蔽」标签页（紧凑标题 + 撤销）
          // 数据归档
          h('div', { className: 'lf-sec' },
            h('div', { className: 'lf-sec-title' }, '数据归档'),
            h('label', { className: 'lf-field' }, h('span', null, '归档上限（条，超出滚动清理）'), h('input', {
              type: 'number', min: 100, max: 100000, value: archiveMax,
              onChange: (e) => setArchiveMax(Number(e.target.value) || 5000),
            })),
          ),
          h('div', { className: 'lf-save-row' },
            h('button', { className: 'lf-primarybtn', onClick: saveAll }, '保存'),
            h('button', { className: 'lf-ghostbtn', onClick: () => {
              setUseDefault(true); setIntervalMin(60); setArchiveMax(5000); setMaxCoarse(15); setMaxFine(5); setSrcMax({});
              const t = {}; sources.forEach((s) => { t[s.id] = true; });
              setToggles(t);
            } }, '恢复默认'),
          ),
          h('p', { className: 'lf-settings-note' }, '保存后写入 config.json，下一个刷新周期生效；关闭的搜索源将跳过采集。'),
        ),
        // 阈值设置弹卡（⚙ 按钮打开）
        threshOpen ? h('div', { className: 'lf-modal', onClick: () => setThreshOpen(false) },
          h('div', { className: 'lf-modal-card', onClick: (e) => e.stopPropagation() },
            h('div', { className: 'lf-modal-head' },
              h('div', { className: 'lf-modal-title' }, '阈值设置'),
              h('button', { className: 'lf-iconbtn', title: '关闭', onClick: () => setThreshOpen(false) },
                iconSvg('M18 6 6 18' + 'M6 6l12 12', 14)),
            ),
            h('div', { className: 'lf-thresh-body' },
              h('div', { className: 'lf-thresh-global' },
                h('label', { className: 'lf-thresh-item' }, h('span', null, '粗搜默认上限'), h('input', { type: 'number', min: 1, max: 100, value: maxCoarse, onChange: (e) => setMaxCoarse(Number(e.target.value) || 15) })),
                h('label', { className: 'lf-thresh-item' }, h('span', null, '精搜默认上限'), h('input', { type: 'number', min: 1, max: 20, value: maxFine, onChange: (e) => setMaxFine(Number(e.target.value) || 5) })),
              ),
              h('p', { className: 'lf-thresh-note' }, '默认值应用于未单独设置的源；源级数值覆盖全局，留空 = 跟随全局。修改后请在主设置界面点「保存」生效。'),
              sources.length ? sources.map((s) => h('div', { key: s.id, className: 'lf-thresh-src' },
                h('div', { className: 'lf-thresh-src-name' }, s.name || s.id),
                h('label', { className: 'lf-thresh-item' }, h('span', null, '粗搜'), h('input', {
                  type: 'number', min: 1, max: 100,
                  placeholder: String(maxCoarse),
                  value: (srcMax[s.id] && srcMax[s.id].coarse) || '',
                  onChange: (e) => { const v = e.target.value; const n = v === '' ? null : (Number(v) || null); setSrcMax(Object.assign({}, srcMax, { [s.id]: Object.assign({}, srcMax[s.id] || {}, { coarse: n }) })); },
                })),
                h('label', { className: 'lf-thresh-item' }, h('span', null, '精搜'), h('input', {
                  type: 'number', min: 1, max: 20,
                  placeholder: String(maxFine),
                  value: (srcMax[s.id] && srcMax[s.id].fine) || '',
                  onChange: (e) => { const v = e.target.value; const n = v === '' ? null : (Number(v) || null); setSrcMax(Object.assign({}, srcMax, { [s.id]: Object.assign({}, srcMax[s.id] || {}, { fine: n }) })); },
                })),
              )) : h('p', { className: 'lf-thresh-note' }, '暂无搜索源'),
            ),
            h('div', { className: 'lf-modal-actions' },
              h('button', { className: 'lf-ghostbtn', style: { margin: 0 }, onClick: () => setThreshOpen(false) }, '关闭'),
            ),
          ),
        ) : null,
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
