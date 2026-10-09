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
const PROMPT_SECTION = (root) =>
  [
    "[项目看板工具] 本会话是**总控**：一个用户诉求 = 一个专家 = 一条任务，内部怎么分工由专家自己决定。看板工具是这套模型的记账本，Web GUI 会话头部的「📋 项目看板」面板（含**专家**标签页）读的就是它们写下的状态。",
    "pm_mode —— 看板读写：action=summary（开新一轮或用户问「现在什么情况」先读它）、tasks、experts、agents、timeline、resources、note；资源动作用 define-resource / grant / revoke（独占资源 id 自定，例如 `shared-env`）；prune 清理旧看板。",
    "pm_task —— 维护任务：create（一个诉求一条，`requestedBy` 写用户原话、`domainId` 写领域；`boardId` 供专家把内部子线写到总控的看板上）、update（status=blocked 必须给 blockedReason；改状态会自动记一次转移）、phase、link、list。",
    "pm_agent —— 登记与判断材料：recommend（派发材料一次给全：领域职责、负责人、在办任务、未挂领域的专家、令牌现状；**不打分、不做关键词匹配**，归属由你自己判断）、domain、list、bind（专家要 `role=expert domainId=...`）、unbind、ctx。",
    "pm_memory —— **项目级经验记忆**：跨会话共享，只由你（总控）读写。写入门槛与检索规则以工具描述为准 —— 开工前、派发前先 `recall`；发现「下一个 Agent 靠常识会做错」的东西才 `remember`，写清 evidence；记错就 `forget`。",
    "subagent_expert —— 派一个领域专家（后台、可续做）。**模型由插件设置决定，插件不预设任何模型**（「设置 → 专家模型」或看板「专家」页配置）：派发时**省略 tier 一律 default 档**，只有活明显超重/超轻才按各档说明换档；任务涉及界面/截图/视觉验证时带 needs=[\"vision\"]（档位不满足会被拒绝并列出满足的档，那是保护不是故障）。boardId 由插件自动附加进任务书。",
    "调用纪律：",
    "1) 派发前先 `pm_agent action=list`（或 `action=recommend`）把材料看全，然后**用你自己的判断定归属**；判断落在已有领域且该领域已有专家，就把它 send_message 续做 —— 重开一个等于把查清的东西再查一遍。",
    "2) 一个诉求只建一条任务、只派一个专家。不要把诉求拆成多条任务分给多个 Agent —— 内部分工是专家的活。",
    "3) 专家负责的领域必须登记：`pm_agent bind role=expert domainId=...`；绑定后立刻改任务状态（planned → running），回收结果时改 review/done 并写 `evidence`；看板不写就不显示。",
    "4) 共享资源**只有总控能发放**：任务书里必须写明「你已持有令牌」或「你没有令牌，只做静态工作」；用完确认释放再转交。",
    "5) 专家跑完进入 idle 是正确状态，不要解绑 —— 它就是下一个同类诉求的首选。",
    `看板根目录：${root}（每块看板一个 JSON，可离线审计）；经验记忆同级存在 ${root}\\memory\\ 下。命令 /pm-mode status|boards|json 可查服务与数据。`,
  ].join("\n");

function apply(ctx) {
  const board = ctx.pmMode;

  for (const definition of createPmTools({
    store: board.store,
    collector: board.collector,
    subagents: board.subagents,
    memory: board.memory,
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
      tiers: () => board.tiers(),
      delegate: board.delegateExpert,
      describe: (active) => describeExpertRoute(active ?? board.expertModel()),
      // Powers the post-dispatch recall reminder: the output names how many
      // entries the caller's project holds, so "recall and top up the task
      // book" happens at the moment it is still cheap.
      memory: board.memory,
      // Records every delegation (tier + route) on the caller's board, so the
      // panel and the metrics can later answer "which tier did this run on".
      store: board.store,
    });
    ctx.effect(() => ctx.tools.register(expertTool), "pm-mode-preset expert tool register()");
  }

  ctx.systemPrompt.section({ name: "pm-mode-preset", order: 151, text: () => PROMPT_SECTION(board.root ?? "") });
}

// The preset row names this module (`dsh-pm-mode/preset`). The Loader's
// `unwrapExports` falls back to the MODULE NAMESPACE when there is no default
// export, and Cordis applies `namespace.apply` — which is why this shape works
// as a row with no `config` channel. `inject` is declared here rather than in
// the composition, which is the only place it can live for a subpath row.
export { apply, inject, name, PROMPT_SECTION };
