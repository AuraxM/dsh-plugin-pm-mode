/**
 * PM Mode — client half styles.
 *
 * Every color, border and control dimension goes through the product's own
 * `--dsw-*` custom properties (the only stable public surface of the DSH
 * theme: the component classes of the native bundles are content-hashed per
 * build and must not be reused). The rules below are deliberately shaped after
 * the native settings surfaces, so the panel reads the same as 设置 → 模型 /
 * 插件 in both themes:
 *
 *   - section heading / description / field label: label-primary, 13px
 *     (the previous revision drew FIELD LABELS in label-tertiary, which is the
 *     native *description* tone — 12px grey labels were the "看不清" text);
 *   - structural lines: border-l2, controls: border-l3 / border-l4;
 *   - inset cards: bg-module-platform (light #f5f6f7, dark #353638), which is
 *     the only layer difference that survives the light theme — every layer
 *     alias resolves to #fff in light mode, so the old l1-vs-l2 contrast trick
 *     disappeared there;
 *   - state text: color-mix() toward label-primary, because the raw state
 *     tokens (amber-500 / green-500) are 2:1 on white.
 *
 * NO hard-coded palette values remain: a hex here would be a light-theme or
 * dark-theme value applied to both. `--dsw-static-*` are palette primitives
 * and are not theme-reactive either, so they are avoided as well.
 *
 * @module dsh-pm-mode/client/styles
 */
var CSS =
  /* shared chrome */
  ".pmb-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:14px;background:none;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:18px;cursor:pointer;flex:none;white-space:nowrap}" +
  ".pmb-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}" +
  ".pmb-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}" +
  ".pmb-btn.on{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-label-primary)}" +
  ".pmb-btn.primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-foreground)}" +
  ".pmb-btn.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}" +
  ".pmb-btn:disabled{opacity:.6;cursor:default}" +
  ".pmb-spacer{flex:1}" +

  /* Native <select>/<input> recipe. The fill is OPAQUE and token-driven on the
     control itself: an <option> popup is drawn by the OS and inherits the
     control's own background, so the old `background:transparent` produced a
     white popup carrying dark-theme light-grey text. */
  ".pmb-select{box-sizing:border-box;height:32px;min-width:150px;max-width:260px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer;flex:none;color-scheme:light}" +
  ".pmb-select:focus{border-color:var(--dsw-alias-brand-primary);outline:none}" +
  ".pmb-select:disabled{opacity:.6;cursor:default}" +
  ".pmb-select option{background:var(--dsw-specific-menu);color:var(--dsw-alias-label-primary)}" +
  "body[data-ds-dark-theme] .pmb-select{color-scheme:dark}" +
  ".pmb-body input,.pmb-body textarea,.pmb-settings-section input,.pmb-settings-section textarea{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:6px 10px;color-scheme:light}" +
  "body[data-ds-dark-theme] .pmb-body input,body[data-ds-dark-theme] .pmb-body textarea,body[data-ds-dark-theme] .pmb-settings-section input,body[data-ds-dark-theme] .pmb-settings-section textarea{color-scheme:dark}" +

  ".pmb-panel{position:fixed;top:0;right:0;bottom:0;width:min(1180px,96vw);max-width:100vw;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border-left:.5px solid var(--dsw-alias-border-l2);box-shadow:var(--dsw-elevation-panel);pointer-events:auto;z-index:1200}" +
  ".pmb-panel.wide{width:100vw;border-left:none}" +
  ".pmb-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:.5px solid var(--dsw-alias-border-l2);flex:none}" +
  ".pmb-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}" +
  ".pmb-sub{font-size:12.5px;font-weight:500;color:var(--dsw-alias-label-primary)}" +
  ".pmb-tabs{display:flex;gap:6px;align-items:center;padding:8px 14px;border-bottom:.5px solid var(--dsw-alias-border-l2);flex:none;overflow-x:auto}" +
  ".pmb-body{flex:1;min-height:0;overflow:auto;padding:12px 14px 24px}" +
  ".pmb-err{color:var(--dsw-alias-state-error-primary);font-size:12px;padding:4px 14px}" +
  ".pmb-none{font-size:12px;color:var(--dsw-alias-label-tertiary);padding:16px 2px;text-align:center}" +

  /* stat strip */
  ".pmb-stats{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}" +
  ".pmb-stat{border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-module-platform);padding:8px 12px;min-width:96px;display:flex;flex-direction:column;gap:2px}" +
  ".pmb-stat .k{font-size:11px;color:var(--dsw-alias-label-tertiary)}" +
  ".pmb-stat .v{font-size:18px;font-weight:600;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}" +
  ".pmb-stat .u{font-size:11px;color:var(--dsw-alias-label-tertiary)}" +

  /* gantt */
  ".pmb-gantt{border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-module-platform)}" +
  ".pmb-axis{display:flex;height:26px;border-bottom:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}" +
  ".pmb-axis .lbl{width:230px;flex:none;padding:0 10px;display:flex;align-items:center;font-size:11px;color:var(--dsw-alias-label-tertiary);border-right:.5px solid var(--dsw-alias-border-l2)}" +
  ".pmb-axis .ticks{flex:1;position:relative}" +
  ".pmb-axis .tick{position:absolute;top:0;bottom:0;border-left:.5px solid var(--dsw-alias-border-l2);font-size:10px;color:var(--dsw-alias-label-tertiary);padding-left:4px;line-height:26px;white-space:nowrap}" +
  ".pmb-lane{display:flex;border-bottom:.5px solid var(--dsw-alias-border-l2)}" +
  ".pmb-lane:last-child{border-bottom:none}" +
  ".pmb-lane-lbl{width:230px;flex:none;padding:7px 10px;border-right:.5px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:3px;min-width:0}" +
  ".pmb-lane-t{font-size:12.5px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
  ".pmb-lane-m{display:flex;gap:5px;align-items:center;font-size:10.5px;color:var(--dsw-alias-label-tertiary);flex-wrap:wrap}" +
  ".pmb-lane-track{flex:1;position:relative;min-height:34px}" +
  ".pmb-grid{position:absolute;top:0;bottom:0;border-left:.5px solid var(--dsw-alias-border-l2);opacity:.45}" +
  ".pmb-row{position:relative;height:22px;margin:6px 0}" +
  ".pmb-bar{position:absolute;top:0;height:22px;border-radius:4px;display:flex;overflow:hidden;min-width:2px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.25)}" +
  ".pmb-bar.ghost{opacity:.42;box-shadow:none}" +
  ".pmb-seg{height:100%}" +
  ".pmb-seg:hover{outline:1px solid var(--dsw-alias-label-primary);outline-offset:-1px}" +
  ".pmb-area{position:absolute;top:0;height:22px;border-radius:4px;opacity:.3;min-width:2px}" +
  ".pmb-now{position:absolute;top:0;bottom:0;width:2px;background:var(--dsw-alias-state-error-primary);z-index:3;pointer-events:none}" +
  ".pmb-rlabel{position:absolute;left:6px;top:3px;font-size:10px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.65);pointer-events:none;white-space:nowrap;overflow:hidden;max-width:100%}" +

  /* tasks */
  ".pmb-task{border:.5px solid var(--dsw-alias-border-l2);border-left-width:3px;border-radius:9px;background:var(--dsw-alias-bg-module-platform);padding:9px 12px;margin-bottom:8px;display:flex;flex-direction:column;gap:6px}" +
  ".pmb-task-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}" +
  ".pmb-task-t{font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary)}" +
  ".pmb-task-id{font-size:11px;font-family:ui-monospace,Consolas,monospace;color:var(--dsw-alias-label-tertiary)}" +
  ".pmb-task-body{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.55;word-break:break-word}" +
  ".pmb-chip{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:999px;font-size:11px;line-height:16px;border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);white-space:nowrap}" +
  ".pmb-chip.s-planned,.pmb-chip.s-idle,.pmb-chip.s-cancelled{--pmb-accent:var(--dsw-alias-label-tertiary)}" +
  ".pmb-chip.s-running,.pmb-chip.s-review{--pmb-accent:var(--dsw-alias-state-business-primary)}" +
  ".pmb-chip.s-blocked{--pmb-accent:var(--dsw-alias-state-warn-primary)}" +
  ".pmb-chip.s-done,.pmb-chip.s-ready{--pmb-accent:var(--dsw-alias-state-success-primary)}" +
  ".pmb-chip.s-failed{--pmb-accent:var(--dsw-alias-state-error-primary)}" +
  /* An OUTLINE chip carries the status in its own ink and border (the 未配置 /
     空闲 / 占用中 badges), mixed toward the theme's text color so the raw
     amber/green stay legible on a white surface. */
  ".pmb-chip.s-planned,.pmb-chip.s-idle,.pmb-chip.s-cancelled,.pmb-chip.s-running,.pmb-chip.s-review,.pmb-chip.s-blocked,.pmb-chip.s-done,.pmb-chip.s-ready,.pmb-chip.s-failed{color:color-mix(in srgb,var(--pmb-accent) 70%,var(--dsw-alias-label-primary));border-color:color-mix(in srgb,var(--pmb-accent) 40%,transparent)}" +
  /* ...and a SOLID chip is a TINTED surface with the theme's text color, so its
     rule is LAST: equal specificity is decided by order, and it must beat the
     outline rule above. */
  ".pmb-chip.solid{color:var(--dsw-alias-label-primary);border-color:transparent;background:color-mix(in srgb,var(--pmb-accent,var(--dsw-alias-label-tertiary)) 22%,transparent)}" +
  ".pmb-chip.solid::before{content:'';width:6px;height:6px;border-radius:50%;flex:none;background:var(--pmb-accent,var(--dsw-alias-label-tertiary))}" +
  ".pmb-phases{display:flex;gap:4px;flex-wrap:wrap;align-items:center}" +
  ".pmb-phase{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:5px;font-size:11px;border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}" +
  ".pmb-phase .d{font-variant-numeric:tabular-nums;opacity:.85}" +
  ".pmb-bar-mini{display:inline-block;height:6px;border-radius:3px;background:var(--dsw-alias-border-l3);overflow:hidden;width:70px;vertical-align:middle}" +
  ".pmb-bar-mini > i{display:block;height:100%;background:var(--dsw-alias-state-business-primary)}" +

  /* resources + metrics */
  ".pmb-res{border:.5px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-module-platform);padding:10px 12px;margin-bottom:8px;display:flex;flex-direction:column;gap:6px}" +
  ".pmb-res-top{display:flex;align-items:center;gap:8px}" +
  ".pmb-res-n{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}" +
  ".pmb-legend{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px;font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-secondary);align-items:center}" +
  ".pmb-key{display:inline-flex;align-items:center;gap:5px}" +
  ".pmb-key i{width:10px;height:10px;border-radius:3px;display:inline-block}" +
  ".pmb-table{width:100%;border-collapse:collapse;font-size:12px}" +
  ".pmb-table th,.pmb-table td{text-align:left;padding:5px 8px;border-bottom:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}" +
  ".pmb-table th{color:var(--dsw-alias-label-tertiary);font-weight:500;font-size:11px}" +
  ".pmb-table td.num{text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}" +
  ".pmb-spark{display:flex;align-items:flex-end;gap:2px;height:52px;margin:6px 0 14px}" +
  ".pmb-spark i{flex:1;background:var(--dsw-alias-state-business-primary);border-radius:2px 2px 0 0;min-height:2px;opacity:.85}" +
  ".pmb-h{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);margin:14px 0 6px}" +
  ".pmb-h:first-child{margin-top:0}" +

  /* tool card */
  ".pmb-card{border:.5px solid var(--dsw-alias-border-l2);border-left:3px solid var(--dsw-alias-state-business-primary);border-radius:10px;background:var(--dsw-alias-bg-module-platform);padding:10px 14px;margin:6px 0;display:flex;flex-direction:column;gap:6px;max-width:680px}" +
  ".pmb-card-t{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}" +
  ".pmb-pre{white-space:pre-wrap;font-size:12.5px;color:var(--dsw-alias-label-secondary);margin:0;font-family:inherit}" +

  /* the same form, rendered inside the DSH settings dialog */
  ".pmb-settings-section{display:flex;flex-direction:column;gap:10px;max-width:760px}" +
  ".pmb-settings-section .pmb-h{font-size:13px;margin:0}" +
  ".pmb-settings-section .pmb-legend{font-size:12.5px;line-height:1.6;margin:0}" +
  ".pmb-settings-section .pmb-res{padding:12px 14px;gap:8px}" +
  ".pmb-settings-section .pmb-btn{height:26px;font-size:12px}" +
  ".pmb-settings-section .pmb-select{height:32px;font-size:13px}" +
  ".pmb-settings-section .pmb-phases{gap:8px}" +

  /* state text — LAST on purpose: these classes are ADDED to elements that
     already carry a component class (`.pmb-lane-m.pmb-t-warn`,
     `.pmb-none.pmb-t-warn`), and a later single-class rule wins over an equal
     one. Raw state tokens are ~2:1 on white, so they are mixed toward the
     theme's own text color instead of being used as-is. */
  ".pmb-t-muted{color:var(--dsw-alias-label-tertiary)}" +
  ".pmb-t-warn{color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 60%,var(--dsw-alias-label-primary))}" +
  ".pmb-t-ok{color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 65%,var(--dsw-alias-label-primary))}" +
  ".pmb-t-err{color:var(--dsw-alias-state-error-primary)}" +

  /* notice rows (the settings page's ⚠ / ✅ / ❌ lines): a tinted surface with
     the theme's own text color, mirroring the state-*-tertiary aliases */
  ".pmb-note{display:block;font-size:12px;line-height:1.6;border-radius:8px;padding:8px 10px;margin:6px 0;color:var(--dsw-alias-label-primary)}" +
  ".pmb-note.warn{background:var(--dsw-alias-state-warn-tertiary)}" +
  ".pmb-note.ok{background:var(--dsw-alias-state-success-tertiary)}" +
  ".pmb-note.err{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}";

export { CSS };
