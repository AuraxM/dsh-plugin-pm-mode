/**
 * PM Mode — durable board store (pure Node, no dsh imports so it stays
 * standalone-testable and import-safe from a junction-mounted package).
 *
 * One board per PM session. A board owns:
 *   - domains:     expertise areas the dispatcher routes requests into, each
 *                  naming the expert agent that owns it (its accumulated
 *                  context is what a follow-up in the same area should reuse);
 *   - tasks:       one line per user request, carrying its domain, phases,
 *                  bound expert, evidence and an append-only transition log;
 *   - agents:      child session ids (and their bindings) belonging to tasks;
 *   - resources:   exclusive leases over shared singletons (the private server,
 *                  the Unity editor, a build slot, ...) plus their wait queue;
 *   - timeline:    timestamped execution spans the Gantt chart draws;
 *   - notes:       free-form dispatcher comments pinned to the board or a task.
 *
 * Persistence is a single JSON document per board under
 * `${DSH_HOME|~/.dsh}/pm-mode/<boardId>/board.json`, written atomically
 * (tmp + rename) so a crash never leaves a half-written board.
 * @module dsh-pm-mode/store
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Board document schema version; bumped when the shape changes incompatibly.
 *
 * v2 added `domains` (expertise areas + their owning expert) and the
 * `domainId` / `requestedBy` fields on a task. A v1 board parsed by this code
 * simply has no domains: every reader tolerates that, so upgrading is a no-op
 * and nothing is thrown away.
 */
export const BOARD_VERSION = 2;

/** Task lifecycle states. `blocked` requires a `blockedReason`. */
export const TASK_STATUS = ["planned", "ready", "running", "blocked", "review", "done", "failed", "cancelled"];

/** Terminal task states — a finished task leaves the active lanes. */
export const TERMINAL_STATUS = new Set(["done", "failed", "cancelled"]);

/** Resource lease states. */
export const LEASE_STATE = ["free", "held", "queued"];

/** Agent roles: the dispatcher itself (implicit, depth 0) is never listed. */
export const AGENT_ROLE = ["expert", "helper", "scout", "reviewer", "fork", "child"];

/** Timeline event kinds recorded by the collector and by the PM tools. */
export const EVENT_KIND = [
  "task-created",
  "task-status",
  "task-phase",
  "task-note",
  "domain-defined",
  "agent-bound",
  "agent-unbound",
  "agent-start",
  "agent-end",
  "tool-call",
  "tool-result",
  "resource-acquire",
  "resource-release",
  "resource-wait",
  "session-start",
  "session-end",
  "error",
];

const MAX_TIMELINE = 4000;
const MAX_NOTES = 500;

/** Name of the board-root settings document (a FILE beside the board dirs). */
export const SETTINGS_FILE = "settings.json";

/**
 * The expert route ships UNCONFIGURED, and that is a decision rather than an
 * omission.
 *
 * A plugin installed in one deployment must not dictate what another one runs
 * on: the previous revision pinned `kimi-coding/k3/max`, which is one route on
 * one machine — a hard-coded model name inside a plugin meant to be generic.
 * Empty means "the operator has not chosen yet": the panel says so, the tool
 * description says so, and a delegation refuses with the way out instead of
 * guessing (see `lib/expert.js`). A wrong guess is worse than a refusal,
 * because the operator would never learn their choice was not used.
 *
 * `reasoningEffort` empty means "the model's own default": effort ids are
 * adapter-owned and model-specific, so inventing one is the same mistake as
 * inventing a model id.
 */
export const DEFAULT_EXPERT_MODEL = { provider: "", model: "", reasoningEffort: "" };

/**
 * Absolute recursion cap for the expert route. The dispatcher sits at depth 0
 * and the expert at depth 1, so 2 lets the expert start helpers of its own and
 * refuses a helper's own helper — the same tiering the preset's scout row
 * enforces on that side.
 *
 * This one DOES ship with a value, because it is not model-specific: it is a
 * property of this plugin's own three-tier design.
 */
export const DEFAULT_EXPERT_MAX_DEPTH = 2;

/** Adapter-owned reasoning effort ids, offered as a fallback list in the form. */
export const REASONING_EFFORTS = ["minimal", "low", "medium", "high", "max"];

/** Whether an operator has chosen a route at all. */
export function isRouteConfigured(route) {
  return route !== undefined && route !== null && route.provider !== "" && route.model !== "";
}

/**
 * Resolve the route catalog a settings form needs, using the live `llm`
 * service.
 *
 * `resolveModelInfo` is the ONLY honest check that a provider/model pair is
 * real: `listModels` is advisory catalog membership, while resolveModelInfo
 * asks the owning adapter. Effort validity comes from the resolved model's own
 * `reasoning.efforts`, so the form offers exactly what that model accepts
 * instead of a hard-coded list that may be wrong.
 *
 * Never throws: a deployment with no `llm` service, or one whose adapters fail,
 * yields `{ available: false, reason }` and the panel renders that instead of
 * silently showing an empty picker.
 */
export async function resolveExpertModelCatalog(llm, current) {
  const wanted = normalizeSettings({ expertModel: current }).expertModel;
  if (llm === undefined || llm === null) {
    return { available: false, reason: "这个部署没有 llm 服务，无法校验模型路由", current: wanted, providers: [] };
  }
  const providers = [];
  try {
    for (const provider of llm.listProviders()) {
      const entry = { id: provider.id, name: provider.name, models: [], error: "" };
      try {
        const models = await llm.listModels(provider.id);
        entry.models = models.map((model) => ({ id: model.id, name: model.name ?? model.id }));
      } catch (error) {
        entry.error = String(error && error.message ? error.message : error);
      }
      providers.push(entry);
    }
  } catch (error) {
    return {
      available: false,
      reason: String(error && error.message ? error.message : error),
      current: wanted,
      providers: [],
    };
  }
  // The current route's own effort set — but only when a route HAS been chosen.
  // Resolving the empty pair would ask the adapter about a model that does not
  // exist and report it as a broken configuration, when the truth is simply
  // "nothing picked yet".
  let efforts = [];
  let resolved = null;
  let resolveError = "";
  if (isRouteConfigured(wanted)) {
    try {
      const info = await llm.resolveModelInfo(wanted.provider, wanted.model);
      resolved = { id: info.id, name: info.name, provider: info.provider };
      efforts = (info.reasoning?.efforts ?? []).map((effort) => effort.id);
    } catch (error) {
      resolveError = String(error && error.message ? error.message : error);
    }
  }
  return {
    available: true,
    reason: "",
    configured: isRouteConfigured(wanted),
    current: wanted,
    providers,
    resolved,
    resolveError,
    // The form always needs SOME effort list to render; the model's own list
    // wins when it resolved, and the generic adapter vocabulary is the
    // placeholder otherwise. Saving is validated against the model either way.
    efforts: efforts.length > 0 ? efforts : REASONING_EFFORTS,
  };
}

/** Root directory holding every board. */
export function defaultRoot(env = process.env) {
  const home = env.DSH_HOME && env.DSH_HOME.trim() !== "" ? env.DSH_HOME : path.join(os.homedir(), ".dsh");
  return path.join(home, "pm-mode");
}

/** Monotonic-ish id with a caller-supplied prefix. */
export function mintId(prefix) {
  return (
    prefix +
    "-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 7)
  );
}

function nowMs() {
  return Date.now();
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function num(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function strArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

/**
 * Split text into comparable routing tokens.
 *
 * Chinese has no spaces, so a Latin-style word split silently yields one giant
 * token and every match scores zero. CJK runs are therefore cut into
 * overlapping bigrams (`NPC移动` → `npc移`/`移`/`移动` plus the `npc` word),
 * which is the cheapest way to get useful recall without a dictionary.
 */
export function tokenize(text) {
  const lower = String(text ?? "").toLowerCase();
  const tokens = new Set();
  for (const word of lower.match(/[a-z0-9_]{2,}/g) ?? []) tokens.add(word);
  const cjkRuns = lower.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const run of cjkRuns) {
    for (const char of run) tokens.add(char);
    for (let index = 0; index + 1 < run.length; index += 1) tokens.add(run.slice(index, index + 2));
  }
  return tokens;
}

/** Whether the collector currently sees this session working. */
export function isAgentBusy(board, sessionId, at = nowMs()) {
  let open = 0;
  for (const event of board.timeline) {
    if (event.sessionId !== sessionId) continue;
    if (event.kind === "agent-start" || event.kind === "session-start") open = event.at;
    else if (event.kind === "agent-end" || event.kind === "session-end") open = 0;
  }
  return open !== 0 && at - open > 0;
}

/** Clamp a board id to something safe for a single directory name. */
export function safeBoardId(boardId) {
  const cleaned = String(boardId).replace(/[^A-Za-z0-9._-]/g, "_");
  return cleaned === "" || cleaned === "." || cleaned === ".." ? "board" : cleaned.slice(0, 120);
}

/** Build an empty board document for one session. */
export function emptyBoard(sessionId, title = "") {
  const at = nowMs();
  return {
    version: BOARD_VERSION,
    boardId: safeBoardId(sessionId),
    sessionId,
    title: title || sessionId,
    createdAt: at,
    updatedAt: at,
    domains: {},
    domainOrder: [],
    tasks: {},
    order: [],
    agents: {},
    resources: {},
    timeline: [],
    notes: [],
    seq: 0,
  };
}

/**
 * Normalize a board document read from disk: tolerate older or hand-edited
 * files without ever throwing on a field the current code expects.
 */
export function normalizeBoard(raw, sessionId) {
  if (!isPlainObject(raw)) return emptyBoard(sessionId);
  const board = emptyBoard(str(raw.sessionId, sessionId), str(raw.title));
  board.boardId = safeBoardId(str(raw.boardId, sessionId));
  board.createdAt = num(raw.createdAt, board.createdAt);
  board.updatedAt = num(raw.updatedAt, board.updatedAt);
  board.seq = num(raw.seq, 0);
  if (isPlainObject(raw.domains)) {
    for (const [id, domain] of Object.entries(raw.domains)) {
      if (!isPlainObject(domain)) continue;
      board.domains[id] = normalizeDomain(id, domain);
    }
  }
  board.domainOrder = strArray(raw.domainOrder).filter((id) => board.domains[id] !== undefined);
  for (const id of Object.keys(board.domains)) if (!board.domainOrder.includes(id)) board.domainOrder.push(id);
  if (isPlainObject(raw.tasks)) {
    for (const [id, task] of Object.entries(raw.tasks)) {
      if (!isPlainObject(task)) continue;
      board.tasks[id] = normalizeTask(id, task);
    }
  }
  board.order = strArray(raw.order).filter((id) => board.tasks[id] !== undefined);
  for (const id of Object.keys(board.tasks)) if (!board.order.includes(id)) board.order.push(id);
  if (isPlainObject(raw.agents)) {
    for (const [key, agent] of Object.entries(raw.agents)) {
      if (!isPlainObject(agent)) continue;
      board.agents[key] = {
        sessionId: str(agent.sessionId, key),
        label: str(agent.label),
        taskId: str(agent.taskId),
        kind: str(agent.kind, "child"),
        role: AGENT_ROLE.includes(str(agent.role)) ? str(agent.role) : str(agent.kind, "child"),
        domainId: str(agent.domainId),
        parentSessionId: str(agent.parentSessionId),
        boundAt: num(agent.boundAt, 0),
      };
    }
  }
  if (isPlainObject(raw.resources)) {
    for (const [id, resource] of Object.entries(raw.resources)) {
      if (!isPlainObject(resource)) continue;
      board.resources[id] = {
        id,
        label: str(resource.label, id),
        exclusive: resource.exclusive !== false,
        holder: isPlainObject(resource.holder)
          ? {
              sessionId: str(resource.holder.sessionId),
              label: str(resource.holder.label),
              taskId: str(resource.holder.taskId),
              since: num(resource.holder.since, 0),
            }
          : null,
        queue: Array.isArray(resource.queue)
          ? resource.queue
              .filter(isPlainObject)
              .map((entry) => ({
                sessionId: str(entry.sessionId),
                label: str(entry.label),
                taskId: str(entry.taskId),
                since: num(entry.since, 0),
              }))
          : [],
        note: str(resource.note),
      };
    }
  }
  board.timeline = Array.isArray(raw.timeline)
    ? raw.timeline.filter(isPlainObject).map(normalizeEvent).slice(-MAX_TIMELINE)
    : [];
  board.notes = Array.isArray(raw.notes)
    ? raw.notes.filter(isPlainObject).map((note) => ({
        id: str(note.id, mintId("note")),
        at: num(note.at, 0),
        taskId: str(note.taskId),
        text: str(note.text),
      })).slice(-MAX_NOTES)
    : [];
  return board;
}

function normalizeTask(id, task) {
  const phases = Array.isArray(task.phases)
    ? task.phases.filter(isPlainObject).map((phase, index, all) => ({
        id: str(phase.id, "phase-" + (index + 1)),
        name: str(phase.name, "阶段 " + (index + 1)),
        status: TASK_STATUS.includes(str(phase.status)) ? str(phase.status) : "planned",
        startedAt: num(phase.startedAt, 0),
        endedAt: num(phase.endedAt, 0),
        note: str(phase.note),
        order: num(phase.order, index),
        seq: all.length,
      }))
    : [];
  return {
    id,
    title: str(task.title, id),
    goal: str(task.goal),
    kind: str(task.kind, "task"),
    status: TASK_STATUS.includes(str(task.status)) ? str(task.status) : "planned",
    priority: str(task.priority, "normal"),
    tags: strArray(task.tags),
    domainId: str(task.domainId),
    requestedBy: str(task.requestedBy),
    parentId: str(task.parentId),
    dependsOn: strArray(task.dependsOn),
    createdAt: num(task.createdAt, 0),
    updatedAt: num(task.updatedAt, 0),
    startedAt: num(task.startedAt, 0),
    endedAt: num(task.endedAt, 0),
    agents: strArray(task.agents),
    phases,
    phase: str(task.phase),
    evidence: str(task.evidence),
    result: str(task.result),
    blockedReason: str(task.blockedReason),
    acceptance: str(task.acceptance),
    transitions: Array.isArray(task.transitions)
      ? task.transitions.filter(isPlainObject).map((item) => ({
          at: num(item.at, 0),
          from: str(item.from),
          to: str(item.to),
          note: str(item.note),
        }))
      : [],
  };
}

/**
 * One expertise area. `ownerSessionId` is the expert that accumulated context
 * in it — the whole reason a follow-up request is routed back to the same
 * agent instead of to a fresh one.
 */function normalizeDomain(id, domain) {
  return {
    id,
    name: str(domain.name, id),
    skills: strArray(domain.skills),
    notes: str(domain.notes),
    ownerSessionId: str(domain.ownerSessionId),
    ownerLabel: str(domain.ownerLabel),
    createdAt: num(domain.createdAt, 0),
    updatedAt: num(domain.updatedAt, 0),
  };
}

function normalizeEvent(event) {
  return {
    at: num(event.at, 0),
    kind: EVENT_KIND.includes(str(event.kind)) ? str(event.kind) : str(event.kind, "note"),
    sessionId: str(event.sessionId),
    taskId: str(event.taskId),
    label: str(event.label),
    phase: str(event.phase),
    status: str(event.status),
    tool: str(event.tool),
    durMs: num(event.durMs, 0),
    detail: str(event.detail).slice(0, 400),
  };
}

/**
 * The plugin's own settings document, defaults filled in.
 *
 * The model fields normalize to EMPTY, not to any model: this plugin ships no
 * default route (see `DEFAULT_EXPERT_MODEL`). Nothing is written to disk until
 * an operator chooses, so "unconfigured" stays observable — `updatedAt: 0` is
 * exactly how the panel tells "never set" from "set to the default".
 *
 * Anything unreadable falls back rather than throwing: a hand-edited settings
 * file must not be able to stop a session from getting its expert tool. Invalid
 * values are refused loudly at the settings boundary instead.
 */
export function normalizeSettings(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const model = isPlainObject(source.expertModel) ? source.expertModel : {};
  const maxDepth = num(model.maxDepth, DEFAULT_EXPERT_MAX_DEPTH);
  const text = (value, fallback) => (typeof value === "string" ? value.trim() : fallback);
  return {
    version: 1,
    expertModel: {
      provider: text(model.provider, DEFAULT_EXPERT_MODEL.provider),
      model: text(model.model, DEFAULT_EXPERT_MODEL.model),
      reasoningEffort: text(model.reasoningEffort, DEFAULT_EXPERT_MODEL.reasoningEffort),
      maxDepth: Number.isSafeInteger(maxDepth) && maxDepth >= 1 && maxDepth <= 5 ? maxDepth : DEFAULT_EXPERT_MAX_DEPTH,
      updatedAt: num(model.updatedAt, 0),
      updatedBy: str(model.updatedBy),
    },
  };
}

/**
 * One process-wide store over a board root. Boards are cached in memory and
 * flushed to disk on every mutation (atomic, debounced by the caller's
 * mutation granularity — a PM turn writes a handful of times, not per token).
 */
export class BoardStore {
  constructor(options = {}) {
    this.root = options.root ?? defaultRoot();
    /** @type {Map<string, object>} */
    this.cache = new Map();
    /** @type {Map<string, number[]>} recent tool-call start times, for pairing */
    this.pendingTools = new Map();
    this.logger = typeof options.logger === "function" ? options.logger : () => {};
  }

  /** Directory of one board. */
  dirFor(sessionId) {
    return path.join(this.root, safeBoardId(sessionId));
  }

  /** Absolute path of one board document. */
  fileFor(sessionId) {
    return path.join(this.dirFor(sessionId), "board.json");
  }

  /** Every board id present on disk, newest first. */
  listBoardIds() {
    let entries;
    try {
      entries = fs.readdirSync(this.root, { withFileTypes: true });
    } catch {
      return [];
    }
    const found = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(this.root, entry.name, "board.json");
      try {
        const stat = fs.statSync(file);
        found.push({ boardId: entry.name, mtime: stat.mtimeMs, file });
      } catch {
        /* not a board directory */
      }
    }
    return found.sort((a, b) => b.mtime - a.mtime);
  }

  /** Read one board, creating (and persisting) an empty one on first use. */
  open(sessionId, title) {
    const id = safeBoardId(sessionId);
    if (title !== undefined && title !== "" && this.cache.get(id) === undefined) {
      // fall through: the title is applied while loading below
    }
    const cached = this.cache.get(id);
    if (cached !== undefined) {
      if (title !== undefined && title !== "" && cached.title !== title) cached.title = title;
      return cached;
    }
    let board = null;
    try {
      const text = fs.readFileSync(this.fileFor(id), "utf8");
      board = normalizeBoard(JSON.parse(text), sessionId);
    } catch {
      board = null;
    }
    if (board === null) {
      board = emptyBoard(sessionId, title);
      board.boardId = id;
      this.cache.set(id, board);
      this.flush(board);
      return board;
    }
    if (title !== undefined && title !== "") board.title = title;
    this.cache.set(id, board);
    return board;
  }

  /** Load a board by id without creating a session association. */
  get(boardId) {
    const id = safeBoardId(boardId);
    const cached = this.cache.get(id);
    if (cached !== undefined) return cached;
    try {
      const text = fs.readFileSync(this.fileFor(id), "utf8");      const board = normalizeBoard(JSON.parse(text), id);
      this.cache.set(id, board);
      return board;
    } catch {
      return null;
    }
  }

  /** Atomically persist one board. */
  flush(board) {
    board.updatedAt = nowMs();
    const dir = this.dirFor(board.boardId);
    const file = path.join(dir, "board.json");
    const tmp = file + ".tmp-" + process.pid;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(board), "utf8");
      fs.renameSync(tmp, file);
      return true;
    } catch (error) {
      this.logger("warn", "pm-mode: flush failed", String(error && error.message ? error.message : error));
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* nothing to clean */
      }
      return false;
    }
  }

  /** Drop a board from memory (used by the delete action). */
  forget(boardId) {
    this.cache.delete(safeBoardId(boardId));
  }

  // ── plugin settings (one file in the board root) ────────────────────────

  /**
   * Path of the settings document. It lives in the board ROOT, not inside a
   * board directory: `listBoardIds()` treats every subdirectory as a board, and
   * the reader only ever loads `board.json` from it, so a file here is both
   * out of the way and impossible to mistake for a board.
   */
  settingsFile() {
    return path.join(this.root, SETTINGS_FILE);
  }

  /**
   * The settings document, with defaults filled in.
   *
   * Read from disk on EVERY call rather than cached: the value decides which
   * model a newly composed expert session runs on, the file is read once per
   * delegation at most, and "I changed it but nothing happened" is exactly the
   * failure this feature must not have.
   */
  settings() {
    let raw = {};
    try {
      raw = JSON.parse(fs.readFileSync(this.settingsFile(), "utf8"));
    } catch {
      raw = {};
    }
    return normalizeSettings(raw);
  }

  /** Merge a patch into the settings document and persist it atomically. */
  saveSettings(patch) {
    if (!isPlainObject(patch)) throw new Error("settings 需要一个对象");
    const current = this.settings();
    const merged = normalizeSettings({
      ...current,
      ...patch,
      expertModel: patch.expertModel === undefined ? current.expertModel : { ...current.expertModel, ...patch.expertModel },
    });
    const file = this.settingsFile();
    const tmp = file + ".tmp-" + process.pid;
    fs.mkdirSync(this.root, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), "utf8");
    fs.renameSync(tmp, file);
    return merged;
  }

  // ── timeline ────────────────────────────────────────────────────────────

  /**
   * Append one timeline event. `key` optionally de-duplicates a repeated
   * observation (a status poll that re-reports the same running state).
   */
  record(board, event) {
    const entry = normalizeEvent({ at: nowMs(), ...event });
    const dedupeKey = event.dedupeKey === undefined ? undefined : String(event.dedupeKey);
    const last = board.timeline[board.timeline.length - 1];
    if (last !== undefined && dedupeKey !== undefined && last.dedupeKey === dedupeKey && entry.at - last.at < 1500) {
      return last;
    }
    if (dedupeKey !== undefined) entry.dedupeKey = dedupeKey;
    board.timeline.push(entry);
    if (board.timeline.length > MAX_TIMELINE) board.timeline.splice(0, board.timeline.length - MAX_TIMELINE);
    return entry;
  }

  // ── tasks ───────────────────────────────────────────────────────────────

  createTask(board, input) {
    const title = str(input.title).trim();
    if (title === "") throw new Error("pm_task create 需要 title");
    const id = str(input.id).trim() !== "" ? str(input.id).trim() : mintId("t");
    if (board.tasks[id] !== undefined) throw new Error(`任务 id 已存在: ${id}（用 update 改它，或换一个 id）`);
    const at = nowMs();
    const task = normalizeTask(id, {
      title,
      goal: str(input.goal),
      kind: str(input.kind, "task"),
      status: TASK_STATUS.includes(str(input.status)) ? str(input.status) : "planned",
      priority: str(input.priority, "normal"),
      tags: strArray(input.tags),
      domainId: str(input.domainId),
      requestedBy: str(input.requestedBy, "user"),
      parentId: str(input.parentId),
      dependsOn: strArray(input.dependsOn),
      createdAt: at,
      updatedAt: at,
      acceptance: str(input.acceptance),
      phases: strArray(input.phases).map((name, index) => ({
        id: "phase-" + (index + 1),
        name,
        status: "planned",
        order: index,
      })),
    });
    if (task.parentId !== "" && board.tasks[task.parentId] === undefined) task.parentId = "";
    if (task.domainId !== "" && board.domains[task.domainId] === undefined) {
      this.defineDomain(board, { id: task.domainId, name: task.domainId });
    }
    board.tasks[id] = task;
    board.order.push(id);
    this.record(board, {
      kind: "task-created",
      taskId: id,
      label: task.title,
      status: task.status,
      detail: task.domainId === "" ? task.kind : task.kind + " · " + task.domainId,
    });
    return task;
  }

  updateTask(board, input) {
    const id = str(input.id).trim();
    const task = board.tasks[id];
    if (task === undefined) throw new Error(`找不到任务: ${id || "(空)"}（先用 action=create 建，或 action=list 看现有 id）`);
    const at = nowMs();
    const before = task.status;
    if (input.title !== undefined) task.title = str(input.title, task.title);
    if (input.goal !== undefined) task.goal = str(input.goal);
    if (input.kind !== undefined) task.kind = str(input.kind, task.kind);
    if (input.priority !== undefined) task.priority = str(input.priority, task.priority);
    if (input.tags !== undefined) task.tags = strArray(input.tags);
    if (input.dependsOn !== undefined) task.dependsOn = strArray(input.dependsOn);
    if (input.acceptance !== undefined) task.acceptance = str(input.acceptance);
    if (input.evidence !== undefined) task.evidence = str(input.evidence);
    if (input.result !== undefined) task.result = str(input.result);
    if (input.phase !== undefined) task.phase = str(input.phase);
    if (input.agents !== undefined) task.agents = strArray(input.agents);
    if (input.blockedReason !== undefined) task.blockedReason = str(input.blockedReason);
    if (input.domainId !== undefined) {
      task.domainId = str(input.domainId);
      if (task.domainId !== "" && board.domains[task.domainId] === undefined) {
        this.defineDomain(board, { id: task.domainId, name: task.domainId });
      }
    }

    if (input.status !== undefined) {
      const status = str(input.status);
      if (!TASK_STATUS.includes(status)) throw new Error(`未知状态: ${status}（可选 ${TASK_STATUS.join("/")}）`);
      if (status === "blocked" && str(input.blockedReason, task.blockedReason).trim() === "") {
        throw new Error("status=blocked 必须同时给 blockedReason（看板要显示卡在哪）");
      }
      task.status = status;
      if (status === "running" && task.startedAt === 0) task.startedAt = at;
      if (TERMINAL_STATUS.has(status)) {
        task.endedAt = at;
        if (task.startedAt === 0) task.startedAt = at;
      } else {
        task.endedAt = 0;
      }
      if (before !== status) {
        task.transitions.push({ at, from: before, to: status, note: str(input.note) });
        if (task.transitions.length > 200) task.transitions.splice(0, task.transitions.length - 200);
        this.record(board, {
          kind: "task-status",
          taskId: id,
          label: task.title,
          status,
          detail: str(input.note),
        });
      }
    }
    if (input.note !== undefined && str(input.note) !== "") {
      this.record(board, { kind: "task-note", taskId: id, label: task.title, detail: str(input.note) });
    }
    task.updatedAt = at;
    return task;
  }

  /** Move one phase of a task and timestamp it. */
  setPhase(board, input) {
    const id = str(input.id).trim();
    const task = board.tasks[id];
    if (task === undefined) throw new Error(`找不到任务: ${id}`);
    const name = str(input.phase).trim();
    if (name === "") throw new Error("set-phase 需要 phase");
    let phase = task.phases.find((item) => item.name === name || item.id === name);
    if (phase === undefined) {
      phase = { id: "phase-" + (task.phases.length + 1), name, status: "planned", startedAt: 0, endedAt: 0, note: "", order: task.phases.length };
      task.phases.push(phase);
    }
    const status = TASK_STATUS.includes(str(input.status)) ? str(input.status) : "running";
    const at = nowMs();
    if (status === "running" && phase.startedAt === 0) phase.startedAt = at;
    if (TERMINAL_STATUS.has(status) || status === "review") {
      phase.endedAt = phase.endedAt === 0 ? at : phase.endedAt;
    }
    phase.status = status;
    if (input.note !== undefined) phase.note = str(input.note);
    task.phase = name;
    task.updatedAt = at;
    this.record(board, { kind: "task-phase", taskId: id, label: task.title, phase: name, status, detail: str(input.note) });
    return phase;
  }

  bindAgent(board, input) {
    const sessionId = str(input.sessionId).trim();
    if (sessionId === "") throw new Error("bind-agent 需要 sessionId（子 Agent 的 durable id）");
    const existing = board.agents[sessionId];
    const at = nowMs();
    const taskId = str(input.taskId, existing === undefined ? "" : existing.taskId);
    let domainId = str(input.domainId, existing === undefined ? "" : existing.domainId);
    const entry = {
      sessionId,
      label: str(input.label, existing === undefined ? "" : existing.label),
      taskId,
      kind: str(input.kind, existing === undefined ? "child" : existing.kind),
      role: str(input.role, existing === undefined ? "" : existing.role) || str(input.kind, existing === undefined ? "child" : existing.kind),
      domainId,
      // An expert spawning its own helper registers it; recording the parent
      // keeps the tree visible on the panel instead of flattening it.
      parentSessionId: str(input.parentSessionId, existing === undefined ? "" : existing.parentSessionId),
      boundAt: existing === undefined ? at : existing.boundAt,
    };
    if (taskId !== "") {
      const task = board.tasks[taskId];
      if (task === undefined) throw new Error(`找不到任务: ${taskId}（bind-agent 的 taskId 必须是已存在的任务）`);
      if (domainId === "" && task.domainId !== "") domainId = task.domainId;
      entry.domainId = domainId;
      if (!task.agents.includes(sessionId)) task.agents.push(sessionId);
      task.updatedAt = at;
    }
    board.agents[sessionId] = entry;
    if (entry.domainId !== "" && entry.role === "expert") this.setDomainOwner(board, entry.domainId, entry);
    this.record(board, {
      kind: "agent-bound",
      sessionId,
      taskId: entry.taskId,
      label: entry.label,
      detail: entry.kind,
    });
    return entry;
  }

  unbindAgent(board, input) {
    const sessionId = str(input.sessionId).trim();
    const entry = board.agents[sessionId];
    if (entry === undefined) return null;
    delete board.agents[sessionId];
    for (const task of Object.values(board.tasks)) {
      const index = task.agents.indexOf(sessionId);
      if (index >= 0) task.agents.splice(index, 1);
    }
    this.record(board, { kind: "agent-unbound", sessionId, taskId: entry.taskId, label: entry.label });
    return entry;
  }

  // ── expertise domains (the routing table) ───────────────────────────────

  /**
   * Create or update one expertise area. Idempotent on `id`, because the whole
   * point is that the SAME area keeps its accumulated context across requests.
   */
  defineDomain(board, input) {
    const id = str(input.id).trim();
    if (id === "") throw new Error("领域需要 id（如 npc-move、level-progression）");
    const at = nowMs();
    const existing = board.domains[id];
    const domain = normalizeDomain(id, {
      name: str(input.name, existing === undefined ? id : existing.name),
      skills: input.skills === undefined ? (existing === undefined ? [] : existing.skills) : strArray(input.skills),
      notes: str(input.notes, existing === undefined ? "" : existing.notes),
      ownerSessionId: existing === undefined ? "" : existing.ownerSessionId,
      ownerLabel: existing === undefined ? "" : existing.ownerLabel,
      createdAt: existing === undefined ? at : existing.createdAt,
      updatedAt: at,
    });
    board.domains[id] = domain;
    if (!board.domainOrder.includes(id)) board.domainOrder.push(id);
    if (existing === undefined) {
      this.record(board, { kind: "domain-defined", label: domain.name, detail: (domain.skills ?? []).join("/") });
    }
    return domain;
  }

  /** Point a domain at the expert that owns it (last writer wins). */
  setDomainOwner(board, domainId, agent) {
    const id = str(domainId).trim();
    if (id === "") return null;
    let domain = board.domains[id];
    if (domain === undefined) domain = this.defineDomain(board, { id, name: id });
    domain.ownerSessionId = str(agent.sessionId);
    domain.ownerLabel = str(agent.label);
    domain.updatedAt = nowMs();
    return domain;
  }

  /** Every domain an agent is an expert of. */
  domainsOf(board, sessionId) {
    const id = str(sessionId);
    return board.domainOrder
      .map((key) => board.domains[key])
      .filter((domain) => domain !== undefined && domain.ownerSessionId === id);
  }

  /** One domain, with the facts a routing decision needs. */
  domainDetail(board, domainId) {
    const id = str(domainId).trim();
    const domain = board.domains[id];
    if (domain === undefined) return null;
    return {
      ...domain,
      expert: this.expertOf(board, domain.ownerSessionId),
      tasks: this.tasksOfDomain(board, id),
    };
  }

  /**
   * Every task in one domain, or every task of one expert when `domainId` is
   * blank. Domain-less tasks fall back to their owning agent, so a board that
   * never declared domains still routes by "who worked on what before".
   */
  tasksOfDomain(board, domainId) {
    const id = str(domainId).trim();
    const found = [];
    for (const taskId of board.order) {
      const task = board.tasks[taskId];
      if (task === undefined) continue;
      if (id !== "") {
        if (task.domainId === id) found.push(task);
        continue;
      }
      if (task.domainId === "") found.push(task);
    }
    return found;
  }

  /** The expert entry behind an agent id, when the board has one. */
  expertOf(board, sessionId) {
    const entry = board.agents[str(sessionId)];
    if (entry === undefined) return null;
    const domains = this.domainsOf(board, entry.sessionId);
    return {
      sessionId: entry.sessionId,
      label: entry.label,
      role: entry.role,
      domainId: entry.domainId,
      domains: domains.map((domain) => ({ id: domain.id, name: domain.name })),
      taskId: entry.taskId,
      parentSessionId: entry.parentSessionId,
      boundAt: entry.boundAt,
    };
  }

  /**
   * The board's own routing view: every expert with the domains it owns, the
   * work currently in its hands, and the measurable activity the collector saw.
   */
  experts(board) {
    const at = nowMs();
    return Object.values(board.agents)
      .filter((agent) => agent.role === "expert")
      .map((agent) => {
        const activity = activityOf(board, agent.sessionId, at);
        const open = [];
        const closed = [];
        for (const taskId of board.order) {
          const task = board.tasks[taskId];
          if (task === undefined || !task.agents.includes(agent.sessionId)) continue;
          (TERMINAL_STATUS.has(task.status) ? closed : open).push(task);
        }
        return {
          sessionId: agent.sessionId,
          label: agent.label,
          domains: this.domainsOf(board, agent.sessionId).map((domain) => ({ id: domain.id, name: domain.name })),
          active: activity.active,
          totalMs: activity.totalMs,
          openTasks: open.map((task) => ({ id: task.id, title: task.title, status: task.status })),
          lastTaskAt: closed.length === 0 ? 0 : Math.max(...closed.map((task) => task.endedAt)),
          doneCount: closed.length,
          boundAt: agent.boundAt,
        };
      })
      .sort((left, right) => right.lastTaskAt - left.lastTaskAt);
  }

  /**
   * Route one incoming request to the expert whose accumulated context already
   * covers it.
   *
   * This is a SCORER, not a classifier: it returns ranked candidates plus the
   * evidence behind each score, and the dispatcher makes (and records) the
   * decision. Scoring is deliberately transparent — token overlap with the
   * domain's name, skills and notes, then a small bonus for the expert that
   * touched that domain most recently, because "who already has the context"
   * is the question being answered.
   */
  routeRequest(board, input = {}) {
    const request = str(input.request);
    const wantedId = str(input.domainId).trim();
    const requestTokens = tokenize(request);
    const minOverlap = Math.max(1, num(input.minOverlap, 1));
    const at = nowMs();
    const candidates = [];
    for (const id of board.domainOrder) {
      const domain = board.domains[id];
      if (domain === undefined) continue;
      const nameTokens = tokenize(domain.name);
      const skillTokens = tokenize([...(domain.skills ?? []), domain.notes ?? ""].join(" "));
      const nameHits = [...requestTokens].filter((token) => nameTokens.has(token));
      const skillHits = [...requestTokens].filter((token) => skillTokens.has(token));
      // A two-character CJK overlap is evidence; a single shared character is
      // merely a hint, so the two are weighted 3:1. Without that split, any
      // two Chinese sentences share enough characters to look like a match.
      const weigh = (hits) => hits.reduce((total, token) => total + (token.length > 1 ? 3 : 1), 0) * 0.5;
      const nameScore = weigh(nameHits);
      const skillScore = weigh(skillHits);
      const score = nameScore + skillScore;
      const tasks = this.tasksOfDomain(board, id);
      const lastTaskAt = tasks.reduce((latest, task) => Math.max(latest, task.endedAt || task.updatedAt || 0), 0);
      const expert = this.expertOf(board, domain.ownerSessionId);
      const open = tasks.filter((task) => !TERMINAL_STATUS.has(task.status));
      const exact = wantedId !== "" && wantedId === id;
      if (!exact && wantedId === "" && request !== "" && score < minOverlap) continue;
      candidates.push({
        domainId: id,
        domainName: domain.name,
        score: exact ? score + 100 : score,
        nameScore,
        skillScore,
        nameHits,
        skillHits,
        expert,
        openTasks: open.map((task) => ({ id: task.id, title: task.title, status: task.status })),
        taskCount: tasks.length,
        lastTaskAt,
        idle: expert === null ? false : !isAgentBusy(board, expert.sessionId, at),
      });
    }
    candidates.sort((left, right) => right.score - left.score || right.lastTaskAt - left.lastTaskAt);
    const best = candidates[0] ?? null;
    const confidence =
      best === null
        ? "none"
        : wantedId !== "" && best.domainId === wantedId
          ? "exact"
          : best.nameScore >= 3
            ? "high"
            : best.score >= 3
              ? "medium"
              : "low";
    return {
      request,
      domainId: wantedId,
      candidates,
      best,
      confidence,
      // What the dispatcher should do next, in one line. Routing is a
      // recommendation: the dispatcher still owns the decision and records it.
      advice:
        best === null
          ? "没有匹配的领域。这是一条全新方向的诉求：先定义一个新领域（pm_agent action=domain），再开一个新的专家 Agent 并把领域登记给它。"
          : best.expert !== null
            ? best.expert.openTasks !== undefined && best.expert.openTasks.length > 0
              ? `领域「${best.domainName}」已有专家 ${best.expert.sessionId.slice(0, 8)}（${best.expert.label || "无标签"}）在办 ${best.expert.openTasks.length} 条任务；同方向不要另开 Agent —— 把新诉求 send_message 给它，让它内部决定要不要再分。`
              : `领域「${best.domainName}」的专家是 ${best.expert.sessionId.slice(0, 8)}（${best.expert.label || "无标签"}）。把诉求 send_message 给它续做，不要新开 Agent —— 它已经有这个领域的上下文。`
            : `领域「${best.domainName}」（${best.domainId}）还没有负责人：开一个新的专家 Agent，用 pm_agent bind role=expert 把这个领域登记给它，然后派发。`,
    };
  }

  // ── resources ───────────────────────────────────────────────────────────

  defineResource(board, input) {
    const id = str(input.id).trim();
    if (id === "") throw new Error("资源需要 id（如 unity、private-server、build-slot）");
    const existing = board.resources[id];
    const resource = {
      id,
      label: str(input.label, existing === undefined ? id : existing.label),
      exclusive: input.exclusive !== false,
      holder: existing === undefined ? null : existing.holder,
      queue: existing === undefined ? [] : existing.queue,
      note: str(input.note, existing === undefined ? "" : existing.note),
      capacity: Math.max(1, num(input.capacity, 1)),
    };
    board.resources[id] = resource;
    return resource;
  }

  /**
   * Try to take a lease. `exclusive` resources admit one holder; a wait-queue
   * entry keeps the ordering visible instead of letting lines race.
   */
  acquireResource(board, input) {
    const id = str(input.id).trim();
    let resource = board.resources[id];
    if (resource === undefined) resource = this.defineResource(board, { id, label: str(input.label, id) });
    const holder = {
      sessionId: str(input.sessionId),
      label: str(input.label, resource.label),
      taskId: str(input.taskId),
      since: nowMs(),
    };
    if (resource.exclusive !== false && resource.holder !== null && resource.holder.sessionId !== holder.sessionId) {
      const queued = resource.queue.find((entry) => entry.sessionId === holder.sessionId);
      if (queued === undefined) {
        resource.queue.push({ sessionId: holder.sessionId, label: holder.label, taskId: holder.taskId, since: nowMs() });
        this.record(board, {
          kind: "resource-wait",
          sessionId: holder.sessionId,
          taskId: holder.taskId,
          label: resource.label,
          detail: `被 ${resource.holder.label || resource.holder.sessionId} 占用`,
        });
      }
      return { granted: false, resource };
    }
    if (resource.holder !== null && resource.holder.sessionId === holder.sessionId) {
      return { granted: true, resource, already: true };
    }
    resource.holder = holder;
    resource.queue = resource.queue.filter((entry) => entry.sessionId !== holder.sessionId);
    this.record(board, {
      kind: "resource-acquire",
      sessionId: holder.sessionId,
      taskId: holder.taskId,
      label: resource.label,
      detail: str(input.reason),
    });
    return { granted: true, resource };
  }

  /**
   * Release a lease. The ownership handoff is part of the release rather than
   * a separate step: a resource released to "nobody" while a line is queued
   * behind it is the exact race this whole mechanism exists to prevent, so the
   * queue head is promoted atomically and reported back as `next` (now the
   * holder). `grantNext` remains as a recovery path for a lease that was
   * force-released while waiters remained.
   */
  releaseResource(board, input) {
    const id = str(input.id).trim();
    const resource = board.resources[id];
    if (resource === undefined) throw new Error(`未定义的资源: ${id}`);
    const actor = str(input.sessionId);
    if (resource.holder !== null && actor !== "" && resource.holder.sessionId !== actor) {
      throw new Error(
        `令牌不在 ${actor} 手上，当前持有者是 ${resource.holder.label || resource.holder.sessionId}；` +
          `先与持有者确认释放，再改看板`,
      );
    }
    const released = resource.holder;
    resource.holder = null;
    this.record(board, {
      kind: "resource-release",
      sessionId: actor === "" ? (released === null ? "" : released.sessionId) : actor,
      taskId: released === null ? "" : released.taskId,
      label: resource.label,
      detail: str(input.note),
    });
    const queued = resource.queue.shift();
    if (queued === undefined) return { released, next: null, resource };
    resource.holder = { ...queued, since: nowMs() };
    this.record(board, {
      kind: "resource-acquire",
      sessionId: resource.holder.sessionId,
      taskId: resource.holder.taskId,
      label: resource.label,
      detail: "排队转交",
    });
    return { released, next: resource.holder, resource };
  }

  /**
   * The dispatcher handing a lease to a named expert.
   *
   * This exists because of the coordination model: the shared environment
   * (one Unity + one private server) is granted BY the dispatcher, never taken
   * by a worker on its own. `force` is the handoff path — the previous holder
   * already returned its result and the dispatcher verified the environment is
   * free, so the lease moves in one recorded step instead of two.
   */
  grantResource(board, input) {
    const id = str(input.id).trim();
    if (id === "") throw new Error("grant 需要资源 id（如 unity、private-server）");
    let resource = board.resources[id];
    if (resource === undefined) resource = this.defineResource(board, { id, label: str(input.label, id) });
    const sessionId = str(input.sessionId).trim();
    if (sessionId === "") throw new Error("grant 需要 sessionId（令牌交给谁）");
    const previous = resource.holder;
    const force = input.force === true;
    if (previous !== null && previous.sessionId !== sessionId && !force) {
      throw new Error(
        `${resource.label} 现在被 ${previous.label || previous.sessionId} 持有；` +
          `先让它交回（或确认它已结束）再转交，确需强制转交就传 force=true`,
      );
    }
    const holder = {
      sessionId,
      label: str(input.holderLabel, str(input.label, resource.label)),
      taskId: str(input.taskId),
      since: nowMs(),
    };
    resource.holder = holder;
    resource.queue = resource.queue.filter((entry) => entry.sessionId !== sessionId);
    this.record(board, {
      kind: "resource-acquire",
      sessionId,
      taskId: holder.taskId,
      label: resource.label,
      detail: force && previous !== null ? `调度强制转交（原持有者 ${previous.label || previous.sessionId}）` : str(input.note, "调度发放"),
    });
    return { granted: true, resource, previous };
  }

  /** Take a lease back (the dispatcher's own recovery path). */
  revokeResource(board, input) {
    const id = str(input.id).trim();
    const resource = board.resources[id];
    if (resource === undefined) throw new Error(`未定义的资源: ${id}`);
    const previous = resource.holder;
    if (previous === null) return { released: null, resource };
    resource.holder = null;
    this.record(board, {
      kind: "resource-release",
      sessionId: previous.sessionId,
      taskId: previous.taskId,
      label: resource.label,
      detail: str(input.note, "调度收回"),
    });
    if (input.promote === false) return { released: previous, next: null, resource };
    const queued = resource.queue.shift();
    if (queued === undefined) return { released: previous, next: null, resource };
    resource.holder = { ...queued, since: nowMs() };
    this.record(board, {
      kind: "resource-acquire",
      sessionId: resource.holder.sessionId,
      taskId: resource.holder.taskId,
      label: resource.label,
      detail: "排队转交",
    });
    return { released: previous, next: resource.holder, resource };
  }

  /** Advance the queue: hand a released resource to the next waiter. */
  grantNext(board, input) {
    const id = str(input.id).trim();
    const resource = board.resources[id];
    if (resource === undefined) throw new Error(`未定义的资源: ${id}`);
    if (resource.holder !== null) {
      throw new Error(`${resource.label} 仍被 ${resource.holder.label || resource.holder.sessionId} 持有，不能直接转交`);
    }
    const next = resource.queue.shift();
    if (next === undefined) return { granted: false, resource };
    resource.holder = { ...next, since: nowMs() };
    this.record(board, {
      kind: "resource-acquire",
      sessionId: next.sessionId,
      taskId: next.taskId,
      label: resource.label,
      detail: "排队转交",
    });
    return { granted: true, resource };
  }

  addNote(board, input) {
    const note = { id: mintId("note"), at: nowMs(), taskId: str(input.taskId), text: str(input.text) };
    if (note.text.trim() === "") throw new Error("note 需要 text");
    board.notes.push(note);
    if (board.notes.length > MAX_NOTES) board.notes.splice(0, board.notes.length - MAX_NOTES);
    this.record(board, { kind: "task-note", taskId: note.taskId, detail: note.text.slice(0, 200) });
    return note;
  }

  // ── read models ─────────────────────────────────────────────────────────

  /**
   * One compact view for the model: counts, the active lanes with elapsed
   * time, resource ownership, and the per-agent activity the collector saw.
   */
  summary(board, options = {}) {
    const at = nowMs();
    const counts = { total: 0 };
    for (const status of TASK_STATUS) counts[status] = 0;
    let agentCount = 0;
    const active = [];
    for (const id of board.order) {
      const task = board.tasks[id];
      if (task === undefined) continue;
      counts.total += 1;
      counts[task.status] = (counts[task.status] ?? 0) + 1;
      agentCount += task.agents.length;
      if (!TERMINAL_STATUS.has(task.status)) {
        active.push({
          id: task.id,
          title: task.title,
          status: task.status,
          kind: task.kind,
          domainId: task.domainId,
          phase: task.phase,
          blockedReason: task.blockedReason,
          agents: task.agents.slice(),
          elapsedMs: task.startedAt === 0 ? 0 : (task.endedAt === 0 ? at : task.endedAt) - task.startedAt,
          phases: task.phases.map((phase) => ({
            name: phase.name,
            status: phase.status,
            durMs: phase.startedAt === 0 ? 0 : (phase.endedAt === 0 ? at : phase.endedAt) - phase.startedAt,
          })),
        });
      }
    }
    const resources = Object.values(board.resources).map((resource) => ({
      id: resource.id,
      label: resource.label,
      holder: resource.holder === null ? null : resource.holder.label || resource.holder.sessionId,
      holderSessionId: resource.holder === null ? null : resource.holder.sessionId,
      heldMs: resource.holder === null ? 0 : at - resource.holder.since,
      queue: resource.queue.map((entry) => entry.label || entry.sessionId),
    }));
    const liveAgents = Object.values(board.agents).map((agent) =>
      activityOf(board, agent.sessionId, at),
    );
    return {
      boardId: board.boardId,
      title: board.title,
      sessionId: board.sessionId,
      counts,
      agentCount,
      active,
      domains: this.experts(board),
      resources,
      agents: liveAgents,
      updatedAt: board.updatedAt,
      windowMs: num(options.windowMs, 24 * 3600 * 1000),
    };
  }

  /**
   * The Gantt view: one lane per task, one row per bound agent, spans merged
   * from the recorded timeline. `sinceMs` bounds the window (default 24 h).
   */
  gantt(board, options = {}) {
    const at = nowMs();
    const windowMs = num(options.windowMs, 24 * 3600 * 1000);
    const since = at - windowMs;
    /** @type {Map<string, {start:number,end:number,tools:Array<{at:number,durMs:number,tool:string}>,taskId:string}>} */
    const byAgent = new Map();
    const openTools = new Map();
    const openSpans = new Map();

    for (const event of board.timeline) {
      if (event.at < since) continue;
      const sessionId = event.sessionId;
      if (sessionId === "") continue;
      if (event.kind === "agent-start" || event.kind === "session-start") {
        const span = openSpans.get(sessionId);
        if (span !== undefined && span.end === 0) {
          span.end = event.at;
        }
        openSpans.set(sessionId, { start: event.at, end: 0, tools: [], taskId: event.taskId });
      } else if (event.kind === "agent-end" || event.kind === "session-end") {
        const span = openSpans.get(sessionId);
        if (span !== undefined) {
          span.end = Math.max(event.at, span.start + 1);
          openSpans.delete(sessionId);
          pushSpan(byAgent, sessionId, span);
        }
      } else if (event.kind === "tool-call") {
        openTools.set(sessionId + "|" + event.detail, event.at);
        const span = openSpans.get(sessionId);
        if (span === undefined) {
          // A tool call with no live span still proves the agent was working.
          openSpans.set(sessionId, { start: event.at, end: 0, tools: [], taskId: event.taskId });
        }
      } else if (event.kind === "tool-result") {
        const key = sessionId + "|" + event.detail;
        const started = openTools.get(key);
        openTools.delete(key);
        const span = openSpans.get(sessionId);
        if (span !== undefined) {
          span.tools.push({ at: started ?? event.at, durMs: event.durMs, tool: event.tool });
        } else {
          pushSpan(byAgent, sessionId, {
            start: started ?? event.at,
            end: event.at,
            tools: [{ at: started ?? event.at, durMs: event.durMs, tool: event.tool }],
            taskId: event.taskId,
          });
        }
      }
    }
    for (const [sessionId, span] of openSpans) {
      span.end = at;
      pushSpan(byAgent, sessionId, span);
    }

    const lanes = [];
    const claimed = new Set();
    for (const id of board.order) {
      const task = board.tasks[id];
      if (task === undefined) continue;
      const rows = [];
      for (const sessionId of task.agents) {
        claimed.add(sessionId);
        const spans = byAgent.get(sessionId);
        if (spans === undefined || spans.length === 0) continue;
        rows.push({
          sessionId,
          label: labelOf(board, sessionId),
          spans: spans.map((span) => ({
            start: span.start,
            end: span.end,
            tools: span.tools.slice(0, 60),
          })),
        });
      }
      const startedAny = task.startedAt !== 0 || rows.length > 0;
      if (!startedAny && TERMINAL_STATUS.has(task.status) === false && task.createdAt < since) continue;
      lanes.push({
        taskId: task.id,
        title: task.title,
        status: task.status,
        kind: task.kind,
        domainId: task.domainId,
        phase: task.phase,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        endedAt: task.endedAt,
        blockedReason: task.blockedReason,
        phases: task.phases.map((phase) => ({
          name: phase.name,
          status: phase.status,
          startedAt: phase.startedAt,
          endedAt: phase.endedAt,
        })),
        transitions: task.transitions.filter((item) => item.at >= since).map((item) => ({ at: item.at, to: item.to })),
        rows,
      });
    }
    // Agents the collector saw but nobody bound to a task: still worth showing.
    const orphans = [];
    for (const [sessionId, spans] of byAgent) {
      if (claimed.has(sessionId)) continue;
      const known = board.agents[sessionId];
      if (known !== undefined && known.taskId !== "" && board.tasks[known.taskId] !== undefined) continue;
      orphans.push({
        sessionId,
        label: labelOf(board, sessionId),
        spans: spans.map((span) => ({ start: span.start, end: span.end, tools: span.tools.slice(0, 60) })),
      });
    }
    return {
      windowMs,
      from: since,
      to: at,
      lanes,
      orphans,
      resources: Object.values(board.resources).map((resource) => ({
        id: resource.id,
        label: resource.label,
        holder: resource.holder,
        queue: resource.queue,
      })),
    };
  }

  /** Task-type / phase duration rollups the panel's metrics tab renders. */
  metrics(board, options = {}) {
    const at = nowMs();
    const windowMs = num(options.windowMs, 24 * 3600 * 1000);
    const since = at - windowMs;
    const byKind = new Map();
    const byPhase = new Map();
    let done = 0;
    let failed = 0;
    let durations = 0;
    let durationCount = 0;
    for (const id of board.order) {
      const task = board.tasks[id];
      if (task === undefined) continue;
      const kind = task.kind || "task";
      const bucket = byKind.get(kind) ?? { kind, total: 0, done: 0, failed: 0, open: 0, ms: 0 };
      bucket.total += 1;
      if (task.status === "done") {
        bucket.done += 1;
        done += 1;
      } else if (task.status === "failed" || task.status === "cancelled") {
        bucket.failed += 1;
        failed += 1;
      } else {
        bucket.open += 1;
      }
      if (task.startedAt !== 0 && task.endedAt !== 0) {
        bucket.ms += task.endedAt - task.startedAt;
        durations += task.endedAt - task.startedAt;
        durationCount += 1;
      }
      byKind.set(kind, bucket);
      for (const phase of task.phases) {
        if (phase.startedAt === 0) continue;
        if (phase.endedAt !== 0 && phase.endedAt < since) continue;
        const key = phase.name;
        const entry = byPhase.get(key) ?? { name: key, count: 0, ms: 0 };
        entry.count += 1;
        entry.ms += (phase.endedAt === 0 ? at : phase.endedAt) - phase.startedAt;
        byPhase.set(key, entry);
      }
    }
    const toolCounts = new Map();
    for (const event of board.timeline) {
      if (event.at < since || event.kind !== "tool-result" || event.tool === "") continue;
      const entry = toolCounts.get(event.tool) ?? { tool: event.tool, count: 0, ms: 0 };
      entry.count += 1;
      entry.ms += event.durMs;
      toolCounts.set(event.tool, entry);
    }
    const timelineByHour = new Array(24).fill(0);
    for (const event of board.timeline) {
      if (event.kind !== "tool-result") continue;
      const bucket = 23 - Math.floor((at - event.at) / 3600000);
      if (bucket >= 0 && bucket < 24) timelineByHour[bucket] += 1;
    }
    return {
      windowMs,
      from: since,
      to: at,
      total: board.order.length,
      done,
      failed,
      avgMs: durationCount === 0 ? 0 : Math.round(durations / durationCount),
      byKind: [...byKind.values()].sort((a, b) => b.total - a.total),
      byPhase: [...byPhase.values()].sort((a, b) => b.ms - a.ms),
      tools: [...toolCounts.values()].sort((a, b) => b.ms - a.ms).slice(0, 24),
      timelineByHour,
    };
  }
}

function pushSpan(map, sessionId, span) {
  const list = map.get(sessionId) ?? [];
  list.push(span);
  list.sort((a, b) => a.start - b.start);
  // merge touching spans so a pause-and-resume reads as one bar
  const merged = [];
  for (const item of list) {
    const last = merged[merged.length - 1];
    if (last !== undefined && item.start - last.end < 3000) {
      last.end = Math.max(last.end, item.end);
      last.tools = last.tools.concat(item.tools);
      continue;
    }
    merged.push({ start: item.start, end: item.end, tools: item.tools.slice(), taskId: item.taskId });
  }
  map.set(sessionId, merged);
}

function labelOf(board, sessionId) {
  const known = board.agents[sessionId];
  if (known !== undefined && known.label !== "") return known.label;
  for (const task of Object.values(board.tasks)) {
    if (task.agents.includes(sessionId)) return task.title;
  }
  return sessionId.slice(0, 12);
}

function activityOf(board, sessionId, at) {
  let lastEnd = 0;
  let active = false;
  let totalMs = 0;
  for (const event of board.timeline) {
    if (event.sessionId !== sessionId) continue;
    if (event.kind === "agent-start" || event.kind === "session-start") {
      active = true;
      lastEnd = event.at;
    } else if (event.kind === "agent-end" || event.kind === "session-end") {
      if (active) totalMs += event.at - lastEnd;
      active = false;
    }
  }
  if (active) totalMs += at - lastEnd;
  return { sessionId, active, totalMs };
}
