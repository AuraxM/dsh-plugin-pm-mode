/**
 * Static validation for the `pm` agent preset's composition.
 *
 * A preset can fail to mount in ways a YAML parse does not catch: a row whose
 * package does not resolve, or a subpath row whose module is not a usable
 * plugin (no `apply`, or no `inject` so it half-registers over an absent
 * service). Both are checked here against the REAL installed modules, so a
 * mistake surfaces before a session tries to use the preset.
 *
 * Run from the profile root (so bare specifiers resolve the way the Loader
 * resolves them):
 *
 *   node E:/dsh/dsh-plugin-pm-mode/scripts/validate-preset.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// `yaml` is not a dependency of this package (the deployment ships it), so the
// profile root's own resolver is used for both it and the composition's bare
// specifiers — which is also exactly how the Loader resolves those rows.
const PROFILE_ROOT = process.cwd();
const requireFromProfile = createRequire(path.join(PROFILE_ROOT, "package.json"));
const yaml = await import(pathToFileURL(requireFromProfile.resolve("yaml")).href);

// Overridable so the preset can be validated while it is disabled (`pm.disabled`
// is what an uninstall renames it to) — the composition is still checkable, and
// checking it BEFORE re-enabling is the point of this script.
const PRESET =
  process.env.PM_PRESET ??
  path.join(os.homedir(), ".dsh", ".agent-presets", "pm", "agent.cordis.yml");
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

/** `!!js <expr>` is a Loader expression, not data — keep it as text. */
const jsExpression = { tag: "!!js", resolve: (value) => ({ __js: value }) };

console.log("parsing " + PRESET);
const text = fs.readFileSync(PRESET, "utf8");
let rows;
try {
  rows = yaml.parse(text, { customTags: [jsExpression] });
} catch (error) {
  console.log("  FAIL yaml parse — " + String(error.message));
  process.exit(1);
}
ok("composition parses to a row array", Array.isArray(rows) && rows.length > 0, String(rows && rows.length));

function walk(entries, depth = 0) {
  const found = [];
  for (const row of entries ?? []) {
    if (row === null || typeof row !== "object") continue;
    if (typeof row.name === "string") found.push({ row, depth });
    if (Array.isArray(row.config) && row.group === true) found.push(...walk(row.config, depth + 1));
  }
  return found;
}

const named = walk(rows);
ok("every named row declares an id", named.every(({ row }) => typeof row.id === "string" && row.id !== ""));

const disabled = named.filter(({ row }) => row.disabled === true);
console.log("\nrows: " + named.length + " named, " + disabled.length + " disabled");
for (const { row, depth } of named) {
  console.log(
    "  " + "  ".repeat(depth) + (row.disabled === true ? "[disabled] " : "") + row.id + "  →  " + row.name,
  );
}

console.log("\nresolving every enabled row's package");
for (const { row } of named) {
  if (row.disabled === true) continue;
  if (row.name === "cordis:group") continue;
  try {
    const resolved = pathToFileURL(requireFromProfile.resolve(row.name)).href;
    await import(resolved);
    ok(row.id + " resolves and imports (" + row.name + ")", true);
  } catch (error) {
    ok(row.id + " resolves and imports (" + row.name + ")", false, String(error && error.message ? error.message : error));
  }
}

console.log("\nsubpath rows: the module must be a usable plugin by itself");
for (const { row } of named) {
  if (row.disabled === true || !row.name.includes("/")) continue;
  if (row.name.startsWith("@deepseek-ai/")) continue;
  try {
    const module = await import(row.name);
    // The Loader's `unwrapExports` falls back to the MODULE NAMESPACE when a
    // module has no default export, and Cordis then applies `namespace.apply`.
    // So a subpath row needs no `config` channel — it needs these two exports.
    ok(row.id + " (" + row.name + ") exports apply", typeof module.apply === "function");
    ok(
      row.id + " declares inject, so the row parks until its service exists",
      Array.isArray(module.inject) && module.inject.includes("pmMode"),
      JSON.stringify(module.inject),
    );
    ok(
      row.id + " has no dangling config (a subpath row has no config channel; a field here would be silently ignored)",
      row.config === undefined,
      JSON.stringify(row.config),
    );
  } catch (error) {
    ok(row.id + " (" + row.name + ") is usable", false, String(error && error.message ? error.message : error));
  }
}

console.log("\ngoal discipline: this preset must NOT be able to hand itself a goal");
// A PM session's own `idle` between rounds is the correct state (its child
// agents hold the work). The goal round driver reads `idle` as "wake it again"
// — `readyToDrive` is `agent.status === "idle" && !competingQueued` — and every
// wake injects a `<goal_round>` demanding concrete progress. Measured on
// session-a3fc6670: after `create_goal`, turns 2-5 burned 561-1325 input tokens
// each doing nothing but re-reading the board, and the one valuable round only
// happened after the user cleared the goal by hand. So `tool-goal` and
// `command-goal` are disabled rows, and re-enabling either silently restores
// the spin. This check is what makes that regression loud.
for (const id of ["tool-goal", "command-goal"]) {
  const entry = named.find(({ row }) => row.id === id);
  ok(id + " row is present", entry !== undefined);
  ok(
    id + " is disabled (goal self-drive is incompatible with a delegating manager)",
    entry !== undefined && entry.row.disabled === true,
    entry === undefined ? "" : "disabled=" + JSON.stringify(entry.row.disabled),
  );
}
const goalTools = named.filter(
  ({ row }) => row.disabled !== true && typeof row.name === "string" && row.name.includes("tool-goal"),
);
ok("no enabled row can publish goal tools", goalTools.length === 0, goalTools.map(({ row }) => row.id).join(","));

console.log("\nplane check: the board row must publish nothing");
const boardRow = named.find(({ row }) => row.id === "pm-tools");
ok("pm-tools exists", boardRow !== undefined);
ok(
  "pm-tools sits OUTSIDE the isolate group (pmMode lives in the root realm)",
  boardRow !== undefined && boardRow.depth === 0,
  boardRow === undefined ? "" : "depth " + boardRow.depth,
);
const isolateGroups = rows.filter((row) => row !== null && typeof row === "object" && row.isolate !== undefined);
console.log(
  "isolate realms declared: " + isolateGroups.map((row) => row.id + "(" + Object.keys(row.isolate).join(",") + ")").join(", "),
);

console.log("\nthe three-tier model: dispatcher → expert → the expert's internal helper");
// `maxDepth` is an ABSOLUTE cap the subagent registry validates on every
// delegation (`resolveChildDepth`: childDepth = delegationDepth(parent) + 1,
// rejected when childDepth > maxDepth).
//
// The EXPERT is no longer a row in this file: `dsh-pm-mode/preset` registers
// `subagent_expert` from the plugin so its model is a plugin setting (see
// lib/expert.js), and it reads its own cap from that setting (default 2). What
// remains here is the scout and the fork, both at 2 — which is what makes "a
// helper does not delegate" a runtime guarantee: a fork or scout started by an
// expert sits at depth 2 and cannot spawn anything further.
//
// Only the rows that actually DELEGATE carry maxDepth: `tool-subagent-control`
// and its `list-agents` companion share the package name but are the
// messaging/handle tools, which take no depth at all.
const delegationRows = named.filter(
  ({ row }) =>
    row.disabled !== true &&
    typeof row.name === "string" &&
    row.name.includes("tool-subagent") &&
    row.config !== undefined &&
    typeof row.config.provider === "string",
);
ok("the preset still mounts delegation tools", delegationRows.length > 0, String(delegationRows.length));
ok(
  "the declarative expert row is GONE (the plugin owns that delegation now)",
  named.every(({ row }) => row.id !== "tool-subagent-k3"),
  named
    .filter(({ row }) => row.id === "tool-subagent-k3")
    .map(({ row }) => row.id)
    .join(","),
);
for (const { row } of delegationRows) {
  ok(
    row.id + " (maxDepth: " + row.config?.maxDepth + ") cannot fan out past one internal level",
    row.config?.maxDepth === 2,
    "expected 2 (a helper at depth 2 spawns nothing at depth 3), got " + JSON.stringify(row.config?.maxDepth),
  );
}

console.log("\nthe expert route is a plugin setting, not a composition value");
const presetModule = await import("dsh-pm-mode/preset").catch((error) => ({ __error: String(error && error.message) }));
ok(
  "the preset module resolves and exports apply/inject",
  typeof presetModule.apply === "function" && Array.isArray(presetModule.inject),
  String(presetModule.__error ?? ""),
);
const expertToolModule = await import("dsh-pm-mode/expert-tool").catch((error) => ({
  __error: String(error && error.message),
}));
ok(
  "the plugin exports the expert tool factory",
  typeof expertToolModule.createExpertTool === "function",
  String(expertToolModule.__error ?? ""),
);
ok(
  "the expert persona travels with the plugin, not the composition",
  typeof expertToolModule.EXPERT_PERSONA === "string" &&
    expertToolModule.EXPERT_PERSONA.includes("领域专家 Agent") &&
    expertToolModule.EXPERT_PERSONA.includes("环境令牌"),
  String(expertToolModule.EXPERT_PERSONA ?? "").slice(0, 60),
);
const expertModule = await import("dsh-pm-mode/expert").catch((error) => ({ __error: String(error && error.message) }));
ok(
  "the plugin exports the delegation implementation",
  typeof expertModule.createExpertDelegate === "function",
  String(expertModule.__error ?? ""),
);
ok(
  "the expert tool name carries no model codename",
  expertModule.EXPERT_TOOL_NAME === "subagent_expert",
  String(expertModule.EXPERT_TOOL_NAME),
);
const storeModule = await import("dsh-pm-mode/store").catch((error) => ({ __error: String(error && error.message) }));
ok(
  "the shipped expert route names no provider and no model",
  storeModule.DEFAULT_EXPERT_MODEL !== undefined &&
    storeModule.DEFAULT_EXPERT_MODEL.provider === "" &&
    storeModule.DEFAULT_EXPERT_MODEL.model === "" &&
    storeModule.DEFAULT_EXPERT_MODEL.reasoningEffort === "",
  JSON.stringify(storeModule.DEFAULT_EXPERT_MODEL),
);

// ── the experience memory reaches BOTH halves ────────────────────────────────
// The board store OWNS the memory, the host half publishes it on `pmMode`, and
// the preset row has to hand it to the tool factory. A missed hand-off is
// invisible at every other layer — `createPmTools` defaults to `store.memory`,
// so the tools keep working while the PRESET path silently depends on a default
// — so the wiring is exercised here by actually applying the row against a stub
// context and inspecting what it registers.
console.log("\nproject experience memory: storage, and both composition halves");
const memoryModule = await import("dsh-pm-mode/memory").catch((error) => ({ __error: String(error && error.message) }));
ok(
  "the memory module resolves and exports its store factory",
  typeof memoryModule.createMemoryStore === "function" &&
    typeof memoryModule.resolveProjectRoot === "function" &&
    typeof memoryModule.projectKeyOf === "function",
  String(memoryModule.__error ?? ""),
);
ok(
  "the four kinds ship with the plugin (token / gotcha / recipe / finding)",
  Array.isArray(memoryModule.MEMORY_KINDS) &&
    ["token", "gotcha", "recipe", "finding"].every((kind) => memoryModule.MEMORY_KINDS.includes(kind)),
  JSON.stringify(memoryModule.MEMORY_KINDS),
);

const hostModule = await import("dsh-pm-mode").catch((error) => ({ __error: String(error && error.message) }));
ok(
  "the host half exports the memory store factory for the board store",
  typeof hostModule.createPmToolset === "function",
  String(hostModule.__error ?? ""),
);

// Apply the preset row for real: one stub context, then read the registrations
// back. The stub records every tool definition the row publishes.
const registeredTools = [];
let promptSections = 0;
const stubBoard = {
  store: { memory: { __marker: "the-board's-memory-store" } },
  collector: { liveStatus: () => ({}) },
  subagents: undefined,
  memory: { __marker: "the-board's-memory-store" },
  expertModel: () => ({ provider: "", model: "", reasoningEffort: "", maxDepth: 2, configured: false }),
  delegateExpert: () => {
    throw new Error("not called");
  },
};
let applyError = "";
try {
  presetModule.apply({
    pmMode: stubBoard,
    tools: {
      register: (definition) => {
        registeredTools.push(definition);
        return () => {};
      },
    },
    systemPrompt: {
      section: () => {
        promptSections += 1;
        return () => {};
      },
    },
    effect: (callback) => {
      const dispose = callback();
      return typeof dispose === "function" ? dispose : () => {};
    },
  });
} catch (error) {
  applyError = String(error && error.message ? error.message : error);
}
ok(
  "the preset row applies against a pmMode service and registers its tools",
  applyError === "" && registeredTools.length === 5,
  applyError !== "" ? applyError : "registered " + registeredTools.map((tool) => tool.name).join(","),
);
ok(
  "the applied row actually exposes pm_memory (not just the factory)",
  registeredTools.some((tool) => tool.name === "pm_memory"),
  registeredTools.map((tool) => tool.name).join(","),
);
ok(
  "the row publishes exactly one prompt section carrying the memory doctrine",
  promptSections === 1 &&
    typeof presetModule.PROMPT_SECTION === "string" &&
    presetModule.PROMPT_SECTION.includes("pm_memory") &&
    presetModule.PROMPT_SECTION.includes("子专家完全无感知"),
  "sections=" + String(promptSections) + " mentions=" + String(presetModule.PROMPT_SECTION.includes("pm_memory")),
);
ok(
  "the preset doctrine states the WRITE GATE, not just the tool name",
  typeof presetModule.PROMPT_SECTION === "string" &&
    presetModule.PROMPT_SECTION.includes("有别于常识") &&
    presetModule.PROMPT_SECTION.includes("靠常识会做错") &&
    presetModule.PROMPT_SECTION.includes("不要写"),
  "the doctrine is what keeps the store from filling with the obvious",
);
ok(
  "the preset doctrine says a stale entry must be deleted",
  typeof presetModule.PROMPT_SECTION === "string" && presetModule.PROMPT_SECTION.includes("forget"),
  "a memory nobody prunes misleads every later session",
);

// The host half must publish NO tool. That row is mounted by the profile, so its
// context is a root one and `ToolRuntime.view(scope)` seeds every agent's
// visible catalog from the process-global layer it would register into —
// `pm_*` (and its dispatcher doctrine) would then appear in EVERY preset, a
// `standard` session included. Measured before this check existed: a standard
// session listed pm_mode / pm_task / pm_agent / pm_memory plus the host's
// 「[项目看板 pm-mode]」 prompt section.
//
// Source history is not evidence, so the row is APPLIED here against a stub
// context and the registrations are read back. The stub is deliberately
// permissive: `tools` and `systemPrompt` are handed to the row as live
// registries, so a re-introduced `ctx.tools.register` cannot pass by throwing.
const hostIndex =
  (await import("node:fs")).readFileSync(
    (await import("node:path")).join((await import("node:url")).fileURLToPath(new URL(".", import.meta.url)), "..", "lib", "index.js"),
    "utf8",
  );
const hostTools = [];
const hostSections = [];
const hostServices = [];
let hostApplyError = "";
try {
  hostModule.apply({
    logger: { info: () => {}, warn: () => {} },
    get: () => undefined,
    on: () => () => {},
    interval: () => () => {},
    provide: (serviceName, value) => {
      hostServices.push({ serviceName, value });
      return () => {};
    },
    effect: (callback) => {
      const dispose = callback();
      return typeof dispose === "function" ? dispose : () => {};
    },
    tools: {
      register: (definition) => {
        hostTools.push(definition);
        return () => {};
      },
    },
    systemPrompt: {
      section: (section) => {
        hostSections.push(section);
        return () => {};
      },
    },
    webServer: { register: () => () => {} },
  });
} catch (error) {
  hostApplyError = String(error && error.message ? error.message : error);
}
ok(
  "the host half applies and publishes no model-facing tool",
  hostApplyError === "" && hostTools.length === 0,
  hostApplyError !== "" ? hostApplyError : "registered " + hostTools.map((tool) => tool.name).join(","),
);
ok(
  "the host half publishes no prompt section either (a global section teaches a toolset the session may not have)",
  hostSections.length === 0,
  hostSections.map((section) => section.name).join(","),
);
ok(
  "the host half still publishes pmMode for the preset row (and the panel) to read",
  hostServices.some(
    (entry) => entry.serviceName === "pmMode" && entry.value !== undefined && entry.value.store !== undefined,
  ),
  hostServices.map((entry) => entry.serviceName).join(","),
);
ok(
  "the host half no longer depends on tools/systemPrompt (its row reads neither)",
  Array.isArray(hostModule.inject) &&
    !hostModule.inject.includes("tools") &&
    !hostModule.inject.includes("systemPrompt"),
  JSON.stringify(hostModule.inject),
);
ok(
  "the host publishes the memory store on the pmMode service",
  /memory:\s*store\.memory/.test(hostIndex),
  "the preset row reads it off that object",
);
ok(
  "the host panel router is built with the memory store",
  /createPanelRouter\(\{[\s\S]{0,200}?memory:\s*store\.memory/.test(hostIndex),
  "the 经验 tab reads through that router",
);

// The structural version of the same promise: no shipped source may name a
// vendor or a model, so a future edit cannot quietly re-introduce a default.
// Comments are stripped first — these files document the value that was removed,
// and a comment is not a runtime default. The package scope (`@deepseek-ai/…`)
// is NOT a model route, so `deepseek` is matched only in a version-shaped form
// (`deepseek-v4-pro`, `deepseek-chat`, …), never bare.
const vendorOffenders = [];
{
  const fs = await import("node:fs");
  const path = await import("node:path");
  const url = await import("node:url");
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const patterns = [
    /\bkimi[A-Za-z0-9._-]*/i,
    /\bmoonshot[A-Za-z0-9._-]*/i,
    /\bdeepseek-(?!ai\/)[a-z0-9][a-z0-9.-]*/i,
    /\bgpt-[0-9a-z.-]+/i,
    /\bclaude-[0-9a-z.-]+/i,
  ];
  for (const name of ["expert.js", "expert-tool.js", "store.js", "preset.js", "index.js", "tools.js", "routes.js"]) {
    const body = fs.readFileSync(path.join(here, "..", "lib", name), "utf8");
    const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const pattern of patterns) {
      for (const hit of code.matchAll(new RegExp(pattern.source, "gi"))) {
        vendorOffenders.push(name + " → " + hit[0]);
      }
    }
  }
}
ok(
  "no shipped source names a vendor or a model (outside comments)",
  vendorOffenders.length === 0,
  vendorOffenders.join("; "),
);

console.log("\ndoctrine: one request = one task = one expert");
const personaRow = named.find(({ row }) => row.id === "persona");
const doctrine = personaRow === undefined ? "" : String(personaRow.row.config?.prefix ?? "");
ok("the persona row carries a doctrine", doctrine.length > 400, String(doctrine.length) + " chars");
for (const [label, needle] of [
  ["is a 总控/dispatcher, not a project manager", "总控"],
  ["states the one-request-per-expert rule", "一个诉求 = 一条任务 = 一个专家"],
  ["forbids splitting one request across agents", "不要把一个诉求拆成多条任务分给多个 Agent"],
  ["routes through the domain engine", "pm_agent action=recommend"],
  ["owns the environment lease", "pm_mode action=grant"],
  ["keeps the template variables intact", "{{cwd}}"],
]) {
  ok(label, doctrine.includes(needle), needle);
}
ok("the old 'decompose into lines' model is gone", !doctrine.includes("PM 模式"), "still mentions「PM 模式」");
// Routing is the model's judgement now: the persona must SAY so, and must not
// advertise the retired keyword matcher back into the doctrine.
ok(
  "the persona hands routing to the dispatcher's own judgement",
  doctrine.includes("归属由你自己判断") && !doctrine.includes("路由关键词") && !doctrine.includes("关键词写全一点"),
  "mentions「路由关键词」/「关键词写全一点」",
);

for (const id of ["tool-subagent", "tool-subagent-fork"]) {
  const row = named.find((entry) => entry.row.id === id);
  const persona = String(row?.row.config?.persona ?? "");
  ok(id + " persona says it executes rather than delegates", /不再往下派|不再往下委派/.test(persona), persona.slice(0, 60));
}

console.log("\n" + (checks - failures.length) + "/" + checks + " checks passed");
if (failures.length > 0) {
  console.log("failures:\n  - " + failures.join("\n  - "));
  process.exitCode = 1;
}
