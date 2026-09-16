/**
 * PM Mode — execution timeline collector.
 *
 * The board's Gantt chart must answer "what is running right now" and "how
 * long did that step take" without any extra cooperation from the PM agent.
 * This module derives both from the live runtime:
 *
 *   - `subagent/start` / `subagent/end`  — every published child run, with its
 *     provider and terminal stop reason;
 *   - `agent/status`                    — idle ⇄ running transitions of any
 *     live agent (including a continuable child resuming from `ready`);
 *   - `session/event`                   — `tool/call` + `tool/result` pairs, so
 *     a long bar can be broken into the individual steps it spent time on;
 *   - a low-frequency reconciliation poll over `agents.list()` that heals any
 *     gap (an agent that started before this plugin mounted, or a missed
 *     dispatch).
 *
 * Attribution is deliberately structural rather than cooperative. A child of
 * the PM session is "tracked" as soon as its start is observed: the collector
 * adopts it onto the board whose task tree contains it — that is, any board
 * belonging to an ancestor session. That way a child that was never explicitly
 * bound still produces a bar, and appears in the board's 未归属 swimlane
 * instead of being silently lost.
 * @module dsh-pm-mode/collector
 */

/** How often the reconciliation poll runs: live enough to read, cheap enough
 * that a large agent tree costs almost nothing. */
const RECONCILE_MS = 5000;

function idOf(value) {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && typeof value.id === "string") return value.id;
  return "";
}

function field(value, key) {
  if (typeof value === "object" && value !== null && typeof value[key] === "string") return value[key];
  return "";
}

function count(value, key) {
  if (typeof value === "object" && value !== null && typeof value[key] === "number") return value[key];
  return 0;
}

/**
 * Start collecting. Every listener and the poll timer are created through
 * `ctx`, so they unwind with the plugin fiber; nothing is registered globally.
 *
 * @param {object} options
 * @param {import('@deepseek-ai/cordis').Context} options.ctx host context
 * @param {import('./store.js').BoardStore} options.store
 * @param {(level: string, message: string) => void} [options.logger]
 */
export function startCollector({ ctx, store, logger = () => {} }) {
  /** sessionId → boardId, for a session observed as somebody's child. */
  const childBoard = new Map();
  /** sessionId → last observed status, so a poll skips an unchanged agent. */
  const lastStatus = new Map();
  /** sessionId → when its current running span began. */
  const runningSince = new Map();
  /** "sessionId|callId" → { name, at } for tool calls still in flight. */
  const openTools = new Map();

  let dirty = new Set();

  function markDirty(boardId) {
    dirty.add(boardId);
  }

  /** Persist every board the collector touched since the last tick. */
  function flushDirty() {
    if (dirty.size === 0) return;
    const ids = [...dirty];
    dirty = new Set();
    for (const id of ids) {
      const board = store.get(id);
      if (board !== null) store.flush(board);
    }
  }

  /** The board that owns a session, or null when none does yet. */
  function boardFor(sessionId) {
    if (sessionId === "") return null;
    const direct = store.cache.get(sessionId);
    if (direct !== undefined) return direct;
    const known = childBoard.get(sessionId);
    if (known === undefined) return null;
    return store.get(known);
  }

  /**
   * When subagent start/end carry no ancestor id, the child belongs to the
   * board of the agent that is running right now — which, for a delegated
   * run, is exactly the delegating parent.
   */
  function boardOfLiveParent() {
    const agents = ctx.get("agents");
    if (agents === undefined) return null;
    try {
      for (const agent of [...agents.list()].reverse()) {
        const sessionId = idOf(agent);
        if (sessionId === "" || typeof agent.status !== "string" || agent.status !== "running") continue;
        const board = store.cache.get(sessionId);
        if (board !== undefined) return board;
      }
    } catch {
      /* the registry can be mid-teardown */
    }
    return null;
  }

  /**
   * Adopt a previously unknown session onto a board so its later events have
   * an owner. Recorded unassigned; the PM attaches a task with `pm_agent`.
   */
  function adopt(board, sessionId, label) {
    const known = board.agents[sessionId];
    if (known === undefined) {
      board.agents[sessionId] = {
        sessionId,
        label: label === undefined ? "" : label,
        taskId: "",
        kind: "child",
        boundAt: Date.now(),
      };
    } else if (label !== undefined && label !== "" && known.label === "") {
      known.label = label;
    }
    childBoard.set(sessionId, board.boardId);
    return board;
  }

  function taskOf(board, sessionId) {
    const known = board.agents[sessionId];
    return known === undefined ? "" : known.taskId;
  }

  // ── agent status (idle ⇄ running) ───────────────────────────────────────

  const onStatus = (payload) => {
    const sessionId = idOf(payload === undefined ? undefined : payload.agent);
    if (sessionId === "") return;
    const board = boardFor(sessionId);
    if (board === null) return;
    const status = field(payload, "status");
    if (status === "" || lastStatus.get(sessionId) === status) return;
    lastStatus.set(sessionId, status);
    const at = Date.now();
    if (status === "running") {
      runningSince.set(sessionId, at);
      store.record(board, { kind: "agent-start", sessionId, taskId: taskOf(board, sessionId), status });
    } else {
      const startedAt = runningSince.get(sessionId);
      runningSince.delete(sessionId);
      store.record(board, {
        kind: "agent-end",
        sessionId,
        taskId: taskOf(board, sessionId),
        status,
        durMs: startedAt === undefined ? 0 : at - startedAt,
      });
    }
    markDirty(board.boardId);
  };

  // ── published child runs ────────────────────────────────────────────────

  const onSubagentStart = (info) => {
    const sessionId = idOf(info);
    if (sessionId === "") return;
    const provider = field(info, "provider");
    let board = boardFor(sessionId);
    if (board === null) {
      const parent = boardOfLiveParent();
      if (parent === null) return;
      board = adopt(parent, sessionId, provider);
    }
    store.record(board, { kind: "agent-start", sessionId, taskId: taskOf(board, sessionId), label: provider, detail: provider, status: "running" });
    lastStatus.set(sessionId, "running");
    runningSince.set(sessionId, Date.now());
    markDirty(board.boardId);
  };

  const onSubagentEnd = (info) => {
    const sessionId = idOf(info);
    if (sessionId === "") return;
    const board = boardFor(sessionId);
    if (board === null) return;
    const stopReason = field(info, "stopReason");
    const startedAt = runningSince.get(sessionId);
    runningSince.delete(sessionId);
    lastStatus.set(sessionId, "idle");
    store.record(board, {
      kind: "agent-end",
      sessionId,
      taskId: taskOf(board, sessionId),
      status: stopReason === "" ? "idle" : stopReason,
      detail: stopReason,
      durMs: startedAt === undefined ? 0 : Date.now() - startedAt,
    });
    markDirty(board.boardId);
  };

  // ── per-step tool timing ────────────────────────────────────────────────

  /**
   * A `tool/call` carries the id it was minted with; the paired `tool/result`
   * only carries that same id inside `data.message.source.callId`, so matching
   * on it is what makes a step's duration exact rather than inferred.
   */
  const onToolCall = (board, sessionId, data) => {
    const callId = field(data, "callId");
    const name = field(data, "name");
    if (callId !== "") openTools.set(sessionId + "|" + callId, { name, at: Date.now() });
    store.record(board, { kind: "tool-call", sessionId, taskId: taskOf(board, sessionId), detail: callId, tool: name });
    markDirty(board.boardId);
  };

  const onToolResult = (board, sessionId, data) => {
    const source = typeof data === "object" && data !== null ? data.message : undefined;
    const callId = field(source === undefined ? undefined : source.source, "callId");
    const key = sessionId + "|" + callId;
    const open = openTools.get(key);
    if (open !== undefined) openTools.delete(key);
    const at = Date.now();
    store.record(board, {
      kind: "tool-result",
      sessionId,
      taskId: taskOf(board, sessionId),
      detail: callId,
      tool: open === undefined ? "" : open.name,
      durMs: open === undefined ? 0 : at - open.at,
      status: typeof data === "object" && data !== null && data.error !== undefined ? "error" : "",
    });
    markDirty(board.boardId);
  };

  const onSessionEvent = (session, event) => {
    const sessionId = idOf(session);
    if (sessionId === "") return;
    const board = boardFor(sessionId);
    if (board === null) return;
    const type = field(event, "type");
    if (type !== "tool/call" && type !== "tool/result") return;
    const data = event === null || typeof event !== "object" ? undefined : event.data;
    if (type === "tool/call") onToolCall(board, sessionId, data);
    else onToolResult(board, sessionId, data);
  };

  // ── reconciliation ──────────────────────────────────────────────────────

  /** Publish the PM's own bindings into the child index. */
  function refreshChildIndex() {
    for (const id of store.cache.keys()) {
      const board = store.get(id);
      if (board === null) continue;
      for (const sessionId of Object.keys(board.agents)) childBoard.set(sessionId, board.boardId);
    }
  }

  function reconcile() {
    refreshChildIndex();
    const agents = ctx.get("agents");
    if (agents === undefined) return;
    let list;
    try {
      list = agents.list();
    } catch (error) {
      logger("warn", "pm-mode: agents.list failed: " + String(error && error.message ? error.message : error));
      return;
    }
    const at = Date.now();
    const seen = new Set();
    for (const agent of list) {
      const sessionId = idOf(agent);
      if (sessionId === "") continue;
      seen.add(sessionId);
      const board = boardFor(sessionId);
      if (board === null) continue;
      const status = typeof agent.status === "string" ? agent.status : "";
      if (status === "" || lastStatus.get(sessionId) === status) continue;
      const previous = lastStatus.get(sessionId);
      lastStatus.set(sessionId, status);
      if (status === "running") {
        if (!runningSince.has(sessionId)) runningSince.set(sessionId, at);
        store.record(board, { kind: "agent-start", sessionId, taskId: taskOf(board, sessionId), status, dedupeKey: sessionId + ":start" });
      } else if (previous === "running") {
        const startedAt = runningSince.get(sessionId);
        runningSince.delete(sessionId);
        store.record(board, {
          kind: "agent-end",
          sessionId,
          taskId: taskOf(board, sessionId),
          status,
          durMs: startedAt === undefined ? 0 : at - startedAt,
          dedupeKey: sessionId + ":end",
        });
      }
      markDirty(board.boardId);
    }
    for (const [sessionId] of runningSince) {
      if (seen.has(sessionId)) continue;
      const board = boardFor(sessionId);
      runningSince.delete(sessionId);
      lastStatus.delete(sessionId);
      if (board === null) continue;
      store.record(board, { kind: "agent-end", sessionId, status: "disposed", dedupeKey: sessionId + ":end" });
      markDirty(board.boardId);
    }
    flushDirty();
  }

  // ── wiring ──────────────────────────────────────────────────────────────

  ctx.on("agent/status", onStatus);
  ctx.on("subagent/start", onSubagentStart);
  ctx.on("subagent/end", onSubagentEnd);
  ctx.on("session/event", onSessionEvent);
  ctx.interval(reconcile, RECONCILE_MS);

  logger("info", "pm-mode: timeline collector started (" + store.root + ")");

  return {
    reconcile,
    flushDirty,
    /** Live status per session, for the panel's "正在执行" read. */
    liveStatus() {
      return Object.fromEntries(lastStatus);
    },
  };
}
