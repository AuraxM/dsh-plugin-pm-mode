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

// A hex here would be one theme's value applied to both. The single exception is
// the label painted ON a saturated bar fill: a bar keeps its own colour in both
// themes, so its label must keep the same contrast against it.
const HEX_ALLOWED_SELECTORS = [".pmb-rlabel"];
const offenders = [];
for (const match of CSS.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
  const selector = selectorAt(CSS, match.index);
  if (HEX_ALLOWED_SELECTORS.includes(selector)) continue;
  offenders.push(match[0] + " in " + selector);
}
ok("no hex colour outside " + HEX_ALLOWED_SELECTORS.join("/"), offenders.length === 0, offenders.join(", "));

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
ok("configured route has no empty row", !configured.providerOptions.some((option) => option.id === ""));

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

// The form must report the SAVED route's fate. `load()` corrects the draft, so a
// notice derived from the draft stays silent about the very thing it exists for.
ok(
  "notices resolve against the saved route, not the corrected draft",
  /var savedPicker = resolveModelPicker\(catalog, catalog && catalog\.current \? catalog\.current : shown\);/.test(clientSource) &&
    /open && savedPicker\.hint !== ""/.test(clientSource),
);

// The chart palette (`COLORS`) may paint fills, dots and accent borders — blocks
// that keep their meaning in either theme — but never INK on a page surface:
// `color: COLORS.x` is how the settings page ended up with a 1.9:1 amber ⚠ line.
const inkOffenders = [...clientSource.matchAll(/\bcolor\s*:\s*COLORS[\w.]*/g)].map((match) => match[0]);
ok("no chart-palette value is used as ink", inkOffenders.length === 0, inkOffenders.join(", "));

// ── summary ───────────────────────────────────────────────────────────────────
console.log("\n" + (failures.length === 0 ? "✅ " + checks + " checks passed" : "❌ " + failures.length + " of " + checks + " checks FAILED"));
for (const failure of failures) console.log("   - " + failure);
process.exitCode = failures.length === 0 ? 0 : 1;
