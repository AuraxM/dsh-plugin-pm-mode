/**
 * PM Mode — the host-plane half.
 *
 * Mounted once for the whole process by the profile's composition. It owns
 * everything a preset must not: the board store, the execution-timeline
 * collector, the same-origin panel route, and the `/pm-mode` command.
 *
 * It REGISTERS NOTHING MODEL-FACING, and that is the whole of the two-half
 * split. A row mounted by the profile is a root context, so `ctx.tools.register`
 * here would write into the process-global tool layer — the layer
 * `ToolRuntime.view(scope)` seeds EVERY agent's visible catalog from
 * (`new Map(this.layers.global.tools.entries())`). Registering the `pm_*`
 * toolset here therefore publishes it to every preset in the process, and a
 * `standard` session would read the board tools, their dispatcher doctrine, and
 * a prompt section telling it to keep a board honest that it has no tools for.
 *
 * The tools are published by `dsh-pm-mode/preset` into the mounting agent scope
 * instead — the one place that is scoped to the `pm` preset and still inherits
 * to the experts and helpers it spawns. This module keeps only the board's
 * single process-wide instance, which is what that row reads: `pmMode`.
 *
 * @module dsh-pm-mode
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BoardStore, TASK_STATUS, isRouteConfigured, isTierName, expertTiersOf, resolveExpertModelCatalog } from "./store.js";
import { startCollector } from "./collector.js";
import { createPmTools } from "./tools.js";
import { createPanelRouter, WEB_PREFIX } from "./routes.js";
import { createExpertDelegate, describeExpertRoute } from "./expert.js";

/** Cordis plugin name. */
const name = "pm-mode";

/**
 * Hard dependencies of the host half: the web server that carries the panel and
 * the timer the collector's poll needs.
 *
 * `tools` and `systemPrompt` are deliberately NOT here, even though the profile
 * composition has both. Neither is touched any more — the model-facing surface
 * belongs to `dsh-pm-mode/preset`, which injects them itself — and declaring
 * them would park the board, the panel route and the `pmMode` service on two
 * registries this half no longer reads.
 *
 * `commands` is deliberately NOT here either. The `/pm-mode` command is a
 * convenience, so it is read with `ctx.get('commands')` and simply skipped
 * where the human-command registry is absent — declaring it would park the
 * whole row on a capability the board does not actually need.
 */
const inject = ["webServer", "timer"];

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
 * It is a pure pass through — the definitions are already compiled by
 * `createPmTools` — and it lives HERE as a named seam rather than in the preset
 * row because `scripts/check-tools.mjs` (and `scripts/validate-preset.mjs` via
 * `dsh-pm-mode`) exercises the "parameters must be compiled" guarantee through
 * it. Being exported from the host module is not a licence to register from it:
 * see the module header for why a root context must publish no tool.
 *
 * @param {object} options
 * @param {import('./store.js').BoardStore} options.store
 * @param {{ liveStatus: () => Record<string, string> }} options.collector
 * @param {() => object | undefined} [options.subagents]
 * @param {import('./memory.js').MemoryStore} [options.memory]
 */
export function createPmToolset({ store, collector, subagents, memory }) {
  return createPmTools({ store, collector, subagents, memory });
}

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
  // composed session's experts run on. The delegate receives the TIER LIST: the
  // dispatcher picks a tier by name (or just declares hard needs like vision),
  // never a raw provider/model pair.
  const expertTiers = () => expertTiersOf(store.settings());
  const delegateExpert = createExpertDelegate({
    subagents,
    tiers: expertTiers,
    maxDepth: () => store.settings().expertModel.maxDepth,
    logger: (level, message) => ctx.logger?.[level === "warn" ? "warn" : "info"]?.(message),
  });

  /**
   * Validate one route against the live LLM adapter and derive its
   * capabilities. Validating HERE rather than at spawn time is the whole
   * reason the panel can be trusted: a route that does not resolve is rejected
   * while the operator is looking at the form, instead of becoming a confusing
   * failure in a session that starts ten minutes later.
   *
   * `vision` comes from the model's advertised input modalities — never from
   * an operator checkbox, because the adapter's answer is the one the runtime
   * will actually honor.
   */
  const validateRoute = async (wanted) => {
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
    const capabilities = { vision: (info.inputModalities ?? []).includes("image") };
    return { info, capabilities };
  };

  /**
   * Persist a new default expert route, refusing anything the live LLM adapter
   * cannot resolve. This is the legacy single-route write path: the default
   * tier IS `expertModel` until `expertTiers.default` exists.
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
    const { info } = await validateRoute(wanted);
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

  /**
   * Create or replace one named tier. "default" writes `expertTiers.default`
   * (which then shadows the legacy single route). Two default-only cases:
   *
   *   - an EMPTY route (provider/model both blank) CLEARS the default: removes
   *     `expertTiers.default` AND blanks the legacy `expertModel` route, back
   *     to 未配置. Refusing it would leave "return to unconfigured" with no
   *     panel path at all; a named NON-default tier with no route is still
   *     refused — an unconfigured named tier can only mislead the picker, and
   *     removing it is `deleteExpertTier`'s job;
   *   - `maxDepth` rides along: the depth cap is global (one value for every
   *     tier — it is a property of the plugin's three-tier design, not of any
   *     model), and the default card is where the panel edits it.
   */
  const setExpertTier = async (input, actor) => {
    const name = String(input && input.name !== undefined ? input.name : "").trim();
    if (!isTierName(name)) throw new Error("档位名必须是小写字母/数字/连字符（1-31 字符），例如 default / front / heavy");
    const wanted = {
      provider: String(input?.provider ?? "").trim(),
      model: String(input?.model ?? "").trim(),
      reasoningEffort: String(input?.reasoningEffort ?? "").trim(),
      note: String(input?.note ?? "").trim(),
    };
    const before = store.settings();

    if (!isRouteConfigured(wanted)) {
      if (name !== "default") {
        throw new Error(`档位「${name}」需要服务商和模型；想撤掉这档用删除档位`);
      }
      const tiers = { ...before.expertTiers };
      delete tiers.default;
      const saved = store.saveSettings({
        expertTiers: tiers,
        expertModel: {
          provider: "",
          model: "",
          reasoningEffort: "",
          maxDepth: before.expertModel.maxDepth,
          updatedAt: Date.now(),
          updatedBy: String(actor ?? ""),
        },
      });
      return { settings: saved, resolved: null, cleared: true };
    }

    const { info, capabilities } = await validateRoute(wanted);
    const tiers = { ...before.expertTiers };
    tiers[name] = { ...wanted, capabilities, updatedAt: Date.now(), updatedBy: String(actor ?? "") };
    const patch = { expertTiers: tiers };
    if (name === "default" && input?.maxDepth !== undefined) {
      const depth = Number(input.maxDepth);
      if (!Number.isSafeInteger(depth) || depth < 1 || depth > 5) throw new Error("maxDepth 必须是 1-5 的整数");
      patch.expertModel = { ...before.expertModel, maxDepth: depth };
    }
    const saved = store.saveSettings(patch);
    return { settings: saved, resolved: { id: info.id, name: info.name, provider: info.provider }, capabilities };
  };

  /** Remove one named tier. The default tier cannot be deleted — only cleared. */
  const deleteExpertTier = async (name) => {
    const wanted = String(name ?? "").trim();
    if (wanted === "default") {
      throw new Error("default 档不能删（它是专家路由的底线）；想清空它在 default 卡上用「清空为未配置」");
    }
    const before = store.settings();
    if (before.expertTiers[wanted] === undefined) throw new Error(`没有这个档位: ${wanted}`);
    const tiers = { ...before.expertTiers };
    delete tiers[wanted];
    return { settings: store.saveSettings({ expertTiers: tiers }) };
  };

  // The settings surface the panel route and the preset both read. One object,
  // so a route handler and the delegation cannot disagree about which value is
  // live.
  const settingsSurface = {
    settings: () => store.settings(),
    // The DEFAULT tier as a single route (legacy shape; preset.js reads it for
    // the tool description's "current route" line).
    expertModel: () => {
      const tiers = expertTiers();
      const dft = tiers[0];
      const settings = store.settings();
      return {
        provider: dft.provider,
        model: dft.model,
        reasoningEffort: dft.reasoningEffort,
        maxDepth: settings.expertModel.maxDepth,
        configured: dft.configured,
      };
    },
    tiers: expertTiers,
    setExpertModel,
    setExpertTier,
    deleteExpertTier,
    // The catalog's `current` is the EFFECTIVE default tier — which may live in
    // `expertTiers.default` — not the legacy `expertModel` slot it shadows.
    catalog: () => {
      const dft = expertTiers()[0];
      return resolveExpertModelCatalog(llm(), { provider: dft.provider, model: dft.model, reasoningEffort: dft.reasoningEffort });
    },
    // Effort vocabularies per tier: `catalog.efforts` describes the default
    // route only, and a tier card whose model differs would otherwise offer
    // ids that model never advertised (the save-time 400 would be the first
    // signal). Per-tier resolution happens on demand here — the form loads
    // lazily, so the cost is one adapter call per configured tier per open.
    tierEfforts: async () => {
      const active = llm();
      if (active === undefined) return {};
      const out = {};
      for (const tier of expertTiers()) {
        if (!tier.configured) continue;
        try {
          const info = await active.resolveModelInfo(tier.provider, tier.model);
          out[tier.name] = (info.reasoning?.efforts ?? []).map((effort) => effort.id);
        } catch {
          /* an unresolvable tier simply falls back to the shared list */
        }
      }
      return out;
    },
  };

  // Created after the settings surface exists: the panel route reads it (for
  // the active expert model and the mutation), so building the router first
  // would capture a binding that is still uninitialized.
  const router = createPanelRouter({
    store,
    collector,
    settings: settingsSurface,
    memory: store.memory,
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
        // The project-level experience memory — the store the dispatcher's
        // `pm_memory` tool writes to and the panel's 经验 tab reads. Published
        // here (rather than read off `store`) because the preset row registers
        // tools against this object and must not have to know its way around
        // the board store to find it.
        memory: store.memory,
        memoryRoot: store.memory.root,
        // The plugin's own settings surface. `expertModel()` returns the live
        // route (read from disk each call), `setExpertModel` validates and
        // persists it, and `delegateExpert` is the spawning implementation the
        // preset's expert tool calls — the settings therefore reach a
        // delegation without any composition row knowing about them.
        settings: settingsSurface.settings,
        expertModel: settingsSurface.expertModel,
        tiers: settingsSurface.tiers,
        setExpertModel: settingsSurface.setExpertModel,
        setExpertTier: settingsSurface.setExpertTier,
        deleteExpertTier: settingsSurface.deleteExpertTier,
        catalog: settingsSurface.catalog,
        delegateExpert,
        describeExpertRoute,
      }),
    "pm-mode provide()",
  );

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
