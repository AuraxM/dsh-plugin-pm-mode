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
- 你可以派**内部助手**（\`subagent_expert\` / \`subagent\`），但只在真的能省时间时才用：互不相干、可并行的取证或探索才值得拆；一条线上的多个步骤请你自己分批发完。
- 你的助手**不能再往下派**；你派出去的只能是执行者，不能是「负责人」。

## 内部子线怎么写进看板
- 需要把内部拆分显式化时：\`pm_task action=create boardId="<任务书里给你的 boardId>" parentId="<你的任务 id>" title=... kind=... phases=[...]\`。这样总控和用户在面板上能看到你在干什么，而不是一个黑盒。
- 推进时 \`pm_task action=update boardId=... id=... status=...\`；最终结论写进你自己那条任务：\`pm_task action=update id=<你的任务 id> result=... evidence=...\`。
- 派助手时 \`pm_agent action=bind boardId=... sessionId=<助手 id> taskId=<你的任务 id> role=helper parentSessionId=<你的 sessionId>\`。
- **任务书没有给你 boardId，就不要调这些工具**，直接干活。

## 环境令牌（硬约束）
- 任务书说「你**没有**环境令牌」就**绝对不要**碰 Unity / 私服：不启动、不重启、不进 Play、不发 GM、不热更脚本。静态分析、读日志、读代码随便做。
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

## 交付格式
- **结论**：做了什么、达成什么（对照验收标准逐条回答）
- **证据**：路径:行号 / 命令 / 日志 / 复现步骤
- **状态**：完成 / 部分完成（缺什么）/ 阻塞（卡在哪、需要什么）
- **资源**：如持有环境令牌，写明是否已释放
- **建议**：下一步（如有）`;

/**
 * Build the expert delegation tool over one live settings surface.
 *
 * @param {object} options
 * @param {() => { provider: string, model: string, reasoningEffort: string, maxDepth: number }} options.route
 *   the CURRENT expert route, read per call.
 * @param {(args: object, exec: object) => Promise<object>} options.delegate
 *   the spawning implementation (`pmMode.delegateExpert`).
 * @param {(route?: object) => string} [options.describe] one-line route summary.
 * @param {boolean} [options.expertMode] true when the registering session is
 *   itself an expert (depth ≥ 1): kept for message clarity only, since the
 *   declared `maxDepth` already refuses a helper's helper.
 */
export function createExpertTool({ route, delegate, describe }) {
  const describeRoute = typeof describe === "function" ? describe : (active) => `${active.provider}/${active.model}`;
  // The tool description is rebuilt per session composition, so it states the
  // route that session will actually delegate on — including "not configured",
  // which is the one state the dispatcher must not have to discover by failing.
  const configuredRoute = route();
  const configured = configuredRoute !== undefined && configuredRoute !== null && configuredRoute.provider !== "" && configuredRoute.model !== "";
  return defineTool({
    name: EXPERT_TOOL_NAME,
    description:
      "把**一整条任务**派给一个领域专家 Agent（后台、可续做：立刻返回持久 id，跑完会主动通知你）。" +
      "专家带着任务书进来、交一个结论出去；**内部怎么分工由它自己决定**（它可以自己再派内部助手）。" +
      (configured
        ? `专家模型由插件设置决定，当前：${describeRoute(configuredRoute)}。`
        : "⚠ 专家模型**尚未配置**：到「项目看板 → 资源 → 专家模型」选一个 服务商/模型 并保存，否则这次派发会被拒绝。") +
      "任务书要给：①用户诉求原文；②验收标准；③边界（能不能改代码、能不能占环境）。" +
      "任务书必须显式写明「你已持有 <资源> 令牌」或「你没有环境令牌，只做静态工作」—— 子 Agent 不会自己知道。",
    parameters: {
      description: { type: "string", required: true, description: "3-5 个词的任务描述，用于显示与看板标签" },
      prompt: { type: "string", required: true, description: "完整的任务书：诉求原文 + 验收标准 + 边界 + 环境令牌状态" },
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
        },
      },
      render: (_args, value) => {
        const id = value !== null && typeof value === "object" ? value.subagentId : undefined;
        return [
          {
            type: "text",
            text:
              id === undefined
                ? "❌ 派发失败"
                : `started subagent ${id}\n下一步：pm_task action=update 把它推成 running，并用 pm_agent action=bind role=expert domainId=... 把领域登记给它。`,
          },
        ];
      },
    },
    async execute(args, exec) {
      // The route is read at CALL time (inside `delegateExpert`), not captured
      // at build time, so a settings change applies to every delegation made
      // after it. This call also performs the "not configured" refusal.
      return await delegate({ description: String(args.description), prompt: String(args.prompt), persona: EXPERT_PERSONA }, exec);
    },
  });
}
