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

import { safeBoardId, EXPERT_NEEDS, tiersSatisfying } from "./store.js";

/** The tool name the dispatcher and the experts call. */
export const EXPERT_TOOL_NAME = "subagent_expert";

/** One-line description of one expert route, for logs, tool text and the panel. */
export function describeExpertRoute(route) {
  if (route === undefined || route === null || route.provider === "" || route.model === "") {
    return "未配置（设置 → 专家模型，或看板面板 → 专家）";
  }
  const effort = route.reasoningEffort === "" ? "模型默认档" : route.reasoningEffort;
  return `${route.provider}/${route.model}@${effort}${route.maxDepth === undefined ? "" : `（maxDepth ${route.maxDepth}）`}`;
}

/**
 * Constructor-safe abort signal for a delegation with no caller signal.
 *
 * Never `AbortSignal.abort()`: `startContinuable` calls
 * `spec.signal.throwIfAborted()` before composing the child, so an
 * already-aborted signal turns "the caller had no signal" into an
 * immediate, misleading AbortError. A fresh controller's signal is the
 * inert stand-in: present, and fires never.
 */
function fallbackSignal() {
  return typeof AbortController !== "undefined" ? new AbortController().signal : { aborted: false };
}

/**
 * Pick the tier one delegation runs on.
 *
 * The dispatcher chooses by TIER NAME (or merely declares hard needs); it never
 * hands over a raw provider/model pair, because a fast dispatcher model cannot
 * judge model ids — the operator's per-tier notes are what it reads. The rules:
 *
 *   - `tier` given    → that tier, or a refusal naming the valid ones;
 *   - `tier` omitted  → the default tier;
 *   - `needs` non-empty and the chosen tier lacks them:
 *       explicit tier  → refusal naming the tiers that DO satisfy (picking a
 *                        text-only model for a visual task fails twenty minutes
 *                        later as a bad frontend, not at dispatch);
 *       implicit default → escalate to the first configured tier that satisfies
 *                        (declaration order), reported as `escalated` so the
 *                        output can say the upgrade happened;
 *   - no configured tier satisfies → refusal with the way out (add one in
 *     Settings). A refusal is always preferable to a silent downgrade.
 */
export function resolveExpertTier(all, args) {
  const needs = (Array.isArray(args?.needs) ? args.needs : []).map((need) => String(need));
  const unknown = needs.filter((need) => !EXPERT_NEEDS.includes(need));
  if (unknown.length > 0) {
    throw new Error(`未知 needs: ${unknown.join(", ")}（目前只支持 ${EXPERT_NEEDS.join("/")} —— needs 只放「没有就干不了」的硬门槛）`);
  }
  const tierName = String(args?.tier ?? "").trim();
  const dft = all[0];
  if (dft === undefined || !dft.configured) {
    throw new Error(
      "专家模型还没配置：打开「设置 → 专家模型」（或看板面板 → 专家）选一个 服务商/模型 并保存" +
        "（写入 settings.json）。在任何模型被选中之前，插件不会替你说用哪个。",
    );
  }
  let chosen;
  let escalated = false;
  if (tierName !== "") {
    chosen = all.find((tier) => tier.name === tierName);
    if (chosen === undefined) {
      throw new Error(`没有档位「${tierName}」。当前档位：${all.map((tier) => tier.name).join("、")}`);
    }
    if (!chosen.configured) throw new Error(`档位「${tierName}」还没有配置路由（设置 → 专家模型 里补全或删掉它）`);
  } else {
    chosen = dft;
  }
  if (needs.length > 0 && tiersSatisfying([chosen], needs).length === 0) {
    const capable = tiersSatisfying(all, needs).filter((tier) => tier.configured);
    if (tierName !== "") {
      throw new Error(
        `档位「${tierName}」不具备 ${needs.join("+")} 能力。` +
          (capable.length > 0
            ? `满足的档位：${capable.map((tier) => tier.name).join("、")} —— 换档重派。`
            : `没有任何已配置档位满足 —— 去「设置 → 专家模型」加一档带该能力的。`),
      );
    }
    if (capable.length === 0) {
      throw new Error(
        `default 档不具备 ${needs.join("+")} 能力，且没有其它已配置档位满足。` +
          `去「设置 → 专家模型」加一档带该能力的（保存时会从模型元数据自动推导）。`,
      );
    }
    chosen = capable[0];
    escalated = true;
  }
  return { chosen, needs, escalated };
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
 * @param {() => Array<object>} options.tiers the CURRENT tier list (default
 *   first), read per call so a settings change is picked up without restarting.
 * @param {() => number} options.maxDepth the absolute depth cap (a property of
 *   the plugin's three-tier design, shared by every tier).
 * @param {(level: string, message: string) => void} [options.logger]
 */
export function createExpertDelegate({ subagents, tiers, maxDepth, logger = () => {} }) {
  return async function delegateExpert(args, exec) {
    const registry = subagents === undefined ? undefined : subagents();
    if (registry === undefined) {
      throw new Error(
        "这个部署没有 subagents 注册表（宿主组合未挂载委派后端），无法派专家。请把 @deepseek-ai/dsh-subagent 及其 spawn 后端加进 profile。",
      );
    }
    const parent = exec === undefined ? undefined : exec.agent;
    if (parent === undefined) throw new Error(EXPERT_TOOL_NAME + " 需要一个发起调用的 agent（exec.agent 为空）");

    const { chosen, needs, escalated } = resolveExpertTier(tiers(), args);
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
    const agentOptions = { provider: chosen.provider, model: chosen.model };
    if (chosen.reasoningEffort !== "") agentOptions.reasoningEffort = chosen.reasoningEffort;
    // The boardId a dispatcher cannot otherwise learn (its own session id is
    // never surfaced to it), auto-appended so the expert can write its internal
    // child lines onto the dispatcher's board. Only on the expert tier: an
    // expert delegating to its own helper must forward the DISPATCHER's
    // boardId in the prompt text (its own board is not the one to write).
    const role = String(args.role ?? "expert");
    const promptText =
      role === "helper"
        ? String(args.prompt)
        : String(args.prompt) +
          `\n\n——— 看板接线（插件自动附加，不要写进你对外的报告）———\n调度方看板 boardId：${safeBoardId(String(parent.id))}。需要把内部拆分显式化时：pm_task action=create boardId="${safeBoardId(String(parent.id))}" parentId=<你的任务 id>；登记下属：pm_agent action=bind boardId="${safeBoardId(String(parent.id))}" sessionId=<下属 id> taskId=<你的任务 id> role=helper parentSessionId=<你的 sessionId>。`;
    const depthCap = typeof maxDepth === "function" ? maxDepth() : 2;
    const request = {
      parent,
      prompt: [{ type: "text", text: promptText }],
      agentOptions,
      persona: String(args.persona),
      maxDepth: depthCap,
    };
    const started = await registry.startContinuable({
      provider: "spawn",
      label: String(args.description),
      request,
      signal,
    });
    logger("info", "pm-mode: expert started on tier " + chosen.name + " (" + describeExpertRoute(chosen) + ")");
    return {
      kind: "continuable",
      subagentId: String(started.childId),
      tier: chosen.name,
      route: describeExpertRoute({ ...chosen, maxDepth: depthCap }),
      escalated,
      needs,
    };
  };
}
