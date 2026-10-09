/**
 * The panel's settings routes, checked end to end without a browser.
 *
 * It drives the REAL `createPanelRouter` over a throwaway board root with a
 * fake `llm`, so the requests below are byte-for-byte the ones the picker in
 * the 资源 tab sends: the catalog read, the loopback-only write, and every
 * refusal the operator can hit (unresolvable model, effort the model does not
 * accept, out-of-range depth, LAN writer, no settings surface at all).
 *
 * Why a second CLI check beside smoke.mjs: smoke.mjs never builds a router, so
 * nothing there would notice a settings mutation that writes the wrong value,
 * skips validation, or becomes writable from the LAN.
 *
 * Run from the profile root (bare specifiers must resolve as the Loader
 * resolves them):
 *
 *   cd $HOME\.dsh\profiles
 *   node E:/dsh/dsh-plugin-pm-mode/scripts/check-settings-routes.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BoardStore, resolveExpertModelCatalog, expertTiersOf, isTierName, isRouteConfigured } from "dsh-pm-mode/store";
import { createPanelRouter, EXPERT_MODEL_SAVED_NOTE } from "dsh-pm-mode/routes";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pmb-routes-"));
const store = new BoardStore({ root });
const SESSION = "session-verify-1";
store.open(SESSION, "验证看板");

// Deliberately fictional routes: the plugin must work for whatever a deployment
// registers, so a test naming a real vendor/model would re-create exactly the
// coupling this setting exists to remove. The starting point is UNCONFIGURED,
// because that is how the plugin now ships.
let current = { provider: "", model: "", reasoningEffort: "", maxDepth: 2 };
const llm = {
  listProviders: () => [
    { id: "vendor-a", name: "Vendor A" },
    { id: "vendor-b", name: "Vendor B" },
  ],
  listModels: async (provider) =>
    provider === "vendor-a"
      ? [{ id: "model-x", name: "Model X" }, { id: "model-y", name: "Model Y" }]
      : [{ id: "model-z", name: "Model Z" }],
  resolveModelInfo: async (provider, model) => {
    if (model === "does-not-exist") throw new Error("unknown model for provider " + provider);
    return {
      provider,
      id: model,
      name: model.toUpperCase(),
      inputModalities: model === "model-vision" ? ["text", "image"] : ["text"],
      reasoning: { efforts: model === "model-y" ? [{ id: "high" }, { id: "medium" }] : [{ id: "max" }, { id: "high" }] },
    };
  },
};

const settings = {
  settings: () => store.settings(),
  expertModel: () => current,
  catalog: () => resolveExpertModelCatalog(llm, current),
  // Mirrors the production surface in lib/index.js: the tier list derives from
  // the settings document (default = expertTiers.default ?? expertModel), and
  // tier writes validate against the adapter and DERIVE capabilities from its
  // advertised modalities.
  tiers: () => expertTiersOf(store.settings()),
  setExpertTier: async (input, actor) => {
    const name = String(input?.name ?? "").trim();
    if (!isTierName(name)) throw new Error("档位名必须是小写字母/数字/连字符（1-31 字符），例如 default / front / heavy");
    const wanted = {
      provider: String(input?.provider ?? "").trim(),
      model: String(input?.model ?? "").trim(),
      reasoningEffort: String(input?.reasoningEffort ?? "").trim(),
      note: String(input?.note ?? "").trim(),
    };
    const before = store.settings();
    // Mirrors production: an EMPTY route clears the default (and only the
    // default); a named tier with no route is refused.
    if (!isRouteConfigured(wanted)) {
      if (name !== "default") throw new Error(`档位「${name}」需要服务商和模型；想撤掉这档用删除档位`);
      const tiers = { ...before.expertTiers };
      delete tiers.default;
      const saved = store.saveSettings({
        expertTiers: tiers,
        expertModel: { provider: "", model: "", reasoningEffort: "", maxDepth: before.expertModel.maxDepth, updatedAt: Date.now(), updatedBy: String(actor ?? "") },
      });
      current = { ...current, provider: "", model: "", reasoningEffort: "" };
      return { settings: saved, resolved: null, cleared: true };
    }
    let info;
    try {
      info = await llm.resolveModelInfo(wanted.provider, wanted.model);
    } catch (error) {
      throw new Error(`模型路由 ${wanted.provider}/${wanted.model} 无法解析：` + String(error && error.message ? error.message : error));
    }
    const efforts = info.reasoning.efforts.map((effort) => effort.id);
    if (wanted.reasoningEffort !== "" && !efforts.includes(wanted.reasoningEffort)) {
      throw new Error(`模型 ${wanted.provider}/${wanted.model} 不支持 reasoning effort "${wanted.reasoningEffort}"；可选：${efforts.join(", ")}`);
    }
    const capabilities = { vision: (info.inputModalities ?? []).includes("image") };
    const tiers = { ...store.settings().expertTiers };
    tiers[name] = { ...wanted, capabilities, updatedAt: Date.now(), updatedBy: String(actor ?? "") };
    const patch = { expertTiers: tiers };
    if (name === "default" && input?.maxDepth !== undefined) {
      const depth = Number(input.maxDepth);
      if (!Number.isSafeInteger(depth) || depth < 1 || depth > 5) throw new Error("maxDepth 必须是 1-5 的整数");
      patch.expertModel = { ...before.expertModel, maxDepth: depth };
    }
    const saved = store.saveSettings(patch);
    return { settings: saved, resolved: { id: info.id, name: info.name, provider: info.provider }, capabilities };
  },
  // Mirrors production: each configured tier's effort list comes from ITS model.
  tierEfforts: async () => {
    const out = {};
    for (const tier of expertTiersOf(store.settings())) {
      if (!tier.configured) continue;
      try {
        const info = await llm.resolveModelInfo(tier.provider, tier.model);
        out[tier.name] = (info.reasoning?.efforts ?? []).map((effort) => effort.id);
      } catch { /* omitted */ }
    }
    return out;
  },
  deleteExpertTier: async (name) => {
    const wanted = String(name ?? "").trim();
    if (wanted === "default") throw new Error("default 档不能删（它是专家路由的底线）；清空它用专家模型表单的「未配置」");
    const tiers = { ...store.settings().expertTiers };
    if (tiers[wanted] === undefined) throw new Error(`没有这个档位: ${wanted}`);
    delete tiers[wanted];
    return { settings: store.saveSettings({ expertTiers: tiers }) };
  },
  setExpertModel: async (patch) => {
    // Mirrors the production order and wording in lib/index.js: route
    // resolution (wrapped as 无法解析), then effort membership. Depth is
    // validated by the ROUTE (see routes.js), which is where a form submit can
    // be refused by range.
    if (patch.provider === "" || patch.model === "") {
      const cleared = store.saveSettings({ expertModel: { ...patch, updatedAt: Date.now(), updatedBy: "panel" } });
      current = { ...patch };
      return { settings: cleared, resolved: null };
    }
    let info;
    try {
      info = await llm.resolveModelInfo(patch.provider, patch.model);
    } catch (error) {
      throw new Error(
        `模型路由 ${patch.provider}/${patch.model} 无法解析：` + String(error && error.message ? error.message : error),
      );
    }
    const efforts = info.reasoning.efforts.map((effort) => effort.id);
    if (patch.reasoningEffort !== "" && !efforts.includes(patch.reasoningEffort)) {
      throw new Error(`模型 ${patch.provider}/${patch.model} 不支持 reasoning effort "${patch.reasoningEffort}"；可选：${efforts.join(", ")}`);
    }
    const saved = store.saveSettings({ expertModel: { ...patch, updatedAt: Date.now(), updatedBy: "panel" } });
    current = {
      provider: saved.expertModel.provider,
      model: saved.expertModel.model,
      reasoningEffort: saved.expertModel.reasoningEffort,
      maxDepth: saved.expertModel.maxDepth,
    };
    return { settings: saved, resolved: { id: info.id, name: info.name, provider: info.provider } };
  },
};

const router = createPanelRouter({ store, collector: { liveStatus: () => ({}) }, settings, logger: () => {} });

/** Minimal req/res pair: the only surface the router touches. */
function call(method, url, body, remoteAddress = "127.0.0.1") {
  return new Promise((resolve) => {
    const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), "utf8")];
    const req = {
      method,
      url,
      socket: { remoteAddress },
      on(event, handler) {
        if (event === "data") for (const chunk of chunks) handler(chunk);
        if (event === "end") handler();
        return req;
      },
      destroy() {},
    };
    const res = {
      statusCode: 0,
      payload: "",
      writeHead(status) {
        res.statusCode = status;
        return res;
      },
      end(text) {
        res.payload = String(text ?? "");
        resolve({ status: res.statusCode, body: res.payload });
      },
    };
    router.handle(req, res);
  });
}

const results = [];
function check(label, condition, detail) {
  results.push({ label, pass: condition === true, detail: String(detail ?? "") });
  console.log((condition === true ? "  ok   " : "  FAIL ") + label + (condition === true ? "" : " — " + detail));
}

// 1. the catalog endpoint, in its shipped state: nothing configured
const models = await call("GET", "/__api__/models");
const catalog = JSON.parse(models.body).catalog;
check("GET /__api__/models answers 200", models.status === 200, models.status);
check("catalog lists every registered provider", catalog.providers.length === 2, JSON.stringify(catalog.providers.map((p) => p.id)));
check("it reports the route as unconfigured, not as broken", catalog.configured === false && catalog.resolveError === "", JSON.stringify({ configured: catalog.configured, resolveError: catalog.resolveError }));
check("the unconfigured route is empty, not a plugin-chosen default", catalog.current.provider === "" && catalog.current.model === "", JSON.stringify(catalog.current));
check("it still offers the provider list to choose from", catalog.providers.every((p) => Array.isArray(p.models)), JSON.stringify(catalog.providers));

// 2. the state payload carries the setting, so the panel needs no second call
const state = await call("GET", "/__api__/state?sessionId=" + SESSION);
const stateBody = JSON.parse(state.body);
// The route reader returns only what the panel renders (provider/model/effort/
// depth), so "nothing chosen yet" shows up as empty fields here.
check(
  "state payload carries the expert model",
  stateBody.settings.expertModel.provider === "" && stateBody.settings.expertModel.model === "",
  JSON.stringify(stateBody.settings),
);
check("state still carries the board", stateBody.tasks.length === 0 && stateBody.domains.length === 0);
// The project fields are ALWAYS emitted, empty or not. A board whose project is
// unknown and a board from a build that never had the field are different
// states, and both the panel and the reload probe read this payload to tell them
// apart — a field emitted only when non-empty cannot.
check(
  "the state payload always carries projectKey / projectRoot (empty when unidentified)",
  Object.prototype.hasOwnProperty.call(stateBody, "projectKey") &&
    Object.prototype.hasOwnProperty.call(stateBody, "projectRoot") &&
    stateBody.projectKey === "",
  JSON.stringify({ projectKey: stateBody.projectKey, projectRoot: stateBody.projectRoot }),
);

// 3. rejecting a route the adapter cannot resolve
const bogus = await call("POST", "/__api__/manage", {
  action: "set-expert-model",
  provider: "vendor-a",
  model: "does-not-exist",
  reasoningEffort: "max",
  maxDepth: 2,
});
check("an unresolvable model is refused", bogus.status === 400 && JSON.parse(bogus.body).error.includes("无法解析"), bogus.body);
check("the refusal did not write anything", store.settings().expertModel.model === "", JSON.stringify(store.settings().expertModel));

// 4. rejecting an effort the model does not accept
const badEffort = await call("POST", "/__api__/manage", {
  action: "set-expert-model",
  provider: "vendor-a",
  model: "model-y",
  reasoningEffort: "max",
  maxDepth: 2,
});
check("an unsupported effort is refused, with the accepted list", badEffort.status === 400 && badEffort.body.includes("high"), badEffort.body);

// 5. rejecting a silly depth
const badDepth = await call("POST", "/__api__/manage", {
  action: "set-expert-model",
  provider: "vendor-a",
  model: "model-y",
  reasoningEffort: "high",
  maxDepth: 99,
});
check("an out-of-range depth is refused", badDepth.status === 400 && badDepth.body.includes("maxDepth"), badDepth.body);

// 6. the good path — an arbitrary deployment's own route
const saved = await call("POST", "/__api__/manage", {
  action: "set-expert-model",
  provider: "vendor-b",
  model: "model-z",
  reasoningEffort: "max",
  maxDepth: 3,
});
const savedBody = JSON.parse(saved.body);
check("a valid route is saved", saved.status === 200 && savedBody.ok === true, saved.body);
check("the saved value is what the route reader returns", current.provider === "vendor-b" && current.maxDepth === 3, JSON.stringify(current));
check("the file on disk has it", JSON.parse(fs.readFileSync(store.settingsFile(), "utf8")).expertModel.model === "model-z");
check(
  "the answer says when it takes effect",
  // Two assertions, deliberately: identity against the router's own constant (so
  // a reworded sentence cannot outgrow a copied expectation — which is exactly
  // how this check sat stale while the suite stayed green), and the promise
  // itself, which is the part an operator acts on.
  savedBody.note === EXPERT_MODEL_SAVED_NOTE && savedBody.note.includes("无需重启"),
  savedBody.note,
);
check("boards on disk are still only boards", store.listBoardIds().length === 1, JSON.stringify(store.listBoardIds().map((b) => b.boardId)));

// 6b. an empty effort means "the model's own default", so it is accepted
const defaultEffort = await call("POST", "/__api__/manage", {
  action: "set-expert-model",
  provider: "vendor-a",
  model: "model-x",
  reasoningEffort: "",
  maxDepth: 2,
});
check("an empty effort is accepted (model default)", defaultEffort.status === 200, defaultEffort.body);
check("the stored effort is empty, not a substituted value", JSON.parse(defaultEffort.body).expertModel.reasoningEffort === "", defaultEffort.body);

// 6c. clearing the route is a legitimate request, not a validation error
const cleared = await call("POST", "/__api__/manage", {
  action: "set-expert-model",
  provider: "",
  model: "",
  reasoningEffort: "",
  maxDepth: 2,
});
check("clearing the route is accepted", cleared.status === 200, cleared.body);
check("the cleared route reads back as unconfigured", current.provider === "" && store.settings().expertModel.model === "", JSON.stringify(current));

// 6d. named expert tiers: upsert validates against the adapter, capabilities
// are DERIVED from the model's advertised modalities, and the catalog endpoint
// carries the tier list for the panel's editor.
const tierSaved = await call("POST", "/__api__/manage", {
  action: "set-expert-tier",
  name: "front",
  provider: "vendor-a",
  model: "model-vision",
  reasoningEffort: "",
  note: "前端/视觉验证",
});
const tierBody = JSON.parse(tierSaved.body);
check("a valid tier is saved", tierSaved.status === 200 && tierBody.ok === true, tierSaved.body);
check("the vision capability is derived from the model's modalities, not asked for", tierBody.capabilities && tierBody.capabilities.vision === true, tierSaved.body);
const tierListBody = JSON.parse((await call("GET", "/__api__/models")).body);
check(
  "the models endpoint carries the tier list for the panel",
  Array.isArray(tierListBody.tiers) && tierListBody.tiers.some((tier) => tier.name === "front" && tier.capabilities.vision === true),
  JSON.stringify(tierListBody.tiers),
);
check("the default tier is the legacy single route (unconfigured here)", tierListBody.tiers[0].name === "default" && tierListBody.tiers[0].configured === false, JSON.stringify(tierListBody.tiers[0]));

const badTier = await call("POST", "/__api__/manage", {
  action: "set-expert-tier",
  name: "heavy",
  provider: "vendor-a",
  model: "does-not-exist",
  reasoningEffort: "",
});
check("a tier route the adapter cannot resolve is refused", badTier.status === 400 && badTier.body.includes("无法解析"), badTier.body);

const emptyTier = await call("POST", "/__api__/manage", { action: "set-expert-tier", name: "heavy", provider: "", model: "" });
check("a tier with no route is refused (clearing is delete's job)", emptyTier.status === 400, emptyTier.body);

const badTierName = await call("POST", "/__api__/manage", { action: "set-expert-tier", name: "坏 名字!", provider: "vendor-a", model: "model-x" });
check("a non-slug tier name is refused", badTierName.status === 400, badTierName.body);

const deleteDefault = await call("POST", "/__api__/manage", { action: "delete-expert-tier", name: "default" });
check("the default tier cannot be deleted", deleteDefault.status === 400 && deleteDefault.body.includes("default"), deleteDefault.body);
const deleted = await call("POST", "/__api__/manage", { action: "delete-expert-tier", name: "front" });
check("a named tier can be deleted", deleted.status === 200 && JSON.parse((await call("GET", "/__api__/models")).body).tiers.every((tier) => tier.name !== "front"), deleted.body);

// 6e. default-tier specifics: maxDepth rides the default card, and an empty
// route CLEARS the default (the panel's only path back to 未配置).
const depthSaved = await call("POST", "/__api__/manage", {
  action: "set-expert-tier",
  name: "default",
  provider: "vendor-b",
  model: "model-z",
  reasoningEffort: "",
  maxDepth: 4,
});
check("the default card carries the global maxDepth", depthSaved.status === 200 && store.settings().expertModel.maxDepth === 4, depthSaved.body);
const withEfforts = JSON.parse((await call("GET", "/__api__/models")).body);
check(
  "the models endpoint hands each configured tier its own effort vocabulary",
  withEfforts.effortsByTier && withEfforts.effortsByTier.default && withEfforts.effortsByTier.default.join(",") === "max,high",
  JSON.stringify(withEfforts.effortsByTier),
);
const clearDefault = await call("POST", "/__api__/manage", { action: "set-expert-tier", name: "default", provider: "", model: "" });
const afterClear = store.settings();
check(
  "an empty default route clears the default tier (panel's path back to 未配置)",
  clearDefault.status === 200 && JSON.parse(clearDefault.body).cleared === true && afterClear.expertTiers.default === undefined && afterClear.expertModel.model === "",
  clearDefault.body,
);
const stillEmpty = await call("POST", "/__api__/manage", { action: "set-expert-tier", name: "heavy", provider: "", model: "" });
check("a non-default tier with no route is still refused", stillEmpty.status === 400, stillEmpty.body);

// 7. a LAN reader may read but not write
const lanRead = await call("GET", "/__api__/models", undefined, "192.168.1.20");
check("a LAN reader can read the catalog", lanRead.status === 200, lanRead.status);
const lanWrite = await call("POST", "/__api__/manage", { action: "set-expert-model", provider: "vendor-a", model: "model-x" }, "192.168.1.20");
check("a LAN reader cannot write the setting", lanWrite.status === 403, lanWrite.status);

// 8. without a settings surface the route says so instead of pretending
const bare = createPanelRouter({ store, collector: { liveStatus: () => ({}) }, logger: () => {} });
const bareResult = await new Promise((resolve) => {
  const req = { method: "GET", url: "/__api__/models", socket: { remoteAddress: "127.0.0.1" }, on() {}, destroy() {} };
  const res = { writeHead(s) { res.statusCode = s; return res; }, end(t) { resolve({ status: res.statusCode, body: String(t ?? "") }); }, statusCode: 0 };
  bare.handle(req, res);
});
check("no settings surface → 501, not an empty picker", bareResult.status === 501, bareResult.body);

// 9. the experience-memory routes — the panel's 经验 tab
//
// The project fixture is a MARKED directory under the real home, not the temp
// board root. Two facts make that necessary rather than fussy: the identity rule
// walks up for a marker but never claims a home directory or whatever `DSH_HOME`
// points at, and `mkdtemp` sits outside home entirely — so the board root is
// correctly UNidentifiable, and a fixture built there would prove nothing. The
// fixture is removed at the end of this file.
const PROJECT = fs.mkdtempSync(path.join(os.homedir(), ".pmb-mem-fixture-"));
fs.mkdirSync(path.join(PROJECT, ".git"), { recursive: true });

const emptyMemory = await call("GET", "/__api__/memory?sessionId=" + SESSION);
const emptyBody = JSON.parse(emptyMemory.body);
check("GET /__api__/memory answers 200 without a project on the board", emptyMemory.status === 200, emptyMemory.status);
check(
  "a board with no recorded project says so instead of showing an empty list",
  emptyBody.project === null && Array.isArray(emptyBody.projects),
  JSON.stringify({ project: emptyBody.project, projects: emptyBody.projects.length }),
);
check("it still publishes the kind vocabulary for the form", Array.isArray(emptyBody.kinds) && emptyBody.kinds.includes("gotcha"), JSON.stringify(emptyBody.kinds));

const written = await call("POST", "/__api__/manage", {
  action: "memory-remember",
  project: PROJECT,
  title: "临时看板根不是项目，除非有标记",
  text: "项目身份靠标记（.git/package.json/…）向上找，找不到就不归属。",
  kind: "gotcha",
  tags: ["identity"],
  evidence: "本测试就是这么把它变成项目的",
});
check("a panel memory write is accepted", written.status === 200, written.body);

const withEntry = await call("GET", "/__api__/memory?project=" + encodeURIComponent(PROJECT));
const entryBody = JSON.parse(withEntry.body);
check("the entry reads back by explicit project", entryBody.total === 1 && entryBody.matches.length === 1, JSON.stringify({ total: entryBody.total }));
check(
  "the entry kept every field the panel renders",
  entryBody.matches[0].entry.kind === "gotcha" &&
    entryBody.matches[0].entry.evidence !== "" &&
    entryBody.matches[0].entry.tags[0] === "identity",
  JSON.stringify(entryBody.matches[0].entry),
);
check("the project is described by its root, so the reader knows where it is", entryBody.project.root === PROJECT, entryBody.project.root);
check(
  "the entry landed under the memory directory, not beside the boards",
  fs.existsSync(path.join(root, "memory")) && store.listBoardIds().length === 1,
  "memory must not be mistaken for a board",
);

// A reader filtering by hand: the server-side query still answers (the panel
// filters locally over everything it already holds).
const filtered = await call("GET", "/__api__/memory?project=" + encodeURIComponent(PROJECT) + "&q=标记");
check("the server-side query filters", JSON.parse(filtered.body).matches.length === 1, filtered.body.slice(0, 120));
const missed = await call("GET", "/__api__/memory?project=" + encodeURIComponent(PROJECT) + "&q=zzzzz");
check("a query with no match returns no match, not everything", JSON.parse(missed.body).matches.length === 0, missed.body.slice(0, 120));

// A LAN reader may read the memory but never rewrite it.
const lanMemoryRead = await call("GET", "/__api__/memory?project=" + encodeURIComponent(PROJECT), undefined, "192.168.1.20");
check("a LAN reader can read the memory", lanMemoryRead.status === 200, lanMemoryRead.status);
const lanMemoryWrite = await call(
  "POST",
  "/__api__/manage",
  { action: "memory-remember", project: PROJECT, title: "x", text: "y" },
  "192.168.1.20",
);
check("a LAN reader cannot write the memory", lanMemoryWrite.status === 403, lanMemoryWrite.status);

const removed = await call("POST", "/__api__/manage", {
  action: "memory-forget",
  project: PROJECT,
  id: JSON.parse(withEntry.body).matches[0].entry.id,
});
check("a panel delete is accepted", removed.status === 200, removed.body);
check("the delete persisted", JSON.parse((await call("GET", "/__api__/memory?project=" + encodeURIComponent(PROJECT))).body).total === 0);

const noProject = await call("POST", "/__api__/manage", { action: "memory-remember", title: "x", text: "y" });
check("a write with no project is refused with a reason, not stored nowhere", noProject.status === 400, noProject.body);
const badId = await call("POST", "/__api__/manage", { action: "memory-forget", project: PROJECT, id: "m-nope" });
check("deleting an unknown id is refused with the way out", badId.status === 400 && badId.body.includes("list"), badId.body);

// Skew honesty: a newer client calling an action this host predates must hear
// "未知 action", not the board lookup's "找不到看板" — that misdirection cost a
// debugging round once (the tier editor against a pre-tier host).
const nonsenseAction = await call("POST", "/__api__/manage", { action: "totally-made-up" });
check("an unknown action with no boardId says 未知 action, not 找不到看板", nonsenseAction.status === 400 && nonsenseAction.body.includes("未知 action") && !nonsenseAction.body.includes("找不到看板"), nonsenseAction.body);
const knownNoBoard = await call("POST", "/__api__/manage", { action: "set-expert-tier", note: "no boardId at all" });
check("a known non-board action never answers 找不到看板 either", knownNoBoard.status === 400 && !knownNoBoard.body.includes("找不到看板"), knownNoBoard.body);

const failed = results.filter((item) => !item.pass);
console.log("\n" + (results.length - failed.length) + "/" + results.length + " route checks passed");
fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(PROJECT, { recursive: true, force: true });
if (failed.length > 0) process.exitCode = 1;
