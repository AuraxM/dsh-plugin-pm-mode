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

/** Semantic colors, matching the deployment's other panels. */
export const COLORS = {
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

function pad(value) {
  return value < 10 ? "0" + value : String(value);
}

/** `14:05` — the chart's tick label. */
export function clockOf(ms) {
  const date = new Date(ms);
  return pad(date.getHours()) + ":" + pad(date.getMinutes());
}

/** `3h20m` / `12m` / `45s` — a duration a human reads at a glance. */
export function humanDuration(ms) {
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

/** Status → the small colored chip a lane header and a task card share. */
export function StatusChip(React, status) {
  const color = COLORS[status] ?? COLORS.planned;
  return React.createElement(
    "span",
    { className: "pmb-chip solid", style: { background: color } },
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
export function createGanttView({ React, fmtTime, onSelectTask }) {
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
          elapsed > 0 ? React.createElement("span", null, humanDuration(elapsed)) : null,
          lane.agents === undefined ? null : null,
        ),
        lane.blockedReason
          ? React.createElement(
              "div",
              { className: "pmb-lane-m", style: { color: COLORS.blocked } },
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

    if (gantt.orphans.length > 0) {
      const rows = gantt.orphans.map((orphan) =>
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
            { className: "pmb-lane-track", style: { minHeight: Math.max(34, gantt.orphans.length * 28 + 12) } },
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
        "最近 " + humanDuration(span) + " 内没有任务或执行记录。让 PM 调 pm_task action=create 建线，并 pm_agent action=bind 绑定子 Agent。",
      );
    }

    return React.createElement("div", { className: "pmb-gantt" }, axis, lanes);
  }

  return Gantt;
}
