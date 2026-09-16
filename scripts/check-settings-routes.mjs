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
import { BoardStore, resolveExpertModelCatalog } from "dsh-pm-mode/store";
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
      reasoning: { efforts: model === "model-y" ? [{ id: "high" }, { id: "medium" }] : [{ id: "max" }, { id: "high" }] },
    };
  },
};

const settings = {
  settings: () => store.settings(),
  expertModel: () => current,
  catalog: () => resolveExpertModelCatalog(llm, current),
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

const failed = results.filter((item) => !item.pass);
console.log("\n" + (results.length - failed.length) + "/" + results.length + " route checks passed");
fs.rmSync(root, { recursive: true, force: true });
if (failed.length > 0) process.exitCode = 1;
