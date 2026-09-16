/**
 * Standalone smoke test for the PM Mode store, collector-facing read models,
 * and the tool surface. No dsh imports and no running host: it exercises the
 * same code paths a live PM session drives, so a regression shows up here
 * rather than in a session.
 *
 *   node scripts/smoke.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BoardStore,
  DEFAULT_EXPERT_MODEL,
  isRouteConfigured,
  resolveExpertModelCatalog,
} from "../lib/store.js";
import { createPmTools } from "../lib/tools.js";
import { createExpertDelegate, describeExpertRoute } from "../lib/expert.js";
import { EXPERT_PERSONA, createExpertTool } from "../lib/expert-tool.js";

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

function section(title) {
  console.log("\n" + title);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-mode-smoke-"));
const store = new BoardStore({ root });
const liveStatus = {};
const tools = createPmTools({
  store,
  collector: { liveStatus: () => liveStatus },
  subagents: () => undefined,
});
const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

/** Minimal ToolExecution stand-in: the tools only read `exec.agent.id`. */
function execFor(sessionId) {
  return { agent: { id: sessionId }, callId: "c1", name: "pm_task", arguments: {}, signal: { aborted: false } };
}

const SESSION = "sess-pm-1";
const CHILD_A = "sess-child-aaaa1111";
const CHILD_B = "sess-child-bbbb2222";

section("board creation");
const board = store.open(SESSION, "测试看板");
ok("board id is the session id", board.boardId === SESSION);
ok("board file written", fs.existsSync(store.fileFor(SESSION)));

section("pm_task create / update / phase");
const created = await byName.pm_task.execute(
  { action: "create", id: "t1", title: "给配表加校验", kind: "dev", priority: "high", phases: ["探索", "实现", "验证"] },
  execFor(SESSION),
);
ok("create reports the task id", created.includes("t1"), created);
ok("task persisted with phases", board.tasks.t1.phases.length === 3);

const reCreate = await byName.pm_task.execute({ action: "create", id: "t1", title: "重复" }, execFor(SESSION));
ok("duplicate id is refused with a teaching error", reCreate.includes("❌") && reCreate.includes("已存在"), reCreate);

const running = await byName.pm_task.execute({ action: "update", id: "t1", status: "running", note: "已派给侦察线" }, execFor(SESSION));
ok("running sets startedAt", board.tasks.t1.startedAt > 0, running);
ok("transition recorded", board.tasks.t1.transitions.length === 1);

const blockedNoReason = await byName.pm_task.execute({ action: "update", id: "t1", status: "blocked" }, execFor(SESSION));
ok("blocked without a reason is refused", blockedNoReason.includes("❌") && blockedNoReason.includes("blockedReason"), blockedNoReason);

await byName.pm_task.execute({ action: "update", id: "t1", status: "blocked", blockedReason: "等 shared-env 令牌" }, execFor(SESSION));
ok("blocked with a reason sticks", board.tasks.t1.status === "blocked" && board.tasks.t1.blockedReason === "等 shared-env 令牌");

const phase = await byName.pm_task.execute({ action: "phase", id: "t1", phase: "实现", status: "running", note: "开始改表" }, execFor(SESSION));
ok("phase starts and is timestamped", board.tasks.t1.phases[1].startedAt > 0, phase);

await byName.pm_task.execute({ action: "phase", id: "t1", phase: "实现", status: "done" }, execFor(SESSION));
ok("phase end is timestamped once", board.tasks.t1.phases[1].endedAt > 0);

section("pm_task link / list / terminal state");
await byName.pm_task.execute({ action: "create", id: "t2", title: "回归验证", kind: "verify" }, execFor(SESSION));
await byName.pm_task.execute({ action: "link", id: "t2", dependsOn: ["t1"] }, execFor(SESSION));
ok("dependency recorded", board.tasks.t2.dependsOn[0] === "t1");

const list = await byName.pm_task.execute({ action: "list" }, execFor(SESSION));
ok("list omits nothing while both are open", list.includes("t1") && list.includes("t2"), list);
ok("list does not say 完成", !list.includes("[done]"));

await byName.pm_task.execute({ action: "update", id: "t1", status: "done", evidence: "table.xlsx:42 校验通过" }, execFor(SESSION));
ok("terminal state closes the interval", board.tasks.t1.endedAt > 0);
const listAfter = await byName.pm_task.execute({ action: "list" }, execFor(SESSION));
ok("finished task leaves the default list", !listAfter.includes("t1"), listAfter);
const listAll = await byName.pm_task.execute({ action: "list", includeDone: true }, execFor(SESSION));
ok("includeDone brings it back", listAll.includes("t1"));

section("pm_agent bind / list / ctx");
const bound = await byName.pm_agent.execute(
  { action: "bind", sessionId: CHILD_A, taskId: "t2", label: "回归线", kind: "child" },
  execFor(SESSION),
);
ok("bind reports the task", bound.includes("t2"), bound);
ok("task carries the agent", board.tasks.t2.agents.includes(CHILD_A));

const badBind = await byName.pm_agent.execute({ action: "bind", sessionId: CHILD_B, taskId: "nope" }, execFor(SESSION));
ok("binding to an unknown task is refused", badBind.includes("❌") && badBind.includes("nope"), badBind);

liveStatus[CHILD_A] = "running";
const agentList = await byName.pm_agent.execute({ action: "list" }, execFor(SESSION));
ok("list shows the bound agent as running", agentList.includes(CHILD_A.slice(0, 12)) && agentList.includes("running"), agentList);
ok("list states the reuse-before-spawn rule", agentList.includes("续做"));

const ctxOut = await byName.pm_agent.execute({ action: "ctx", sessionId: CHILD_A }, execFor(SESSION));
ok("ctx reports the live status", ctxOut.includes("running"), ctxOut);
ok("ctx reports the accounting", ctxOut.includes("累计执行"), ctxOut);

section("timeline + gantt");
const now = Date.now();
board.timeline.push(
  { at: now - 600000, kind: "agent-start", sessionId: CHILD_A, taskId: "t2", label: "回归线", status: "running" },
  { at: now - 540000, kind: "tool-call", sessionId: CHILD_A, taskId: "t2", detail: "call-1", tool: "executeLua" },
  { at: now - 480000, kind: "tool-result", sessionId: CHILD_A, taskId: "t2", detail: "call-1", tool: "executeLua", durMs: 60000 },
  { at: now - 300000, kind: "agent-end", sessionId: CHILD_A, taskId: "t2", status: "completed", durMs: 300000 },
);
const gantt = store.gantt(board, {});
const lane = gantt.lanes.find((item) => item.taskId === "t2");
ok("gantt has the lane", lane !== undefined);
ok("gantt lane carries one measured span", lane !== undefined && lane.rows[0].spans.length === 1, JSON.stringify(lane && lane.rows));
ok(
  "gantt span holds the tool segment with its duration",
  lane !== undefined && lane.rows[0].spans[0].tools[0].durMs === 60000,
  JSON.stringify(lane && lane.rows[0].spans[0].tools),
);

section("pm_mode summary / timeline / note");
const summary = await byName.pm_mode.execute({ action: "summary" }, execFor(SESSION));
ok("summary counts terminal vs active", summary.includes("任务 2"), summary);
ok("summary lists the active lane", summary.includes("回归验证"), summary);
ok("summary reports agent activity from the collector", summary.includes("Agent 活跃度"), summary);

const timeline = await byName.pm_mode.execute({ action: "timeline" }, execFor(SESSION));
ok("timeline reports the span and its heaviest step", timeline.includes("executeLua") && timeline.includes("回归线"), timeline);

const note = await byName.pm_mode.execute({ action: "note", taskId: "t2", text: "令牌交接给回归线" }, execFor(SESSION));
ok("note is recorded", board.notes.length === 1 && note.includes("令牌交接"), note);

section("exclusive shared resource");
const first = store.acquireResource(board, { id: "shared-env", label: "共享独占环境", sessionId: CHILD_A, taskId: "t2" });
ok("first acquirer is granted", first.granted === true);
const second = store.acquireResource(board, { id: "shared-env", label: "共享独占环境", sessionId: CHILD_B, taskId: "t2" });
ok("second acquirer is queued, not granted", second.granted === false && second.resource.queue.length === 1);
ok("resource is still held by the first", board.resources["shared-env"].holder.sessionId === CHILD_A);
const resources = await byName.pm_mode.execute({ action: "resources" }, execFor(SESSION));
ok("resources view names the holder and the wait", resources.includes("持有") && resources.includes("排队"), resources);
const released = store.releaseResource(board, { id: "shared-env", sessionId: CHILD_A });
ok(
  "release atomically promotes the queue head",
  released.next !== null && released.next.sessionId === CHILD_B && board.resources["shared-env"].holder.sessionId === CHILD_B,
  JSON.stringify(released.next),
);
let wrongRelease = "";
try {
  store.releaseResource(board, { id: "shared-env", sessionId: CHILD_A });
} catch (error) {
  wrongRelease = String(error.message);
}
ok("releasing somebody else's lease is refused", wrongRelease.includes("令牌不在"), wrongRelease || "(no error thrown)");
const handoff = store.releaseResource(board, { id: "shared-env", sessionId: CHILD_B });
ok("the promoted holder can release in turn", handoff.released.sessionId === CHILD_B && board.resources["shared-env"].holder === null);
const reAcquired = store.acquireResource(board, { id: "shared-env", label: "共享独占环境", sessionId: CHILD_B, taskId: "t2" });
ok("a freed lease is grantable again", reAcquired.granted === true && board.resources["shared-env"].holder.sessionId === CHILD_B);

section("expert domains: routing a new request to the expert that already has the context");
// The model this board exists for: one user request = one expert = one task.
// The expert keeps its domain across requests, so a LATER request in the same
// domain goes back to the same agent instead of starting from zero.
const domainCreated = await byName.pm_agent.execute(
  {
    action: "domain",
    id: "move-and-path",
    name: "移动与寻路",
    responsibility: "位移与碰撞响应、起步/停步手感、路径跟随；不管动画状态机，也不管资源导入流水线。",
  },
  execFor(SESSION),
);
ok("domain is created through the tool", board.domains["move-and-path"] !== undefined, domainCreated);
ok("the domain keeps the responsibility prose", board.domains["move-and-path"].responsibility.includes("位移与碰撞响应"), domainCreated);
await byName.pm_agent.execute(
  { action: "domain", id: "build-cache", name: "构建缓存", responsibility: "增量产物的复用与失效判定；不管发布流水线。" },
  execFor(SESSION),
);
// A board written before routing became a model judgement carries `skills`. It
// must keep reading (folded into the prose) instead of erroring or showing up
// empty — no migration, no rewrite.
const legacyDomain = await byName.pm_agent.execute(
  { action: "domain", id: "legacy-keywords", name: "旧关键词领域", skills: ["旧关键词甲", "旧关键词乙"] },
  execFor(SESSION),
);
ok("a legacy skills array still registers", board.domains["legacy-keywords"] !== undefined, legacyDomain);
ok(
  "legacy keywords read back as responsibility prose",
  board.domains["legacy-keywords"].responsibility === "旧关键词甲 / 旧关键词乙",
  String(board.domains["legacy-keywords"].responsibility),
);

const request = "起步后有一段滑动位移，路径跟随也偏了";
await byName.pm_task.execute(
  { action: "create", id: "t3", title: "起步滑步", kind: "bugfix", domainId: "move-and-path", requestedBy: request },
  execFor(SESSION),
);
ok("task records the domain", board.tasks.t3.domainId === "move-and-path");
ok("task records the user's original request", board.tasks.t3.requestedBy === request);

section("dispatch material: judgement, not scoring");
const material = await byName.pm_agent.execute({ action: "recommend", request }, execFor(SESSION));
ok("the material lists every domain with its responsibility", material.includes("move-and-path") && material.includes("位移与碰撞响应"), material);
ok("the material echoes the request as context", material.includes(request), material);
ok("the material says the dispatcher judges, not the plugin", material.includes("归属由你自己判断"), material);
ok("the material carries no score, hit list or confidence", !/得分|命中|置信度/.test(material), material);
ok("the material carries the shared-resource state", material.includes("共享资源令牌"), material);

const narrowed = await byName.pm_agent.execute({ action: "recommend", domainId: "build-cache" }, execFor(SESSION));
ok("domainId narrows the material to that domain", narrowed.includes("build-cache") && !narrowed.includes("move-and-path"), narrowed);
ok("material without a domain id still needs one of the two inputs", (await byName.pm_agent.execute({ action: "recommend" }, execFor(SESSION))).includes("需要 request"), "");

const expertBind = await byName.pm_agent.execute(
  { action: "bind", sessionId: CHILD_A, taskId: "t3", label: "移动与寻路专家", role: "expert", domainId: "move-and-path" },
  execFor(SESSION),
);
ok("an expert bind registers the domain owner", expertBind.includes("expert") && expertBind.includes("move-and-path"), expertBind);
ok("the domain points at its owner", board.domains["move-and-path"].ownerSessionId === CHILD_A);

const materialAfter = await byName.pm_agent.execute({ action: "recommend", request }, execFor(SESSION));
ok("the material names the existing owner so the follow-up goes back to it", materialAfter.includes(CHILD_A.slice(0, 8)), materialAfter);
ok("the material says to reuse the owner instead of opening another agent", materialAfter.includes("别另开 Agent"), materialAfter);
ok("no domain-less expert yet → that section stays out of the material", !materialAfter.includes("还没挂领域的专家"), materialAfter);

// An expert whose domains are all gone still holds context: the material must
// surface it as a reuse candidate (a keyword matcher could never do this).
// Bound WITHOUT a task on purpose — `bindAgent` inherits a task's domainId, so a
// task-bound bind would make this expert the owner of that task's domain.
await byName.pm_agent.execute({ action: "bind", sessionId: "sess-expert-loaner", label: "待归属专家", role: "expert" }, execFor(SESSION));
const materialWithLoner = await byName.pm_agent.execute({ action: "recommend", request }, execFor(SESSION));
ok("an expert with no domain is still offered as a reuse candidate", materialWithLoner.includes("还没挂领域的专家") && materialWithLoner.includes("待归属专家"), materialWithLoner);
await byName.pm_agent.execute({ action: "unbind", sessionId: "sess-expert-loaner" }, execFor(SESSION));

const roster = await byName.pm_mode.execute({ action: "experts" }, execFor(SESSION));
ok("the expert roster lists the expert", roster.includes(CHILD_A) && roster.includes("移动与寻路专家"), roster);
ok("the roster states the one-request-one-expert discipline", roster.includes("一个用户诉求 = 一个专家"), roster);
const summaryWithExperts = await byName.pm_mode.execute({ action: "summary" }, execFor(SESSION));
ok("summary surfaces the experts", summaryWithExperts.includes("专家") && summaryWithExperts.includes("move-and-path"), summaryWithExperts);

const helperBind = await byName.pm_agent.execute(
  { action: "bind", sessionId: "sess-helper-cccc3333", taskId: "t3", label: "内部取证", role: "helper", parentSessionId: CHILD_A },
  execFor(SESSION),
);
ok("an expert's helper is bound under the same task", helperBind.includes("helper"), helperBind);
ok("the helper keeps its parent link", board.agents["sess-helper-cccc3333"].parentSessionId === CHILD_A);

section("the dispatcher grants and revokes the shared environment");
board.resources["shared-env"].holder = null;
board.resources["shared-env"].queue = [];
const grantToA = await byName.pm_mode.execute(
  { action: "grant", id: "shared-env", sessionId: CHILD_A, taskId: "t3", holderLabel: "移动与寻路专家" },
  execFor(SESSION),
);
ok("grant hands the lease to the named expert", grantToA.includes("已交给") && board.resources["shared-env"].holder.sessionId === CHILD_A, grantToA);
ok("grant tells the dispatcher to say so in the task book", grantToA.includes("必须报告释放"), grantToA);

const grantToB = await byName.pm_mode.execute({ action: "grant", id: "shared-env", sessionId: CHILD_B }, execFor(SESSION));
ok("grant refuses to overwrite a live holder without force", grantToB.includes("❌") && grantToB.includes("force"), grantToB);

const forced = await byName.pm_mode.execute({ action: "grant", id: "shared-env", sessionId: CHILD_B, force: true }, execFor(SESSION));
ok("force takes the lease over and records the handoff", forced.includes("原持有者") && board.resources["shared-env"].holder.sessionId === CHILD_B, forced);

const revoked = await byName.pm_mode.execute({ action: "revoke", id: "shared-env", promote: false }, execFor(SESSION));
ok("revoke takes the lease back", revoked.includes("已收回") && board.resources["shared-env"].holder === null, revoked);

// Leave the lease in a known state for the sections below (the persistence
// round trip asserts the holder survives a reload).
store.acquireResource(board, { id: "shared-env", label: "共享独占环境", sessionId: CHILD_B, taskId: "t2" });

/* #region retired-resource-ids */
section("a board written with the retired resource ids keeps working");
// Resource ids are caller-chosen and stored verbatim, so an id that came from an
// older revision (or from another operator's naming) must keep working — no
// migration, no rename, no error. These literals are DATA on purpose: they are
// the only place in the repo where a retired id appears, and they exist to prove
// old boards do not break.
const legacyIds = ["unity", "private-server"];
for (const legacyId of legacyIds) {
  store.defineResource(board, { id: legacyId, label: "老看板里的资源" });
  const acquired = store.acquireResource(board, { id: legacyId, label: "老看板里的资源", sessionId: CHILD_A, taskId: "t2" });
  ok("a legacy id is still granted as-is (" + legacyId + ")", acquired.granted === true && board.resources[legacyId].holder.sessionId === CHILD_A, JSON.stringify(acquired.granted));
  // The dispatcher's own handoff path (`force`): the previous holder already
  // reported in, so the lease moves in one recorded step.
  const handed = store.grantResource(board, { id: legacyId, sessionId: CHILD_B, force: true });
  ok("a legacy id is still transferable (" + legacyId + ")", board.resources[legacyId].holder.sessionId === CHILD_B, JSON.stringify(handed.resource.holder));
  const released = store.releaseResource(board, { id: legacyId, sessionId: CHILD_B });
  ok("a legacy id is still releasable (" + legacyId + ")", released.released !== null && board.resources[legacyId].holder === null);
  ok("the legacy id was NOT rewritten (" + legacyId + ")", board.resources[legacyId].id === legacyId, board.resources[legacyId].id);
  delete board.resources[legacyId];
}
/* #endregion retired-resource-ids */

section("plugin settings: the expert's model is configuration, not a composition value");
const defaults = store.settings();
ok(
  "the expert route ships UNCONFIGURED (the plugin names no model)",
  defaults.expertModel.provider === "" && defaults.expertModel.model === "",
  JSON.stringify(defaults.expertModel),
);
ok(
  "an unconfigured route is not mistaken for a resolved one",
  isRouteConfigured(defaults.expertModel) === false,
  String(isRouteConfigured(defaults.expertModel)),
);
ok(
  "updatedAt 0 is how the panel tells 未配置 from 已保存",
  defaults.expertModel.updatedAt === 0,
  String(defaults.expertModel.updatedAt),
);
ok("the default depth still tiers helpers one level below the expert", defaults.expertModel.maxDepth === 2, String(defaults.expertModel.maxDepth));
ok("reading the settings wrote nothing to disk", !fs.existsSync(store.settingsFile()));

const saved = store.saveSettings({ expertModel: { provider: "some-vendor", model: "some-model", reasoningEffort: "high" } });
ok("a patch updates only what it names", saved.expertModel.model === "some-model" && saved.expertModel.maxDepth === 2, JSON.stringify(saved.expertModel));
ok("it is persisted as a file in the board root (not a board directory)", fs.existsSync(store.settingsFile()) && path.dirname(store.settingsFile()) === root);
ok("the board list does not mistake settings.json for a board", store.listBoardIds().every((entry) => entry.boardId !== "settings.json"));
ok("a second store reads the same value back", new BoardStore({ root }).settings().expertModel.model === "some-model");

const cleared = store.saveSettings({ expertModel: { provider: "", model: "", reasoningEffort: "" } });
ok(
  "saving an empty route clears it rather than resurrecting a default",
  cleared.expertModel.provider === "" && cleared.expertModel.model === "",
  JSON.stringify(cleared.expertModel),
);

const garbage = store.saveSettings({ expertModel: { provider: "  ", model: "", reasoningEffort: "", maxDepth: 99 } });
ok(
  "an unusable value normalizes to empty, never to a model the plugin picked",
  garbage.expertModel.provider === "" && garbage.expertModel.model === "" && garbage.expertModel.maxDepth === 2,
  JSON.stringify(garbage.expertModel),
);

const noLlm = await resolveExpertModelCatalog(undefined, DEFAULT_EXPERT_MODEL);
ok("a deployment without `llm` reports why it cannot validate", noLlm.available === false && noLlm.reason.includes("llm"), JSON.stringify(noLlm.reason));

const fakeLlm = {
  listProviders: () => [{ id: "vendor-a", name: "Vendor A" }],
  listModels: async () => [{ id: "model-x", name: "Model X" }],
  resolveModelInfo: async (provider, model) => ({
    provider,
    id: model,
    name: model.toUpperCase(),
    reasoning: { efforts: [{ id: "max" }, { id: "high" }] },
  }),
};
const emptyCatalog = await resolveExpertModelCatalog(fakeLlm, DEFAULT_EXPERT_MODEL);
ok(
  "an unconfigured catalog is not reported as a broken route",
  emptyCatalog.configured === false && emptyCatalog.resolveError === "",
  JSON.stringify(emptyCatalog.resolveError),
);
ok(
  "it still lists the routes the operator can choose from",
  emptyCatalog.providers.length === 1 && emptyCatalog.providers[0].models[0].id === "model-x",
  JSON.stringify(emptyCatalog.providers),
);

const catalog = await resolveExpertModelCatalog(fakeLlm, { provider: "vendor-a", model: "model-x", reasoningEffort: "max", maxDepth: 2 });
ok("a configured route resolves", catalog.configured === true && catalog.resolved.id === "model-x", JSON.stringify(catalog.resolved));
ok("effort options come from the resolved model, not a hard-coded list", catalog.efforts.join(",") === "max,high", JSON.stringify(catalog.efforts));

const route = { provider: "vendor-a", model: "model-x", reasoningEffort: "max", maxDepth: 2 };
ok("the route has a one-line description for logs and the panel", describeExpertRoute(route).includes("vendor-a/model-x@max"), describeExpertRoute(route));
ok(
  "an unconfigured route describes itself as unconfigured",
  describeExpertRoute({ provider: "", model: "", reasoningEffort: "", maxDepth: 2 }).includes("未配置"),
  describeExpertRoute({ provider: "", model: "", reasoningEffort: "", maxDepth: 2 }),
);
ok(
  "an empty effort is described as the model's own default, not as a value",
  describeExpertRoute({ provider: "vendor-a", model: "model-x", reasoningEffort: "", maxDepth: 2 }).includes("模型默认档"),
  describeExpertRoute({ provider: "vendor-a", model: "model-x", reasoningEffort: "", maxDepth: 2 }),
);

const delegated = [];
const makeDelegate = (activeRoute) =>
  createExpertDelegate({
    subagents: () => ({
      getProvider: () => ({ name: "spawn", capabilities: { agentOptions: true, depthLimit: true } }),
      startContinuable: async (spec) => {
        delegated.push(spec);
        return { childId: "child-1", messageId: "msg-1" };
      },
    }),
    route: () => activeRoute,
  });
let unconfiguredRefusal = "";
try {
  await makeDelegate({ provider: "", model: "", reasoningEffort: "", maxDepth: 2 })(
    { description: "x", prompt: "y", persona: EXPERT_PERSONA },
    { agent: { id: "dispatcher-session" } },
  );
} catch (error) {
  unconfiguredRefusal = String(error.message);
}
ok(
  "an unconfigured route refuses with the way out instead of guessing",
  unconfiguredRefusal.includes("专家模型还没配置"),
  unconfiguredRefusal || "(no error)",
);
ok("the refusal happened before any child was started", delegated.length === 0, String(delegated.length));

const delegate = makeDelegate(route);
const startResult = await delegate(
  { description: "移动与寻路", prompt: "起步后有一段滑动位移", persona: EXPERT_PERSONA },
  { agent: { id: "dispatcher-session" }, signal: new AbortController().signal },
);
ok("delegation returns a durable continuable child id", startResult.kind === "continuable" && startResult.subagentId === "child-1", JSON.stringify(startResult));
ok("the configured model reaches the child request", delegated[0].request.agentOptions.model === "model-x" && delegated[0].request.agentOptions.provider === "vendor-a", JSON.stringify(delegated[0].request.agentOptions));
ok("the configured depth cap reaches the child request", delegated[0].request.maxDepth === 2, String(delegated[0].request.maxDepth));
ok("the expert persona travels with the delegation", delegated[0].request.persona.includes("领域专家 Agent"));
ok("the initial prompt is a text block, not a bare string", Array.isArray(delegated[0].request.prompt) && delegated[0].request.prompt[0].type === "text");

// The route is read per delegation, so a settings change must be visible
// without rebuilding anything.
route.model = "model-y";
route.maxDepth = 1;
await delegate({ description: "again", prompt: "again", persona: EXPERT_PERSONA }, { agent: { id: "dispatcher-session" } });
ok("a later delegation picks up the new model", delegated[1].request.agentOptions.model === "model-y", JSON.stringify(delegated[1].request.agentOptions));
ok("a later delegation picks up the new depth cap", delegated[1].request.maxDepth === 1, String(delegated[1].request.maxDepth));

// "Unset effort" must reach the child as ABSENT, not as an invented value: the
// adapter owns the effort vocabulary, so the model's own default has to apply.
await makeDelegate({ provider: "vendor-a", model: "model-x", reasoningEffort: "", maxDepth: 2 })(
  { description: "no effort", prompt: "p", persona: EXPERT_PERSONA },
  { agent: { id: "dispatcher-session" } },
);
ok(
  "an unset effort is omitted from the child request (model default applies)",
  delegated[2].request.agentOptions.reasoningEffort === undefined,
  JSON.stringify(delegated[2].request.agentOptions),
);
// A delegation with no caller signal must still work: the expert tool may be
// called from a context that supplies none.
let noSignalError = "";
try {
  await delegate({ description: "no signal", prompt: "p", persona: EXPERT_PERSONA }, { agent: { id: "dispatcher-session" } });
} catch (error) {
  noSignalError = String(error.message);
}
ok("a delegation with no caller signal still starts", noSignalError === "", noSignalError || "(started)");

const tool = createExpertTool({ route: () => route, delegate, describe: describeExpertRoute });
ok("the expert tool is named subagent_expert (no model in the name)", tool.name === "subagent_expert", tool.name);
const unconfiguredTool = createExpertTool({
  route: () => ({ provider: "", model: "", reasoningEffort: "", maxDepth: 2 }),
  delegate,
  describe: describeExpertRoute,
});
ok(
  "the tool description says 尚未配置 when nothing is chosen",
  unconfiguredTool.description.includes("尚未配置"),
  unconfiguredTool.description.slice(0, 160),
);
let missingRegistry = "";
try {
  await createExpertDelegate({ subagents: () => undefined, route: () => route })(
    { description: "x", prompt: "y", persona: EXPERT_PERSONA },
    { agent: { id: "s" }, signal: new AbortController().signal },
  );
} catch (error) {
  missingRegistry = String(error.message);
}
ok("a deployment with no subagent backend fails with a sentence, not a stack trace", missingRegistry.includes("subagents 注册表"), missingRegistry || "(no error)");
let noAgentOptions = "";
try {
  await createExpertDelegate({
    subagents: () => ({ getProvider: () => ({ name: "spawn", capabilities: { agentOptions: false, depthLimit: true } }) }),
    route: () => route,
  })({ description: "x", prompt: "y", persona: EXPERT_PERSONA }, { agent: { id: "s" }, signal: new AbortController().signal });
} catch (error) {
  noAgentOptions = String(error.message);
}
ok("a provider that cannot route children fails loudly", noAgentOptions.includes("agentOptions"), noAgentOptions || "(no error)");

section("metrics");
const metrics = store.metrics(board, {});
ok("metrics counts the finished task", metrics.done === 1, JSON.stringify(metrics.done));
ok("metrics rolls phases up", metrics.byPhase.some((item) => item.name === "实现" && item.ms > 0), JSON.stringify(metrics.byPhase));
ok("metrics rolls tool cost up", metrics.tools.some((item) => item.tool === "executeLua" && item.ms === 60000), JSON.stringify(metrics.tools));
ok("metrics buckets the last 24 hours", metrics.timelineByHour.length === 24 && metrics.timelineByHour.some((n) => n > 0));

section("persistence round trip");
store.flush(board);
const reloaded = new BoardStore({ root }).open(SESSION);
ok("tasks survive a reload", Object.keys(reloaded.tasks).length >= 2);
ok("agents survive a reload", reloaded.agents[CHILD_A] !== undefined);
ok("expert domains survive a reload", reloaded.domains["move-and-path"] !== undefined && reloaded.domains["move-and-path"].ownerSessionId === CHILD_A);
ok("a task's domain and request survive a reload", reloaded.tasks.t3.domainId === "move-and-path" && reloaded.tasks.t3.requestedBy === request);
ok("timeline survives a reload", reloaded.timeline.length >= 4);
ok("resource holder survives a reload", reloaded.resources["shared-env"].holder.sessionId === CHILD_B);
ok("notes survive a reload", reloaded.notes.length === 1);

section("board isolation");
const other = store.open("sess-pm-2", "另一块看板");
ok("a second session gets its own board", other.boardId === "sess-pm-2" && other.order.length === 0);
ok("board list sees both", store.listBoardIds().length === 2);
const otherSummary = await byName.pm_mode.execute({ action: "summary" }, execFor("sess-pm-2"));
ok("the second board's summary is empty of the first board's work", !otherSummary.includes("回归验证"), otherSummary);

section("result");
console.log("\n" + (checks - failures.length) + "/" + checks + " checks passed");
if (failures.length > 0) {
  console.log("failures:\n  - " + failures.join("\n  - "));
  process.exitCode = 1;
}
fs.rmSync(root, { recursive: true, force: true });
