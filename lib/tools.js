/**
 * PM Mode — the model-facing tool factory.
 *
 * The tools are built here rather than in `index.js` so the preset row that
 * publishes them stays a two-line composition, and so the same factory can be
 * exercised from a standalone smoke test.
 *
 * Three tools cover the whole surface. One tool per verb would bloat the PM's
 * tool catalog and its context; the action discriminator keeps the model's
 * menu short while the parameter schema teaches the valid combinations.
 *
 * EVERY definition is returned through `defineTool`, and that is load-bearing
 * rather than stylistic. `ToolRuntime.register()` validates only the OUTPUT
 * schema, while `schemaOf()` copies `definition.parameters` verbatim into the
 * schema the model provider receives. A hand-written definition carrying the
 * parameter DSL therefore reaches the provider as-is — where
 * `{ action: { type: 'string' } }` has no root `type`, producing exactly:
 *
 *   Invalid schema for function 'pm_agent': schema must be a JSON Schema of
 *   'type: "object"', got 'type: null'.
 *
 * `defineTool` is the step that compiles that DSL through
 * `parameterSchemaSpecToJsonSchema`. Building a definition any other way
 * registers without complaint and then fails at the first model call, which is
 * why `scripts/check-tools.mjs` asserts on the projected schema rather than on
 * registration.
 *
 * @module dsh-pm-mode/tools
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import { TASK_STATUS, TERMINAL_STATUS } from "./store.js";

const PM_TOOL_NAMES = ["pm_mode", "pm_task", "pm_agent"];

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return minutes + "m";
  return hours + "h" + String(minutes).padStart(2, "0") + "m";
}

function fmtClock(ms) {
  if (!ms) return "-";
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, "0");
  return pad(date.getHours()) + ":" + pad(date.getMinutes());
}

function fmtStamp(ms) {
  if (!ms) return "-";
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, "0");
  return (
    (date.getMonth() + 1) + "-" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes())
  );
}

/**
 * Build the three tool definitions.
 *
 * @param {object} options
 * @param {import('./store.js').BoardStore} options.store
 * @param {{ liveStatus: () => Record<string, string> }} options.collector
 * @param {() => object | undefined} [options.subagents] resolves the live
 *   `subagents` registry lazily — the host service may not exist in a
 *   deployment that composes no delegation backend, and the tool must degrade
 *   to "board-only" rather than fail.
 */
export function createPmTools({ store, collector, subagents }) {
  /** Every call resolves the calling session's own board. */
  function boardOf(exec) {
    const sessionId = exec !== undefined && exec.agent !== undefined ? String(exec.agent.id) : "";
    if (sessionId === "") throw new Error("pm: 无法确定当前会话（工具调用没有 agent 上下文）");
    const board = store.open(sessionId);
    board.sessionId = sessionId;
    return board;
  }

  function sessionIdOf(exec) {
    return exec !== undefined && exec.agent !== undefined ? String(exec.agent.id) : "";
  }

  // ────────────────────────────────────────────────────────────────────────
  // pm_mode — read the board, journal a note
  // ────────────────────────────────────────────────────────────────────────

  const pmMode = {
    name: "pm_mode",
    description:
      "读取/记录你自己会话的项目看板（Gantt 与任务状态都在 Web GUI 的「项目看板」面板里）。" +
      'action="summary"：总览 —— 线程数、各状态计数、每条在办线的已耗时、**专家与领域**、共享资源令牌归属。开新一轮、或用户问「现在什么情况」时先读它。' +
      'action="tasks"：任务清单（status/kind/domainId 可过滤）。' +
      'action="experts"：专家花名册 —— 每个领域归哪个专家、它现在在办什么、累计跑了多久。派发新诉求前读它。' +
      'action="timeline"：最近窗口内每条线的执行片段，用来回答「过去哪些步骤花了多久」。' +
      'action="agents"：列出本会话登记的子 Agent 及其角色/领域/状态。' +
      'action="resources"：共享资源（Unity/私服/构建槽等）的持有者与排队。' +
      'action="define-resource"：声明一个独占资源（需 id，可选 label）。' +
      'action="grant"：**调度发放**令牌（需 id、sessionId；可选 taskId/holderLabel/note；force=true 强制从上一个持有者手里转交）。' +
      'action="revoke"：**调度收回**令牌（需 id；可选 note/promote=false 不自动转交队首）。' +
      'action="note"：往看板写一条备注（需 text，taskId 可选）。',
    parameters: {
      action: {
        type: "string",
        enum: ["summary", "tasks", "experts", "timeline", "agents", "resources", "define-resource", "grant", "revoke", "note"],
        required: true,
        description: "要读/写的视图",
      },
      status: { type: "string", description: "tasks 时按状态过滤（" + TASK_STATUS.join("/") + "）" },
      kind: { type: "string", description: "tasks 时按类型过滤（如 dev/bugfix/research/verify，类型不写死）" },
      domainId: { type: "string", description: "tasks 时按领域过滤" },
      includeDone: { type: "boolean", description: "tasks 时 true = 连已完成/失败/取消的一起列" },
      windowMs: { type: "number", description: "timeline 的时间窗口毫秒，默认 24 小时" },
      taskId: { type: "string", description: "note/grant 时归属的任务 id（可选）" },
      text: { type: "string", description: "note 的正文" },
      id: { type: "string", description: "define-resource/grant/revoke 的资源 id（如 unity、private-server、build-slot）" },
      label: { type: "string", description: "define-resource 的资源显示名" },
      sessionId: { type: "string", description: "grant 时把令牌交给哪个子 Agent" },
      holderLabel: { type: "string", description: "grant 时给持有者写的可读名字（默认用资源名）" },
      force: { type: "boolean", description: "grant 时 true = 从上一个持有者手里强制转交（仅当确认它已停手时使用）" },
      promote: { type: "boolean", description: "revoke 时 false = 不把令牌自动交给排队队首（默认自动转交）" },
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: String(value ?? "") }],
    },
    async execute(args, exec) {
      const board = boardOf(exec);
      try {
        switch (args.action) {
          case "summary":
            return renderSummary(board);
          case "tasks":
            return renderTasks(board, args);
          case "experts":
            return renderExperts(board);
          case "timeline":
            return renderTimeline(board, args.windowMs);
          case "agents":
            return renderAgents(board);
          case "resources":
            return renderResources(board);
          case "define-resource": {
            const resource = store.defineResource(board, { id: args.id, label: args.label });
            return `✅ 已声明资源「${resource.label}」（${resource.id}，排他）`;
          }
          case "grant": {
            const granted = store.grantResource(board, {
              id: args.id,
              sessionId: args.sessionId,
              taskId: args.taskId,
              holderLabel: args.holderLabel,
              note: args.text,
              force: args.force === true,
            });
            return (
              `✅ 令牌「${granted.resource.label}」已交给 ${String(args.sessionId).slice(0, 12)}` +
              (granted.previous === null ? "（此前空闲）" : `（原持有者 ${granted.previous.label || granted.previous.sessionId} 已转出）`) +
              `\n必须在任务书里写明「你已持有该令牌，用完必须报告释放」—— 子 Agent 不会自己知道。`
            );
          }
          case "revoke": {
            const revoked = store.revokeResource(board, { id: args.id, note: args.text, promote: args.promote !== false });
            if (revoked.released === null) return "（该资源本来就空闲）";
            return (
              `✅ 已收回令牌「${revoked.resource.label}」（原持有者 ${revoked.released.label || revoked.released.sessionId}）` +
              (revoked.next === null ? "，当前空闲" : `，已转交队首 ${revoked.next.label || revoked.next.sessionId}`) +
              `\n若该持有者可能仍在运行，请 send_message 明确告知「令牌已收回，立即停止一切环境操作」并等它确认。`
            );
          }
          case "note": {
            const note = store.addNote(board, { taskId: args.taskId ?? "", text: String(args.text ?? "") });
            store.flush(board);
            return `✅ 已记备注（${fmtStamp(note.at)}）${note.taskId ? " ｜ 任务 " + note.taskId : ""}\n${note.text}`;
          }
          default:
            return "未知 action: " + String(args.action);
        }
      } catch (error) {
        // A refused grant/revoke is a normal answer for a dispatcher ("it is
        // held by X, force or wait"), not a tool crash.
        return "❌ pm_mode 失败：" + String(error && error.message ? error.message : error);
      } finally {
        store.flush(board);
      }
    },
  };

  function renderSummary(board) {
    const summary = store.summary(board);
    const lines = [];
    lines.push(`📋 看板「${board.title}」 ｜ 任务 ${summary.counts.total}（活跃 ${summary.counts.total - summary.counts.done - summary.counts.failed - summary.counts.cancelled}）`);
    lines.push(
      `状态：` +
        TASK_STATUS.filter((status) => (summary.counts[status] ?? 0) > 0)
          .map((status) => `${status} ${summary.counts[status]}`)
          .join(" ｜ ") || "状态：无任务",
    );
    if (summary.domains.length > 0) {
      lines.push(`专家（${summary.domains.length} 位，领域归属以看板为准）：`);
      for (const expert of summary.domains) {
        const areas = expert.domains.length === 0 ? "未挂领域" : expert.domains.map((domain) => domain.name + "(" + domain.id + ")").join(" / ");
        const working = expert.openTasks.length === 0 ? "空闲" : "在办 " + expert.openTasks.map((task) => task.id).join(",");
        lines.push(
          `  - ${expert.sessionId.slice(0, 8)} ｜ ${expert.label || "(无标签)"} ｜ ${areas} ｜ ${working} ｜ 累计 ${fmtDuration(expert.totalMs)}`,
        );
      }
    } else {
      lines.push("专家：尚未登记任何领域（新诉求先 pm_agent action=domain 定义领域，再把领域登记给派出去的专家）。");
    }
    if (summary.active.length === 0) {
      lines.push("在办线：无（会话可以接收新指令）");
    } else {
      lines.push(`在办线 ${summary.active.length} 条：`);
      for (const task of summary.active) {
        const agents = task.agents.length === 0 ? "未绑定 Agent" : task.agents.map((id) => id.slice(0, 8)).join(",");
        lines.push(
          `  - [${task.status}] ${task.title}（${task.kind}${task.domainId ? " · " + task.domainId : ""}${task.phase ? " / " + task.phase : ""}）已耗时 ${fmtDuration(task.elapsedMs)} ｜ agents=${agents}` +
            (task.blockedReason ? ` ｜ 阻塞：${task.blockedReason}` : ""),
        );
      }
    }
    if (summary.resources.length > 0) {
      lines.push("共享资源：");
      for (const resource of summary.resources) {
        lines.push(
          `  - ${resource.label}：${resource.holder === null ? "空闲" : `被 ${resource.holder} 持有 ${fmtDuration(resource.heldMs)}`}` +
            (resource.queue.length > 0 ? ` ｜ 排队 ${resource.queue.join(" → ")}` : ""),
        );
      }
    } else {
      lines.push("共享资源：尚未声明（唯一一套 Unity + 私服建议先 pm_mode action=define-resource 声明 unity / private-server）。");
    }
    if (summary.agents.length > 0) {
      lines.push("Agent 活跃度（采集器实测）：");
      for (const agent of summary.agents) {
        lines.push(`  - ${agent.sessionId.slice(0, 8)}：${agent.active ? "运行中" : "空闲"} ｜ 累计 ${fmtDuration(agent.totalMs)}`);
      }
    }
    return lines.join("\n");
  }

  function renderExperts(board) {
    const experts = store.experts(board);
    const lines = [];
    if (experts.length === 0) {
      lines.push("（还没有登记专家。流程：pm_agent action=domain 定义领域 → 派一个子 Agent → pm_agent action=bind role=expert domainId=... 把领域登记给它。）");
      return lines.join("\n");
    }
    lines.push(`专家 ${experts.length} 位（按最近活动排序）：`);
    for (const expert of experts) {
      const areas = expert.domains.length === 0 ? "未挂领域" : expert.domains.map((domain) => `${domain.name}(${domain.id})`).join(" / ");
      lines.push(`\n- ${expert.sessionId} ｜ ${expert.label || "(无标签)"}`);
      lines.push(`  领域：${areas}`);
      lines.push(`  状态：${expert.active ? "运行中" : "空闲"} ｜ 已交付 ${expert.doneCount} 条 ｜ 累计 ${fmtDuration(expert.totalMs)}`);
      if (expert.openTasks.length > 0) {
        lines.push(`  在办：${expert.openTasks.map((task) => `${task.id}[${task.status}] ${task.title}`).join("；")}`);
      }
    }
    lines.push("");
    lines.push("派发纪律：一个用户诉求 = 一个专家 = 一条任务。专家的内部怎么分工由它自己决定；你只负责选人、发令牌、验收。");
    return lines.join("\n");
  }

  function renderTasks(board, args) {
    const includeDone = args.includeDone === true;
    const statusFilter = typeof args.status === "string" && args.status !== "" ? args.status : "";
    const kindFilter = typeof args.kind === "string" && args.kind !== "" ? args.kind : "";
    const domainFilter = typeof args.domainId === "string" && args.domainId !== "" ? args.domainId : "";
    const lines = [];
    for (const id of board.order) {
      const task = board.tasks[id];
      if (task === undefined) continue;
      if (!includeDone && TERMINAL_STATUS.has(task.status)) continue;
      if (statusFilter !== "" && task.status !== statusFilter) continue;
      if (kindFilter !== "" && task.kind !== kindFilter) continue;
      if (domainFilter !== "" && task.domainId !== domainFilter) continue;
      const phases =
        task.phases.length === 0
          ? ""
          : " ｜ 阶段 " + task.phases.map((phase) => `${phase.name}:${phase.status}`).join(" → ");
      lines.push(
        `- ${task.id} ｜ [${task.status}] ${task.title}（${task.kind}/${task.priority}${task.domainId ? " · " + task.domainId : ""}）` +
          (task.parentId ? ` ｜ 父任务 ${task.parentId}` : "") +
          (task.agents.length > 0 ? ` ｜ agents=${task.agents.map((item) => item.slice(0, 8)).join(",")}` : "") +
          phases +
          (task.blockedReason ? ` ｜ ⛔ ${task.blockedReason}` : ""),
      );
    }
    if (lines.length === 0) return "（没有匹配的任务）";
    return `任务清单（${lines.length} 条）\n` + lines.join("\n");
  }

  function renderTimeline(board, windowMs) {
    const gantt = store.gantt(board, { windowMs: typeof windowMs === "number" && windowMs > 0 ? windowMs : undefined });
    const lines = [`执行时间线（最近 ${fmtDuration(gantt.windowMs)}）`];
    if (gantt.lanes.length === 0 && gantt.orphans.length === 0) {
      lines.push("（这段时间没有记录到执行）");
      return lines.join("\n");
    }
    for (const lane of gantt.lanes) {
      lines.push(`【${lane.status}】${lane.title}（${lane.kind}）`);
      if (lane.rows.length === 0) {
        lines.push(`  （尚无 Agent 绑定的执行记录${lane.startedAt ? `，任务起于 ${fmtClock(lane.startedAt)}` : ""}）`);
        continue;
      }
      for (const row of lane.rows) {
        for (const span of row.spans) {
          const steps = span.tools
            .slice()
            .sort((left, right) => right.durMs - left.durMs)
            .slice(0, 6)
            .map((tool) => `${tool.tool || "?"} ${fmtDuration(tool.durMs)}`)
            .join("，");
          lines.push(
            `  ${row.label || row.sessionId.slice(0, 8)} ｜ ${fmtClock(span.start)}–${fmtClock(span.end)}（${fmtDuration(
              span.end - span.start,
            )}）${steps ? " ｜ 最耗时步骤：" + steps : ""}`,
          );
        }
      }
    }
    if (gantt.orphans.length > 0) {
      lines.push("未归属任何任务的 Agent（用 pm_agent bind 挂到任务上，否则看板只能把它们画在杂项泳道）：");
      for (const orphan of gantt.orphans) {
        const total = orphan.spans.reduce((sum, span) => sum + (span.end - span.start), 0);
        lines.push(`  - ${orphan.label || orphan.sessionId.slice(0, 8)} ｜ ${orphan.spans.length} 段 ｜ 累计 ${fmtDuration(total)}`);
      }
    }
    return lines.join("\n");
  }

  function renderAgents(board) {
    const lines = [];
    const bound = Object.values(board.agents);
    lines.push(`看板记录的 Agent（${bound.length}）`);
    for (const agent of bound) {
      const task = agent.taskId === "" ? "未绑定任务" : agent.taskId;
      const activity = activityTotal(board, agent.sessionId);
      lines.push(`- ${agent.sessionId} ｜ ${agent.label || "(无标签)"} ｜ ${task} ｜ 累计 ${fmtDuration(activity)}`);
    }
    if (bound.length === 0) lines.push("（还没有绑定的 Agent）");
    lines.push("");
    lines.push("提示：list_agents 能看到完整状态（running/idle/ready）。同方向的后续工作优先 send_message 续做；");
    lines.push("若某条线上下文最强但方向要变，用 subagent_fork 会继承你的对话；只有全新方向才开新 Agent。");
    return lines.join("\n");
  }

  function renderResources(board) {
    const resources = Object.values(board.resources);
    if (resources.length === 0) {
      return "（还没有定义共享资源。用 pm_mode action=define-resource 声明，例如 unity、private-server、build-slot）";
    }
    const at = Date.now();
    return resources
      .map((resource) => {
        const holder =
          resource.holder === null
            ? "空闲"
            : `${resource.holder.label || resource.holder.sessionId} 持有 ${fmtDuration(at - resource.holder.since)}（任务 ${resource.holder.taskId || "-"}）`;
        const queue = resource.queue.length === 0 ? "" : ` ｜ 排队：${resource.queue.map((item) => item.label || item.sessionId).join(" → ")}`;
        return `- ${resource.id}（${resource.label}）｜ ${holder}${queue}`;
      })
      .join("\n");
  }

  function activityTotal(board, sessionId) {
    let total = 0;
    let open = 0;
    for (const event of board.timeline) {
      if (event.sessionId !== sessionId) continue;
      if (event.kind === "agent-start" || event.kind === "session-start") open = event.at;
      else if ((event.kind === "agent-end" || event.kind === "session-end") && open !== 0) {
        total += event.at - open;
        open = 0;
      }
    }
    if (open !== 0) total += Date.now() - open;
    return total;
  }

  // ────────────────────────────────────────────────────────────────────────
  // pm_task — the task board itself
  // ────────────────────────────────────────────────────────────────────────

  const pmTask = {
    name: "pm_task",
    description:
      "维护看板上的任务。**一条任务 = 一个用户诉求**（或专家为它拆出的内部子线），不要把一个诉求拆成多条任务分给多个 Agent。" +
      "kind 与 phases 由你按实情写，不要被固定类型限制（探索/设计/实现/验证/修复是常见的一条开发流，但不是必须）。" +
      'action="create"：建任务（需 title；可选 goal/kind/priority/tags/phases/domainId/requestedBy/acceptance/parentId/dependsOn/boardId）。' +
      'requestedBy 写用户的原始诉求原文 —— 它就是派给专家的任务书。' +
      'boardId 仅专家内部使用：写你自己那块的 boardId，把你拆出的内部子线记到调度方的看板上（父任务用 parentId）。' +
      'action="update"：改任务（需 id）。status=blocked 时必须给 blockedReason。status 进 done/failed/cancelled 会停止计时。' +
      '改状态时会自动记录一次转移并写进时间线 —— 所以每次派发/回收结果后都要更新，看板才是真的。' +
      'action="phase"：推进某个阶段（需 id、phase，可选 status/note），阶段耗时会计入统计。' +
      'action="link"：在任务间建父子依赖（用 dependsOn）。' +
      'action="list"：等价于 pm_mode action=tasks。',
    parameters: {
      action: { type: "string", enum: ["create", "update", "phase", "link", "list"], required: true, description: "要执行的操作" },
      id: { type: "string", description: "任务 id（update/phase/link 必需；create 时可指定，便于引用）" },
      title: { type: "string", description: "任务标题（create 必需）" },
      goal: { type: "string", description: "目标：这条线要做成什么" },
      kind: {
        type: "string",
        description: "任务类型，自由文本，例如 dev / bugfix / research / design / verify / ops。不写死枚举。",
      },
      priority: { type: "string", description: "优先级：low / normal / high / urgent" },
      tags: { type: "array", items: { type: "string" }, description: "标签" },
      phases: { type: "array", items: { type: "string" }, description: "预置阶段名（create 时）" },
      phase: { type: "string", description: "phase 时的阶段名；update 时记录当前阶段" },
      status: {
        type: "string",
        enum: TASK_STATUS,
        description: "任务或阶段状态。" + TASK_STATUS.join("/"),
      },
      blockedReason: { type: "string", description: "status=blocked 时必需：卡在哪、等什么" },
      note: { type: "string", description: "本次变更的说明（会写进时间线）" },
      evidence: { type: "string", description: "验收证据：路径/命令/日志片段/复现步骤" },
      result: { type: "string", description: "结果结论" },
      acceptance: { type: "string", description: "验收标准" },
      domainId: { type: "string", description: "这条任务所属的领域 id（调度方按领域把后续同类诉求路由回同一个专家）" },
      requestedBy: { type: "string", description: "诉求来源：用户原始诉求原文，或「专家 X 的内部子线」" },
      boardId: { type: "string", description: "写入哪块看板（默认本会话）；专家写内部子线时填调度方给的 boardId" },
      dependsOn: { type: "array", items: { type: "string" }, description: "前置任务 id 列表" },
      parentId: { type: "string", description: "父任务 id（专家拆出的内部子线挂到它下面）" },
      agents: { type: "array", items: { type: "string" }, description: "直接设置该任务关联的 Agent sessionId 列表" },
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: String(value ?? "") }],
    },
    async execute(args, exec) {
      const own = boardOf(exec);
      const target = args.boardId === undefined || String(args.boardId).trim() === "" ? own : store.open(String(args.boardId).trim());
      const board = target;
      try {
        switch (args.action) {
          case "create": {
            const task = store.createTask(board, args);
            return (
              `✅ 已建任务 ${task.id}「${task.title}」（${task.kind}/${task.priority}${task.domainId ? " · " + task.domainId : ""}）` +
              (task.phases.length > 0 ? `\n阶段：${task.phases.map((phase) => phase.name).join(" → ")}` : "") +
              (board.boardId === own.boardId
                ? `\n下一步：派发后用 pm_agent bind 把子 Agent 的 sessionId 绑到 ${task.id}（专家加 role=expert domainId=...），看板才会把执行画在这条线下。`
                : `\n（已写入看板 ${board.boardId}${task.parentId ? "，挂在父任务 " + task.parentId + " 下" : ""}）`)
            );
          }
          case "update": {
            const task = store.updateTask(board, args);
            return (
              `✅ 已更新 ${task.id} ｜ 状态 ${task.status}` +
              (task.phase ? ` ｜ 阶段 ${task.phase}` : "") +
              (task.blockedReason ? ` ｜ ⛔ ${task.blockedReason}` : "") +
              (task.endedAt !== 0 ? ` ｜ 用时 ${fmtDuration(task.endedAt - task.startedAt)}` : "")
            );
          }
          case "phase": {
            const phase = store.setPhase(board, args);
            return `✅ ${args.id} 阶段「${phase.name}」→ ${phase.status}` + (phase.note ? ` ｜ ${phase.note}` : "");
          }
          case "link": {
            const task = store.updateTask(board, { id: args.id, dependsOn: args.dependsOn ?? [] });
            return `✅ ${task.id} 前置依赖：${task.dependsOn.length === 0 ? "（已清空）" : task.dependsOn.join(", ")}`;
          }
          case "list":
            return renderTasks(board, args);
          default:
            return "未知 action: " + String(args.action);
        }
      } catch (error) {
        return "❌ pm_task 失败：" + String(error && error.message ? error.message : error);
      } finally {
        store.flush(own);
        if (board !== own) store.flush(board);
      }
    },
  };

  // ────────────────────────────────────────────────────────────────────────
  // pm_agent — the routing table: which expert owns which domain
  // ────────────────────────────────────────────────────────────────────────

  const pmAgent = {
    name: "pm_agent",
    description:
      "管理「哪个领域归哪个专家」，并给出新诉求该派给谁的判断依据。**派发前先 recommend 或 list** —— 同一个领域的后续诉求要交回原来那个专家续做，" +
      "它已经有这个领域的上下文，重开一个 Agent 等于把查清的东西再查一遍。" +
      'action="recommend"：把一个诉求（request 原文）路由到领域与专家，返回候选领域、匹配到的关键词、负责人、它在办什么，以及下一步建议。' +
      'action="domain"：定义/更新一个领域（需 id；可选 name 必填建议、skills 关键词、notes）。' +
      'action="list"：专家花名册 + 注册表里还没绑定的子 Agent，含角色、领域、状态。' +
      'action="bind"：把子 Agent 的 sessionId 绑到任务（需 sessionId、taskId）；专家要同时给 role=expert 与 domainId=...，' +
      "这样它的领域归属和累计时间才会被看板记住；专家派出的下属用 role=helper，并带 parentSessionId，看板会把它画在同一个任务下。" +
      'action="unbind"：解除绑定（需 sessionId）。' +
      'action="ctx"：给出派发决策所需的上下文摘要（需 sessionId）—— 角色、领域、绑在哪个任务、累计执行时长、执行片段。',
    parameters: {
      action: { type: "string", enum: ["list", "recommend", "domain", "bind", "unbind", "ctx"], required: true, description: "要执行的操作" },
      sessionId: { type: "string", description: "子 Agent 的 durable sessionId（bind/unbind/ctx 必需）" },
      taskId: { type: "string", description: "bind 时绑定的任务 id" },
      label: { type: "string", description: "bind 时给这条线起的可读名字，例如「NPC 移动专家」「关卡专家」" },
      kind: { type: "string", description: "bind 时的角色：expert / helper / scout / reviewer / fork" },
      role: { type: "string", description: "bind 时的角色别名（同 kind）：专家用 expert，专家派出的下属用 helper" },
      domainId: { type: "string", description: "bind 时把哪个领域登记给这个 Agent；domain 动作时是要定义的领域 id" },
      name: { type: "string", description: "domain 动作时的领域显示名，例如「街区 NPC 移动与寻路」" },
      skills: { type: "array", items: { type: "string" }, description: "domain 动作时的领域关键词（路由靠它匹配，写全一点）" },
      notes: { type: "string", description: "domain 动作时的备注：这个领域踩过什么坑、边界在哪" },
      request: { type: "string", description: "recommend 动作时用户诉求的原文" },
      parentSessionId: { type: "string", description: "bind 专家下属时填派出它的那个专家的 sessionId（看板靠它画层级）" },
      boardId: { type: "string", description: "要写哪块看板（默认本会话）；专家登记自己的下属时填调度方给的 boardId" },
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: String(value ?? "") }],
    },
    async execute(args, exec) {
      const own = boardOf(exec);
      const board = args.boardId === undefined || String(args.boardId).trim() === "" ? own : store.open(String(args.boardId).trim());
      const ownerSessionId = sessionIdOf(exec);
      try {
        switch (args.action) {
          case "list":
            return await renderAgentList(board, ownerSessionId);
          case "recommend":
            return renderRecommendation(board, args);
          case "domain": {
            const domain = store.defineDomain(board, args);
            return (
              `✅ 领域「${domain.name}」（${domain.id}）已登记` +
              (domain.skills.length > 0 ? ` ｜ 关键词 ${domain.skills.join("、")}` : "") +
              (domain.ownerSessionId === ""
                ? `\n还没有负责人：派一个专家 Agent，然后 pm_agent bind role=expert domainId=${domain.id} 把它登记上。`
                : `\n负责人：${domain.ownerSessionId.slice(0, 8)}（${domain.ownerLabel || "无标签"}）`)
            );
          }
          case "bind": {
            const entry = store.bindAgent(board, {
              sessionId: args.sessionId,
              taskId: args.taskId,
              label: args.label,
              kind: args.kind,
              role: args.role,
              domainId: args.domainId,
              parentSessionId: args.parentSessionId,
            });
            const domains = store.domainsOf(board, entry.sessionId).map((domain) => `${domain.name}(${domain.id})`);
            return (
              `✅ 已绑定 ${entry.sessionId.slice(0, 12)} → 任务 ${entry.taskId || "(未指定)"}` +
              ` ｜ 角色 ${entry.role}` +
              (entry.label ? ` ｜ ${entry.label}` : "") +
              (domains.length > 0 ? ` ｜ 领域 ${domains.join("、")}` : "")
            );
          }
          case "unbind": {
            const entry = store.unbindAgent(board, { sessionId: args.sessionId });
            return entry === null ? "（该 sessionId 未登记）" : `✅ 已解绑 ${entry.sessionId.slice(0, 12)}`;
          }
          case "ctx":
            return renderAgentContext(board, String(args.sessionId ?? ""));
          default:
            return "未知 action: " + String(args.action);
        }
      } catch (error) {
        return "❌ pm_agent 失败：" + String(error && error.message ? error.message : error);
      } finally {
        store.flush(own);
        if (board !== own) store.flush(board);
      }
    },
  };

  function renderRecommendation(board, args) {
    const request = String(args.request ?? "");
    const domainId = typeof args.domainId === "string" ? args.domainId : "";
    if (request.trim() === "" && domainId.trim() === "") {
      return "recommend 需要 request（用户诉求原文）或 domainId（你已确定领域时直接指定）";
    }
    const routed = store.routeRequest(board, { request, domainId });
    const lines = [`🧭 路由建议（置信度 ${routed.confidence}）`];
    lines.push(`诉求：${request || "（按领域指定：" + domainId + "）"}`);
    if (routed.candidates.length === 0) {
      lines.push("候选领域：无 —— 这是一条全新方向的诉求。");
    } else {
      lines.push("候选领域：");
      for (const candidate of routed.candidates.slice(0, 4)) {
        const owner =
          candidate.expert === null
            ? "无负责人"
            : `${candidate.expert.sessionId.slice(0, 8)}（${candidate.expert.label || "无标签"}）${candidate.idle ? "空闲" : "运行中"}`;
        const hits = [...candidate.nameHits, ...candidate.skillHits].filter((token) => token.length > 1).slice(0, 6);
        lines.push(
          `  - ${candidate.domainName}（${candidate.domainId}）得分 ${candidate.score.toFixed(1)} ｜ ${owner}` +
            ` ｜ 已办 ${candidate.taskCount} 条${candidate.openTasks.length > 0 ? "，在办 " + candidate.openTasks.map((task) => task.id).join(",") : ""}` +
            (hits.length > 0 ? ` ｜ 命中 ${hits.join("、")}` : ""),
        );
      }
    }
    lines.push("");
    lines.push("下一步：" + routed.advice);
    return lines.join("\n");
  }

  async function renderAgentList(board, ownerSessionId) {
    const lines = [];
    const registered = new Map();
    const registry = subagents === undefined ? undefined : subagents();
    if (registry !== undefined && ownerSessionId !== "") {
      try {
    const entries = await registry.listChildren(ownerSessionId);
        for (const entry of entries) {
          if (entry.kind !== "child") continue;
          registered.set(String(entry.id), {
            activity: entry.activity,
            label: entry.label ?? "",
            mode: entry.mode,
          });
        }
        lines.push(`subagents 注册表可见 ${registered.size} 个子 Agent（含已结束但仍可冷恢复的线）`);
      } catch (error) {
        lines.push("（subagents 列表失败：" + String(error && error.message ? error.message : error) + "）");
      }
    }
    const live = collector === undefined ? {} : collector.liveStatus();
    const experts = store.experts(board);
    if (experts.length > 0) {
      lines.push("");
      lines.push(`专家（${experts.length} 位，领域归属已登记）：`);
      for (const expert of experts) {
        const info = registered.get(expert.sessionId);
        const state = live[expert.sessionId] ?? (info === undefined ? "unknown" : info.activity);
        const areas = expert.domains.length === 0 ? "未挂领域" : expert.domains.map((domain) => `${domain.name}(${domain.id})`).join("、");
        lines.push(
          `- ${expert.sessionId} ｜ ${expert.label || (info === undefined ? "(无标签)" : info.label) || "(无标签)"} ｜ expert ｜ ${state} ｜ ${areas}` +
            ` ｜ 在办 ${expert.openTasks.length} 条 ｜ 已交付 ${expert.doneCount} 条`,
        );
      }
    }
    const others = Object.values(board.agents).filter((agent) => agent.role !== "expert");
    if (others.length > 0) {
      lines.push("");
      lines.push(`其他已登记 Agent（${others.length}）：`);
      for (const agent of others) {
        const info = registered.get(agent.sessionId);
        const state = live[agent.sessionId] ?? (info === undefined ? "unknown" : info.activity);
        lines.push(
          `- ${agent.sessionId} ｜ ${agent.label || (info === undefined ? "(无标签)" : info.label) || "(无标签)"} ｜ ${agent.role}` +
            ` ｜ ${state} ｜ 任务 ${agent.taskId || "-"}` +
            (agent.parentSessionId ? ` ｜ 上级 ${agent.parentSessionId.slice(0, 8)}` : ""),
        );
      }
    }
    const unbound = [...registered.keys()].filter((id) => board.agents[id] === undefined);
    if (unbound.length > 0) {
      lines.push("");
      lines.push("尚未绑定到任务的子 Agent（先确认方向，再决定续做还是重开）：");
      for (const id of unbound) {
        const info = registered.get(id);
        lines.push(`- ${id} ｜ ${info.label || "(无标签)"} ｜ ${info.activity}`);
      }
    }
    lines.push("");
    lines.push("派发纪律（按顺序判断）：");
    lines.push("1) 先 pm_agent action=recommend 用诉求原文查领域 —— 命中领域就 send_message 给该领域的专家续做；");
    lines.push("2) 命中领域但没有专家，或该专家上一轮跑偏/失败 → 才开新 Agent，并 bind role=expert domainId=... 登记领域；");
    lines.push("3) 领域内怎么再分工是专家自己的事，不要替它拆；");
    lines.push("4) 只有真正全新方向（没有任何领域覆盖）才开新专家。");
    lines.push("绑定时用 pm_agent bind 把 sessionId 记到任务上，否则你看板上看不到它，几轮之后就找不到该复用谁。");
    return lines.join("\n");
  }

  function renderAgentContext(board, sessionId) {
    if (sessionId === "") return "需要 sessionId";
    const entry = board.agents[sessionId];
    const live = collector === undefined ? {} : collector.liveStatus();
    const lines = [];
    lines.push(`Agent ${sessionId}`);
    if (entry === undefined) {
      lines.push("- 看板登记：未登记（用 pm_agent bind 挂到任务上）");
    } else {
      const domains = store.domainsOf(board, sessionId).map((domain) => `${domain.name}(${domain.id})`);
      lines.push(`- 看板登记：角色 ${entry.role} ｜ 任务 ${entry.taskId || "-"} ｜ 标签 ${entry.label || "-"}`);
      if (domains.length > 0) lines.push(`- 负责领域：${domains.join("、")}`);
      if (entry.parentSessionId) lines.push(`- 上级专家：${entry.parentSessionId}`);
    }
    lines.push(`- 实时状态：${live[sessionId] ?? "未观测到（可能不在本进程活跃，或从未启动）"}`);
    lines.push(`- 累计执行：${fmtDuration(activityTotal(board, sessionId))}`);
    const own = board.order
      .map((id) => board.tasks[id])
      .filter((task) => task !== undefined && task.agents.includes(sessionId));
    if (own.length > 0) {
      lines.push(`- 经手任务：${own.map((task) => `${task.id}[${task.status}]`).join("、")}`);
    }
    const gantt = store.gantt(board, {});
    const spans = [];
    for (const lane of gantt.lanes) {
      for (const row of lane.rows) {
        if (row.sessionId === sessionId) spans.push({ lane, row });
      }
    }
    if (spans.length > 0) {
      lines.push("- 执行片段：");
      for (const item of spans) {
        for (const span of item.row.spans) {
          const steps = span.tools
            .slice()
            .sort((left, right) => right.durMs - left.durMs)
            .slice(0, 6)
            .map((tool) => `${tool.tool || "?"} ${fmtDuration(tool.durMs)}`)
            .join("，");
          lines.push(
            `  ${item.lane.title} ｜ ${fmtClock(span.start)}–${fmtClock(span.end)}（${fmtDuration(span.end - span.start)}）` +
              (steps ? ` ｜ ${steps}` : ""),
          );
        }
      }
    }
    return lines.join("\n");
  }

  // The single place the definitions are compiled. Wrapping at the seam rather
  // than at each literal keeps the three definitions above readable as data,
  // while guaranteeing that nothing leaves this factory with uncompiled
  // parameters — see the module header for why that failure is silent.
  return [pmMode, pmTask, pmAgent].map((definition) =>
    defineTool({
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
      output: definition.output,
      execute: definition.execute,
    }),
  );
}

export { PM_TOOL_NAMES, fmtDuration };
