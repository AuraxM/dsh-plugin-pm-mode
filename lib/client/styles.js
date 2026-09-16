/**
 * PM Mode — client half styles.
 *
 * Colors go through the product's own CSS variables so the panel follows the
 * light/dark theme instead of pinning one palette. Hex fallbacks match the
 * values the other panels of this deployment already fall back to.
 *
 * @module dsh-pm-mode/client/styles
 */
var CSS =
  /* shared chrome */
  ".pmb-btn{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,#3a3f47);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,#9aa0a6);font-size:12px;line-height:1;cursor:pointer;flex:none;white-space:nowrap}" +
  ".pmb-btn:hover{border-color:var(--dsw-alias-border-l2,#565d68);color:var(--dsw-alias-label-primary,#e6e8eb)}" +
  ".pmb-btn.on{border-color:#4d6bfe;color:var(--dsw-alias-label-primary,#e6e8eb);background:rgba(77,107,254,.12)}" +
  ".pmb-btn.primary{background:#4d6bfe;border-color:#4d6bfe;color:#fff}" +
  ".pmb-btn:disabled{opacity:.5;cursor:default}" +
  ".pmb-spacer{flex:1}" +
  ".pmb-panel{position:fixed;top:0;right:0;bottom:0;width:min(1180px,96vw);max-width:100vw;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1,#1c1f26);border-left:1px solid var(--dsw-alias-border-l1,#3a3f47);box-shadow:var(--dsw-shadow-lv3,0 8px 40px rgba(0,0,0,.5));pointer-events:auto;z-index:1200}" +
  ".pmb-panel.wide{width:100vw;border-left:none}" +
  ".pmb-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,#3a3f47);flex:none}" +
  ".pmb-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#e6e8eb)}" +
  ".pmb-sub{font-size:12px;color:var(--dsw-alias-label-tertiary,#8b929e)}" +
  ".pmb-tabs{display:flex;gap:6px;align-items:center;padding:8px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,#3a3f47);flex:none;overflow-x:auto}" +
  ".pmb-body{flex:1;min-height:0;overflow:auto;padding:12px 14px 24px}" +
  ".pmb-err{color:var(--dsw-alias-state-error-primary,#e5534b);font-size:12px;padding:4px 14px}" +
  ".pmb-none{font-size:12px;color:var(--dsw-alias-label-tertiary,#8b929e);padding:16px 2px;text-align:center}" +

  /* stat strip */
  ".pmb-stats{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}" +
  ".pmb-stat{border:1px solid var(--dsw-alias-border-l1,#3a3f47);border-radius:10px;background:var(--dsw-alias-bg-layer-2,#262a33);padding:8px 12px;min-width:96px;display:flex;flex-direction:column;gap:2px}" +
  ".pmb-stat .k{font-size:11px;color:var(--dsw-alias-label-tertiary,#8b929e)}" +
  ".pmb-stat .v{font-size:18px;font-weight:600;color:var(--dsw-alias-label-primary,#e6e8eb);font-variant-numeric:tabular-nums}" +
  ".pmb-stat .u{font-size:11px;color:var(--dsw-alias-label-tertiary,#8b929e)}" +

  /* gantt */
  ".pmb-gantt{border:1px solid var(--dsw-alias-border-l1,#3a3f47);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,#262a33)}" +
  ".pmb-axis{display:flex;height:26px;border-bottom:1px solid var(--dsw-alias-border-l1,#3a3f47);background:var(--dsw-alias-bg-layer-1,#1c1f26)}" +
  ".pmb-axis .lbl{width:230px;flex:none;padding:0 10px;display:flex;align-items:center;font-size:11px;color:var(--dsw-alias-label-tertiary,#8b929e);border-right:1px solid var(--dsw-alias-border-l1,#3a3f47)}" +
  ".pmb-axis .ticks{flex:1;position:relative}" +
  ".pmb-axis .tick{position:absolute;top:0;bottom:0;border-left:1px solid var(--dsw-alias-border-l1,#3a3f47);font-size:10px;color:var(--dsw-alias-label-tertiary,#8b929e);padding-left:4px;line-height:26px;white-space:nowrap}" +
  ".pmb-lane{display:flex;border-bottom:1px solid var(--dsw-alias-border-l1,#3a3f47)}" +
  ".pmb-lane:last-child{border-bottom:none}" +
  ".pmb-lane-lbl{width:230px;flex:none;padding:7px 10px;border-right:1px solid var(--dsw-alias-border-l1,#3a3f47);display:flex;flex-direction:column;gap:3px;min-width:0}" +
  ".pmb-lane-t{font-size:12.5px;color:var(--dsw-alias-label-primary,#e6e8eb);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
  ".pmb-lane-m{display:flex;gap:5px;align-items:center;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8b929e);flex-wrap:wrap}" +
  ".pmb-lane-track{flex:1;position:relative;min-height:34px}" +
  ".pmb-grid{position:absolute;top:0;bottom:0;border-left:1px solid var(--dsw-alias-border-l1,#3a3f47);opacity:.45}" +
  ".pmb-row{position:relative;height:22px;margin:6px 0}" +
  ".pmb-bar{position:absolute;top:0;height:22px;border-radius:4px;display:flex;overflow:hidden;min-width:2px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.25)}" +
  ".pmb-bar.ghost{opacity:.42;box-shadow:none}" +
  ".pmb-seg{height:100%}" +
  ".pmb-seg:hover{outline:1px solid var(--dsw-alias-label-primary,#e6e8eb);outline-offset:-1px}" +
  ".pmb-area{position:absolute;top:0;height:22px;border-radius:4px;opacity:.3;min-width:2px}" +
  ".pmb-now{position:absolute;top:0;bottom:0;width:2px;background:var(--dsw-alias-state-error-primary,#e5534b);z-index:3;pointer-events:none}" +
  ".pmb-rlabel{position:absolute;left:6px;top:3px;font-size:10px;color:rgba(255,255,255,.92);text-shadow:0 1px 2px rgba(0,0,0,.6);pointer-events:none;white-space:nowrap;overflow:hidden;max-width:100%}" +

  /* tasks */
  ".pmb-task{border:1px solid var(--dsw-alias-border-l1,#3a3f47);border-left-width:3px;border-radius:9px;background:var(--dsw-alias-bg-layer-2,#262a33);padding:9px 12px;margin-bottom:8px;display:flex;flex-direction:column;gap:6px}" +
  ".pmb-task-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}" +
  ".pmb-task-t{font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary,#e6e8eb)}" +
  ".pmb-task-id{font-size:11px;font-family:ui-monospace,Consolas,monospace;color:var(--dsw-alias-label-tertiary,#8b929e)}" +
  ".pmb-task-body{font-size:12px;color:var(--dsw-alias-label-secondary,#9aa0a6);line-height:1.55;word-break:break-word}" +
  ".pmb-chip{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:11px;border:1px solid var(--dsw-alias-border-l1,#3a3f47);color:var(--dsw-alias-label-secondary,#9aa0a6);white-space:nowrap}" +
  ".pmb-chip.solid{color:#fff;border-color:transparent}" +
  ".pmb-phases{display:flex;gap:4px;flex-wrap:wrap;align-items:center}" +
  ".pmb-phase{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:5px;font-size:11px;border:1px solid var(--dsw-alias-border-l1,#3a3f47);color:var(--dsw-alias-label-tertiary,#8b929e)}" +
  ".pmb-phase .d{font-variant-numeric:tabular-nums;opacity:.85}" +
  ".pmb-bar-mini{display:inline-block;height:6px;border-radius:3px;background:var(--dsw-alias-border-l2,#565d68);overflow:hidden;width:70px;vertical-align:middle}" +
  ".pmb-bar-mini > i{display:block;height:100%;background:#4d6bfe}" +

  /* resources + metrics */
  ".pmb-res{border:1px solid var(--dsw-alias-border-l1,#3a3f47);border-radius:9px;background:var(--dsw-alias-bg-layer-2,#262a33);padding:10px 12px;margin-bottom:8px;display:flex;flex-direction:column;gap:6px}" +
  ".pmb-res-top{display:flex;align-items:center;gap:8px}" +
  ".pmb-res-n{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#e6e8eb)}" +
  ".pmb-legend{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px;font-size:11px;color:var(--dsw-alias-label-tertiary,#8b929e);align-items:center}" +
  ".pmb-key{display:inline-flex;align-items:center;gap:5px}" +
  ".pmb-key i{width:10px;height:10px;border-radius:3px;display:inline-block}" +
  ".pmb-table{width:100%;border-collapse:collapse;font-size:12px}" +
  ".pmb-table th,.pmb-table td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,#3a3f47);color:var(--dsw-alias-label-secondary,#9aa0a6)}" +
  ".pmb-table th{color:var(--dsw-alias-label-tertiary,#8b929e);font-weight:500;font-size:11px}" +
  ".pmb-table td.num{text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,#e6e8eb)}" +
  ".pmb-spark{display:flex;align-items:flex-end;gap:2px;height:52px;margin:6px 0 14px}" +
  ".pmb-spark i{flex:1;background:#4d6bfe;border-radius:2px 2px 0 0;min-height:2px;opacity:.85}" +
  ".pmb-h{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#9aa0a6);margin:14px 0 6px}" +
  ".pmb-h:first-child{margin-top:0}" +

  /* tool card */
  ".pmb-card{border:1px solid var(--dsw-alias-border-l1,#3a3f47);border-left:3px solid #4d6bfe;border-radius:10px;background:var(--dsw-alias-bg-layer-1,#1c1f26);padding:10px 14px;margin:6px 0;display:flex;flex-direction:column;gap:6px;max-width:680px}" +
  ".pmb-card-t{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#e6e8eb)}" +
  ".pmb-pre{white-space:pre-wrap;font-size:12.5px;color:var(--dsw-alias-label-secondary,#9aa0a6);margin:0;font-family:inherit}";

export { CSS };
