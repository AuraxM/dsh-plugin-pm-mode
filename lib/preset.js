/**
 * PM Mode — the agent-preset half.
 *
 * This is the row an agent preset mounts to give *its* sessions the board
 * tools. It is deliberately a second entry point rather than part of
 * `lib/index.js`: the host half is mounted once for the whole process and owns
 * the store, the collector and the panel route, while this half publishes
 * nothing at all. It only reads the `pmMode` service the host provided and
 * registers tools into the mounting agent scope, which is what keeps `pm_*`
 * out of every other preset's tool catalog.
 *
 * The row is mounted by the `pm` (总控) preset, and — because a delegated
 * child joins its parent's standing composition — by every expert and helper
 * that preset spawns. That is intentional: an expert uses the same tools with
 * an explicit `boardId` to record its internal split as child tasks on the
 * dispatcher's board.
 *
 * A preset row must not publish a service, so this file provides none — that
 * is the whole point of the split, and why it can be mounted by many sessions
 * without colliding.
 *
 * @module dsh-pm-mode/preset
 */
import { createPmTools } from "./tools.js";
import { createExpertTool } from "./expert-tool.js";
import { describeExpertRoute } from "./expert.js";

/** Cordis plugin name. */
const name = "pm-mode-preset";

/**
 * `pmMode` is a hard dependency: this row exists only to publish tools over
 * the host board service, so Cordis parks the row until that service appears
 * rather than registering a broken toolset. `tools` and `systemPrompt` are the
 * host registries this row registers INTO — both live on the host plane, so
 * they resolve from here exactly as `standard`'s rows resolve them.
 *
 * The expert delegation needs no extra service: `pmMode` carries both the
 * configured route and the spawning implementation (`delegateExpert`), because
 * the plugin owns that delegation rather than the composition. See
 * `lib/expert.js` for why.
 */
const inject = ["tools", "systemPrompt", "pmMode"];

/**
 * Where the dispatcher is told about the toolset. The preset's own persona
 * carries the operating model; this section is the mechanical half — what each
 * tool does, the call order that keeps the board honest, and the rules the
 * tools cannot enforce by themselves.
 */
const PROMPT_SECTION = [
  "[项目看板工具] 本会话是**总控**：一个用户诉求 = 一个专家 = 一条任务，内部怎么分工由专家自己决定。看板工具是这套模型的记账本，Web GUI 会话头部的「📋 项目看板」面板（含**专家**标签页）读的就是它们写下的状态。",
  "pm_mode —— PM 模式的看板工具：action=summary（在办线/专家/令牌一屏）、tasks、experts（领域与负责人花名册）、agents、timeline、resources、note；资源动作用 define-resource（声明 unity/private-server）、grant（发放令牌给某专家）、revoke（收回）。",
  "pm_task —— 维护任务：create（一个诉求一条，`requestedBy` 写用户原话、`domainId` 写领域；`boardId` 供专家把内部子线写到总控的看板上）、update（改状态/加证据，status=blocked 必须给 blockedReason）、phase（推进阶段）、link、list。",
  "pm_agent —— 路由与登记：recommend（用诉求原文查领域与负责人，返回下一步建议）、domain（定义/更新领域，skills 是路由关键词）、list（专家花名册 + 注册表）、bind（`role=expert domainId=...` 把领域登记给专家）、unbind、ctx。",
  "subagent_expert —— 派一个领域专家：后台（立刻返回持久 id，跑完主动通知你），专家自己决定内部分工。**模型由插件设置决定，插件不预设任何模型**（在「设置 → 专家模型」里选，看板面板「专家」页也有同一张表单；工具描述会写明当前用的是哪个，没配置时它直接说没配置）；你不需要、也不应该在每次派发时挑模型。",
  "调用纪律：",
  "1) 派发前先 `pm_agent action=recommend request=\"<用户原话>\"`；命中领域的专家就把它 send_message 续做 —— 它已经有那个领域的上下文，重开一个等于把查清的东西再查一遍。",
  "2) 一个诉求只建一条任务、只派一个专家。不要把诉求拆成多条任务分给多个 Agent —— 内部分工是专家的活。",
  "3) 专家负责的领域必须登记：`pm_agent bind role=expert domainId=...`。不登记，下次同类诉求就路由不到它。",
  "4) 绑定后立刻改任务状态（planned → running），回收结果时改 review/done 并写 `evidence`；看板不写就不显示。",
  "5) 共享资源（Unity/私服/构建槽）**只有总控能发放**：任务书里必须写明「你已持有令牌」或「你没有令牌，只做静态工作」；用完确认释放再转交。",
  "6) 专家跑完进入 idle 是正确状态，不要解绑 —— 它就是下一个同类诉求的首选。",
].join("\n");

function apply(ctx) {
  const board = ctx.pmMode;

  for (const definition of createPmTools({
    store: board.store,
    collector: board.collector,
    subagents: board.subagents,
  })) {
    ctx.effect(() => ctx.tools.register(definition), "pm-mode-preset tools.register()");
  }

  // The expert delegation tool, over the plugin's own settings. Registered
  // here rather than declared in the composition because its route is a
  // SETTING: a composition row's `agentOptions` is resolved at compose time and
  // cannot be rewritten afterwards, which is precisely the limitation this
  // replaces. Every session on this preset — the dispatcher and every expert it
  // spawns — gets the tool, and the route is re-read on each delegation.
  if (typeof board.delegateExpert === "function") {
    const expertTool = createExpertTool({
      route: () => board.expertModel(),
      delegate: board.delegateExpert,
      describe: (active) => describeExpertRoute(active ?? board.expertModel()),
    });
    ctx.effect(() => ctx.tools.register(expertTool), "pm-mode-preset expert tool register()");
  }

  ctx.systemPrompt.section({ name: "pm-mode-preset", order: 151, text: PROMPT_SECTION });
}

// The preset row names this module (`dsh-pm-mode/preset`). The Loader's
// `unwrapExports` falls back to the MODULE NAMESPACE when there is no default
// export, and Cordis applies `namespace.apply` — which is why this shape works
// as a row with no `config` channel. `inject` is declared here rather than in
// the composition, which is the only place it can live for a subpath row.
export { apply, inject, name, PROMPT_SECTION };
