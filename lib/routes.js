/**
 * PM Mode — the panel's same-origin HTTP surface.
 *
 * The browser half never talks to the host over RPC: it reads and writes the
 * board through a prefix route registered on the dsh web server, exactly like
 * the other in-GUI panels of this deployment. That keeps the panel a plain
 * `fetch` consumer (no CORS, no extra port) and leaves one place — this file —
 * where the board's JSON view is defined.
 *
 *   GET  <prefix>/__health__          liveness probe used during install
 *   GET  <prefix>/__api__/state       one board: summary + gantt + metrics
 *   GET  <prefix>/__api__/boards      every board on disk, newest first
 *   GET  <prefix>/__api__/memory      one project's experience memory
 *   POST <prefix>/__api__/manage      human-launched board mutations
 *
 * Mutating a board from the browser is loopback-only: a LAN visitor may read
 * the board but never rewrite it.
 * @module dsh-pm-mode/routes
 */
import { TERMINAL_STATUS } from "./store.js";
import { MEMORY_KINDS } from "./memory.js";

/** Panel prefix mounted on the dsh web server. */
export const WEB_PREFIX = "/pm-mode";

/**
 * What the settings form is told after a save — and the reason it is a CONSTANT
 * rather than a literal inlined at the send site.
 *
 * The route test has to assert that the answer says WHEN the setting takes
 * effect, and a test that copies the sentence drifts the moment the wording is
 * touched: the check looked for「新开的会话」 while the sentence had said
 * 「无需重启或开新会话」 for three commits, so a green suite was really a stale
 * assertion. Exporting the sentence lets the test assert identity (same source,
 * nothing to drift) AND the promise itself (`无需重启`, the part an operator
 * acts on) — reword the sentence freely, keep the promise, stay green.
 */
export const EXPERT_MODEL_SAVED_NOTE = "已保存。专家路由是每次派发实时读的：下一个派出的专家就用这个模型，无需重启或开新会话。";

const MAX_BODY_BYTES = 65536;

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function isLoopback(req) {
  const address = req.socket === undefined ? "" : req.socket.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.trim() === "") {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

function windowFrom(query, fallback = 24 * 3600 * 1000) {
  const raw = query.get("windowMs");
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.max(value, 5 * 60 * 1000), 30 * 24 * 3600 * 1000);
}

/**
 * Build the route handler. `store` and `collector` are owned by the plugin
 * fiber; this module never registers anything itself.
 *
 * `settings` is optional and carries the plugin's own settings surface
 * (`catalog()`, `expertModel()`, `setExpertModel()`). The panel uses it to
 * render and change the expert model; when it is absent (a standalone test) the
 * settings routes answer 501 instead of pretending the feature exists.
 *
 * `memory` is the project-level experience store. It is read off `store` when
 * not passed, because it belongs to the board root and a caller that already
 * has the store should not have to hand over the same thing twice.
 */
export function createPanelRouter({ store, collector, settings = null, memory = store.memory, logger = () => {} }) {
  /** The combined view the panel renders in one round trip. */
  function statePayload(board, windowMs) {
    const summary = store.summary(board, { windowMs });
    summary.live = collector === undefined ? {} : collector.liveStatus();
    return {
      service: "pm-mode",
      prefix: WEB_PREFIX,
      boardId: board.boardId,
      title: board.title,
      sessionId: board.sessionId,
      // Which PROJECT this conversation is about — the board's own record, so
      // the panel can name it and the 经验 tab can say which memory it is
      // showing. Always present (empty when nothing is identified), because it
      // also serves as the reload probe: a field that appears ONLY when it has
      // a value cannot distinguish "no project" from "old code loaded".
      projectKey: board.projectKey ?? "",
      projectRoot: board.projectRoot ?? "",
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
      summary,
      gantt: store.gantt(board, { windowMs }),
      metrics: store.metrics(board, { windowMs }),
      notes: board.notes.slice(-40),
      // The routing table, rendered by the panel's 专家 tab: which domain is
      // owned by which expert, and what each expert currently has in hand.
      domains: board.domainOrder
        .map((id) => board.domains[id])
        .filter((domain) => domain !== undefined)
        .map((domain) => ({
          id: domain.id,
          name: domain.name,
          // Prose, not the retired keyword array: the panel shows what the
          // domain is for, and the board no longer ranks requests against it.
          responsibility: domain.responsibility,
          notes: domain.notes,
          ownerSessionId: domain.ownerSessionId,
          ownerLabel: domain.ownerLabel,
          updatedAt: domain.updatedAt,
          tasks: store.tasksOfDomain(board, domain.id).map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            endedAt: task.endedAt,
          })),
        })),
      experts: store.experts(board),
      // The plugin's own settings, so the panel can show the ACTIVE expert
      // route without a second round trip. The catalog (the expensive half) is
      // a separate endpoint the model picker fetches only when it opens.
      settings: settings === null ? null : { expertModel: settings.expertModel() },
      resources: Object.values(board.resources).map((resource) => ({
        id: resource.id,
        label: resource.label,
        exclusive: resource.exclusive !== false,
        holder: resource.holder,
        queue: resource.queue,
      })),
      tasks: board.order
        .map((id) => board.tasks[id])
        .filter((task) => task !== undefined)
        .map((task) => ({
          id: task.id,
          title: task.title,
          goal: task.goal,
          kind: task.kind,
          status: task.status,
          priority: task.priority,
          tags: task.tags,
          domainId: task.domainId,
          requestedBy: task.requestedBy,
          phase: task.phase,
          phases: task.phases,
          agents: task.agents,
          dependsOn: task.dependsOn,
          parentId: task.parentId,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          startedAt: task.startedAt,
          endedAt: task.endedAt,
          blockedReason: task.blockedReason,
          acceptance: task.acceptance,
          evidence: task.evidence,
          result: task.result,
          transitions: task.transitions.slice(-20),
        })),
    };
  }

  async function handleState(url, res) {
    const sessionId = url.searchParams.get("sessionId");
    const boardId = url.searchParams.get("boardId");
    const windowMs = windowFrom(url.searchParams);
    if ((sessionId === null || sessionId === "") && (boardId === null || boardId === "")) {
      sendJson(res, 400, { ok: false, error: "需要 sessionId 或 boardId" });
      return;
    }
    let board = null;
    if (boardId !== null && boardId !== "") board = store.get(boardId);
    if (board === null && sessionId !== null && sessionId !== "") {
      board = store.get(sessionId);
      if (board === null) board = store.open(sessionId);
    }
    if (board === null) {
      sendJson(res, 404, { ok: false, error: "找不到看板" });
      return;
    }
    sendJson(res, 200, { ok: true, ...statePayload(board, windowMs) });
  }

  function handleBoards(res) {
    const boards = store.listBoardIds().map((entry) => {
      const board = store.get(entry.boardId);
      if (board === null) {
        return { boardId: entry.boardId, title: entry.boardId, mtime: entry.mtime, counts: { total: 0 }, active: 0 };
      }
      let active = 0;
      for (const id of board.order) {
        const task = board.tasks[id];
        if (task !== undefined && !TERMINAL_STATUS.has(task.status)) active += 1;
      }
      return {
        boardId: board.boardId,
        sessionId: board.sessionId,
        title: board.title,
        mtime: entry.mtime,
        counts: { total: board.order.length, active },
        agents: Object.keys(board.agents).length,
        domains: board.domainOrder.length,
        experts: store.experts(board).length,
        resources: Object.values(board.resources).filter((resource) => resource.holder !== null).length,
      };
    });
    sendJson(res, 200, { ok: true, service: "pm-mode", prefix: WEB_PREFIX, boards });
  }

  /**
   * The expert-model settings form's data: every registered provider, its
   * advertised models, and the effort ids the CURRENT route accepts.
   *
   * Read-only and loopback-independent (a LAN reader may see which model is in
   * use), but the write goes through `__api__/manage`, which is loopback-only
   * like every other panel mutation.
   */
  async function handleModels(res) {
    if (settings === null || typeof settings.catalog !== "function") {
      sendJson(res, 501, { ok: false, error: "这个构建没有插件设置面（settings 未挂载）" });
      return;
    }
    const catalog = await settings.catalog();
    sendJson(res, 200, { ok: true, service: "pm-mode", prefix: WEB_PREFIX, catalog });
  }

  async function handleManage(req, url, res) {
    if (!isLoopback(req)) {
      sendJson(res, 403, { ok: false, error: "面板写操作仅限本机访问" });
      return;
    }
    const payload = await readBody(req);
    const action = typeof payload.action === "string" ? payload.action : "";

    // The plugin setting is deployment-wide, not board-scoped: it decides what
    // the NEXT composed session's experts run on, so it is handled BEFORE the
    // board lookup below (which would reject an unknown boardId).
    if (action === "set-expert-model") {
      if (settings === null || typeof settings.setExpertModel !== "function") {
        sendJson(res, 501, { ok: false, error: "这个构建没有插件设置面（settings 未挂载）" });
        return;
      }
      // Validate BEFORE handing the value to the store: the store's normalizer
      // falls back to the default for an unusable depth, and a silent fallback
      // on a form submit reads as "it saved" while nothing changed. A refusal
      // with the accepted range is the honest answer.
      const depth = Number(payload.maxDepth);
      if (payload.maxDepth !== undefined && (!Number.isSafeInteger(depth) || depth < 1 || depth > 5)) {
        sendJson(res, 400, { ok: false, error: "maxDepth 必须是 1-5 的整数（当前收到 " + String(payload.maxDepth) + "）" });
        return;
      }
      // A HALF-CHOSEN route is the dangerous input, and the UI can produce it:
      // switching the provider clears the model field, and if that submit slips
      // through (a stale disabled state on the button, a programmatic change),
      // the route is written as "provider set, model empty" — which later reads
      // as 未配置 and silently refuses every delegation. Clearing the route on
      // purpose is still allowed; it is sent as BOTH fields empty.
      const wantedProvider = String(payload.provider ?? "").trim();
      const wantedModel = String(payload.model ?? "").trim();
      if ((wantedProvider === "") !== (wantedModel === "")) {
        sendJson(res, 400, {
          ok: false,
          error:
            "服务商与模型必须一起选：当前 服务商=" + (wantedProvider || "(空)") + "、模型=" + (wantedModel || "(空)") +
            "。换成「未配置」请把两个都清空。",
        });
        return;
      }
      try {
        const saved = await settings.setExpertModel(
          {
            provider: wantedProvider,
            model: wantedModel,
            reasoningEffort: String(payload.reasoningEffort ?? "max").trim(),
            maxDepth: payload.maxDepth === undefined ? undefined : Number(payload.maxDepth),
          },
          "panel",
        );
        sendJson(res, 200, {
          ok: true,
          action,
          expertModel: saved.settings.expertModel,
          resolved: saved.resolved,
          note: EXPERT_MODEL_SAVED_NOTE,
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) });
      }
      return;
    }

    // The panel's memory writes. They go through the SAME store methods the
    // dispatcher's tool uses, so the panel is a second face on one source of
    // truth rather than a parallel editor: a human deleting a wrong entry here
    // and the agent deleting it with `pm_memory action=forget` leave identical
    // documents behind.
    //
    // Handled BEFORE the board lookup below, like `set-expert-model` and for the
    // same reason: memory is keyed by PROJECT, not by board. A reader who picked
    // a project by hand may have no board on screen at all, and the project
    // comes from the BOARD'S recorded key rather than the server's cwd — the
    // drawer can be open on any conversation, and filing a human's correction
    // into whichever checkout the harness happens to run in would be silent
    // data loss.
    if (action === "memory-remember" || action === "memory-forget") {
      const named = typeof payload.project === "string" ? payload.project.trim() : "";
      // Whether the project came from the CALLER naming it, or from the board on
      // screen. That distinction decides how the store is asked: a caller-named
      // project is an override (`input.project`), while the board's own project
      // IS the identity — passing its key as an override too would ask the store
      // to resolve a project that has no document yet, which is exactly the first
      // write, and it would refuse it.
      const byCaller = panelProject(named);
      const namedByCaller = byCaller !== null;
      let project = byCaller;
      if (project === null) {
        const owner = typeof payload.boardId === "string" && payload.boardId !== "" ? store.get(payload.boardId) : null;
        if (owner !== null && owner.projectKey !== "") project = { key: owner.projectKey, root: owner.projectRoot, name: "" };
      }
      if (project === null) {
        sendJson(res, 400, { ok: false, error: "无法确定要写哪个项目：这块看板没有项目归属，也没有指定 project" });
        return;
      }
      try {
        if (action === "memory-remember") {
          memory.remember({ key: project.key, root: project.root, name: project.name, cwd: "" }, {
            project: namedByCaller ? named : "",
            id: typeof payload.id === "string" ? payload.id : "",
            title: typeof payload.title === "string" ? payload.title : "",
            text: typeof payload.text === "string" ? payload.text : "",
            kind: typeof payload.kind === "string" ? payload.kind : "",
            tags: Array.isArray(payload.tags) ? payload.tags : undefined,
            evidence: typeof payload.evidence === "string" ? payload.evidence : "",
          });
        } else {
          memory.forget({ key: project.key, root: project.root, name: project.name, cwd: "" }, {
            project: namedByCaller ? named : "",
            id: String(payload.id ?? ""),
          });
        }
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) });
        return;
      }
      sendJson(res, 200, { ok: true, action, project: project.key });
      return;
    }

    const boardId = typeof payload.boardId === "string" ? payload.boardId : "";
    const board = boardId === "" ? null : store.get(boardId);
    if (board === null) {
      sendJson(res, 404, { ok: false, error: "找不到看板: " + boardId });
      return;
    }
    switch (action) {
      case "rename": {
        const title = typeof payload.title === "string" ? payload.title.trim() : "";
        if (title === "") throw new Error("title 不能为空");
        board.title = title;
        break;
      }
      case "note": {
        store.addNote(board, { taskId: typeof payload.taskId === "string" ? payload.taskId : "", text: String(payload.text ?? "") });
        break;
      }
      case "delete-task": {
        const id = typeof payload.taskId === "string" ? payload.taskId : "";
        if (board.tasks[id] === undefined) throw new Error("找不到任务: " + id);
        delete board.tasks[id];
        board.order = board.order.filter((item) => item !== id);
        for (const task of Object.values(board.tasks)) {
          task.dependsOn = task.dependsOn.filter((item) => item !== id);
          if (task.parentId === id) task.parentId = "";
        }
        store.record(board, { kind: "task-status", taskId: id, status: "cancelled", detail: "从面板删除" });
        break;
      }
      case "define-resource": {
        store.defineResource(board, {
          id: typeof payload.id === "string" ? payload.id : "",
          label: typeof payload.label === "string" ? payload.label : "",
          note: typeof payload.note === "string" ? payload.note : "",
        });
        break;
      }
      case "release-resource": {
        store.releaseResource(board, { id: String(payload.id ?? ""), sessionId: "", note: "面板强制释放" });
        break;
      }
      case "grant-next": {
        store.grantNext(board, { id: String(payload.id ?? "") });
        break;
      }
      default:
        sendJson(res, 400, { ok: false, error: "未知 action: " + action });
        return;
    }
    store.flush(board);
    sendJson(res, 200, { ok: true, action, boardId: board.boardId });
  }

  /**
   * Which project a panel action is about, from what the caller supplied.
   *
   * One resolver for the read path (`?project=`) and the write paths
   * (`memory-remember` / `memory-forget`), because they must agree: a reader who
   * can SEE a project by path in the URL must be able to delete an entry in it,
   * and vice versa. `project` is accepted as either a key this machine already
   * knows (what the panel echoes back after a read) or an absolute directory
   * (what a human pastes in) — the same two things the dispatcher's tool holds.
   *
   * NEVER the browsing process's cwd: the drawer can be open on any conversation,
   * and filing a human's correction into whichever checkout the harness happens
   * to run in would be silent data loss.
   *
   * @returns {{key: string, root: string, name: string}|null}
   */
  function panelProject(named) {
    const wanted = typeof named === "string" ? named.trim() : "";
    if (wanted === "") return null;
    const known = memory.projects().find((entry) => entry.key === wanted);
    if (known !== undefined) return { key: known.key, root: known.root, name: known.name };
    // A NAMED directory is obeyed rather than guessed at, so a checkout with no
    // marker the plugin recognizes can still be read — and corrected — from here.
    const resolved = memory.resolveNamed(wanted);
    if (resolved.key !== "") return { key: resolved.key, root: resolved.root, name: resolved.name };
    return null;
  }

  /**
   * The project-level experience memory, as the panel's 经验 tab reads it.
   *
   * Two lookups, because the panel holds a SESSION while the memory is keyed by
   * PROJECT: `sessionId` (the board the drawer is showing) is resolved to the
   * project that board recorded, and an explicit `project=<key>` overrides it so
   * a reader can inspect any project on this machine without leaving the drawer.
   *
   * A board with no project (a session opened outside any identifiable
   * checkout) is answered with `project: null` and the reason, rather than an
   * empty list that would read as "this project has learned nothing".
   */
  function handleMemory(url, res) {
    const explicit = url.searchParams.get("project");
    const sessionId = url.searchParams.get("sessionId");
    const query = url.searchParams.get("q") ?? "";
    const kind = url.searchParams.get("kind") ?? "";
    const limitRaw = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 200;

    const stripped = explicit === null ? "" : explicit.trim();
    let resolved = stripped === "" ? null : panelProject(stripped);
    let identity = resolved === null ? null : { key: resolved.key, root: resolved.root, name: resolved.name, reason: "explicit" };
    if (resolved === null && sessionId !== null && sessionId !== "") {
      // Read-only on purpose: `projectFor` would tag and flush the board from a
      // GET, and a panel poll must never be a board write.
      const board = store.get(sessionId);
      identity = board === null ? null : { key: board.projectKey, root: board.projectRoot, name: "", reason: "recorded" };
      resolved = board === null || board.projectKey === "" ? null : { key: board.projectKey, root: board.projectRoot, name: "" };
    }

    const projects = memory.projects();
    // The RESOLVED identity is handed over whole: the store needs both halves,
    // and a key alone would make it re-derive a key from the key.
    const view = resolved === null ? null : memory.view(resolved, { query, kind, limit });
    sendJson(res, 200, {
      ok: true,
      service: "pm-mode",
      prefix: WEB_PREFIX,
      root: memory.root,
      kinds: MEMORY_KINDS,
      project: view === null ? null : { key: view.document.key, root: view.document.root, name: view.document.name, cwds: view.document.cwds },
      identity,
      // Every project this machine has learned about, so the drawer can switch
      // without a second round trip.
      projects,
      total: view === null ? 0 : view.total,
      matches: view === null ? [] : view.matches.map((match) => ({ score: match.score, hits: match.hits, entry: match.entry })),
    });
  }

  /**
   * Route one mount-relative request (the caller strips the prefix).
   * An unexpected failure answers 500 with the message rather than throwing
   * into the web server's error path, so the panel can show it.
   */
  async function handle(req, res) {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === "/__health__") {
        sendJson(res, 200, {
          service: "pm-mode",
          magic: "pm-mode-ok",
          root: store.root,
          boards: store.listBoardIds().length,
        });
        return;
      }
      if (url.pathname === "/__api__/boards" && req.method === "GET") {
        handleBoards(res);
        return;
      }
      if (url.pathname === "/__api__/state" && req.method === "GET") {
        await handleState(url, res);
        return;
      }
      if (url.pathname === "/__api__/models" && req.method === "GET") {
        await handleModels(res);
        return;
      }
      if (url.pathname === "/__api__/memory" && req.method === "GET") {
        handleMemory(url, res);
        return;
      }
      if (url.pathname === "/__api__/manage" && req.method === "POST") {
        await handleManage(req, url, res);
        return;
      }
      sendJson(res, 404, { ok: false, error: "未知路径: " + url.pathname });
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      logger("warn", "pm-mode: request failed: " + message);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: message });
      else res.end();
    }
  }

  return { handle, statePayload };
}
