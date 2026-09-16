/**
 * PM Mode — the host-plane half.
 *
 * Mounted once for the whole process by the profile's composition. It owns
 * everything a preset must not: the board store, the execution-timeline
 * collector, the same-origin panel route, and the `/pm-mode` command. The
 * model-facing tools are built here and published by the `pm` agent preset,
 * so a session on any other preset never sees them in its catalog while the
 * storage underneath stays a single instance.
 *
 * @module dsh-pm-mode
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BoardStore, TASK_STATUS, isRouteConfigured, resolveExpertModelCatalog } from "./store.js";
import { startCollector } from "./collector.js";
import { createPmTools } from "./tools.js";
import { createPanelRouter, WEB_PREFIX } from "./routes.js";
import { createExpertDelegate, describeExpertRoute } from "./expert.js";

/** Cordis plugin name. */
const name = "pm-mode";

/**
 * Hard dependencies of the host half: the tool registry the preset reads, the
 * prompt-section registry, the web server that carries the panel, and the
 * timer the collector's poll needs.
 *
 * `commands` is deliberately NOT here. The `/pm-mode` command is a
 * convenience, so it is read with `ctx.get('commands')` and simply skipped
 * where the human-command registry is absent — declaring it would park the
 * whole row (and with it the panel route and the `pmMode` service) on a
 * capability the board does not actually need.
 */
const inject = ["tools", "systemPrompt", "webServer", "timer"];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(HERE, "..");

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0 ? minutes + "m" : hours + "h" + String(minutes).padStart(2, "0") + "m";
}

function fmtStamp(ms) {
  if (!ms) return "-";
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Compose the PM toolset over one store, for whichever context publishes it.
 *
 * There is exactly ONE caller — the `pm` agent preset's row — and the
 * definitions are already compiled by `createPmTools`, so this is a pure pass
 * through. It is kept as a named seam because `scripts/check-tools.mjs`
 * registers through it, which is where the "parameters must be compiled"
 * guarantee is actually verified.
 *
 * @param {object} options
 * @param {import('./store.js').BoardStore} options.store
 * @param {{ liveStatus: () => Record<string, string> }} options.collector
 * @param {() => object | undefined} [options.subagents]
 */
export function createPmToolset({ store, collector, subagents }) {
  return createPmTools({ store, collector, subagents });
}

const PROMPT_SECTION = (root) =>
  [
    "[项目看板 pm-mode] 你这条会话有一块专属项目看板，Web GUI 会话头部「📋 项目看板」按钮打开它：24 小时甘特图（哪条线在跑、过去每步花了多久）、任务看板、共享资源令牌、统计。",
    "看板的唯一数据来源是你的工具调用 + 运行时采集器。采集器自动记录每个子 Agent 的起止与它每一步工具调用的耗时，但**任务本身**只有你写才知道 —— 所以每次派发/回收/改判之后都要更新任务状态，否则看板显示的不是真的。",
    "标准用法：",
    "1. 拆完任务立刻 pm_task action=create 建线（kind 与 phases 按任务实际情况写，不要套固定类型；一条开发线常见 探索→设计→实现→验证→修复，bug 线通常 复现→定位→修复→回归）。",
    "2. 派发前 pm_agent action=list：同方向优先 send_message 续做，需要你的对话上下文用 subagent_fork，只有全新方向才开新 Agent。",
    "3. 拿到子 Agent 的 sessionId 后 pm_agent action=bind 绑到任务上，看板才能把它画在那条线的泳道里；否则会落到「未归属」杂项泳道。",
    "4. 推进时 pm_task action=phase 走阶段、action=update 改状态；status=blocked 必须写 blockedReason。验收证据写进 evidence。",
    "5. 共享资源（Unity/私服/构建槽）用 pm_task 的看板资源动作治理：见 pm_mode action=resources，或看板面板上的令牌区 —— 任一时刻只允许一个持有者，转交要显式。",
    `看板根目录：${root}（每块看板一个 JSON，可离线审计）。命令 /pm-mode status|boards|json 可查服务与数据。`,
  ].join("\n");

function apply(ctx) {
  const store = new BoardStore({
    logger: (level, message) => ctx.logger?.[level === "warn" ? "warn" : "info"]?.(message),
  });
  const collector = startCollector({
    ctx,
    store,
    logger: (level, message) => ctx.logger?.[level === "warn" ? "warn" : "info"]?.(message),
  });

  // Same-origin mount for the in-GUI panel. `webServer.register` returns a raw
  // disposer (not fiber-scoped), so it is captured and released in our own
  // effect; a duplicate from a stale previous mount is tolerated because it
  // serves the same on-disk root.
  let disposeRoute = null;
  try {
    disposeRoute = ctx.webServer.register({
      kind: "prefix",
      path: WEB_PREFIX,
      handler: (req, res) => {
        const raw = req.url || "/";
        let stripped = raw.slice(WEB_PREFIX.length);
        if (stripped === "" || stripped.startsWith("?")) stripped = "/" + stripped;
        req.url = stripped;
        router.handle(req, res);
      },
    });
  } catch (error) {
    ctx.logger?.warn?.(
      "pm-mode: " + WEB_PREFIX + " route already registered (stale from a previous mount; it serves the same board root, reusing it)",
      error && error.message ? error.message : error,
    );
  }

  ctx.effect(() => () => {
    try {
      if (disposeRoute) disposeRoute();
    } catch {
      /* route table already gone */
    }
    collector.flushDirty();
  }, "pm-mode route teardown");

  // The laziest possible read of the delegation registry: absent in a
  // deployment with no subagent backend, in which case `pm_agent list` still
  // answers from the board's own bindings.
  const subagents = () => ctx.get("subagents");

  // The live `llm` service, for validating a settings-supplied expert route.
  // Optional on purpose: a deployment without it still gets the panel and the
  // board, and the model picker says why it cannot validate anything.
  const llm = () => ctx.get("llm");

  // The expert delegation the plugin performs itself (see lib/expert.js for why
  // this is not a declarative composition row): the route is read per call from
  // the settings document, so changing it in the panel changes what the NEXT
  // composed session's experts run on.
  const expertRoute = () => {
    const settings = store.settings();
    return {
      provider: settings.expertModel.provider,
      model: settings.expertModel.model,
      reasoningEffort: settings.expertModel.reasoningEffort,
      maxDepth: settings.expertModel.maxDepth,
      configured: isRouteConfigured(settings.expertModel),
    };
  };
  const delegateExpert = createExpertDelegate({
    subagents,
    route: expertRoute,
    logger: (level, message) => ctx.logger?.[level === "warn" ? "warn" : "info"]?.(message),
  });

  /**
   * Persist a new expert route, refusing anything the live LLM adapter cannot
   * resolve.
   *
   * Validating HERE rather than at spawn time is the whole reason the panel can
   * be trusted: a route that does not resolve is rejected while the operator is
   * looking at the form, instead of becoming a confusing failure in a session
   * that starts ten minutes later.
   */
  const setExpertModel = async (patch, actor) => {
    const before = store.settings();
    const wanted = {
      ...before.expertModel,
      ...(patch === undefined || patch === null ? {} : patch),
    };
    // Choosing an empty route is a legitimate request ("forget it"), and it must
    // not be resolved against the adapter — there is no model to ask about.
    if (!isRouteConfigured(wanted)) {
      const cleared = store.saveSettings({
        expertModel: {
          provider: "",
          model: "",
          reasoningEffort: "",
          maxDepth: Number.isSafeInteger(Number(wanted.maxDepth)) ? Number(wanted.maxDepth) : before.expertModel.maxDepth,
          updatedAt: Date.now(),
          updatedBy: String(actor ?? ""),
        },
      });
      return { settings: cleared, resolved: null };
    }
    const active = llm();
    if (active === undefined) {
      throw new Error("这个部署没有 llm 服务，无法校验模型路由；拒绝写入以免派专家时才失败");
    }
    let info;
    try {
      info = await active.resolveModelInfo(wanted.provider, wanted.model);
    } catch (error) {
      throw new Error(
        `模型路由 ${wanted.provider}/${wanted.model} 无法解析：` +
          String(error && error.message ? error.message : error),
      );
    }
    // An EMPTY effort means "use the model's own default", so it is accepted
    // without further ado; a named one must be one the model advertises.
    const efforts = (info.reasoning?.efforts ?? []).map((effort) => effort.id);
    if (wanted.reasoningEffort !== "" && !efforts.includes(wanted.reasoningEffort)) {
      throw new Error(
        `模型 ${wanted.provider}/${wanted.model} 不支持 reasoning effort "${wanted.reasoningEffort}"；` +
          (efforts.length > 0 ? `可选：${efforts.join(", ")}` : "该模型没有声明任何档位，请留空用它的默认档"),
      );
    }
    const depth = Number(wanted.maxDepth);
    if (!Number.isSafeInteger(depth) || depth < 1 || depth > 5) {
      throw new Error("maxDepth 必须是 1-5 的整数");
    }
    const saved = store.saveSettings({
      expertModel: {
        provider: wanted.provider,
        model: wanted.model,
        reasoningEffort: wanted.reasoningEffort,
        maxDepth: depth,
        updatedAt: Date.now(),
        updatedBy: String(actor ?? ""),
      },
    });
    return { settings: saved, resolved: { id: info.id, name: info.name, provider: info.provider } };
  };

  // The settings surface the panel route and the preset both read. One object,
  // so a route handler and the delegation cannot disagree about which value is
  // live.
  const settingsSurface = {
    settings: () => store.settings(),
    expertModel: expertRoute,
    setExpertModel,
    catalog: () => resolveExpertModelCatalog(llm(), store.settings().expertModel),
  };

  // Created after the settings surface exists: the panel route reads it (for
  // the active expert model and the mutation), so building the router first
  // would capture a binding that is still uninitialized.
  const router = createPanelRouter({
    store,
    collector,
    settings: settingsSurface,
    logger: (level, message) => ctx.logger?.[level]?.(message),
  });

  // Publish the board to whatever agent scope wants the tools. This lands in
  // the ROOT realm because a host row provides it, which is exactly why the
  // `pm` preset's row can read it without owning it — and why that row must
  // publish nothing itself (a preset service would have to sit behind an
  // `isolate` realm it cannot share with the host).
  ctx.effect(
    () =>
      ctx.provide("pmMode", {
        store,
        collector,
        subagents,
        prefix: WEB_PREFIX,
        root: store.root,
        // The plugin's own settings surface. `expertModel()` returns the live
        // route (read from disk each call), `setExpertModel` validates and
        // persists it, and `delegateExpert` is the spawning implementation the
        // preset's expert tool calls — the settings therefore reach a
        // delegation without any composition row knowing about them.
        settings: settingsSurface.settings,
        expertModel: settingsSurface.expertModel,
        setExpertModel: settingsSurface.setExpertModel,
        catalog: settingsSurface.catalog,
        delegateExpert,
        describeExpertRoute,
      }),
    "pm-mode provide()",
  );

  const toolset = createPmToolset({ store, collector, subagents });
  for (const definition of toolset) {
    ctx.effect(() => ctx.tools.register(definition), "pm-mode tools.register()");
  }

  ctx.systemPrompt.section({ name: "dsh-pm-mode", order: 150, text: () => PROMPT_SECTION(store.root) });

  const jsonState = (sessionId) => {
    const board = sessionId === "" ? null : store.get(sessionId);
    if (board === null) return { service: "pm-mode", root: store.root, boards: store.listBoardIds().length, session: null };
    return {
      service: "pm-mode",
      root: store.root,
      prefix: WEB_PREFIX,
      session: {
        boardId: board.boardId,
        title: board.title,
        counts: store.summary(board).counts,
        tasks: board.order.length,
        agents: Object.keys(board.agents).length,
      },
    };
  };

  const commands = ctx.get("commands");
  if (commands !== undefined && typeof commands.register === "function") {
    commands.register({
      name: "pm-mode",
      description: "项目看板：查看/控制 PM 看板服务（status|boards|json）",
      input: { hint: "[status|boards|json]" },
      handler: async (invocation) => {
        const arg = String(invocation.rawInput || "").trim().toLowerCase();
        const sessionId = invocation.agent === undefined ? "" : String(invocation.agent.id);
        try {
          if (arg === "json") {
            return { kind: "success", text: JSON.stringify(jsonState(sessionId)) };
          }
          if (arg === "boards" || arg === "ls") {
            const found = store.listBoardIds();
            if (found.length === 0) return { kind: "success", text: "（还没有任何 PM 看板）" };
            return {
              kind: "success",
              text: found
                .map((entry) => {
                  const board = store.get(entry.boardId);
                  return `${entry.boardId}  ｜  ${board === null ? "?" : board.title}  ｜  更新 ${fmtStamp(entry.mtime)}`;
                })
                .join("\n"),
            };
          }
          const found = store.listBoardIds();
          return {
            kind: "success",
            text:
              `on 项目看板服务运行中\n根目录 ${store.root} ｜ 看板 ${found.length} 块\n` +
              `面板（同源） ${WEB_PREFIX}/ ｜ 会话头部「📋 项目看板」按钮\n` +
              `本会话看板：${sessionId === "" ? "(无会话)" : sessionId}`,
          };
        } catch (error) {
          return { kind: "error", text: "pm-mode: " + String(error && error.message ? error.message : error) };
        }
      },
    });
  }

  ctx.logger?.info?.(
    "pm-mode: mounted (root " + store.root + ", panel " + WEB_PREFIX + ", package " + PACKAGE_ROOT + ")",
  );
}

export { apply, inject, name, WEB_PREFIX, createPmTools, BoardStore, startCollector };
