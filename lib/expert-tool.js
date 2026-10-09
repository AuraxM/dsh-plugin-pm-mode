/**
 * PM Mode — the model-facing expert delegation tool.
 *
 * The tool is BUILT here (host half) but REGISTERED by the `pm` preset's row,
 * for the same reason `pm_mode` / `pm_task` / `pm_agent` are: a tool that only
 * a preset's sessions should see must be registered into that preset's agent
 * scope. What makes this one different is where the CONFIG lives — the route is
 * read from the plugin's settings at registration time (and again per
 * delegation), which is the whole point of the feature: the expert's model is
 * configuration, not a hard-coded composition row.
 *
 * `defineTool` is mandatory, exactly as `lib/tools.js` documents at length:
 * `ToolRuntime.register()` validates only the OUTPUT schema, so a hand-written
 * definition carrying the parameter DSL reaches the model provider uncompiled
 * and fails at the first call with "schema must be a JSON Schema of
 * type: 'object', got 'type: null'". `scripts/check-tools.mjs` covers both
 * families.
 *
 * @module dsh-pm-mode/expert-tool
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import { EXPERT_TOOL_NAME } from "./expert.js";

/**
 * The expert persona, installed per delegation.
 *
 * It lives here rather than in the preset's YAML because this module is what
 * performs the delegation now; the persona the row used to inject and the one
 * this call injects must be the same text, and keeping it beside the call is
 * what makes that checkable. `preset/agent.cordis.yml` carries no expert row.
 */
export const EXPERT_PERSONA = `你是总控派出的**领域专家 Agent**。一个专家负责一个领域，一个诉求交给你**一整条任务** —— 从问题本身到验收标准，都由你负责到底。

## 身份
- 你收到的任务书是**用户的原始诉求**，加上验收标准与边界。你已经有这个领域的上下文（上次查过什么、排除过什么），**不要从头重来**。
- **内部怎么分工由你自己决定。** 要先静态定位还是先跑现场、要不要拆成两条内部子线、要不要派助手，都是你的判断。总控不会替你排步骤。
- 你可以派**内部助手**（\`subagent_expert\` 传 \`role="helper"\`，或 \`subagent\` 侦察），但只在真的能省时间时才用：互不相干、可并行的取证或探索才值得拆；一条线上的多个步骤请你自己分批发完。
- 你的助手**不能再往下派**；你派出去的只能是执行者，不能是「负责人」。

## 内部子线怎么写进看板
- 任务书末尾插件会自动附加一行「调度方看板 boardId」。需要把内部拆分显式化时：\`pm_task action=create boardId="<任务书给你的 boardId>" parentId="<你的任务 id>" title=... kind=... phases=[...]\`。这样总控和用户在面板上能看到你在干什么，而不是一个黑盒。
- 推进时 \`pm_task action=update boardId=... id=... status=...\`；最终结论写进你自己那条任务：\`pm_task action=update id=<你的任务 id> result=... evidence=...\`。
- 派助手时用 \`subagent_expert\` 并传 \`role="helper"\`（助手人设与专家不同，别让它以为自己是负责人），然后 \`pm_agent action=bind boardId=... sessionId=<助手 id> taskId=<你的任务 id> role=helper parentSessionId=<你的 sessionId>\`。**给助手的任务书里要带上同一个 boardId**（它收到的是它自己调用方的看板，不是总控的）。
- **任务书没有给你 boardId，就不要调这些工具**，直接干活。

## 环境令牌（硬约束）
- 任务书说「你**没有**环境令牌」就**绝对不要**碰共享环境：不启动、不重启、不进入运行态、不下发管理指令、不重载脚本。静态分析、读日志、读代码随便做。
- 需要环境时先 \`send_message\` 给总控申请：说明「要哪套资源、用多久、用它验证哪一条断言」。**拿到令牌前一律按静态推进。**
- 任务书说「你**已持有**令牌」才可以用。用完必须**主动报告并释放**，并明确说「已释放，令牌可转交」。
- 你的助手同样不许碰环境 —— 就算是为了「顺手验证一下」也不行。

## 准则
1. **自己动手**：读代码、改代码、跑验证都自己来。不要写「建议由谁去做」。
2. **任务书即口径**：按诉求、验收标准、边界推进。有歧义时按最合理的解释做，并在报告里写明你的假设。
3. **证据说话**：交付时给可核查的证据 —— 文件路径与行号、执行过的命令、日志片段、复现步骤、截图路径。没有证据的结论等于没做。
4. **写操作要有回滚意识**：只做任务书允许范围内的写操作；改代码前先想清楚失败了怎么回滚。
5. **如实报告**：没做完、做错了、被卡住了就直说，说明卡在哪、需要什么。不要粉饰，也不要假装完成。
6. **报告要短**：结论 + 证据 + 状态 + 资源，不要堆思考过程。
7. **缺能力就报**：发现这条线需要你没有的能力（比如要看截图/界面效果，但派你的模型没有视觉），如实报回总控换档重派，不要硬撑着盲猜。

## 交付格式
- **结论**：做了什么、达成什么（对照验收标准逐条回答）
- **证据**：路径:行号 / 命令 / 日志 / 复现步骤
- **状态**：完成 / 部分完成（缺什么）/ 阻塞（卡在哪、需要什么）
- **资源**：如持有环境令牌，写明是否已释放
- **建议**：下一步（如有）`;

/**
 * The helper persona, installed when an expert delegates with `role="helper"`.
 *
 * A helper spawned through this tool used to receive EXPERT_PERSONA verbatim —
 * it then believed it reported to the dispatcher, owned a domain, and should
 * arbitrate resources, while its `send_message` actually reaches the EXPERT
 * that spawned it. This persona states the real topology: one task, one
 * report, up to the expert.
 */
export const HELPER_PERSONA = `你是专家派出的**内部助手 Agent**。你只执行，不再往下派。

## 身份
- 你的上级是派出你的那个专家，不是总控。做完用 send_message 把结论发回给它。
- 任务书是你的全部背景。任务书里给的 boardId 是总控的看板：被要求写内部子线时才用 pm_task/pm_agent 带 boardId 写，否则不要调。

## 准则
1. 只执行任务书范围内的动作；不写任务书未允许修改的文件。
2. 不碰共享环境 —— 除非任务书明确写「你已持有 <资源> 令牌」。
3. 证据说话：结论带路径:行号 / 命令 / 日志片段。
4. 如实报告：做完、没做完、卡住都直说。
5. 报告要短：结论 + 证据 + 状态。`;

/**
 * Build the expert delegation tool over one live settings surface.
 *
 * @param {object} options
 * @param {() => Array<object>} options.tiers the CURRENT tier list (default
 *   first), read per call — a settings change applies to the next delegation.
 * @param {(args: object, exec: object) => Promise<object>} options.delegate
 *   the spawning implementation (`pmMode.delegateExpert`).
 * @param {(route?: object) => string} [options.describe] one-line route summary.
 * @param {boolean} [options.expertMode] true when the registering session is
 *   itself an expert (depth ≥ 1): kept for message clarity only, since the
 *   declared `maxDepth` already refuses a helper's helper.
 * @param {import('./memory.js').MemoryStore} [options.memory] the project's
 *   experience memory. When present, a successful EXPERT-tier delegation
 *   reports how many entries the project holds, so the dispatcher is reminded
 *   — at the one moment topping up is still cheap — to recall the relevant
 *   ones and `send_message` them into the running expert's task book.
 * @param {import('./store.js').BoardStore} [options.store] the board store.
 *   When present, every successful delegation records an `agent-dispatch`
 *   event (tier + route) on the caller's board, so the panel and the metrics
 *   can later answer "which tier did this expert run on".
 */
export function createExpertTool({ tiers, delegate, describe, memory, store }) {
  const describeRoute = typeof describe === "function" ? describe : (active) => `${active.provider}/${active.model}`;
  // The tool description is rebuilt per session composition, so it states the
  // tiers that session will actually delegate on — including "not configured",
  // which is the one state the dispatcher must not have to discover by failing.
  const tierList = typeof tiers === "function" ? tiers() : [];
  const defaultTier = tierList[0];
  const configured = defaultTier !== undefined && defaultTier.configured === true;
  const tierSummary =
    tierList.length === 0
      ? ""
      : "档位：" +
        tierList
          .map((tier) => {
            const caps = tier.capabilities && tier.capabilities.vision === true ? "（带视觉）" : "";
            const note = tier.note ? "：" + tier.note : "";
            return `${tier.name}=${describeRoute(tier)}${caps}${note}`;
          })
          .join(" ｜ ") +
        "。";
  return defineTool({
    name: EXPERT_TOOL_NAME,
    description:
      "把**一整条任务**派给一个领域专家 Agent（后台、可续做：立刻返回持久 id，跑完会主动通知你）。" +
      "专家带着任务书进来、交一个结论出去；**内部怎么分工由它自己决定**（它可以自己再派内部助手）。" +
      (configured
        ? `专家模型由插件设置决定（按档位），当前 ${tierSummary}`
        : "⚠ 专家模型**尚未配置**：到「设置 → 专家模型」（或看板面板「专家」页）选一个 服务商/模型 并保存，否则这次派发会被拒绝。") +
      "任务书要给：①用户诉求原文；②验收标准；③边界（能不能改代码、能不能占环境）。" +
      "任务书必须显式写明「你已持有 <资源> 令牌」或「你没有环境令牌，只做静态工作」—— 子 Agent 不会自己知道。" +
      "调度方看板的 boardId 由插件自动附加进任务书，不用你找。专家派内部助手时传 role=\"helper\"。" +
      "档位选择：**省略 tier 一律 default**，只有活明显超重/超轻才换档（按各档说明判断）。任务涉及界面/截图/视觉验证时带 needs=[\"vision\"]；档位不满足 needs 会被拒绝并列出满足的档 —— 那是保护，不是故障。",
    parameters: {
      description: { type: "string", required: true, description: "3-5 个词的任务描述，用于显示与看板标签" },
      prompt: { type: "string", required: true, description: "完整的任务书：诉求原文 + 验收标准 + 边界 + 环境令牌状态" },
      role: {
        type: "string",
        enum: ["expert", "helper"],
        description: "省略=expert（总控派领域专家）。专家派自己的内部助手时传 helper：助手拿到的是执行者人设，并被告知上级是你而不是总控",
      },
      tier: {
        type: "string",
        description: "档位名（省略=default）。只选档，不写模型 id —— 各档的路由和说明由运营在「设置 → 专家模型」维护",
      },
      needs: {
        type: "array",
        items: { type: "string", enum: ["vision"] },
        description: "任务的硬能力门槛，只放「没有就干不了」的：vision=要看截图/做视觉验证。选中的档不满足会被拒绝并列出满足的档",
      },
    },
    output: {
      // A single object shape, NOT a `oneOf`: `defineTool` compiles this through
      // `valueSchemaSpecToJsonSchema`, which rejects a one-branch `oneOf`
      // ("schema.oneOf must be an array of at least two schemas"). The row this
      // tool replaces declared two branches because it also served the
      // non-continuable modes; this tool only ever starts a continuable child.
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", required: true, const: "continuable" },
          subagentId: { type: "string", required: true },
          // How many experience entries the caller's project holds (0 or
          // absent when the memory is unavailable/unidentified). Advisory —
          // it drives the recall reminder below, never the delegation.
          memoryTotal: { type: "number" },
          // Which tier the delegation actually started on (may differ from
          // the requested one when `needs` forced an escalation).
          tier: { type: "string" },
          route: { type: "string" },
          escalated: { type: "boolean" },
          // The hard needs the call declared, echoed back. EVERY field the
          // delegate returns must be declared here: the runtime validates the
          // output against this schema with additionalProperties:false, and a
          // rejection there reports "invalid output" AFTER the child already
          // started — the dispatcher retries and spawns a duplicate expert
          // per retry. That failure mode shipped once; smoke.mjs now pins the
          // return shape against this list.
          needs: { type: "array", items: { type: "string" } },
        },
      },
      render: (_args, value) => {
        const id = value !== null && typeof value === "object" ? value.subagentId : undefined;
        const memoryTotal = value !== null && typeof value === "object" && typeof value.memoryTotal === "number" ? value.memoryTotal : 0;
        const tierLine =
          value !== null && typeof value === "object" && typeof value.tier === "string" && value.tier !== ""
            ? `档位：${value.tier}（${value.route}）${value.escalated === true ? " —— needs 不满足原档，已自动升档" : ""}\n`
            : "";
        return [
          {
            type: "text",
            text:
              id === undefined
                ? "❌ 派发失败"
                : `started subagent ${id}\n${tierLine}下一步：pm_task action=update 把它推成 running，并用 pm_agent action=bind role=expert domainId=... 把领域登记给它。` +
                  (memoryTotal > 0
                    ? `\n📚 本项目记忆库有 ${memoryTotal} 条经验：如果任务书还没带上相关条目，现在 pm_memory action=recall query=... 查到后 send_message 补给它还来得及（经验不自动注入，由你判断带哪条）。`
                    : ""),
          },
        ];
      },
    },
    async execute(args, exec) {
      // The route is read at CALL time (inside `delegateExpert`), not captured
      // at build time, so a settings change applies to every delegation made
      // after it. This call also performs the "not configured" refusal and the
      // needs/tier hard-gate checks.
      const role = String(args.role ?? "expert") === "helper" ? "helper" : "expert";
      const started = await delegate(
        {
          description: String(args.description),
          prompt: String(args.prompt),
          persona: role === "helper" ? HELPER_PERSONA : EXPERT_PERSONA,
          role,
          tier: args.tier,
          needs: args.needs,
        },
        exec,
      );
      // Record the dispatch (tier + route) on the caller's board: without it,
      // "did the dispatcher pick the right tier" is unauditable. Best-effort —
      // a board hiccup must never break a delegation that already started.
      if (store !== undefined && exec?.agent?.id !== undefined) {
        try {
          const board = store.open(String(exec.agent.id));
          store.record(board, {
            kind: "agent-dispatch",
            sessionId: started.subagentId,
            label: String(args.description),
            detail: `档位 ${started.tier}（${started.route}）${started.escalated ? "｜needs 自动升档" : ""}`,
          });
          store.flush(board);
        } catch {
          /* advisory record only */
        }
      }
      // The recall reminder. Best-effort and read-only (`view`, never
      // `recall`, so the hint does not inflate hit counts); anything that can
      // go wrong simply yields no hint, because a memory hiccup must never
      // fail a delegation that already started. Helpers are excluded: they
      // report to their expert, and memory management is the dispatcher's job.
      let memoryTotal = 0;
      if (memory !== undefined && role === "expert") {
        try {
          const cwd = typeof exec?.agent?.session?.header?.cwd === "string" ? exec.agent.session.header.cwd : "";
          if (cwd !== "") {
            const identity = memory.resolveIdentity(cwd);
            if (identity.key !== "") {
              const view = memory.view({ key: identity.key, root: identity.root }, { limit: 1 });
              if (view !== null) memoryTotal = view.total;
            }
          }
        } catch {
          /* no hint, by design */
        }
      }
      return { ...started, memoryTotal };
    },
  });
}
