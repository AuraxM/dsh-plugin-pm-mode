/**
 * Standalone client-half checks. No dsh imports, no running host, no browser.
 *
 * The web half is a hand-inlined bundle (`lib/client.js` concatenates
 * `lib/client/styles.js` and `lib/client/gantt.js`, because the dsh client
 * bundle cannot resolve relative ESM imports), so two things rot silently:
 * the inlined copies drift from their modules, and a colour creeps back in as a
 * hex literal — which pins ONE theme's value onto both. Both are asserted here.
 *
 * The third check drives `resolveModelPicker`, the function that decides what
 * the 服务商 / 模型 pickers render, with fixture catalogs shaped exactly like
 * the live `GET /pm-mode/__api__/models` payload (verified against the running
 * GUI). It reproduces the reported defect — a first open whose 模型 list holds
 * only 「（选一个）」 — and fails if it comes back.
 *
 *   node scripts/check-client.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CSS } from "../lib/client/styles.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
const clientSource = fs.readFileSync(path.join(repo, "lib", "client.js"), "utf8");
const ganttSource = fs.readFileSync(path.join(repo, "lib", "client", "gantt.js"), "utf8");

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

/** The source text between a `var <name> =` and the `;` that ends it, string-aware. */
function extractExpression(source, name) {
  const declStart = source.indexOf("var " + name + " =");
  if (declStart < 0) throw new Error("no `var " + name + " =` declaration");
  const eq = source.indexOf("=", declStart);
  let inString = false;
  for (let i = eq + 1; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === ";") return source.slice(eq + 1, i);
  }
  throw new Error("unterminated `var " + name + "` statement");
}

/** The source text between two region markers, markers excluded. */
function extractRegion(source, name) {
  const open = "/* #region " + name + " */";
  const close = "/* #endregion " + name + " */";
  const from = source.indexOf(open);
  const to = source.indexOf(close);
  if (from < 0 || to < 0 || to < from) throw new Error("no region `" + name + "`");
  return source.slice(from + open.length, to);
}

/** One function's source, from its `function` keyword to the matching brace. */
function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error("no `" + signature + "`");
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error("unbalanced braces after `" + signature + "`");
}

// ── 1. the inlined copies must equal their modules ────────────────────────────
section("hand-inlined bundle stays in sync");

const inlined = new Function("return (" + extractExpression(clientSource, "CSS") + ");")();
ok(
  "client.js inlines styles.js verbatim",
  inlined === CSS,
  "same rule text? " + (inlined.length === CSS.length ? "length matches — compare the strings" : "lengths " + inlined.length + " vs " + CSS.length),
);

const moduleChip = extractFunction(ganttSource, "export function statusClass(status)").replace(/^export /, "");
const inlinedChip = extractFunction(clientSource, "function statusClass(status)");
ok(
  "client.js inlines gantt.js statusClass verbatim",
  moduleChip.replace(/\s+/g, " ") === inlinedChip.replace(/\s+/g, " "),
  "statusClass drifted between lib/client/gantt.js and the inlined copy",
);

// The statusClass check above was the whole gantt guard once, and the section
// drifted anyway (props.orphans, the domainId badge, the empty-state wording
// existed only in the bundle). Compare the WHOLE inlined region — marked with
// `/* #region gantt */` in client.js — against the module with `export`
// stripped and pad() dropped (client.js keeps its own pad for fmtTime).
function firstDiff(a, b) {
  if (a === b) return "";
  const n = Math.min(a.length, b.length);
  let at = 0;
  while (at < n && a[at] === b[at]) at += 1;
  return (
    "first diff@" + at + ": bundle " +
    JSON.stringify(a.slice(Math.max(0, at - 40), at + 60)) +
    " vs module " +
    JSON.stringify(b.slice(Math.max(0, at - 40), at + 60))
  );
}
const ganttModuleAsInlined = ganttSource
  .replace("export const COLORS =", "var COLORS =")
  .replace(/export function /g, "function ")
  .replace('function pad(value) {\n  return value < 10 ? "0" + value : String(value);\n}\n\n', "");
const ganttInlined = extractRegion(clientSource, "gantt");
ok(
  "client.js inlines the whole gantt.js section verbatim",
  ganttInlined.trim() === ganttModuleAsInlined.trim(),
  "the inlined gantt region drifted from lib/client/gantt.js — edit the module and re-splice. " +
    firstDiff(ganttInlined.trim(), ganttModuleAsInlined.trim()),
);

// ── 2. no colour may be pinned to one theme ───────────────────────────────────
section("colours come from theme tokens, not literals");

/** Selector owning the declaration that contains `at`. */
function selectorAt(css, at) {
  const open = css.lastIndexOf("{", at);
  const close = css.lastIndexOf("}", at);
  if (open < 0 || open < close) return "";
  const prev = Math.max(css.lastIndexOf("}", open), css.lastIndexOf("{", open - 1));
  return css.slice(prev + 1, open).trim();
}

// A hex here would be one theme's value applied to both. There used to be a
// single exception (".pmb-rlabel", a label painted on a saturated bar fill);
// that rule is gone, so the whitelist is empty and NO hex survives at all.
const HEX_ALLOWED_SELECTORS = [];
const offenders = [];
for (const match of CSS.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
  const selector = selectorAt(CSS, match.index);
  if (HEX_ALLOWED_SELECTORS.includes(selector)) continue;
  offenders.push(match[0] + " in " + selector);
}
ok(
  HEX_ALLOWED_SELECTORS.length === 0 ? "no hex colour anywhere in the stylesheet" : "no hex colour outside " + HEX_ALLOWED_SELECTORS.join("/"),
  offenders.length === 0,
  offenders.join(", "),
);

// The two controls the report was about, and the ones an OS paints for us.
ok("select carries an opaque token fill", /\.pmb-select\{[^}]*background:var\(--dsw-alias-bg-layer-3\)/.test(CSS));
ok("select does not inherit a transparent background", !/\.pmb-select\{[^}]*background:transparent/.test(CSS));
ok("option popup is themed explicitly", /\.pmb-select option\{[^}]*background:var\(--dsw-specific-menu\)/.test(CSS));
ok("dark theme gets a dark colour-scheme for the popup", /body\[data-ds-dark-theme\] \.pmb-select\{color-scheme:dark\}/.test(CSS));
ok("primary button uses the native fill pair", /\.pmb-btn\.primary\{[^}]*button-primary-fill[^}]*label-primary-foreground/.test(CSS));
ok("field labels use the primary text token", /\.pmb-sub\{[^}]*color:var\(--dsw-alias-label-primary\)/.test(CSS));

// `.pmb-t-*` is ADDED to elements that already carry a component class, and an
// equal-specificity rule wins by ORDER — appended state rules would silently
// lose to .pmb-lane-m / .pmb-none.
ok(
  "state text rules come after the component rules they override",
  CSS.indexOf(".pmb-t-warn{") > CSS.indexOf(".pmb-lane-m{") && CSS.indexOf(".pmb-t-warn{") > CSS.indexOf(".pmb-none{"),
  "t-warn@" + CSS.indexOf(".pmb-t-warn{") + " lane-m@" + CSS.indexOf(".pmb-lane-m{") + " none@" + CSS.indexOf(".pmb-none{"),
);

// The chips moved their accent into `--pmb-accent`, which leaves two ways to
// lose the colour: a non-solid chip that never reads the property, and a solid
// chip whose rule is out-ordered by the outline rule (equal specificity).
ok("an outline chip still shows its status colour", /\.pmb-chip\.s-blocked\{--pmb-accent:var\(--dsw-alias-state-warn-primary\)\}/.test(CSS) && /\.pmb-chip\.s-blocked,[^{]*\{color:color-mix\(/.test(CSS));
ok("the solid chip rule beats the outline rule", CSS.lastIndexOf(".pmb-chip.solid{") > CSS.lastIndexOf("{color:color-mix(in srgb,var(--pmb-accent)"));

// The bundle must actually mount the CSS (a rule nobody injects styles nothing).
ok("the bundle mounts the stylesheet once", /tag\.textContent = CSS;/.test(clientSource) && /document\.head\.appendChild\(tag\)/.test(clientSource));

// A hot reload re-runs the module while the old <style> is still mounted. If the
// mount is skipped in that case, a stylesheet fix is invisible until a manual
// refresh — which is indistinguishable from "the CSS change did nothing".
{
  const makeDocument = () => {
    const head = { children: [] };
    head.appendChild = (tag) => head.children.push(tag);
    const doc = {
      head,
      createElement: () => ({ dataset: {}, textContent: "" }),
      querySelector: (selector) => {
        const id = selector.replace(/^style\[data-plugin-css="?/, "").replace(/"?\]$/, "");
        return head.children.find((node) => node.dataset.pluginCss === id) ?? null;
      },
    };
    return doc;
  };
  const mount = new Function("document", "CSS", extractFunction(clientSource, "function stylize()") + "\nreturn { stylize, document };")(
    makeDocument(),
    "a{b:c}",
  );
  mount.stylize();
  const injected = mount.document.head.children.length;
  ok("first mount injects one style tag", injected === 1, "tags=" + injected);
  mount.document.head.children[0].textContent = "stale{}"; // what a hot reload sees
  mount.stylize();
  ok(
    "a re-mount refreshes the mounted stylesheet instead of skipping it",
    mount.document.head.children.length === 1 && mount.document.head.children[0].textContent === "a{b:c}",
    "tags=" + mount.document.head.children.length + " text=" + mount.document.head.children[0].textContent,
  );
}

// A `var(--dsw-…, #hex)` fallback is the same bug as a bare hex: the fallback is
// one theme's value, and it is what renders whenever the token is not mounted.
const fallbacks = [];
for (const file of ["client.js", "client/styles.js", "client/gantt.js"]) {
  const source = fs.readFileSync(path.join(repo, "lib", file), "utf8");
  for (const match of source.matchAll(/var\(--dsw-[a-z0-9-]+,#[0-9a-fA-F]{3,8}\)/g)) fallbacks.push(file + " " + match[0]);
}
ok("no theme token carries a hex fallback", fallbacks.length === 0, fallbacks.join(", "));

const inlineHex = [...clientSource.matchAll(/style:\s*\{[^}]*#[0-9a-fA-F]{3,8}[^}]*\}/g)].map((match) => match[0].slice(0, 80));
ok("no inline style object hard-codes a colour", inlineHex.length === 0, inlineHex.join(" | "));

// ── 3. the model picker must never open empty ─────────────────────────────────
section("model picker resolves a usable provider");

const resolveModelPicker = new Function(extractRegion(clientSource, "model-picker") + "\nreturn resolveModelPicker;")();

/** Shaped after `GET /pm-mode/__api__/models` on this deployment. */
function catalogFixture(current) {
  return {
    available: true,
    reason: "",
    configured: current.provider !== "" && current.model !== "",
    current,
    efforts: ["off", "low", "high", "max"],
    providers: [
      {
        id: "deepseek-official",
        name: "DeepSeek",
        error: "",
        models: [
          { id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash" },
          { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro" },
          { id: "deepseek-v4-flash-vision-exp", name: "DeepSeek-V4-Flash-Vision-Exp" },
          { id: "deepseek-v4.1-flash-expires-on-0910", name: "DeepSeek-V4.1-Flash" },
        ],
      },
      {
        id: "kimi-coding",
        name: "kimi-coding",
        error: "",
        models: [
          { id: "k3", name: "k3" },
          { id: "k3-256k", name: "k3-256k" },
          { id: "kimi-for-coding", name: "kimi-for-coding" },
          { id: "kimi-for-coding-highspeed", name: "kimi-for-coding-highspeed" },
        ],
      },
    ],
  };
}

const ROUTE = { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "max", maxDepth: 2 };

// The reported defect: a panel that had never been configured opened with an
// empty 模型 list, because the saved provider ("") matched no catalog entry.
const fresh = resolveModelPicker(catalogFixture({ provider: "", model: "", reasoningEffort: "", maxDepth: 2 }), { provider: "" });
ok("first open of a never-configured panel offers models", fresh.models.length === 4, "models=" + fresh.models.length);
ok("first open names a real provider (not blank)", fresh.provider === "deepseek-official", fresh.provider);
ok("first open says what it is doing", fresh.hintKind === "info" && fresh.hint.includes("还没配置"), fresh.hint);
ok("first open still offers the empty choice", fresh.providerOptions.some((option) => option.id === ""), JSON.stringify(fresh.providerOptions.map((o) => o.id)));
ok("every catalog provider is selectable", ["deepseek-official", "kimi-coding"].every((id) => fresh.providerOptions.some((option) => option.id === id)));
ok("model options mirror the entry", fresh.modelOptions.length === 4 && fresh.modelOptions[0].label === "DeepSeek-V4-Flash");

// A configured route must be honoured exactly as before.
const configured = resolveModelPicker(catalogFixture(ROUTE), ROUTE);
ok("configured route keeps its provider", configured.provider === "deepseek-official", configured.provider);
ok("configured route is not flagged", configured.savedMissing === false && configured.hint === "", configured.hint);
// The empty row is permanent BY DESIGN: it is how a configured user clears the
// route (the host accepts provider+model empty together — and only together).
ok("the empty choice stays for a configured route (clearing must stay reachable)", configured.providerOptions.some((option) => option.id === ""));

// A non-DeepSeek route must not be hijacked by the fallback.
const kimi = resolveModelPicker(catalogFixture({ provider: "kimi-coding", model: "k3" }), { provider: "kimi-coding", model: "k3" });
ok("a valid non-default provider is left alone", kimi.provider === "kimi-coding" && kimi.models.length === 4, kimi.provider);

// The other shape of the same bug: a saved id the host does not register.
const stale = resolveModelPicker(catalogFixture({ provider: "deepseek", model: "deepseek-v4-flash" }), { provider: "deepseek", model: "deepseek-v4-flash" });
ok("stale provider still yields a model list", stale.models.length === 4, "models=" + stale.models.length);
ok("stale provider is reported", stale.savedMissing === true && stale.hintKind === "warn", stale.hint);
ok("stale provider keeps a visible row", stale.providerOptions[0] === undefined ? false : stale.providerOptions[0].id === "deepseek", JSON.stringify(stale.providerOptions[0]));
ok("stale row is labelled", String(stale.providerOptions[0].label).includes("不在当前模型清单"), stale.providerOptions[0].label);

// A provider that resolves but returns nothing must SAY so.
const emptyProvider = {
  available: true,
  current: { provider: "kimi-coding", model: "k3" },
  providers: [{ id: "kimi-coding", name: "kimi-coding", error: "", models: [] }],
};
const none = resolveModelPicker(emptyProvider, { provider: "kimi-coding", model: "k3" });
ok("empty provider list is explained", none.models.length === 0 && none.emptyNote !== "", none.emptyNote);
ok("empty provider list is not called stale", none.savedMissing === false);

// A failing listModels must not look like "nothing to choose".
const failed = resolveModelPicker(
  { available: true, current: ROUTE, providers: [{ id: "deepseek-official", name: "DeepSeek", error: "boom", models: [] }] },
  ROUTE,
);
ok("provider read failure is surfaced", failed.emptyNote.includes("boom"), failed.emptyNote);

// Degenerate catalogs must not throw: the form renders before/without one.
const beforeLoad = resolveModelPicker(null, null);
ok("null catalog is survivable", beforeLoad.provider === "" && beforeLoad.models.length === 0);
const unavailable = resolveModelPicker({ available: false, reason: "这个部署没有 llm 服务", providers: [] }, ROUTE);
ok("no-llm catalog is survivable", unavailable.models.length === 0 && unavailable.provider === "deepseek-official");

// Each tier card must report ITS OWN saved route's fate. The card's open draft
// has already been corrected onto a listed provider, so a notice derived from
// the draft stays silent about the very thing it exists for — that THIS tier's
// persisted provider is not in the catalog the host is serving.
ok(
  "notices resolve against the saved tier, not the corrected draft",
  /var savedPicker = resolveModelPicker\(catalog, saved\);/.test(clientSource) &&
    /savedPicker\.hint !== ""/.test(clientSource),
  "one savedPicker per card, resolved on the persisted tier",
);

// The chart palette (`COLORS`) may paint fills, dots and accent borders — blocks
// that keep their meaning in either theme — but never INK on a page surface:
// `color: COLORS.x` is how the settings page ended up with a 1.9:1 amber ⚠ line.
const inkOffenders = [...clientSource.matchAll(/\bcolor\s*:\s*COLORS[\w.]*/g)].map((match) => match[0]);
ok("no chart-palette value is used as ink", inkOffenders.length === 0, inkOffenders.join(", "));

// ── 4. the expert tier manager: named routes over one catalog ─────────────
// The expert model grew from ONE route into named tiers (default + front /
// heavy / ...). The panel edits them all in one manager: the tiers array the
// host sends alongside the catalog, one card per tier, and ONLY the tier
// write actions — the legacy single-route write must not be called any more,
// because two write paths for overlapping state is how the UI and the
// dispatcher drift apart.
section("the expert tier manager: named routes, one catalog");

const tierCardSource = extractFunction(clientSource, "function renderTierCard(props)");

ok(
  "the container reads the tiers array the host sends with the catalog",
  /setTiers\(Array\.isArray\(payload\.tiers\) \? payload\.tiers : \[\]\)/.test(clientSource),
  "tiers travel on the same /__api__/models document",
);
ok(
  "every tier in the response renders as its own card",
  /tiers\.map\(function \(tier\) \{\s*return React\.createElement\(TierCard, \{/.test(clientSource),
  "the list is data-driven — a tier the panel does not know about still shows",
);
ok(
  "the default tier's name is fixed on its card (the bottom line is not renamable)",
  /isDefault \? "default（底线）" : saved\.name/.test(tierCardSource),
  "default is an id the dispatcher falls back to, not a label to edit",
);
ok(
  "an unconfigured tier carries the 未配置 badge",
  /saved\.configured !== true/.test(tierCardSource) && /"未配置"/.test(tierCardSource),
  "a tier without a route would refuse dispatches that name it — say so on the card",
);
ok(
  "the vision badge is the host's verdict, not a client guess",
  /saved\.capabilities && saved\.capabilities\.vision === true/.test(tierCardSource) && /👁 带视觉/.test(tierCardSource),
  "capabilities come from the model's own metadata via the host",
);
ok(
  "tier saves go through set-expert-tier with name + route + note",
  /action: "set-expert-tier",\s*name: name,\s*provider: picker\.provider,\s*model: shownModel,\s*reasoningEffort: shown\.reasoningEffort \|\| "",\s*note: shown\.note \|\| "",/.test(tierCardSource),
  "the payload shape the host's setExpertTier validates",
);
ok(
  "the panel never builds the legacy set-expert-model payload",
  !clientSource.includes('action: "set-expert-model"'),
  "the single-route write path is retired from the panel (the host still has it; the panel must not call it)",
);
ok(
  "the delete button is rendered only for tiers that may be deleted",
  /!isNew && !isDefault[\s\S]{0,400}?"删除档位"/.test(tierCardSource),
  "default 是底线：没有删除钮，而不是一个置灰的删除钮",
);
ok(
  "delete-expert-tier can never name default, even if the button fence is bypassed",
  /if \(isDefault\) return;/.test(tierCardSource) && /action: "delete-expert-tier", name: saved\.name/.test(tierCardSource),
  "two fences: the button is not rendered, and the handler refuses anyway",
);

// The new-tier name is validated BEFORE any request leaves the panel. The
// validator is pure (same seam as resolveModelPicker), so drive it directly.
const expertTierNameProblem = new Function(
  "var TIER_NAME_RE = " + extractExpression(clientSource, "TIER_NAME_RE") + ";\n" +
    extractFunction(clientSource, "function expertTierNameProblem(name)") +
    "\nreturn expertTierNameProblem;",
)();
ok(
  "legal tier names pass the pre-flight check",
  ["default", "front", "heavy-2", "a"].every((name) => expertTierNameProblem(name) === ""),
  ["default", "front", "heavy-2", "a"].map((name) => name + "→" + expertTierNameProblem(name)).join(" | "),
);
ok(
  "illegal tier names are refused with a reason",
  ["", "Front", "-x", "x y", "x_y", "前端", "a".repeat(32)].every((name) => expertTierNameProblem(name) !== ""),
  "mirrors the host's isTierName: 小写字母/数字/连字符, 1-31 字符",
);
ok(
  "the name check fires before the save request is built",
  tierCardSource.indexOf("expertTierNameProblem(name)") > 0 &&
    tierCardSource.indexOf("expertTierNameProblem(name)") < tierCardSource.indexOf('action: "set-expert-tier"'),
  "an illegal name must produce a hint, not a 400 round trip",
);
ok(
  "a new card cannot silently overwrite an existing tier (set-expert-tier upserts)",
  /props\.existingNames/.test(tierCardSource) && /已有同名档位/.test(tierCardSource),
  "renaming-onto is refused client-side; editing the tier's own card stays the honest path",
);
ok(
  "every tier write re-reads the document it changed",
  /function afterTierWrite\(message\) \{[\s\S]*?load\(\);/.test(clientSource),
  "order, capabilities and configured flags only the host can re-issue",
);
ok(
  "the 已保存 note comes from the host response",
  /result && result\.note/.test(clientSource),
  "the response's note field is shown verbatim, not paraphrased",
);
ok(
  "the form still mounts on both surfaces (panel card + settings section)",
  /mode: "panel"/.test(clientSource) &&
    /React\.createElement\(ExpertModelForm, \{ view: null, mode: "settings", onSaved: refreshOpenBoard \}\)/.test(clientSource),
  "one implementation, two surfaces — the settings one stays open from the start",
);

// maxDepth is global (one value on the legacy route), so it gets exactly ONE
// editor — the default tier's card, whose save is the only one the host reads
// the field from — and stays a read-only line everywhere else.
ok(
  "the default tier's save carries maxDepth (and only the default's)",
  /maxDepth: isDefault \? shown\.maxDepth : undefined/.test(tierCardSource),
  "the host writes maxDepth onto the legacy global route, only from name=default",
);
ok(
  "the maxDepth select is editable on the default card only",
  /isDefault\s*\?\s*tierSelectField\("maxDepth",/.test(tierCardSource),
  "every other tier keeps the container's read-only line — one global value, one editor",
);
// Clearing ≠ deleting: default still has no 删除档位, but a configured default
// can be written back to 未配置 — the host reads the empty pair as clear and
// answers cleared:true. Dangerous enough to earn a confirm, honest enough to
// say what the consequence is.
ok(
  "清空为未配置 renders on the configured default card only",
  /!isNew && isDefault && saved\.configured === true[\s\S]{0,400}?"清空为未配置"/.test(tierCardSource),
  "default 仍没有删除档位 —— 清空是另一颗钮，且只在有路由可清时出现",
);
ok(
  "clearing the default tier is a confirmed empty-pair set-expert-tier write",
  /window\.confirm\("清空后派发会被拒绝，直到重新配置/.test(tierCardSource) &&
    /action: "set-expert-tier", name: "default", provider: "", model: ""/.test(tierCardSource),
  "the host reads the empty pair as clear (cleared:true) — never as a delete",
);
ok(
  "a cleared default is reported as cleared, not as saved",
  /result\.cleared === true \? "已清空为未配置/.test(clientSource),
  "清空和保存是两种结局，提示语不能共用一句",
);
// The effort vocabulary is per tier: the host resolves each configured tier's
// own model (effortsByTier), a missing entry falls back to the default
// route's list (which the container already fell back to the generic table).
ok(
  "the effort list prefers the tier's own effortsByTier entry, then the default route's",
  /props\.effortsByTier\[saved\.name\]/.test(tierCardSource) &&
    /Array\.isArray\(perTier\) && perTier\.length > 0 \? perTier : props\.efforts/.test(tierCardSource) &&
    /setEffortsByTier\(/.test(clientSource) &&
    /effortsByTier: effortsByTier/.test(clientSource),
  "一个档的强度选项应该是它自己模型接受的强度，不是 default 模型的",
);

// ── 5. the 经验 tab: the one surface where a WRONG entry must be removable ────
// The memory's whole value is that it outlives the session that wrote it, which
// is also its whole risk: an entry that is wrong, stale, or was never true keeps
// misleading every later session that recalls it. The user's own requirement was
// that a human can delete a mis-remembered entry, so the panel must offer delete
// on the entry itself — and the tab must not be gated behind "this board has
// tasks", because a fresh session's board is empty exactly when the project's
// accumulated knowledge is most worth reading.
section("the 经验 tab: readable, correctable, deletable");

const tabsExpression = extractExpression(clientSource, "TABS");
ok(
  "the tab bar carries the 经验 tab",
  /id:\s*"memory"/.test(tabsExpression),
  tabsExpression.replace(/\s+/g, " ").slice(0, 220),
);
ok(
  "the memory tab is rendered BEFORE the empty-board branch",
  (() => {
    // Anchored to the branch CHAIN in the drawer's body (`else if (state.tab ===
    // "memory") { … } else if (data.summary.counts.total === 0)`), because the
    // empty-board sentence appears earlier in the file inside `emptyBoardState`
    // and matching that one would assert nothing about this ordering.
    const memoryBranch = clientSource.indexOf('} else if (state.tab === "memory") {');
    const emptyBranch = clientSource.indexOf("} else if (data.summary.counts.total === 0) {");
    return memoryBranch > 0 && emptyBranch > 0 && memoryBranch < emptyBranch;
  })(),
  "a board with no tasks must still show the project's memory",
);
ok(
  "the memory view offers 删除 on every entry",
  /title: "删掉这条[^"]*"/.test(clientSource) && /action: "memory-forget"/.test(clientSource),
  "the requirement this surface exists for",
);
ok(
  "the memory view offers 改正 too (correcting beats deleting-and-retelling)",
  /action: "memory-remember"/.test(clientSource) && /saveEdit|memoryEdit/.test(clientSource),
  "a half-right entry should be fixable in place",
);
ok(
  "a panel write names the PROJECT, so it cannot land in the browsing process's cwd",
  /project: data\.project\.key/.test(clientSource),
  "the drawer can be open on any conversation",
);
ok(
  "memory reads are keyed by the session on screen",
  /__api__\/memory\?sessionId=/.test(clientSource),
  "the route resolves that board's recorded project",
);
ok(
  "the memory read is silent on a poll, like the board read",
  /function refreshMemory\(sessionId, options\)/.test(clientSource) &&
    /silent && store\.memory !== null/.test(clientSource),
  "a background tick must not blank a readable list",
);
ok(
  "entering the tab is what fetches it (not every open)",
  /if \(tab\.id === "memory" && \(store\.memory === null \|\| store\.memorySessionId !== store\.sessionId\)\) refreshMemory\(store\.sessionId\);/.test(clientSource),
  "no other tab should pay that round trip — and memory belonging to a session the reader left must re-fetch, not show",
);

// ── 6. a background poll must not announce itself ─────────────────────────────// The reported defect: the drawer polls the board every 1.5s, and every tick set
// `loading`, so 刷新中… appeared and vanished 40 times a minute while the drawer,
// the tool cards and the header button outside it re-rendered twice per tick.
// Polling is not an operation the reader asked for, so it must be silent.
section("the board poll is invisible");

const refreshSource = extractFunction(clientSource, "function refresh(sessionId, windowMs, allBoards, options)");

ok(
  "refresh reads the silent option",
  /var silent = options !== undefined && options\.silent === true;/.test(refreshSource),
  "a poll cannot be told apart from a reader-initiated read",
);
ok(
  "refresh flags loading only when it has something to report",
  /var showLoading = !silent \|\| store\.data === null;/.test(refreshSource) &&
    /if \(showLoading\) setState\(\{ loading: true, error: null \}\);/.test(refreshSource),
  "the loading flag must not be set on a silent read that already has data on screen — and an empty patch must not re-render at all",
);
ok(
  "a failed silent poll keeps the last good board and stays quiet",
  /silent && store\.data !== null \? \{ loading: false, error: null \}/.test(refreshSource),
  "one failed read must not blank a readable panel",
);
ok(
  "a stale response (session/window moved on) is dropped, not applied",
  (refreshSource.match(/if \(target !== store\.sessionId \|\| windowTarget !== store\.windowMs\) return;/g) ?? []).length === 2,
  "both the success and the failure landing must check — a slow answer to an old query used to overwrite the board on screen",
);
ok(
  "an unchanged payload does not re-render the panel",
  /store\.data !== null && store\.data\.updatedAt === data\.updatedAt && store\.data\.boardId === data\.boardId/.test(refreshSource),
  "a poll that returns the same updatedAt+boardId carries nothing new",
);

const pollCalls = [...clientSource.matchAll(/refresh(?:Memory)?\([^;]*?\);/g)].map((match) => match[0]);
ok(
  "every poll call site is silent",
  pollCalls.filter((call) => call.includes("{ silent: true }")).length >= 3,
  "silent call sites: " +
    JSON.stringify(pollCalls.filter((call) => call.includes("sync.target") || call.includes("store.sessionId, store.windowMs"))),
);
ok(
  "the ⟳ button still reports progress",
  /onClick: function \(\) \{\s*refresh\(store\.sessionId, store\.windowMs, store\.allBoards\);\s*\}/.test(clientSource),
  "a reader-initiated read passing { silent: true } would look like nothing happened",
);
ok(
  "one slow poll cannot stack a second on top",
  /if \(silent && inflight\[query\] === true\) return Promise\.resolve\(\);/.test(refreshSource) &&
    (refreshSource.match(/delete inflight\[query\];/g) ?? []).length === 2,
  "polls dedup (the silent kind only — a reader-initiated read must always go out, it is what follows every manage write); both settle paths must clear the in-flight mark",
);
// The ⟳ button, the board picker and the window buttons keep the bare call —
// a reader-initiated read SHOULD say it is working. What must stay explicit is
// the timer: its body is the code that flashed a spinner 40 times a minute.
//
// The body is now one named call (`pollTick()`), because the memory read made
// an inline body long enough to be worth extracting — and a long timer body is
// exactly what this check exists to stop. So the assertion moved with it: the
// three silent calls must live inside `pollTick`, and the timer must call
// nothing else.
const timerBody = clientSource.slice(clientSource.indexOf("setInterval(function () {"), clientSource.indexOf("}, 1500);"));
ok(
  "the timer body does nothing but call pollTick",
  /setInterval\(function \(\) \{\s*pollTick\(\);\s*\}, 1500\);/.test(clientSource),
  "timer body: " + JSON.stringify(timerBody.replace(/\s+/g, " ").slice(0, 200)),
);
const pollTickBody = extractFunction(clientSource, "function pollTick()");
const pollTickCalls = [...pollTickBody.matchAll(/refresh(?:Memory)?\([^;]*\);/g)].map((match) => match[0]);
ok(
  "every call inside pollTick is explicit about being silent",
  pollTickCalls.length === 4 && pollTickCalls.every((call) => call.includes("{ silent: true }")),
  "calls in pollTick: " + JSON.stringify(pollTickCalls),
);
ok(
  "the poll interval is still the 1.5s live view",
  /setInterval\(function \(\) \{[\s\S]{0,200}?\}, 1500\);/.test(clientSource),
  "the Gantt is a live view; silence is the fix, not a slower poll",
);

// ── 7. a failed WRITE must not blank the board it failed against ─────────────
// `manage()` used to report into `store.error` — the field the drawer treats as
// "the board could not be read" and renders INSTEAD of the body. A rejected
// note/release therefore hid the very board the operator was acting on. The
// write error lives in `manageError` now, shown as a banner above the body.
section("a failed write is a banner, not a blanked board");

const manageSource = extractFunction(clientSource, "function manage(payload)");
ok(
  "manage reports failures into manageError",
  /setState\(\{ busy: false, manageError: /.test(manageSource) && /setState\(\{ busy: true, manageError: null \}\)/.test(manageSource),
  "store.error is the READ path's field; a write failure must not take the board down with it",
);
ok(
  "manage never touches the read-path error field",
  !/\berror:/.test(manageSource),
  "a bare `error:` key in manage() would feed the full-screen branch",
);
ok(
  "the banner renders beside the body, not instead of it",
  /state\.manageError !== null/.test(clientSource) && /"❌ " \+ state\.manageError/.test(clientSource),
  "the drawer must show the failure AND keep the board",
);

// ── summary ───────────────────────────────────────────────────────────────────
console.log("\n" + (failures.length === 0 ? "✅ " + checks + " checks passed" : "❌ " + failures.length + " of " + checks + " checks FAILED"));
for (const failure of failures) console.log("   - " + failure);
process.exitCode = failures.length === 0 ? 0 : 1;
