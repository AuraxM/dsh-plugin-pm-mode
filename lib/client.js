/**
 * PM Mode — client half.
 *
 * Surfaces:
 *   - `📋 项目看板` button in the conversation session header utilities;
 *   - a right-hand drawer with four tabs — 甘特图 (24 h timeline), 任务 (kanban
 *     cards), 资源 (exclusive shared-resource leases), 统计 (throughput and
 *     per-phase / per-tool cost);
 *   - a compact card for each `pm_*` tool call, so the conversation shows what
 *     the PM recorded instead of a wall of text.
 *
 * Everything reads the host's same-origin `/pm-mode` route, so there is no
 * RPC and no second port. Polling runs only while the drawer is open.
 *
 * @module dsh-pm-mode/client
 */
/* Inlined from ./client/styles.js — the dsh client bundle is a plain script
 * concatenation, so relative ESM imports cannot resolve here. Edit the module
 * and re-splice; scripts/check-client.mjs fails if the two copies drift. */
/**
 * PM Mode — client half styles.
 *
 * Every color, border and control dimension goes through the product's own
 * `--dsw-*` custom properties, so the panel follows the light/dark theme
 * instead of pinning one palette. See ./client/styles.js for the full notes.
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

/* Inlined from ./client/gantt.js (pad() deduplicated against the one below). */
/**
 * PM Mode — the 24-hour Gantt chart.
 *
 * One lane per task, one row per agent the runtime actually observed working
 * on it. A bar is a measured execution span; the segments inside it are the
 * individual tool calls, so a long bar reads as "what it spent the time on"
 * rather than just "it was busy".
 *
 * Nothing here is synthesized: if the collector saw no span, the lane says so.
 *
 * @module dsh-pm-mode/client/gantt
 */

/**
 * The chart's own data-viz palette. These are FILLS for bars, areas and legend
 * swatches only — text and chips use the theme's own tokens (see the styles
 * above), never these values.
 */
var COLORS = {
  planned: "#6b7280",
  ready: "#3fb950",
  running: "#4d6bfe",
  blocked: "#e3b341",
  review: "#a371f7",
  done: "#3fb950",
  failed: "#e5534b",
  cancelled: "#6b7280",
  idle: "#6b7280",
  tool: "#22307a",
  toolError: "#8c2c26",
};

/** `14:05` — the chart's tick label. */
function clockOf(ms) {
  const date = new Date(ms);
  return pad(date.getHours()) + ":" + pad(date.getMinutes());
}

/** `3h20m` / `12m` / `45s` — a duration a human reads at a glance. */
function humanDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return seconds + "s";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes + "m";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest === 0 ? hours + "h" : hours + "h" + pad(rest) + "m";
  return Math.floor(hours / 24) + "d" + (hours % 24) + "h";
}

/**
 * Status → the `s-<status>` class that carries the chip's accent.
 *
 * The chip is a tinted surface with readable text; its ACCENT lives in the
 * `--pmb-accent` custom property, so one class per status covers both themes.
 * See ./client/gantt.js for the notes.
 */
function statusClass(status) {
  if (status === "running" || status === "review" || status === "blocked" || status === "done" || status === "ready" || status === "failed") {
    return "s-" + status;
  }
  return "s-planned";
}

/** Status → the small chip a lane header and a task card share. */
function StatusChip(React, status) {
  return React.createElement(
    "span",
    { className: "pmb-chip solid " + statusClass(status) },
    status,
  );
}

/**
 * Build the chart component.
 *
 * @param {object} deps
 * @param {Function} deps.React
 * @param {(ms: number) => string} deps.fmtTime absolute timestamp formatter
 * @param {(iso: string|null) => void} deps.onSelectTask open the task tab at one task
 */
function createGanttView({ React, fmtTime, onSelectTask }) {
  function ticksFor(from, to) {
    const span = to - from;
    const stepMinutes = span <= 2 * 3600000 ? 15 : span <= 6 * 3600000 ? 30 : span <= 24 * 3600000 ? 120 : 360;
    const step = stepMinutes * 60000;
    const first = Math.ceil(from / step) * step;
    const ticks = [];
    for (let at = first; at <= to && ticks.length < 40; at += step) ticks.push(at);
    return ticks;
  }

  /** One row of measured spans for a single agent. */
  function AgentRow(props) {
    const { row, from, to, now } = props;
    const span = to - from || 1;
    const pct = (value) => ((value - from) / span) * 100;
    const children = [];
    for (const item of row.spans) {
      const left = pct(Math.max(item.start, from));
      const width = Math.max(0.4, pct(Math.min(item.end, to)) - left);
      const segments = [];
      for (let index = 0; index < item.tools.length; index += 1) {
        const tool = item.tools[index];
        if (tool.at < from || tool.at > to) continue;
        const segLeft = ((tool.at - Math.max(item.start, from)) / Math.max(item.end - Math.max(item.start, from), 1)) * 100;
        const segWidth = Math.max(1.2, (Math.max(tool.durMs, 800) / Math.max(item.end - item.start, 1)) * 100);
        segments.push(
          React.createElement("i", {
            key: "s" + index,
            className: "pmb-seg",
            style: {
              position: "absolute",
              left: segLeft + "%",
              width: segWidth + "%",
              background: tool.error === true ? COLORS.toolError : COLORS.tool,
            },
            title: (tool.tool || "step") + " ｜ " + humanDuration(tool.durMs) + " ｜ " + clockOf(tool.at),
          }),
        );
      }
      children.push(
        React.createElement(
          "div",
          {
            key: "span" + item.start,
            className: "pmb-bar" + (item.end >= now - 2000 ? "" : " ghost"),
            style: { left: left + "%", width: width + "%", background: COLORS.running },
            title: row.label + " ｜ " + clockOf(item.start) + "–" + clockOf(item.end) + " ｜ " + humanDuration(item.end - item.start),
          },
          segments,
        ),
      );
    }
    return React.createElement(
      "div",
      { className: "pmb-row" },
      children.length === 0
        ? React.createElement(
            "span",
            { className: "pmb-lane-m", style: { paddingLeft: 6 } },
            "（这段时间没有采集到执行片段）",
          )
        : children,
    );
  }

  /** The axis + one lane per task. */
  function Gantt(props) {
    const { gantt, now } = props;
    // Orphans arrive as a prop so the tab can drop the dispatcher's own session;
    // the chart keeps drawing every orphan it is handed.
    const orphans = props.orphans === undefined ? gantt.orphans : props.orphans;
    const from = gantt.from;
    const to = Math.max(gantt.to, from + 60000);
    const span = to - from;
    const pct = (value) => ((value - from) / span) * 100;
    const ticks = ticksFor(from, to);

    const axis = React.createElement(
      "div",
      { className: "pmb-axis" },
      React.createElement("div", { className: "lbl" }, "任务 / Agent 泳道"),
      React.createElement(
        "div",
        { className: "ticks" },
        ticks.map((at) =>
          React.createElement(
            "span",
            { key: at, className: "tick", style: { left: pct(at) + "%" } },
            clockOf(at),
          ),
        ),
        React.createElement("span", {
          className: "pmb-now",
          style: { left: pct(now) + "%" },
          title: "现在 " + clockOf(now),
        }),
      ),
    );

    const lanes = [];
    for (const lane of gantt.lanes) {
      const elapsed = lane.startedAt === 0 ? 0 : (lane.endedAt === 0 ? now : lane.endedAt) - lane.startedAt;
      const label = React.createElement(
        "div",
        { className: "pmb-lane-lbl" },
        React.createElement(
          "div",
          { className: "pmb-lane-t", title: lane.title },
          lane.title,
        ),
        React.createElement(
          "div",
          { className: "pmb-lane-m" },
          StatusChip(React, lane.status),
          React.createElement("span", null, lane.kind),
          lane.domainId ? React.createElement("span", { title: "领域" }, "🧭 " + lane.domainId) : null,
          elapsed > 0 ? React.createElement("span", null, humanDuration(elapsed)) : null,
          lane.agents === undefined ? null : null,
        ),
        lane.blockedReason
          ? React.createElement(
              "div",
              { className: "pmb-lane-m pmb-t-warn" },
              "⛔ " + lane.blockedReason,
            )
          : null,
      );

      const rows = [];
      if (lane.rows.length === 0) {
        rows.push(
          React.createElement(
            "div",
            { className: "pmb-row", key: "empty" },
            lane.startedAt > 0
              ? React.createElement("div", {
                  className: "pmb-area",
                  style: {
                    left: pct(Math.max(lane.startedAt, from)) + "%",
                    width: Math.max(0.4, pct(Math.min(lane.endedAt === 0 ? now : lane.endedAt, to)) - pct(Math.max(lane.startedAt, from))) + "%",
                    background: COLORS[lane.status] ?? COLORS.planned,
                  },
                  title: "任务时间段（尚未绑定 Agent，所以看不到子 Agent 的执行）",
                })
              : React.createElement(
                  "span",
                  { className: "pmb-lane-m", style: { paddingLeft: 6 } },
                  "尚未开始（pm_agent bind 后这里会画出子 Agent 的执行）",
                ),
          ),
        );
      }
      for (const row of lane.rows) {
        rows.push(
          React.createElement(
            "div",
            { key: "name" + row.sessionId, className: "pmb-lane-m", style: { paddingLeft: 4, paddingTop: 2 } },
            "▸ " + (row.label || row.sessionId.slice(0, 8)),
          ),
          React.createElement(AgentRow, {
            key: row.sessionId,
            row,
            from,
            to,
            now,
          }),
        );
      }

      const track = React.createElement(
        "div",
        { className: "pmb-lane-track", style: { minHeight: Math.max(34, rows.length * 28 + 12) } },
        ticks.map((at) =>
          React.createElement("span", { key: "g" + at, className: "pmb-grid", style: { left: pct(at) + "%" } }),
        ),
        rows,
        React.createElement("span", { className: "pmb-now", style: { left: pct(now) + "%" } }),
      );

      lanes.push(
        React.createElement(
          "div",
          {
            key: lane.taskId,
            className: "pmb-lane",
            style: { cursor: onSelectTask === undefined ? "default" : "pointer" },
            onClick: onSelectTask === undefined ? undefined : () => onSelectTask(lane.taskId),
            title: onSelectTask === undefined ? undefined : "点击查看该任务详情",
          },
          label,
          track,
        ),
      );
    }

    if (orphans.length > 0) {
      const rows = orphans.map((orphan) =>
        React.createElement(
          "div",
          { key: orphan.sessionId },
          React.createElement(
            "div",
            { className: "pmb-lane-m", style: { paddingLeft: 4, paddingTop: 2 } },
            "▸ " + (orphan.label || orphan.sessionId.slice(0, 8)) + "（未绑定任务）",
          ),
          React.createElement(AgentRow, { row: orphan, from, to, now }),
        ),
      );
      lanes.push(
        React.createElement(
          "div",
          { key: "__orphans", className: "pmb-lane" },
          React.createElement(
            "div",
            { className: "pmb-lane-lbl" },
            React.createElement("div", { className: "pmb-lane-t" }, "未归属"),
            React.createElement(
              "div",
              { className: "pmb-lane-m" },
              "用 pm_agent bind 挂到任务上",
            ),
          ),
          React.createElement(
            "div",
            { className: "pmb-lane-track", style: { minHeight: Math.max(34, orphans.length * 28 + 12) } },
            ticks.map((at) => React.createElement("span", { key: "go" + at, className: "pmb-grid", style: { left: pct(at) + "%" } })),
            rows,
            React.createElement("span", { className: "pmb-now", style: { left: pct(now) + "%" } }),
          ),
        ),
      );
    }

    if (lanes.length === 0) {
      return React.createElement(
        "div",
        { className: "pmb-none" },
        "最近 " + humanDuration(span) + " 内没有任务或执行记录。让总控调 pm_task action=create 建线，并 pm_agent action=bind 绑定专家。",
      );
    }

    return React.createElement("div", { className: "pmb-gantt" }, axis, lanes);
  }

  return Gantt;
}

var PREFIX = "/pm-mode";
var WINDOWS = [
  { ms: 3600000, label: "1 小时" },
  { ms: 6 * 3600000, label: "6 小时" },
  { ms: 24 * 3600000, label: "24 小时" },
];
var TABS = [
  { id: "gantt", label: "甘特图" },
  { id: "experts", label: "专家" },
  { id: "tasks", label: "任务" },
  { id: "resources", label: "资源" },
  { id: "metrics", label: "统计" },
];
var SESSION_KEY = "dsh-pm-mode/session";
/**
 * The GUI's OWN "which conversation am I looking at" key, written by the
 * session controller (`dsh-api-session-controller` persists its selection
 * store under exactly this name).
 *
 * The panel needs it because `shell.overlay` is a frame-level slot: the drawer
 * is rendered OUTSIDE the conversation, so it receives no session prop and the
 * only session it ever knew was the one whose header button opened it —
 * rememberSession() then wrote that id into a single localStorage entry shared
 * by the whole GUI. Switching conversations while the drawer stayed open (or
 * reopening it from another conversation before the button ran) therefore kept
 * painting the PREVIOUS session's board, or an empty board that advised
 * "让总控跑一次 pm_task create" while the real board was busy in the sibling
 * conversation. Following this key makes the panel answer the question the
 * reader is actually asking: "what is running HERE".
 */
var LIVE_SESSION_KEY = "dsh.sessions.current";

function pad(value) {
  return value < 10 ? "0" + value : String(value);
}

function fmtTime(ms) {
  if (!ms) return "-";
  var date = new Date(ms);
  return (
    date.getMonth() + 1 + "-" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes())
  );
}

function fmtSeconds(ms) {
  if (!ms) return "-";
  return fmtTime(ms) + ":" + pad(new Date(ms).getSeconds());
}

function stylize() {
  var tagId = "dsh-pm-mode/pm-mode.css";
  if (typeof document === "undefined") return;
  var existing = document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]");
  if (existing !== null) {
    // A hot reload RE-RUNS this module while the previous stylesheet is still
    // mounted. Returning early there (the previous behaviour) kept the stale
    // rules on screen until a manual refresh, which is indistinguishable from
    // "the CSS fix did nothing". Rewriting the same tag keeps it unique AND
    // makes a stylesheet change take effect in place.
    if (existing.textContent !== CSS) existing.textContent = CSS;
    return;
  }
  var tag = document.createElement("style");
  tag.dataset.plugin = "dsh-pm-mode";
  tag.dataset.pluginCss = tagId;
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

window.__ModuleLoader__.load({
  id: "dsh-pm-mode",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var React = require("react");

    stylize();

    // ── shared panel state ───────────────────────────────────────────────
    // The drawer lives in the frame-level overlay slot, which carries no
    // session prop, so the session the header button was opened from is kept
    // here and mirrored into localStorage for a reload.
    var store = {
      open: false,
      sessionId: null,
      // Whether the drawer is still following the conversation on screen. Set
      // false only when the reader picks a board by hand (the board picker), so
      // an explicit choice is never yanked away by the session poll.
      followLive: true,
      tab: "gantt",
      windowMs: 24 * 3600000,
      wide: false,
      data: null,
      boards: null,
      allBoards: false,
      loading: false,
      error: null,
      busy: false,
      selectedTask: null,
      focusTask: null,
      nonce: 0,
    };
    var listeners = [];

    /**
     * A failure reported from inside a rendered cell.
     *
     * The slot owner removes a cell whose render throws, so the reader sees an
     * empty page and the console stays silent — the least actionable failure
     * this plugin can have. Reporting once per signature puts it in the console
     * without spamming a re-rendering cell, and the cell renders the message
     * itself (see ExpertModelForm) so a recurrence is visible where it happened.
     */
    var diagnostics = {
      seen: {},
      report: function (where, thrown) {
        var message = String(thrown && thrown.stack ? thrown.stack : thrown);
        var signature = where + "|" + message.slice(0, 160);
        if (this.seen[signature] === true) return;
        this.seen[signature] = true;
        try {
          console.error("[pm-mode] " + where + " failed to render:\n" + message);
        } catch (error) {
          /* no console in this environment */
        }
      },
    };

    function emit() {
      listeners.slice().forEach(function (listener) {
        listener();
      });
    }
    function setState(patch) {
      store = Object.assign({}, store, patch);
      emit();
    }
    function subscribe(listener) {
      listeners.push(listener);
      return function () {
        listeners = listeners.filter(function (item) {
          return item !== listener;
        });
      };
    }
    function useStore() {
      var pair = React.useState(store);
      var set = pair[1];
      React.useEffect(function () {
        return subscribe(function () {
          set(store);
        });
      }, []);
      return pair[0];
    }

    try {
      var remembered = window.localStorage.getItem(SESSION_KEY);
      if (remembered) store.sessionId = remembered;
    } catch (error) {
      /* storage disabled */
    }

    function rememberSession(sessionId) {
      if (!sessionId) return;
      store.sessionId = sessionId;
      try {
        window.localStorage.setItem(SESSION_KEY, sessionId);
      } catch (error) {
        /* storage disabled */
      }
    }

    /**
     * The conversation currently on screen, or null when the GUI has not said.
     *
     * Read fresh on every call (never cached): the whole point is to notice the
     * reader moving between conversations, which is exactly the change a cached
     * value would hide. An unreadable value is treated as "no opinion" rather
     * than as a session id, so a storage hiccup cannot leave the panel pinned
     * to "null".
     */
    function liveSessionId() {
      try {
        var raw = window.localStorage.getItem(LIVE_SESSION_KEY);
        if (!raw) return null;
        var parsed = JSON.parse(raw);
        var id = parsed && parsed.sessionId ? String(parsed.sessionId) : "";
        return id === "" ? null : id;
      } catch (error) {
        return null;
      }
    }

    /**
     * The drawer's session, re-resolved against the conversation on screen.
     *
     * Returns the target to load and whether it CHANGED, so callers can decide
     * between a silent swap and a full refresh. Two rules:
     *   - the live conversation wins while followLive is on — that is the whole
     *     fix for "panel shows another session's board";
     *   - an explicit board pick turns followLive off and its choice stands
     *     until the reader returns to the live conversation.
     */
    function syncSession() {
      var live = liveSessionId();
      if (live === null) return { target: store.sessionId, changed: false, live: null };
      if (!store.followLive && store.sessionId !== live) return { target: store.sessionId, changed: false, live: live };
      var changed = store.sessionId !== live;
      rememberSession(live);
      return { target: live, changed: changed, live: live };
    }

    // ── data access ──────────────────────────────────────────────────────

    function refresh(sessionId, windowMs, allBoards) {
      setState({ loading: true, error: null });
      var target = sessionId || store.sessionId;
      var query =
        PREFIX + "/__api__/state?windowMs=" + String(windowMs || store.windowMs) + (target ? "&sessionId=" + encodeURIComponent(target) : "");
      return fetch(query, { cache: "no-store" }).then(
        function (response) {
          if (response.status === 404) throw new Error("这个会话还没有看板：让总控调一次 pm_task action=create 就会建出来");
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.json();
        },
        function (error) {
          throw new Error("无法连接看板服务: " + String(error && error.message ? error.message : error));
        },
      ).then(
        function (data) {
          setState({ data: data, loading: false });
          if (allBoards) refreshBoards();
        },
        function (error) {
          setState({ loading: false, error: String(error && error.message ? error.message : error) });
        },
      );
    }

    function refreshBoards() {
      return fetch(PREFIX + "/__api__/boards", { cache: "no-store" }).then(
        function (response) {
          return response.json();
        },
        function () {
          return null;
        },
      ).then(function (data) {
        if (data && Array.isArray(data.boards)) setState({ boards: data.boards });
      });
    }

    function manage(payload) {
      setState({ busy: true, error: null });
      return fetch(PREFIX + "/__api__/manage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(payload),
      }).then(
        function (response) {
          return response.json();
        },
        function (error) {
          throw new Error(String(error && error.message ? error.message : error));
        },
      ).then(
        function (result) {
          setState({ busy: false });
          if (!result || result.ok !== true) throw new Error(result && result.error ? result.error : "操作失败");
          return result;
        },
        function (error) {
          setState({ busy: false, error: String(error && error.message ? error.message : error) });
          throw error;
        },
      );
    }

    function openPanel(sessionId, taskId) {
      // The header button is the authoritative "this conversation is on screen
      // right now" signal, so it re-arms following before anything else. Only
      // when it hands over nothing AND the GUI says nothing do we fall back to
      // the remembered board — which may well be a different conversation's.
      setState({ followLive: true });
      if (sessionId) rememberSession(sessionId);
      var live = liveSessionId();
      if (live !== null) rememberSession(live);
      var target = sessionId || live || store.sessionId;
      setState({ open: true, focusTask: taskId || null, tab: taskId ? "tasks" : store.tab, nonce: store.nonce + 1 });
      refresh(target, store.windowMs, store.allBoards);
      // The empty board is answered with "here is where the work actually is",
      // and that answer needs the board list — which the reader should not have
      // to ask for by toggling 全部看板 first. Only on a miss, so the steady
      // state costs no extra request.
      if (store.boards === null) refreshBoards();
    }

    // ── header button ────────────────────────────────────────────────────

    function HeaderButton(props) {
      var state = useStore();
      var active = state.data && state.data.summary ? state.data.summary.counts : null;
      var activeCount =
        active === null
          ? 0
          : (active.planned || 0) + (active.ready || 0) + (active.running || 0) + (active.blocked || 0) + (active.review || 0);
      var blocked = active === null ? 0 : active.blocked || 0;
      var label = "📋 项目看板";
      if (activeCount > 0) label += " (" + activeCount + ")";
      if (blocked > 0) label += " ⛔" + blocked;
      return React.createElement(
        "button",
        {
          type: "button",
          className: "pmb-btn" + (state.open ? " on" : ""),
          title: state.open ? "关闭项目看板" : "打开项目看板：24 小时甘特图、任务看板、共享资源令牌、统计",
          onClick: function () {
            if (store.open) setState({ open: false });
            else openPanel(props.sessionId, null);
          },
        },
        label,
      );
    }

    // ── gantt tab ────────────────────────────────────────────────────────

    var GanttView = createGanttView({
      React: React,
      fmtTime: fmtTime,
      onSelectTask: function (taskId) {
        setState({ tab: "tasks", focusTask: taskId });
      },
    });

    function GanttTab(props) {
      var state = props.state;
      var data = state.data;
      if (!data) return null;
      var now = Date.now();
      var gantt = data.gantt;
      var live = data.summary && data.summary.live ? data.summary.live : {};
      var running = Object.keys(live).filter(function (id) {
        return live[id] === "running";
      });
      // An empty board used to render a full-size empty chart plus a sentence
      // telling the reader to run a tool themselves, which hid the actually
      // useful answer ("the work is on another session's board — here it is").
      // The drawer answers this on EVERY tab before it picks a body; this branch
      // is the fallback for a caller that renders the tab directly.
      if (data.summary.counts.total === 0 && (store.boards || []).length > 0) {
        return emptyBoardState(
          state,
          "这个会话的看板还没有任务：从这里派单时用 pm_task action=create 建线，看板才会跟着动起来。",
        );
      }
      // The dispatcher's own conversation sits IN this board, so the collector
      // naturally observes it too. Drawing it as an "未归属" lane reads as a
      // forgotten subagent when it is really the reader's own session, so it is
      // filtered out here while every other orphan stays visible.
      var orphans = (gantt.orphans || []).filter(function (orphan) {
        return orphan.sessionId !== data.sessionId;
      });
      return React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { className: "pmb-stats" },
          stat("正在执行", running.length, "个子 Agent 处于 running"),
          stat("活跃任务", activeTaskCount(data), "条线在推进"),
          stat("阻塞", data.summary.counts.blocked || 0, "需要你裁决"),
          stat("累计执行", humanDuration(totalExecMs(data)), "本窗口内采集到的 agent 时间"),
        ),
        React.createElement(
          "div",
          { className: "pmb-legend" },
          keyOf(COLORS.running, "执行中"),
          keyOf(COLORS.planned, "已完成/已结束片段"),
          keyOf(COLORS.tool, "单步工具调用"),
          keyOf(COLORS.blocked, "阻塞"),
          keyOf(COLORS.done, "完成"),
          React.createElement(
            "span",
            { className: "pmb-spacer" },
          ),
          React.createElement("span", null, "窗口 " + humanDuration(gantt.to - gantt.from) + " ｜ 数据更新 " + fmtTime(data.updatedAt)),
        ),
        React.createElement(GanttView, { gantt: data.gantt, now: now, orphans: orphans }),
        data.summary.resources && data.summary.resources.length > 0
          ? React.createElement(
              "div",
              null,
              React.createElement("div", { className: "pmb-h" }, "共享资源令牌（同一时刻只能有一个持有者）"),
              data.summary.resources.map(function (resource) {
                return React.createElement(
                  "div",
                  { className: "pmb-res", key: resource.id },
                  React.createElement(
                    "div",
                    { className: "pmb-res-top" },
                    React.createElement("span", { className: "pmb-res-n" }, resource.label),
                    React.createElement(
                      "span",
                      { className: "pmb-chip" + (resource.holder === null ? "" : " solid s-blocked") },
                      resource.holder === null ? "空闲" : "被 " + resource.holder + " 持有 " + humanDuration(resource.heldMs),
                    ),
                    React.createElement("span", { className: "pmb-spacer" }),
                    resource.queue.length > 0
                      ? React.createElement("span", { className: "pmb-chip" }, "排队 " + resource.queue.join(" → "))
                      : null,
                  ),
                );
              }),
            )
          : null,
      );
    }

    function stat(key, value, unit) {
      return React.createElement(
        "div",
        { className: "pmb-stat", key: key },
        React.createElement("span", { className: "k" }, key),
        React.createElement("span", { className: "v" }, String(value)),
        React.createElement("span", { className: "u" }, unit),
      );
    }

    function keyOf(color, label) {
      return React.createElement(
        "span",
        { className: "pmb-key", key: label },
        React.createElement("i", { style: { background: color } }),
        label,
      );
    }

    function activeTaskCount(data) {
      var counts = data.summary.counts;
      return (counts.planned || 0) + (counts.ready || 0) + (counts.running || 0) + (counts.blocked || 0) + (counts.review || 0);
    }

    function totalExecMs(data) {
      var total = 0;
      var rows = data.summary.agents || [];
      for (var index = 0; index < rows.length; index += 1) total += rows[index].totalMs || 0;
      return total;
    }

    // ── empty board: where is the work, then? ────────────────────────────

    /**
     * Other boards on this machine that actually have work, newest first.
     *
     * A board is keyed by session, and the reader is looking at ONE session, so
     * "this board is empty while an expert is busy" is a normal state — not a
     * broken one. It is only confusing when the panel answers it with a
     * dead-end sentence, so these entries turn it into one click.
     */
    function otherBoards(data) {
      var boards = store.boards || [];
      var own = data === null ? null : data.boardId;
      return boards.filter(function (board) {
        if (board.boardId === own) return false;
        if (board.sessionId === (data === null ? null : data.sessionId)) return false;
        return (board.counts && board.counts.total) > 0;
      });
    }

    /** The sibling-board list, or null when there is nothing to point at. */
    function boardJumpList(data) {
      var others = otherBoards(data);
      if (others.length === 0) return null;
      return React.createElement(
        "div",
        { className: "pmb-tabs", style: { borderBottom: "none", flexWrap: "wrap" } },
        React.createElement("span", { className: "pmb-sub" }, "本机其它看板有在办的工作："),
        others.slice(0, 6).map(function (board) {
          var active = (board.counts && board.counts.active) || 0;
          return React.createElement(
            "button",
            {
              key: board.boardId,
              type: "button",
              className: "pmb-btn" + (active > 0 ? " primary" : ""),
              title: board.boardId + " ｜ 任务 " + (board.counts.total || 0) + " ｜ 更新 " + fmtTime(board.mtime),
              onClick: function () {
                // Same explicit-pick rule as the 全部看板 picker: the choice
                // stands until the reader goes back to the live conversation.
                setState({ followLive: false, allBoards: false, boards: null });
                rememberSession(board.boardId);
                refresh(board.boardId, store.windowMs, false);
              },
            },
            board.boardId.replace(/^session-/, "").slice(0, 8) + "（在办 " + active + "）",
          );
        }),
      );
    }

    /** What to show instead of a dead end: why it is empty + where work is. */
    function emptyBoardState(state, fallback) {
      var jump = boardJumpList(state.data);
      if (jump === null) {
        return React.createElement("div", { className: "pmb-none" }, fallback);
      }
      return React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { className: "pmb-none" },
          "这个会话的看板还没有任务。看板按会话分开存放：从这里派单时用 pm_task action=create 建线，" +
            "或者直接看下面那块有在办工作的看板。",
        ),
        jump,
      );
    }

    /** The 任务 tab's empty state: list the sibling boards instead of a dead end. */
    function emptyTasksState(state) {
      var jump = boardJumpList(state.data);
      if (jump === null) {
        return React.createElement(
          "div",
          { className: "pmb-none", key: "empty" },
          "这块看板还没有任务。总控接到诉求后会先 pm_task action=create 建一条，再指派一个专家。",
        );
      }
      return React.createElement(
        "div",
        { key: "empty" },
        React.createElement(
          "div",
          { className: "pmb-none" },
          "这块看板还没有任务 —— 看板按会话分开存放，这里为空不代表没有活。",
        ),
        jump,
      );
    }

    // ── tasks tab ────────────────────────────────────────────────────────

    function TaskCard(props) {
      var task = props.task;
      var state = props.state;
      var [open, setOpen] = React.useState(state.focusTask === task.id);
      React.useEffect(
        function () {
          if (state.focusTask === task.id) setOpen(true);
        },
        [state.focusTask],
      );
      var statusColor = COLORS[task.status] || COLORS.planned;
      var elapsed = task.startedAt === 0 ? 0 : (task.endedAt === 0 ? Date.now() : task.endedAt) - task.startedAt;
      var live = state.data && state.data.summary && state.data.summary.live ? state.data.summary.live : {};
      return React.createElement(
        "div",
        { className: "pmb-task", style: { borderLeftColor: statusColor } },
        React.createElement(
          "div",
          { className: "pmb-task-top" },
          React.createElement("span", { className: "pmb-chip solid " + statusClass(task.status) }, task.status),
          React.createElement("span", { className: "pmb-task-t" }, task.title),
          React.createElement("span", { className: "pmb-task-id" }, task.id),
          React.createElement("span", { className: "pmb-spacer" }),
          React.createElement("span", { className: "pmb-chip" }, task.kind),
          task.domainId
            ? React.createElement(
                "span",
                {
                  className: "pmb-chip s-running",
                  key: "domain",
                  title: "领域：" + task.domainId + "（同领域的后续诉求路由回同一个专家）",
                },
                "🧭 " + task.domainId,
              )
            : null,
          elapsed > 0 ? React.createElement("span", { className: "pmb-chip" }, humanDuration(elapsed)) : null,
          React.createElement(
            "button",
            {
              type: "button",
              className: "pmb-btn",
              onClick: function () {
                setOpen(!open);
              },
            },
            open ? "收起" : "展开",
          ),
        ),
        task.blockedReason
          ? React.createElement("div", { className: "pmb-note warn", key: "blocked" }, "⛔ " + task.blockedReason)
          : null,
        task.requestedBy && task.requestedBy !== "user"
          ? React.createElement("div", { className: "pmb-task-body", style: { opacity: 0.85 } }, "📨 原始诉求：" + task.requestedBy)
          : null,
        task.parentId
          ? React.createElement("div", { className: "pmb-task-body", style: { opacity: 0.85 } }, "↳ 专家内部子线，父任务 " + task.parentId)
          : null,
        task.agents.length > 0
          ? React.createElement(
              "div",
              { className: "pmb-phases" },
              task.agents.map(function (sessionId) {
                var status = live[sessionId] || "unknown";
                return React.createElement(
                  "span",
                  {
                    className: "pmb-chip" + (status === "running" ? " solid" : ""),
                    key: sessionId,
                    style: status === "running" ? { background: COLORS.running } : {},
                    title: sessionId,
                  },
                  (status === "running" ? "▶ " : "■ ") + sessionId.slice(0, 8) + " " + status,
                );
              }),
            )
          : React.createElement("div", { className: "pmb-task-body" }, "尚未绑定 Agent —— 用 pm_agent action=bind 把它接上，甘特图才会画出这条线的执行。"),
        task.phases.length > 0
          ? React.createElement(
              "div",
              { className: "pmb-phases" },
              task.phases.map(function (phase) {
                var duration = phase.startedAt === 0 ? 0 : (phase.endedAt === 0 ? Date.now() : phase.endedAt) - phase.startedAt;
                return React.createElement(
                  "span",
                  { className: "pmb-phase", key: phase.id, style: { borderColor: COLORS[phase.status] || undefined } },
                  React.createElement("i", { style: { width: 7, height: 7, borderRadius: 4, background: COLORS[phase.status] || COLORS.planned, display: "inline-block" } }),
                  phase.name,
                  duration > 0 ? React.createElement("span", { className: "d" }, humanDuration(duration)) : null,
                );
              }),
            )
          : null,
        open
          ? React.createElement(
              "div",
              null,
              task.goal ? React.createElement("div", { className: "pmb-task-body" }, "目标：" + task.goal) : null,
              task.acceptance ? React.createElement("div", { className: "pmb-task-body" }, "验收：" + task.acceptance) : null,
              task.evidence ? React.createElement("div", { className: "pmb-task-body" }, "证据：" + task.evidence) : null,
              task.result ? React.createElement("div", { className: "pmb-task-body" }, "结果：" + task.result) : null,
              task.dependsOn.length > 0 ? React.createElement("div", { className: "pmb-task-body" }, "前置：" + task.dependsOn.join(", ")) : null,
              React.createElement(
                "div",
                { className: "pmb-task-body" },
                "创建 " + fmtTime(task.createdAt) + " ｜ 更新 " + fmtTime(task.updatedAt),
              ),
              task.transitions.length > 0
                ? React.createElement(
                    "table",
                    { className: "pmb-table" },
                    React.createElement(
                      "thead",
                      null,
                      React.createElement(
                        "tr",
                        null,
                        React.createElement("th", null, "时间"),
                        React.createElement("th", null, "变化"),
                        React.createElement("th", null, "说明"),
                      ),
                    ),
                    React.createElement(
                      "tbody",
                      null,
                      task.transitions
                        .slice()
                        .reverse()
                        .map(function (item, index) {
                          return React.createElement(
                            "tr",
                            { key: index },
                            React.createElement("td", null, fmtSeconds(item.at)),
                            React.createElement("td", null, item.from + " → " + item.to),
                            React.createElement("td", null, item.note || "-"),
                          );
                        }),
                    ),
                  )
                : null,
              React.createElement(
                "div",
                { className: "pmb-phases" },
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "pmb-btn",
                    disabled: state.busy,
                    onClick: function () {
                      var text = window.prompt("给这条任务加一条备注（会写进看板）");
                      if (!text) return;
                      manage({ action: "note", boardId: state.data.boardId, taskId: task.id, text: text }).then(function () {
                        refresh(state.sessionId, state.windowMs, state.allBoards);
                      });
                    },
                  },
                  "加备注",
                ),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "pmb-btn",
                    disabled: state.busy,
                    title: "从看板移除这条任务（不影响任何 Agent，只影响看板记录）",
                    onClick: function () {
                      if (!window.confirm("从看板移除任务「" + task.title + "」？\n只删除看板记录，正在跑的 Agent 不受影响。")) return;
                      manage({ action: "delete-task", boardId: state.data.boardId, taskId: task.id }).then(function () {
                        refresh(state.sessionId, state.windowMs, state.allBoards);
                      });
                    },
                  },
                  "移除",
                ),
              ),
            )
          : null,
      );
    }

    function TasksTab(props) {
      var state = props.state;
      var data = state.data;
      if (!data) return null;
      var groups = [
        { id: "active", label: "进行中", match: ["running", "ready", "review"] },
        { id: "attention", label: "需要关注", match: ["blocked"] },
        { id: "waiting", label: "未开始", match: ["planned"] },
        { id: "closed", label: "已结束", match: ["done", "failed", "cancelled"] },
      ];
      var children = [];
      for (var index = 0; index < groups.length; index += 1) {
        var group = groups[index];
        var tasks = data.tasks.filter(function (task) {
          return group.match.indexOf(task.status) >= 0;
        });
        if (tasks.length === 0) continue;
        children.push(React.createElement("div", { className: "pmb-h", key: group.id }, group.label + "（" + tasks.length + "）"));
        for (var t = 0; t < tasks.length; t += 1) {
          children.push(React.createElement(TaskCard, { key: tasks[t].id, task: tasks[t], state: state }));
        }
      }
      if (children.length === 0) {
        children.push(emptyTasksState(state));
      }
      if (data.notes && data.notes.length > 0) {
        children.push(React.createElement("div", { className: "pmb-h", key: "notes" }, "看板备注"));
        children.push(
          React.createElement(
            "table",
            { className: "pmb-table", key: "notestable" },
            React.createElement(
              "tbody",
              null,
              data.notes
                .slice()
                .reverse()
                .slice(0, 20)
                .map(function (note, noteIndex) {
                  return React.createElement(
                    "tr",
                    { key: noteIndex },
                    React.createElement("td", { style: { whiteSpace: "nowrap" } }, fmtSeconds(note.at)),
                    React.createElement("td", { className: "pmb-task-id" }, note.taskId || "-"),
                    React.createElement("td", null, note.text),
                  );
                }),
            ),
          ),
        );
      }
      return React.createElement("div", null, children);
    }

    // ── experts tab ──────────────────────────────────────────────────────

    // The dispatcher's routing table, rendered as-is: one card per expertise
    // area with its owning expert, so "who already has the context for this?"
    // is answered by looking rather than by remembering. A domain with no
    // owner is the visible state of "this direction would open a new agent".
    /**
     * A domain's responsibility as prose, tolerating the retired keyword array.
     *
     * The fallback is for VERSION SKEW, not for the feature: this bundle is
     * hot-swapped into a running browser while the host half only changes on a
     * profile reload, so for a window of time the panel reads a payload produced
     * by the older host (which still sends `skills`). Without it every domain
     * would read "还没写职责描述" until the host caught up.
     */
    function domainResponsibilityOf(domain) {
      var prose = typeof domain.responsibility === "string" ? domain.responsibility : "";
      if (prose !== "") return prose;
      return (domain.skills || []).join(" / ");
    }

    function ExpertsTab(props) {
      var state = props.state;
      var data = state.data;
      if (!data) return null;
      var resources = data.resources || [];
      var experts = data.experts || [];
      var domains = data.domains || [];
      var live = (data.summary && data.summary.live) || {};
      var bySession = {};
      for (var e = 0; e < experts.length; e += 1) bySession[experts[e].sessionId] = experts[e];
      // The expert-model picker leads this tab, not the 资源 tab: "which model
      // does my expert run on" is the first thing someone opens the 专家 tab to
      // ask, and a setting nobody can find is a setting that does not exist. It
      // stays in 资源 as well (same component, one implementation) because that
      // is where deployment-level resources are configured.
      var children = [].concat(ExpertModelCard(props));
      children.push(
        React.createElement(
          "div",
          { className: "pmb-legend", key: "hint" },
          "一个用户诉求 = 一个专家 = 一条任务。领域的上下文留在专家身上，同领域的后续诉求交回同一个专家；专家的内部分工由它自己决定，共享环境令牌由总控发放。",
        ),
      );

      children.push(React.createElement("div", { className: "pmb-h", key: "lh" }, "领域（" + domains.length + "）"));
      if (domains.length === 0) {
        children.push(
          React.createElement(
            "div",
            { className: "pmb-none", key: "empty" },
            "还没有领域。总控接到诉求后先 pm_agent action=domain 定义领域，再把专家 bind（role=expert）上去。",
          ),
        );
      }
      for (var index = 0; index < domains.length; index += 1) {
        var domain = domains[index];
        var owner = domain.ownerSessionId ? bySession[domain.ownerSessionId] : null;
        var ownerState = domain.ownerSessionId ? live[domain.ownerSessionId] || (owner ? (owner.active ? "running" : "idle") : "unknown") : "";
        var openTasks = (domain.tasks || []).filter(function (task) {
          return task.status !== "done" && task.status !== "failed" && task.status !== "cancelled";
        });
        children.push(
          React.createElement(
            "div",
            { className: "pmb-res", key: domain.id },
            React.createElement(
              "div",
              { className: "pmb-res-top" },
              React.createElement("span", { className: "pmb-res-n" }, domain.name),
              React.createElement("span", { className: "pmb-task-id" }, domain.id),
              React.createElement(
                "span",
                {
                  className: "pmb-chip" + (domain.ownerSessionId ? " solid s-running" : " s-blocked"),
                },
                domain.ownerSessionId ? "有负责人" : "无人负责",
              ),
              React.createElement("span", { className: "pmb-spacer" }),
              openTasks.length > 0 ? React.createElement("span", { className: "pmb-chip" }, "在办 " + openTasks.length) : null,
            ),
            React.createElement(
              "div",
              { className: "pmb-task-body" },
              domain.ownerSessionId
                ? "负责人 " +
                    (domain.ownerLabel || (owner && owner.label) || "(无标签)") +
                    " ｜ " +
                    domain.ownerSessionId.slice(0, 12) +
                    " ｜ " +
                    ownerState +
                    (owner && owner.doneCount ? " ｜ 已交付 " + owner.doneCount + " 条" : "")
                : "尚无专家：同方向的下一个诉求要么开新专家，要么先把它接给已有专家。",
            ),
            // Responsibility as PROSE: the panel shows what the domain covers so
            // the dispatcher (a model) can judge ownership itself. The keyword
            // chips are gone with the scorer that ranked them.
            //
            // `domainResponsibilityOf` falls back to the retired `skills` array
            // as a VERSION-SKEW guard, not as a feature: this bundle is
            // hot-swapped into a running browser while the host half only changes
            // on a profile reload, so for a while the panel reads a payload from
            // the older host (which still sends `skills`). Without the fallback
            // every domain would read "还没写职责描述" until the host caught up.
            domainResponsibilityOf(domain)
              ? React.createElement("div", { className: "pmb-task-body" }, "职责：" + domainResponsibilityOf(domain))
              : React.createElement("div", { className: "pmb-task-body pmb-t-muted" }, "还没写职责描述：用 pm_agent action=domain 补一句这个领域负责什么、边界在哪。"),
            (domain.tasks || []).length > 0
              ? React.createElement(
                  "div",
                  { className: "pmb-task-body", style: { opacity: 0.85 } },
                  "经手任务：" +
                    domain.tasks
                      .slice(-8)
                      .map(function (task) {
                        return task.id + "[" + task.status + "]";
                      })
                      .join("、"),
                )
              : null,
          ),
        );
      }

      var loners = experts.filter(function (expert) {
        return !(expert.domains || []).length;
      });
      if (loners.length > 0) {
        children.push(React.createElement("div", { className: "pmb-h", key: "nh" }, "未挂领域的专家（" + loners.length + "）"));
        children.push(
          React.createElement(
            "table",
            { className: "pmb-table", key: "notable" },
            React.createElement(
              "tbody",
              null,
              loners.map(function (expert) {
                return React.createElement(
                  "tr",
                  { key: expert.sessionId },
                  React.createElement("td", { className: "pmb-task-id" }, expert.sessionId.slice(0, 12)),
                  React.createElement("td", null, expert.label || "(无标签)"),
                  React.createElement("td", null, expert.active ? "运行中" : "空闲"),
                  React.createElement("td", null, "用 pm_agent action=bind role=expert domainId=… 把领域登记上，否则后续同类诉求找不到它"),
                );
              }),
            ),
          ),
        );
      }

      children.push(React.createElement("div", { className: "pmb-h", key: "rh" }, "环境令牌（总控持有与转交）"));
      if (resources.length === 0) {
        children.push(
          React.createElement(
            "div",
            { className: "pmb-none", key: "nores" },
            "还没有声明共享资源。本机独占的环境/服务建议先声明一个 id（例如 shared-env）。",
          ),
        );
      }
      for (var r = 0; r < resources.length; r += 1) {
        var resource = resources[r];
        var holder = resource.holder;
        var holderExpert = holder ? bySession[holder.sessionId] : null;
        children.push(
          React.createElement(
            "div",
            { className: "pmb-task-body", key: resource.id, style: { padding: "4px 2px" } },
            "🔒 " +
              resource.label +
              "：" +
              (holder === null
                ? "空闲（任何专家要用都必须先由总控发出令牌）"
                : "被 " +
                  (holder.label || holder.sessionId.slice(0, 12)) +
                  " 持有（任务 " +
                  (holder.taskId || "-") +
                  "）" +
                  (holderExpert && holderExpert.domains && holderExpert.domains.length
                    ? " ｜ 领域 " +
                      holderExpert.domains
                        .map(function (item) {
                          return item.name;
                        })
                        .join("、")
                    : "")) +
              ((resource.queue || []).length > 0
                ? " ｜ 排队 " +
                  resource.queue
                    .map(function (item) {
                      return item.label || item.sessionId.slice(0, 8);
                    })
                    .join(" → ")
                : ""),
          ),
        );
      }

      return React.createElement("div", null, children);
    }

    // ── expert route: one form, two surfaces ─────────────────────────────
    //
    // `subagent_expert` runs where the OPERATOR points it, and the operator
    // points it here. The form is one implementation used from two places:
    //
    //   - "panel" — the 专家 tab's card (and 资源, same component), where it sits
    //     beside the leases and shows the route to someone already reading the
    //     board;
    //   - "settings" — a DSH Settings section, where a deployment-level setting
    //     belongs and where it is reachable WITHOUT a dispatch session, which is
    //     the case that forced it: a fresh session has no board panel to open.
    //
    // Both read the same catalog and save through the same loopback-only
    // endpoint, which re-validates against the live LLM adapter before writing,
    // so a bad route is refused while the form is on screen instead of failing
    // later inside a delegation.
    //
    // The catalog comes from the host, which asks the live adapter
    // (`llm.resolveModelInfo`), so the effort list is what that model actually
    // accepts rather than a hard-coded guess.
    function ExpertModelCard(props) {
      return React.createElement(ExpertModelForm, {
        view: props.state,
        mode: "panel",
        onSaved: undefined,
      });
    }

    /**
     * The expert-route form.
     *
     * This is a COMPONENT, not a render helper, and that is load-bearing: it
     * owns React state, and a hook-bearing function called during another
     * component's render has no component of its own to attach that state to.
     * The symptom is quiet rather than loud — the first paint succeeds, then the
     * first `setState` unwinds the owner and the slot's error boundary removes
     * the whole cell (a blank settings page, with nothing in the console).
     *
     * @param {{ view: object|null, mode: "panel"|"settings", onSaved?: () => void }} props
     *   `view` is the drawer's store on the panel surface, or null on the
     *   settings surface (which has no drawer and therefore no board payload to
     *   read the active route from — it fetches the catalog, and the catalog
     *   carries `current`, so the settings surface needs no `__api__/state`
     *   round trip). `onSaved` lets the surface that owns a second view of the
     *   same value (the drawer's board payload) re-read it.
     */
    function ExpertModelForm(props) {
      try {
        return renderExpertModelForm(props);
      } catch (thrown) {
        // A slot cell that throws is removed by the slot owner, which looks
        // exactly like "the page is blank for no reason" — no console entry, no
        // stack, nothing to act on. Rendering the failure INSIDE the cell keeps
        // the next occurrence diagnosable.
        diagnostics.report("pm-mode expert-model form", thrown);
        return React.createElement(
          "div",
          { className: "pmb-none pmb-t-err" },
          "专家模型表单渲染失败：" + String(thrown && thrown.message ? thrown.message : thrown),
        );
      }
    }

    /* #region model-picker */
    /**
     * Resolve what the 服务商 / 模型 pickers must render.
     *
     * The 模型 options can only come from the catalog entry of ONE provider —
     * the one the 服务商 select shows — and the previous revision took that
     * provider from the SAVED route alone:
     *
     *     for (i...) if (providers[i].id === shown.provider) providerEntry = providers[i];
     *
     * The saved provider is empty on a never-configured install (that IS the
     * plugin's default: `DEFAULT_EXPERT_MODEL.provider === ""`, lib/store.js),
     * and any id the host does not register verbatim — `llm.listProviders()`
     * answers `deepseek-official`, not `deepseek` — misses the same way. The
     * lookup then returned nothing, so 模型 rendered its 「（选一个）」 row
     * alone while 服务商 still listed every real provider, and the save button
     * stayed disabled on `!shown.provider`. Picking any provider re-seeded the
     * draft with an id that DID match, which is why "switch the provider away
     * and back" appeared to fix it.
     *
     * This resolver keeps the saved value when it matches and otherwise falls
     * back to the first provider that advertises models, reporting what it did
     * so the form can SAY so instead of rendering an empty list.
     *
     * Pure and DOM-free on purpose: scripts/check-client.mjs drives it with
     * fixture catalogs, because the hand-inlined client bundle has no test seam.
     *
     * @param {{providers?: Array<{id: string, name?: string, models?: Array<{id: string, name?: string}>, error?: string}>}|null} catalog
     * @param {{provider?: string, model?: string}|null} shown the value the form edits
     * @returns {{provider: string, entry: object|null, models: Array, providerOptions: Array<{id: string, label: string}>, modelOptions: Array<{id: string, label: string}>, savedMissing: boolean, hint: string, hintKind: string, emptyNote: string}}
     */
    function resolveModelPicker(catalog, shown) {
      var providers = catalog && catalog.providers ? catalog.providers : [];
      var wanted = shown && shown.provider ? shown.provider : "";
      var entry = null;
      var fallback = null;
      var index;
      for (index = 0; index < providers.length; index += 1) {
        if (providers[index].id === wanted) entry = providers[index];
        if (fallback === null && providers[index].models && providers[index].models.length > 0) fallback = providers[index];
      }
      var effective = entry === null ? fallback : entry;
      var provider = effective === null ? wanted : effective.id;
      var models = effective !== null && effective.models ? effective.models : [];
      var providerOptions = [];
      for (index = 0; index < providers.length; index += 1) {
        providerOptions.push({ id: providers[index].id, label: providers[index].name || providers[index].id });
      }
      // A <select> whose value matches no <option> renders BLANK — React cannot
      // display a value the list does not contain — which reads as "the page is
      // broken" rather than "this id is unknown". Both edge values get a row.
      if (wanted === "") providerOptions.unshift({ id: "", label: "（未配置）" });
      if (wanted !== "" && entry === null) providerOptions.unshift({ id: wanted, label: wanted + "（不在当前模型清单）" });
      var modelOptions = [];
      for (index = 0; index < models.length; index += 1) {
        modelOptions.push({ id: models[index].id, label: models[index].name || models[index].id });
      }
      var emptyNote = "";
      if (effective !== null && models.length === 0) {
        emptyNote = effective.error
          ? "读取 " + (effective.name || effective.id) + " 的模型清单失败：" + effective.error
          : "服务商 " + (effective.name || effective.id) + " 没有返回任何模型";
      }
      var savedMissing = wanted !== "" && entry === null;
      var hint = "";
      var hintKind = "info";
      if (savedMissing) {
        hint =
          "保存的服务商「" + wanted + "」不在当前模型清单里" +
          (effective !== null
            ? "，下面先按 " + (effective.name || effective.id) + " 列出；选定后点保存覆盖"
            : "；请先选一个服务商");
        hintKind = "warn";
      } else if (wanted === "" && effective !== null) {
        hint = "还没配置：先按 " + (effective.name || effective.id) + " 的模型清单列出，选定后点保存";
      }
      return {
        provider: provider,
        entry: effective,
        models: models,
        providerOptions: providerOptions,
        modelOptions: modelOptions,
        savedMissing: savedMissing,
        hint: hint,
        hintKind: hintKind,
        emptyNote: emptyNote,
      };
    }
    /* #endregion model-picker */

    function renderExpertModelForm(props) {
      var state = props.view;
      var settingsMode = props.mode === "settings";
      var onSaved = props.onSaved;
      // One `state`-shaped value for both callers: the settings surface has no
      // drawer, and inventing one here would mean a second code path for every
      // "is the drawer busy" read below.
      var view = settingsMode ? { data: null, busy: false, sessionId: null, windowMs: 24 * 3600000, allBoards: false } : state;
      var active = settingsMode ? null : (view.data && view.data.settings && view.data.settings.expertModel) || null;
      var [catalog, setCatalog] = React.useState(null);
      var [draft, setDraft] = React.useState(null);
      var [note, setNote] = React.useState(null);
      var [error, setError] = React.useState(null);
      var [loading, setLoading] = React.useState(false);
      var [open, setOpen] = React.useState(settingsMode);

      /**
       * The draft a freshly read catalog opens with: the picker's effective
       * provider, plus the saved model ONLY when that model's provider is the
       * one still in play. The effort field defaults to empty for the same
       * reason it always did — empty means "the model's own default", and the
       * form must be able to express that.
       */
      function draftFromCatalog(cat) {
        var current = (cat && cat.current) || {};
        var picker = resolveModelPicker(cat, current);
        var sameProvider = (current.provider || "") === picker.provider;
        return {
          provider: picker.provider,
          model: sameProvider ? current.model || "" : "",
          reasoningEffort: current.reasoningEffort || "",
          maxDepth: current.maxDepth || 2,
        };
      }

      function load() {
        setLoading(true);
        setError(null);
        fetch(PREFIX + "/__api__/models", { cache: "no-store" })
          .then(function (response) {
            return response.json();
          })
          .then(function (payload) {
            setLoading(false);
            if (!payload || payload.ok !== true) {
              setError((payload && payload.error) || "读取模型清单失败");
              return;
            }
            setCatalog(payload.catalog);
            // An unconfigured install has an empty saved provider/model. The
            // draft must still open a USABLE picker: `resolveModelPicker` names
            // the provider to show (the first one with models) and the model is
            // kept only when it belongs to that provider — the previous revision
            // seeded both from the saved route verbatim, which left 模型 with
            // nothing to choose from until the provider was switched by hand.
            // Saving still needs an explicit click; nothing here is persisted.
            setDraft(draftFromCatalog(payload.catalog));
          })
          .catch(function (err) {
            setLoading(false);
            setError(String(err && err.message ? err.message : err));
          });
      }

      // The settings surface IS the form, so it loads on mount. The panel card
      // stays lazy — opening the drawer must not fan out into a catalog request
      // (which walks every provider's model list) for a setting most visits do
      // not touch.
      React.useEffect(
        function () {
          if (settingsMode) load();
        },
        [],
      );

      var shown = draft || active;
      // "Configured" means a route is SAVED, not merely drafted: the chip and
      // the toggle button key off the persisted value while the draft is what
      // the form edits.
      var isConfigured = !!(active && active.provider && active.model);
      // The two pickers, resolved together: `picker.provider` is the provider
      // the 模型 list actually belongs to (the saved one when it exists, else
      // the first provider that advertises models), and `shownModel` drops a
      // saved model id that belongs to a provider no longer in play — saving
      // such a pair is accepted by the host (an unknown model id resolves to
      // itself), so the form must not be able to send it.
      var picker = resolveModelPicker(catalog, shown);
      var draftProvider = shown && shown.provider ? shown.provider : "";
      var shownModel = picker.provider === draftProvider ? (shown && shown.model) || "" : "";
      // What the pickers RENDER is the draft's business, but what the notices
      // REPORT is the SAVED route's fate: `load()` has already corrected the
      // draft, so asking `picker` would hide the one fact worth stating — that
      // the persisted provider is not in the catalog the host is serving.
      var savedPicker = resolveModelPicker(catalog, catalog && catalog.current ? catalog.current : shown);
      var efforts = catalog && catalog.efforts ? catalog.efforts : ["minimal", "low", "medium", "high", "max"];

      function field(label, value, onChange, options) {
        return React.createElement(
          "label",
          { className: "pmb-phases", style: { gap: "6px" }, key: label },
          React.createElement("span", { className: "pmb-sub" }, label),
          React.createElement(
            "select",
            {
              className: "pmb-btn pmb-select",
              value: value || "",
              disabled: view.busy || !catalog,
              onChange: function (event) {
                onChange(event.target.value);
              },
            },
            options,
          ),
        );
      }

      var providerOptions = picker.providerOptions.map(function (option) {
        return React.createElement("option", { key: option.id, value: option.id }, option.label);
      });
      var modelOptions = picker.modelOptions.map(function (option) {
        return React.createElement("option", { key: option.id, value: option.id }, option.label);
      });
      var effortOptions = [React.createElement("option", { key: "default", value: "" }, "（模型默认档）")].concat(
        efforts.map(function (effort) {
          return React.createElement("option", { key: effort, value: effort }, effort);
        }),
      );

      var children = [
        React.createElement("div", { className: "pmb-h", key: "h" }, settingsMode ? "专家模型（首次使用前必须配置）" : "专家模型（插件设置）"),
        React.createElement(
          "div",
          { className: "pmb-legend", key: "l" },
          settingsMode
            ? "总控（总控模式）派出的专家 Agent 跑在哪个 服务商/模型 上。插件不预设任何模型 —— 没配置之前，subagent_expert 派发会被直接拒绝并说明原因。"
            : "总控派出的专家 Agent 跑在哪个模型上 —— 插件不预设任何模型，由你在这里定。完整设置同样在「设置 → 专家模型」里。",
        ),
      ];

      // On the settings surface the CARD is just a container for the form —
      // there is no chip, no 更改/收起 toggle and no route line, because the form
      // itself is the content and the reader is already where the setting lives.
      var panelChrome = !settingsMode
        ? React.createElement(
            "div",
            { className: "pmb-res-top" },
            React.createElement("span", { className: "pmb-res-n" }, "专家（subagent_expert）"),
            isConfigured
              ? React.createElement(
                  "span",
                  { className: "pmb-chip solid s-running" },
                  active.provider + "/" + active.model + (active.reasoningEffort ? "@" + active.reasoningEffort : "@模型默认档"),
                )
              : React.createElement(
                  "span",
                  { className: "pmb-chip s-blocked" },
                  "未配置",
                ),
            React.createElement("span", { className: "pmb-spacer" }),
            React.createElement(
              "button",
              {
                type: "button",
                className: "pmb-btn" + (isConfigured ? "" : " primary"),
                disabled: loading,
                onClick: function () {
                  if (open === false) {
                    setOpen(true);
                    load();
                    return;
                  }
                  setOpen(false);
                },
              },
              open ? (catalog === null ? (loading ? "读取中…" : "更改") : "收起") : "更改",
            ),
          )
        : null;

      if (!settingsMode) {
        children.push(
          React.createElement(
            "div",
            { className: "pmb-task-body", key: "route" },
            "当前路由：" +
              (isConfigured
                ? active.provider + "/" + active.model + (active.reasoningEffort ? "@" + active.reasoningEffort : "@模型默认档")
                : "未配置"),
          ),
        );
      }

      children.push(
        React.createElement(
          "div",
          { className: "pmb-res", key: "card" },
          panelChrome,
          React.createElement(
            "div",
            { className: "pmb-task-body" },
            "maxDepth " + String((shown && shown.maxDepth) || 2) + "（绝对层级上限：总控 0 → 专家 1 → 专家的助手 2）",
          ),
          open && catalog === null
            ? React.createElement(
                "div",
                { className: "pmb-task-body pmb-t-muted" },
                loading ? "读取模型清单中…" : "模型清单尚未读取。",
              )
            : null,
          open && catalog !== null
            ? React.createElement(
                "div",
                { className: "pmb-phases", style: { flexWrap: "wrap" } },
                field("服务商", picker.provider, function (value) {
                  setDraft({ provider: value, model: "", reasoningEffort: "max", maxDepth: shown.maxDepth });
                }, providerOptions),
                field("模型", shownModel, function (value) {
                  setDraft({
                    provider: picker.provider,
                    model: value,
                    reasoningEffort: shown.reasoningEffort,
                    maxDepth: shown.maxDepth,
                  });
                }, [React.createElement("option", { key: "none", value: "" }, "（选一个）")].concat(modelOptions)),
                field("思考强度", shown.reasoningEffort, function (value) {
                  setDraft({
                    provider: picker.provider,
                    model: shownModel,
                    reasoningEffort: value,
                    maxDepth: shown.maxDepth,
                  });
                }, effortOptions),
                field(
                  "maxDepth",
                  String(shown.maxDepth || 2),
                  function (value) {
                    setDraft({
                      provider: picker.provider,
                      model: shownModel,
                      reasoningEffort: shown.reasoningEffort,
                      maxDepth: Number(value),
                    });
                  },
                  [1, 2, 3, 4, 5].map(function (depth) {
                    return React.createElement("option", { key: depth, value: String(depth) }, String(depth));
                  }),
                ),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "pmb-btn",
                    disabled: loading,
                    // The host neither pushes catalog changes here nor re-reads
                    // on its own: without this, a provider that appears (or a
                    // model list that fails once) can only be picked up by
                    // re-mounting the surface.
                    title: "重新拉取服务商与模型清单",
                    onClick: function () {
                      setNote(null);
                      load();
                    },
                  },
                  loading ? "读取中…" : "重新读取模型清单",
                ),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "pmb-btn primary",
                    disabled: view.busy || loading || !picker.provider || !shownModel,
                    onClick: function () {
                      setNote(null);
                      setError(null);
                      manage({
                        action: "set-expert-model",
                        provider: picker.provider,
                        model: shownModel,
                        reasoningEffort: shown.reasoningEffort,
                        maxDepth: shown.maxDepth,
                      }).then(
                        function (result) {
                          setNote(result.note || "已保存");
                          // Keep the form's baseline in step with what was just
                          // written: `catalog.current` is what the next load
                          // seeds the draft from, and the panel's chip reads the
                          // board payload rather than this form.
                          setCatalog(function (previous) {
                            if (previous === null) return previous;
                            var next = {};
                            for (var key in previous) if (Object.prototype.hasOwnProperty.call(previous, key)) next[key] = previous[key];
                            next.current = {
                              provider: picker.provider,
                              model: shownModel,
                              reasoningEffort: shown.reasoningEffort,
                              maxDepth: shown.maxDepth,
                            };
                            next.configured = true;
                            return next;
                          });
                          setDraft({
                            provider: picker.provider,
                            model: shownModel,
                            reasoningEffort: shown.reasoningEffort,
                            maxDepth: shown.maxDepth,
                          });
                          if (!settingsMode) refresh(view.sessionId, view.windowMs, view.allBoards);
                          if (onSaved !== undefined) onSaved();
                        },
                        function (err) {
                          setError(String(err && err.message ? err.message : err));
                        },
                      );
                    },
                  },
                  "保存",
                ),
              )
            : null,
          open && savedPicker.hint !== ""
            ? React.createElement(
                "div",
                { className: savedPicker.hintKind === "warn" ? "pmb-note warn" : "pmb-legend" },
                (savedPicker.hintKind === "warn" ? "⚠ " : "ℹ ") + savedPicker.hint,
              )
            : null,
          open && picker.emptyNote !== ""
            ? React.createElement("div", { className: "pmb-note warn" }, "⚠ " + picker.emptyNote)
            : null,
          catalog !== null && catalog.resolveError
            ? React.createElement(
                "div",
                { className: "pmb-note warn" },
                "⚠ 当前路由无法解析：" + catalog.resolveError,
              )
            : null,
          catalog !== null && catalog.configured === false
            ? React.createElement(
                "div",
                { className: "pmb-note warn" },
                "⚠ 还没配置：插件不预设模型，选好 服务商 + 模型 再点保存。保存之前 subagent_expert 派发会被直接拒绝（已开着的会话不受影响，路由是每次派发实时读的）。",
              )
            : null,
          catalog !== null && catalog.available === false
            ? React.createElement(
                "div",
                { className: "pmb-note warn" },
                "⚠ " + catalog.reason,
              )
            : null,
        ),
      );

      if (note) {
        children.push(React.createElement("div", { className: "pmb-note ok", key: "note" }, "✅ " + note));
      }
      if (error) {
        children.push(React.createElement("div", { className: "pmb-note err", key: "err" }, "❌ " + error));
      }
      // The settings section renders this same form, and THERE it is the whole
      // page — a trailing "环境令牌（总控持有与转交）" heading would announce a
      // section that does not follow it on that surface.
      if (!settingsMode) {
        children.push(React.createElement("div", { className: "pmb-h", key: "rh" }, "环境令牌（总控持有与转交）"));
      }
      return children;
    }

    // ── the same setting as a DSH Settings section ───────────────────────
    //
    // Why a section and not just the panel card: the expert route is a
    // DEPLOYMENT-level value (which model every dispatched expert runs on), set
    // once and then left alone — and the board panel is only reachable from a
    // session header, which a fresh session does not have until it has work. A
    // setting you cannot reach before the first dispatch is a setting that gets
    // configured by editing JSON. Hence: 设置 → 专家模型, beside 模型 / 插件 /
    // Agent 预设, with the panel card kept as the in-context view.
    var expertModelLoaded = false;

    function ExpertModelSettings() {
      var pair = React.useState(false);
      var loaded = pair[0];
      var setLoaded = pair[1];
      function markLoaded() {
        expertModelLoaded = true;
        setLoaded(true);
      }
      // Keep the drawer in step when it happens to be open beside the settings
      // dialog: the card reads the route from the board payload, so a save here
      // must refresh it rather than leave it showing the previous route.
      function refreshOpenBoard() {
        if (!store.open) return;
        setState({ nonce: store.nonce + 1 });
        refresh(store.sessionId, store.windowMs, store.allBoards);
      }
      return React.createElement(
        "div",
        { className: "pmb-settings-section" },
        React.createElement(
          "div",
          { className: "pmb-legend" },
          "这个会话的插件设置：点「读取模型清单」→ 选 服务商 / 模型 / 思考强度 / maxDepth → 保存。写入 $DSH_HOME/pm-mode/settings.json，由插件在所有会话里共用。",
        ),
        // Lazily mounted: each mount walks every provider's model list, so it
        // happens on the first click and then STAYS mounted — unmounting would
        // re-fetch on every visit and drop an in-progress draft.
        loaded
          ? React.createElement(ExpertModelForm, { view: null, mode: "settings", onSaved: refreshOpenBoard })
          : React.createElement(
              "button",
              {
                type: "button",
                className: "pmb-btn primary",
                onClick: markLoaded,
              },
              "读取模型清单",
            ),
      );
    }

    // ── resources tab ────────────────────────────────────────────────────

    function ResourcesTab(props) {
      var state = props.state;
      var data = state.data;
      if (!data) return null;
      var resources = data.resources || [];
      var children = [].concat(ExpertModelCard(props));
      children.push(
        React.createElement(
          "div",
          { className: "pmb-legend", key: "hint" },
          "本机的独占资源（环境、长驻服务、构建槽）用看板当排他锁：任一时刻只允许一个持有者，转交必须显式。",
        ),
      );
      if (resources.length === 0) {
        children.push(
          React.createElement(
            "div",
            { className: "pmb-none", key: "empty" },
            "还没有声明共享资源。用 pm_mode action=define-resource 声明（例如 shared-env、build-slot、device-farm）。",
          ),
        );
      }
      for (var index = 0; index < resources.length; index += 1) {
        var resource = resources[index];
        var held = resource.holder !== null;
        children.push(
          React.createElement(
            "div",
            { className: "pmb-res", key: resource.id },
            React.createElement(
              "div",
              { className: "pmb-res-top" },
              React.createElement("span", { className: "pmb-res-n" }, resource.label),
              React.createElement("span", { className: "pmb-task-id" }, resource.id),
              React.createElement(
                "span",
                { className: "pmb-chip" + (held ? " solid s-blocked" : "") },
                held ? "占用中" : "空闲",
              ),
              React.createElement("span", { className: "pmb-spacer" }),
              held
                ? React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "pmb-btn",
                      disabled: state.busy,
                      title: "仅在该持有者已确认结束、或它卡死需要人工解锁时使用",
                      onClick: function () {
                        if (!window.confirm("强制释放「" + resource.label + "」？\n只有在持有者已确认结束或已卡死时才这么做。")) return;
                        manage({ action: "release-resource", boardId: data.boardId, id: resource.id }).then(function () {
                          refresh(state.sessionId, state.windowMs, state.allBoards);
                        });
                      },
                    },
                    "强制释放",
                  )
                : null,
              !held && (resource.queue || []).length > 0
                ? React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "pmb-btn primary",
                      disabled: state.busy,
                      onClick: function () {
                        manage({ action: "grant-next", boardId: data.boardId, id: resource.id }).then(function () {
                          refresh(state.sessionId, state.windowMs, state.allBoards);
                        });
                      },
                    },
                    "转交队首",
                  )
                : null,
            ),
            React.createElement(
              "div",
              { className: "pmb-task-body" },
              held
                ? "持有者 " +
                    (resource.holder.label || resource.holder.sessionId) +
                    " ｜ 自 " +
                    fmtSeconds(resource.holder.since) +
                    "（" +
                    humanDuration(Date.now() - resource.holder.since) +
                    "）｜ 任务 " +
                    (resource.holder.taskId || "-")
                : "当前无人持有",
            ),
            (resource.queue || []).length > 0
              ? React.createElement(
                  "div",
                  { className: "pmb-task-body" },
                  "排队：" +
                    resource.queue
                      .map(function (entry) {
                        return (entry.label || entry.sessionId) + "（等 " + humanDuration(Date.now() - entry.since) + "）";
                      })
                      .join(" → "),
                )
              : null,
          ),
        );
      }
      return React.createElement("div", null, children);
    }

    // ── metrics tab ──────────────────────────────────────────────────────

    function MetricsTab(props) {
      var state = props.state;
      var data = state.data;
      if (!data) return null;
      var metrics = data.metrics;
      var maxHour = Math.max.apply(
        null,
        metrics.timelineByHour.concat([1]),
      );
      var children = [
        React.createElement(
          "div",
          { className: "pmb-stats", key: "stats" },
          stat("任务总数", metrics.total, "本看板"),
          stat("完成", metrics.done, "条线"),
          stat("失败/取消", metrics.failed, "条线"),
          stat("平均用时", humanDuration(metrics.avgMs), "已结束任务"),
        ),
        React.createElement("div", { className: "pmb-h", key: "sparkh" }, "最近 24 小时工具调用分布（每格 1 小时）"),
        React.createElement(
          "div",
          { className: "pmb-spark", key: "spark" },
          metrics.timelineByHour.map(function (count, index) {
            return React.createElement("i", {
              key: index,
              style: { height: Math.max(2, Math.round((count / maxHour) * 50)) + "px" },
              title: (23 - index) + " 小时前：" + count + " 次",
            });
          }),
        ),
      ];
      if (metrics.byPhase.length > 0) {
        children.push(React.createElement("div", { className: "pmb-h", key: "phaseh" }, "阶段耗时（哪一类工作最吃时间）"));
        children.push(
          React.createElement(
            "table",
            { className: "pmb-table", key: "phase" },
            React.createElement(
              "thead",
              null,
              React.createElement("tr", null, React.createElement("th", null, "阶段"), React.createElement("th", { className: "num" }, "次数"), React.createElement("th", { className: "num" }, "累计")),
            ),
            React.createElement(
              "tbody",
              null,
              metrics.byPhase.map(function (phase) {
                return React.createElement(
                  "tr",
                  { key: phase.name },
                  React.createElement("td", null, phase.name),
                  React.createElement("td", { className: "num" }, phase.count),
                  React.createElement("td", { className: "num" }, humanDuration(phase.ms)),
                );
              }),
            ),
          ),
        );
      }
      if (metrics.byKind.length > 0) {
        children.push(React.createElement("div", { className: "pmb-h", key: "kindh" }, "任务类型"));
        children.push(
          React.createElement(
            "table",
            { className: "pmb-table", key: "kind" },
            React.createElement(
              "thead",
              null,
              React.createElement(
                "tr",
                null,
                React.createElement("th", null, "类型"),
                React.createElement("th", { className: "num" }, "总数"),
                React.createElement("th", { className: "num" }, "完成"),
                React.createElement("th", { className: "num" }, "未完成"),
              ),
            ),
            React.createElement(
              "tbody",
              null,
              metrics.byKind.map(function (kind) {
                return React.createElement(
                  "tr",
                  { key: kind.kind },
                  React.createElement("td", null, kind.kind),
                  React.createElement("td", { className: "num" }, kind.total),
                  React.createElement("td", { className: "num" }, kind.done),
                  React.createElement("td", { className: "num" }, kind.open + kind.failed),
                );
              }),
            ),
          ),
        );
      }
      if (metrics.tools.length > 0) {
        children.push(React.createElement("div", { className: "pmb-h", key: "toolh" }, "最耗时的工具（本窗口内所有子 Agent 合计）"));
        children.push(
          React.createElement(
            "table",
            { className: "pmb-table", key: "tools" },
            React.createElement(
              "thead",
              null,
              React.createElement(
                "tr",
                null,
                React.createElement("th", null, "工具"),
                React.createElement("th", { className: "num" }, "调用"),
                React.createElement("th", { className: "num" }, "累计"),
                React.createElement("th", { className: "num" }, "平均"),
              ),
            ),
            React.createElement(
              "tbody",
              null,
              metrics.tools.map(function (tool) {
                return React.createElement(
                  "tr",
                  { key: tool.tool },
                  React.createElement("td", null, tool.tool),
                  React.createElement("td", { className: "num" }, tool.count),
                  React.createElement("td", { className: "num" }, humanDuration(tool.ms)),
                  React.createElement("td", { className: "num" }, humanDuration(tool.ms / Math.max(tool.count, 1))),
                );
              }),
            ),
          ),
        );
      }
      return React.createElement("div", null, children);
    }

    // ── drawer ───────────────────────────────────────────────────────────

    function Overlay() {
      var state = useStore();

      React.useEffect(
        function () {
          if (!state.open) return undefined;
          var timer = setInterval(function () {
            // Follow the conversation: a drawer left open while the reader moves
            // to another session must switch to THAT session's board instead of
            // keeping the one it was opened on. A detected switch refreshes the
            // new board and skips this tick's normal poll, so one session change
            // costs one round trip.
            var sync = syncSession();
            if (sync.changed) {
              refresh(sync.target, store.windowMs, store.allBoards);
              return;
            }
            refresh(store.sessionId, store.windowMs, store.allBoards);
          }, 1500);
          return function () {
            clearInterval(timer);
          };
        },
        [state.open],
      );

      React.useEffect(
        function () {
          if (!state.open) return undefined;
          var onKey = function (event) {
            if (event.key === "Escape") setState({ open: false });
          };
          window.addEventListener("keydown", onKey);
          return function () {
            window.removeEventListener("keydown", onKey);
          };
        },
        [state.open],
      );

      if (!state.open) return null;
      var data = state.data;

      var tabBar = React.createElement(
        "div",
        { className: "pmb-tabs" },
        TABS.map(function (tab) {
          return React.createElement(
            "button",
            {
              key: tab.id,
              type: "button",
              className: "pmb-btn" + (state.tab === tab.id ? " on" : ""),
              onClick: function () {
                setState({ tab: tab.id });
              },
            },
            tab.label,
          );
        }),
        React.createElement("span", { className: "pmb-spacer" }),
        WINDOWS.map(function (item) {
          return React.createElement(
            "button",
            {
              key: item.ms,
              type: "button",
              className: "pmb-btn" + (state.windowMs === item.ms ? " on" : ""),
              onClick: function () {
                setState({ windowMs: item.ms });
                refresh(store.sessionId, item.ms, store.allBoards);
              },
            },
            item.label,
          );
        }),
        React.createElement(
          "button",
          {
            type: "button",
            className: "pmb-btn" + (state.followLive ? " on" : ""),
            title: state.followLive
              ? "正在跟随当前会话：切换会话时面板自动切到那个会话的看板；点一下可钉住手上这块"
              : "已钉住这块看板（不会跟着切会话）；点一下回到跟随当前会话",
            onClick: function () {
              var next = !state.followLive;
              setState({ followLive: next, boards: null });
              if (next) {
                var live = syncSession();
                refresh(live.target, store.windowMs, false);
                return;
              }
              // Pin: hand the picker back so a one-click switch is always
              // reachable, including the jump back to the live conversation.
              refreshBoards();
            },
          },
          state.followLive ? "🔗 跟随会话" : "📌 已钉住",
        ),
        React.createElement(
          "button",
          {
            type: "button",
            className: "pmb-btn" + (state.allBoards ? " on" : ""),
            title: "在「只看本会话」和「列出所有看板」之间切换",
            onClick: function () {
              var next = !state.allBoards;
              setState({ allBoards: next, boards: next ? state.boards : null });
              if (next) refreshBoards();
            },
          },
          "全部看板",
        ),
      );

      var boardPicker = null;
      if (state.allBoards && state.boards) {
        boardPicker = React.createElement(
          "div",
          { className: "pmb-tabs" },
          React.createElement("span", { className: "pmb-sub" }, "本机看板："),
          state.boards.length === 0
            ? React.createElement("span", { className: "pmb-sub" }, "（无）")
            : state.boards.map(function (board) {
                return React.createElement(
                  "button",
                  {
                    key: board.boardId,
                    type: "button",
                    className: "pmb-btn" + (data && data.boardId === board.boardId ? " on" : ""),
                    title: board.boardId + " ｜ 更新 " + fmtTime(board.mtime),
                    onClick: function () {
                      // An explicit pick, so stop following the conversation —
                      // otherwise the next poll would snap straight back to the
                      // board the reader just navigated away from.
                      setState({ followLive: false, allBoards: false, boards: null });
                      rememberSession(board.boardId);
                      refresh(board.boardId, store.windowMs, false);
                    },
                  },
                  (board.title || board.boardId).slice(0, 24) + "（" + (board.counts.active || 0) + "）",
                );
              }),
        );
      }

      var body = null;
      if (state.error !== null) {
        body = React.createElement(
          "div",
          { className: "pmb-none pmb-t-warn" },
          state.error,
        );
      } else if (data === null) {
        body = React.createElement("div", { className: "pmb-none" }, "读取看板中…");
      } else if (data.summary.counts.total === 0) {
        // The same answer on EVERY tab: this board has no tasks, so the empty
        // board — not an empty chart, not an empty table — is the content, and
        // it must point at the boards that do have work.
        body = emptyBoardState(
          state,
          "这个会话的看板还没有任务：从这里派单时用 pm_task action=create 建线，看板才会跟着动起来。",
        );
      } else if (state.tab === "gantt") {
        body = React.createElement(GanttTab, { state: state });
      } else if (state.tab === "experts") {
        body = React.createElement(ExpertsTab, { state: state });
      } else if (state.tab === "tasks") {
        body = React.createElement(TasksTab, { state: state });
      } else if (state.tab === "resources") {
        body = React.createElement(ResourcesTab, { state: state });
      } else {
        body = React.createElement(MetricsTab, { state: state });
      }

      return React.createElement(
        "div",
        { className: "pmb-panel" + (state.wide ? " wide" : "") },
        React.createElement(
          "div",
          { className: "pmb-head" },
          React.createElement("span", { className: "pmb-title" }, "📋 项目看板"),
          React.createElement(
            "span",
            { className: "pmb-sub" },
            data === null
              ? "读取中…"
              : (data.title || data.boardId) +
                  " ｜ 任务 " +
                  data.summary.counts.total +
                  " ｜ Agent " +
                  data.summary.agentCount +
                  " ｜ " +
                  fmtTime(data.updatedAt),
          ),
          React.createElement("span", { className: "pmb-spacer" }),
          React.createElement(
            "button",
            {
              type: "button",
              className: "pmb-btn",
              title: state.wide ? "还原宽度" : "铺满全宽",
              onClick: function () {
                setState({ wide: !state.wide });
              },
            },
            state.wide ? "↙ 还原" : "↔ 全宽",
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "pmb-btn",
              title: "立刻重新读取",
              onClick: function () {
                refresh(store.sessionId, store.windowMs, store.allBoards);
              },
            },
            "⟳",
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "pmb-btn",
              title: "关闭（Esc）",
              onClick: function () {
                setState({ open: false });
              },
            },
            "✕",
          ),
        ),
        tabBar,
        boardPicker,
        state.loading ? React.createElement("div", { className: "pmb-none" }, "刷新中…") : null,
        React.createElement("div", { className: "pmb-body" }, body),
      );
    }

    // ── tool cards ───────────────────────────────────────────────────────

    function blockText(block) {
      if (!block) return "";
      var content = block.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content
          .map(function (item) {
            return item && item.type === "text" ? item.text : "";
          })
          .filter(Boolean)
          .join("\n");
      }
      return "";
    }

    function ToolCard(props) {
      var text = blockText(props.block);
      if (!text) {
        return React.createElement(
          "div",
          { className: "pmb-card" },
          React.createElement("div", { className: "pmb-card-t" }, "📋 " + props.toolName + " 执行中…"),
        );
      }
      var first = text.split("\n")[0] || "";
      var rest = text.split("\n").slice(1).join("\n");
      var failed = text.indexOf("❌") === 0 || text.indexOf("❌") >= 0;
      return React.createElement(
        "div",
        { className: "pmb-card" + (failed ? " fail" : "") },
        React.createElement("div", { className: "pmb-card-t" }, "📋 " + (first.length > 120 ? first.slice(0, 120) + "…" : first)),
        rest ? React.createElement("pre", { className: "pmb-pre" }, rest) : null,
        React.createElement(
          "div",
          { className: "pmb-phases" },
          React.createElement(
            "button",
            {
              type: "button",
              className: "pmb-btn primary",
              onClick: function () {
                openPanel(props.sessionId, null);
              },
            },
            "在面板中打开",
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "pmb-btn",
              onClick: function () {
                window.open(PREFIX + "/__health__", "_blank", "noopener");
              },
            },
            "服务自检",
          ),
        ),
      );
    }

    // ── registration ─────────────────────────────────────────────────────

    function apply(ctx) {
      var slots = ctx.slots;

      slots.inject("conversation.session.header.actions", function () {
        return slots.register(
          {
            name: "conversation.session.header.actions",
            id: "pm-mode-button",
            order: 20,
            label: "项目看板按钮",
          },
          function (props) {
            return React.createElement(HeaderButton, { sessionId: props.sessionId });
          },
        );
      });

      slots.inject("shell.overlay", function () {
        return slots.register(
          {
            name: "shell.overlay",
            id: "pm-mode-overlay",
            order: 0,
            label: "项目看板面板",
          },
          function () {
            return React.createElement(Overlay, null);
          },
        );
      });

      // The expert route is a deployment setting, so it also lives where
      // deployment settings live — reachable without a session that has a board.
      // `order: 25` puts it after Agent 预设 (20) and before nothing in
      // particular: the section list is append-only, so a fresh id adds a row
      // beside the shipped ones instead of replacing one.
      slots.inject("settings.section", function () {
        return slots.register(
          {
            name: "settings.section",
            id: "pm-mode-expert",
            order: 25,
            label: "专家模型",
          },
          function () {
            return React.createElement(ExpertModelSettings, null);
          },
        );
      });

      var names = ["pm_mode", "pm_task", "pm_agent"];
      slots.inject("tool.call.toolview", function () {
        var disposers = [];
        for (var index = 0; index < names.length; index += 1) {
          (function (toolName) {
            disposers.push(
              slots.register({ name: "tool.call.toolview", key: toolName }, function (props) {
                return React.createElement(ToolCard, {
                  block: props.block,
                  sessionId: props.sessionId,
                  toolName: toolName,
                });
              }),
            );
          })(names[index]);
        }
        return function () {
          for (var d = 0; d < disposers.length; d += 1) disposers[d]();
        };
      });
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  },
});
