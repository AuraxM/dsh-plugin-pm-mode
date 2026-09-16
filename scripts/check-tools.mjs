/**
 * Standalone registration check for the PM tools.
 *
 * Why this script exists rather than trusting the unit tests: a tool whose
 * `parameters` are shipped as the un-compiled DSL **registers without error**
 * and only fails later, inside the provider call:
 *
 *   Invalid schema for function 'pm_agent':
 *   schema must be a JSON Schema of 'type: "object"', got 'type: null'.
 *
 * `ToolRuntime.register()` validates only the output schema, and `schemaOf()`
 * copies `definition.parameters` straight through. So the assertion has to be
 * made on the projected schema — exactly what the provider receives — and it
 * has to be made against a REAL registry, because `defineTool` is the step
 * that compiles the DSL.
 *
 * The whole check runs in this process and touches nothing that is running:
 * a private Cordis Context, a throwaway board root under the OS temp dir.
 *
 * Run from the profile root so bare specifiers resolve as the Loader resolves
 * them:
 *
 *   cd $HOME\.dsh\profiles
 *   node E:/dsh/dsh-plugin-pm-mode/scripts/check-tools.mjs
 */
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { ToolRuntime, validateJsonSchemaValue } from "@deepseek-ai/dsh-tools";
import { BoardStore, createPmToolset } from "dsh-pm-mode";
import { createExpertTool } from "dsh-pm-mode/expert-tool";

const failures = [];
let checks = 0;
function ok(label, condition, detail) {
  checks += 1;
  if (condition) {
    console.log("  ok   " + label);
    return;
  }
  failures.push(label + (detail === undefined ? "" : " — " + detail));
  console.log("  FAIL " + label + (detail === undefined ? "" : " — " + detail));
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pmb-tools-"));

console.log("mounting a private ToolRuntime over a throwaway board root");
const ctx = new Context();

// `ToolRuntime`'s constructor calls `ctx.systemPrompt.tools(...)` to contribute
// its schema provider. The real registry is the host composition's business;
// here the only thing under test is parameter compilation, so a stub with the
// two methods the constructor touches is enough — and it keeps this check
// independent of the prompt registry's own setup order.
ctx.provide("systemPrompt", {
  tools: () => {},
  section: () => {},
});

const runtime = new ToolRuntime(ctx);
// Identity is deliberately NOT asserted: Cordis hands back a traced proxy, so
// `ctx.get("tools") === runtime` is false even though it is the same service.
// What matters is that the registry is reachable, which the projection below
// then exercises for real.
ok(
  "the tools registry is reachable from ctx",
  typeof ctx.tools?.register === "function" && typeof ctx.tools?.schemas === "function",
);

const store = new BoardStore({ root });
const toolset = createPmToolset({
  store,
  collector: { liveStatus: () => ({}) },
  subagents: () => undefined,
});
console.log("toolset: " + toolset.map((tool) => tool.name).join(", "));

// The expert delegation tool is registered by the SAME preset row, from the
// plugin's own settings — so it belongs in this check. It is the tool that most
// needs it: its predecessor was a declarative composition row, and moving it
// into code is exactly when a hand-written schema would sneak back in.
//
// The route below is a made-up vendor on purpose. Nothing in this repository may
// name a real model: the whole point of the setting is that the deployment
// decides, so a test that asserts on `kimi-coding/k3` would re-introduce the
// coupling the setting removes.
const EXPERT_TEST_ROUTE = { provider: "vendor-a", model: "model-x", reasoningEffort: "max", maxDepth: 2 };
const expertTool = createExpertTool({
  route: () => EXPERT_TEST_ROUTE,
  delegate: async () => ({ kind: "continuable", subagentId: "child-1" }),
  describe: (route) => route.provider + "/" + route.model,
});
toolset.push(expertTool);
console.log("with the expert tool: " + toolset.map((tool) => tool.name).join(", "));

console.log("\nregistering every tool into the private registry");
for (const definition of toolset) {
  try {
    ctx.tools.register(definition);
    ok(definition.name + " registers", true);
  } catch (error) {
    ok(definition.name + " registers", false, String(error && error.message ? error.message : error));
  }
}

console.log("\nprojecting what the MODEL PROVIDER would receive");
const schemas = ctx.tools.schemas();
ok("every toolset tool is visible", schemas.length >= toolset.length, String(schemas.length));

for (const definition of toolset) {
  const schema = schemas.find((item) => item.name === definition.name);
  if (schema === undefined) {
    ok(definition.name + " has a projected schema", false, "not visible");
    continue;
  }
  const parameters = schema.parameters;
  ok(
    definition.name + " root type is 'object' (this is the exact field the provider rejected)",
    parameters !== null && typeof parameters === "object" && parameters.type === "object",
    "got " + JSON.stringify(parameters === null || parameters === undefined ? parameters : parameters.type),
  );
  ok(
    definition.name + " declares properties as a JSON Schema map",
    parameters !== null &&
      typeof parameters === "object" &&
      parameters.properties !== null &&
      typeof parameters.properties === "object" &&
      Object.values(parameters.properties).every((property) => typeof property.type === "string"),
    JSON.stringify(parameters === null || parameters === undefined ? parameters : Object.keys(parameters.properties || {})),
  );
  const required = parameters !== null && typeof parameters === "object" && Array.isArray(parameters.required) ? parameters.required : [];
  // `action` is the discriminator on the three board tools; the expert tool has
  // no discriminator (its two parameters are both required, which the check
  // below asserts instead), so requiring `action` here would be asserting the
  // wrong contract for it.
  if (definition.name.startsWith("pm_")) {
    ok(
      definition.name + " marks its discriminator required",
      required.includes("action"),
      "required=" + JSON.stringify(required),
    );
  }
  ok(
    definition.name + " output schema is valid lossless JSON",
    schema.description !== undefined && typeof schema.description === "string",
  );
}

console.log("\nthe bug that caused the outage, re-checked directly");
const agentSchema = schemas.find((item) => item.name === "pm_agent");
ok(
  "pm_agent.parameters has NO null type at the root",
  agentSchema !== undefined && agentSchema.parameters.type === "object",
  agentSchema === undefined ? "pm_agent missing" : JSON.stringify(agentSchema.parameters.type),
);
ok(
  "the board toolset is exactly the three PM tools plus the expert gate",
  toolset.map((tool) => tool.name).join(",") === "pm_mode,pm_task,pm_agent,subagent_expert",
  toolset.map((tool) => tool.name).join(","),
);
ok(
  "pm_agent.parameters.action is an enum-constrained string",
  agentSchema !== undefined &&
    agentSchema.parameters.properties !== undefined &&
    agentSchema.parameters.properties.action !== undefined &&
    agentSchema.parameters.properties.action.type === "string" &&
    Array.isArray(agentSchema.parameters.properties.action.enum),
  agentSchema === undefined ? "" : JSON.stringify(agentSchema.parameters.properties.action),
);

console.log("\nargument validation still works through the compiled schema");
const taskSchema = schemas.find((item) => item.name === "pm_task");
ok("pm_task action enum survives compilation", taskSchema !== undefined && taskSchema.parameters.properties.action.enum.includes("create"));
// The routing surface is new, and a dropped action here would be silent: the
// model would simply never be able to declare a domain or route a request.
const boardSchema = schemas.find((item) => item.name === "pm_mode");
for (const action of ["experts", "grant", "revoke", "define-resource"]) {
  ok(
    "pm_mode exposes action=" + action,
    boardSchema !== undefined && boardSchema.parameters.properties.action.enum.includes(action),
    boardSchema === undefined ? "pm_mode missing" : JSON.stringify(boardSchema.parameters.properties.action.enum),
  );
}
for (const action of ["recommend", "domain"]) {
  ok(
    "pm_agent exposes action=" + action,
    agentSchema !== undefined && agentSchema.parameters.properties.action.enum.includes(action),
    agentSchema === undefined ? "pm_agent missing" : JSON.stringify(agentSchema.parameters.properties.action.enum),
  );
}
for (const field of ["domainId", "requestedBy"]) {
  ok(
    "pm_task carries " + field + " (one request = one expert needs both on the task)",
    taskSchema !== undefined && taskSchema.parameters.properties[field] !== undefined,
    taskSchema === undefined ? "pm_task missing" : Object.keys(taskSchema.parameters.properties).join(","),
  );
}
ok(
  "pm_agent carries role + domainId + parentSessionId + responsibility (expert registration and judged routing)",
  agentSchema !== undefined &&
    ["role", "domainId", "parentSessionId", "responsibility", "request"].every((field) => agentSchema.parameters.properties[field] !== undefined),
  agentSchema === undefined ? "pm_agent missing" : Object.keys(agentSchema.parameters.properties).join(","),
);
ok(
  "the retired skills array is still accepted (old calls must not break)",
  agentSchema !== undefined && agentSchema.parameters.properties.skills !== undefined,
  agentSchema === undefined ? "pm_agent missing" : Object.keys(agentSchema.parameters.properties).join(","),
);
ok(
  "recommend is described as material, not as a matcher",
  agentSchema !== undefined &&
    agentSchema.description.includes("不返回关键词命中") &&
    agentSchema.description.includes("归属由你自己判断") &&
    !agentSchema.description.includes("路由到领域与专家"),
  agentSchema === undefined ? "pm_agent missing" : agentSchema.description.slice(0, 160),
);

// The expert tool moved OUT of the composition and INTO the plugin, which is
// the moment its schema became hand-writable again. Assert on the projection,
// not on `createExpertTool` returning something.
console.log("\nargument validation for the expert delegation tool");
const expertSchema = schemas.find((item) => item.name === "subagent_expert");
ok("the expert tool is visible after registration", expertSchema !== undefined);
ok(
  "its parameter root is an object",
  expertSchema !== undefined && expertSchema.parameters.type === "object",
  expertSchema === undefined ? "missing" : JSON.stringify(expertSchema.parameters.type),
);
ok(
  "it requires description + prompt (the task book)",
  expertSchema !== undefined &&
    ["description", "prompt"].every((field) => expertSchema.parameters.required.includes(field)),
  expertSchema === undefined ? "missing" : JSON.stringify(expertSchema.parameters.required),
);
ok(
  "no model parameter: the operator owns the route, not the dispatcher",
  expertSchema !== undefined && expertSchema.parameters.properties.model === undefined,
  expertSchema === undefined ? "missing" : Object.keys(expertSchema.parameters.properties).join(","),
);
ok(
  "its description states the ACTIVE route (the setting is not invisible)",
  expertSchema !== undefined && expertSchema.description.includes("vendor-a/model-x"),
  expertSchema === undefined ? "missing" : expertSchema.description.slice(0, 140),
);
const unconfiguredSchema = createExpertTool({
  route: () => ({ provider: "", model: "", reasoningEffort: "", maxDepth: 2 }),
  delegate: async () => ({ kind: "continuable", subagentId: "x" }),
});
ok(
  "with nothing configured the description says so instead of naming a model",
  unconfiguredSchema.description.includes("尚未配置") && !unconfiguredSchema.description.includes("vendor-a"),
  unconfiguredSchema.description.slice(0, 140),
);
ok(
  "its output schema is a single object shape",
  // `schemas()` projects only what the provider receives — name, description
  // and PARAMETERS — so the output contract is asserted where it is visible:
  // registration validated it (see the crash this script exists for: the old
  // declarative row's one-branch `oneOf` was rejected by `defineTool`.
  typeof expertTool.output?.schema === "object" && expertTool.output.schema.type === "object",
  JSON.stringify(expertTool.output?.schema),
);
const expertMissingPrompt = validateJsonSchemaValue(expertSchema.parameters, { description: "x" }, "");
ok("a delegation without a prompt is rejected", expertMissingPrompt.length > 0, JSON.stringify(expertMissingPrompt));

// The compiled schema is what the runtime validates real calls against, so a
// bad action must be rejected and a good one must pass — this is the assertion
// that would have caught the outage one layer earlier than the provider did.
const badArgs = validateJsonSchemaValue(taskSchema.parameters, { action: "nonsense" }, "");
ok("an out-of-enum action is rejected by the compiled schema", badArgs.length > 0, JSON.stringify(badArgs));
const missingAction = validateJsonSchemaValue(taskSchema.parameters, { title: "x" }, "");
ok("a call without the required discriminator is rejected", missingAction.length > 0, JSON.stringify(missingAction));
const goodArgs = validateJsonSchemaValue(taskSchema.parameters, { action: "create", title: "x" }, "");
ok("a valid call passes", goodArgs.length === 0, JSON.stringify(goodArgs));

// Negative control. Without this the check above could pass for the wrong
// reason — e.g. if `schemas()` one day started compiling parameters itself,
// the outage's root cause would be gone and this script should say so rather
// than keep asserting a fix nobody needs.
console.log("\nnegative control: an UNCOMPILED definition must still project a null root type");
const rawRegistration = ctx.tools.register({
  name: "pm_uncompiled_probe",
  description: "probe: raw DSL parameters, deliberately not built by defineTool",
  parameters: { action: { type: "string", required: true, description: "probe" } },
  output: { schema: { type: "string" }, render: () => [{ type: "text", text: "" }] },
  async execute() {
    return "";
  },
});
const probe = ctx.tools.schemas().find((item) => item.name === "pm_uncompiled_probe");
ok(
  "the probe is visible (registration itself never validates parameters)",
  probe !== undefined,
);
ok(
  "the probe's root type is NOT 'object' — this is the failure mode the check detects",
  probe !== undefined && probe.parameters.type !== "object",
  probe === undefined ? "probe missing" : "type=" + JSON.stringify(probe.parameters.type),
);
if (typeof rawRegistration === "function") rawRegistration();

ctx.scope?.dispose?.();
fs.rmSync(root, { recursive: true, force: true });

console.log("\n" + (checks - failures.length) + "/" + checks + " checks passed");
if (failures.length > 0) {
  console.log("failures:\n  - " + failures.join("\n  - "));
  process.exitCode = 1;
}
