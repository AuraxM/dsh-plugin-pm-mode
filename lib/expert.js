/**
 * PM Mode — the expert delegation the plugin owns itself.
 *
 * ## Why this is not a composition row any more
 *
 * The expert tier used to be a declarative `@deepseek-ai/dsh-tool-subagent` row
 * in the preset's `agent.cordis.yml`, carrying an `agentOptions` with one
 * provider/model/effort pinned inside it. A composition config is resolved when
 * a session is COMPOSED, and nothing in the plugin API can rewrite it afterwards
 * — so "the expert's model" was only ever changeable by editing a YAML file and
 * starting a new session, and the file named one model on one machine.
 *
 * Delegating from here instead makes the route a settings value: the preset
 * reads it when it registers the tool, and each `execute` passes it to the
 * subagent registry. The capability this buys is exactly the one asked for —
 * pick the expert's model in the plugin's own panel, in any deployment.
 * This module holds no default route of its own; see `DEFAULT_EXPERT_MODEL` in
 * lib/store.js for why the plugin refuses rather than guesses when nothing has
 * been chosen.
 *
 * ## What is deliberately preserved from the row it replaces
 *
 * - `maxDepth`: the dispatcher is depth 0 and an expert is depth 1, so the
 *   configured cap stops a helper from starting a helper (see the preset's
 *   scout row, which enforces the same tiering declaratively).
 * - `persona`: the expert identity is supplied per delegation from
 *   `lib/expert-tool.js`, exactly as the row's `config.persona` was.
 * - `continuable`: `startContinuable` is the same lifecycle the row's
 *   `backgroundMode: continuable` used, so a child still returns a durable id
 *   immediately and the dispatcher stays free.
 *
 * @module dsh-pm-mode/expert
 */

/** The tool name the dispatcher and the experts call. */
export const EXPERT_TOOL_NAME = "subagent_expert";

/** One-line description of the active expert route, for logs and the panel. */
export function describeExpertRoute(route) {
  if (route === undefined || route === null || route.provider === "" || route.model === "") {
    return "未配置（设置 → 专家模型，或看板面板 → 专家）";
  }
  const effort = route.reasoningEffort === "" ? "模型默认档" : route.reasoningEffort;
  return `${route.provider}/${route.model}@${effort}（maxDepth ${route.maxDepth}）`;
}

/** Constructor-safe abort signal for a delegation with no caller signal. */
function fallbackSignal() {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.abort === "function"
    ? AbortSignal.abort()
    : { aborted: false };
}

/**
 * Build the expert delegation function.
 *
 * The route is supplied by the caller, never assumed here: this module has no
 * default provider, no default model and no default effort, because a plugin
 * that ships in one deployment must not dictate what another one runs on. A
 * route that is not configured is refused with an instruction, and an effort
 * that was not asked for is omitted so the model's own default applies.
 *
 * @param {object} options
 * @param {() => object | undefined} options.subagents resolves the live
 *   `subagents` registry lazily: the host row must mount even in a deployment
 *   that composes no delegation backend, and the failure belongs at the call,
 *   with a sentence a dispatcher can act on.
 * @param {() => { provider: string, model: string, reasoningEffort: string, maxDepth: number, configured?: boolean }} options.route
 *   the CURRENT expert route. Read per call, so a settings change is picked up
 *   without restarting anything.
 * @param {(level: string, message: string) => void} [options.logger]
 */
export function createExpertDelegate({ subagents, route, logger = () => {} }) {
  return async function delegateExpert(args, exec) {
    const registry = subagents === undefined ? undefined : subagents();
    if (registry === undefined) {
      throw new Error(
        "这个部署没有 subagents 注册表（宿主组合未挂载委派后端），无法派专家。请把 @deepseek-ai/dsh-subagent 及其 spawn 后端加进 profile。",
      );
    }
    const parent = exec === undefined ? undefined : exec.agent;
    if (parent === undefined) throw new Error(EXPERT_TOOL_NAME + " 需要一个发起调用的 agent（exec.agent 为空）");

    const selected = route();
    // No configured route → refuse with the way out, rather than silently
    // inheriting the parent's model or picking one: whichever we guessed, the
    // operator would have no way to tell that their choice was never used.
    if (selected.provider === "" || selected.model === "") {
      throw new Error(
        "专家模型还没配置：打开「设置 → 专家模型」（或看板面板 → 专家）选一个 服务商/模型 并保存" +
          "（写入 settings.json 的 expertModel）。在任何模型被选中之前，插件不会替你说用哪个。",
      );
    }
    const provider = registry.getProvider("spawn");
    if (provider === undefined) {
      throw new Error('subagents 注册表里没有 "spawn" provider，无法派专家（检查宿主组合里的 subagent 后端行）');
    }
    const capabilities = provider.capabilities ?? {};
    if (capabilities.agentOptions !== true) {
      throw new Error('"spawn" provider 不支持 agentOptions，无法为专家指定模型');
    }
    if (capabilities.depthLimit !== true) {
      throw new Error('"spawn" provider 不支持 maxDepth，无法约束专家的下属层级');
    }

    const signal = exec.signal ?? fallbackSignal();
    // Depth is an ABSOLUTE cap validated by the registry (`childDepth =
    // delegationDepth(parent) + 1`, rejected when it exceeds maxDepth), so this
    // value is what stops an expert's helper from starting its own helper.
    //
    // `reasoningEffort` is omitted unless it was explicitly chosen: effort ids
    // are adapter-owned and model-specific, so "unset" must mean "the model's
    // own default" rather than a value this plugin invented.
    const agentOptions = { provider: selected.provider, model: selected.model };
    if (selected.reasoningEffort !== "") agentOptions.reasoningEffort = selected.reasoningEffort;
    const request = {
      parent,
      prompt: [{ type: "text", text: String(args.prompt) }],
      agentOptions,
      persona: String(args.persona),
      maxDepth: selected.maxDepth,
    };
    const started = await registry.startContinuable({
      provider: "spawn",
      label: String(args.description),
      request,
      signal,
    });
    logger("info", "pm-mode: expert started on " + describeExpertRoute(selected));
    return { kind: "continuable", subagentId: String(started.childId) };
  };
}
