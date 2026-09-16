/**
 * Vocabulary check — this plugin is project-agnostic and must READ that way.
 *
 * The repo used to carry one deployment's vocabulary as its examples: a specific
 * editor, a specific server process, its admin console, its runtime mode, its
 * domain nouns. That leaks twice — a reader assumes the plugin belongs to that
 * project, and a user's own environment never matches the sample sentences. The
 * generic vocabulary is `shared-env` (a singleton the machine has exactly one
 * of) plus whatever id an operator declares; nothing here hard-codes a project.
 *
 * TWO allowances, both explicit and greppable:
 *   1. a line containing `terms-ok:` — a comment that has to name a retired term
 *      to explain why it is retired;
 *   2. a block wrapped in a `#region retired-…` / `#endregion retired-…` pair —
 *      the retired ids as TEST DATA in `scripts/smoke.mjs` (proving an old board
 *      still grants, transfers and releases), and this file's own list of terms
 *      under test.
 *
 *   node scripts/check-terms.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");

/**
 * Retired terms. The runtime-mode wording is matched as a phrase, never as a
 * bare latin word: the three-letter verb also appears inside ordinary words
 * such as `display`, which would make this check unusable.
 */
/* #region retired-terms */
const RETIRED = [
  "Unity",
  "私服",
  "private-server",
  "private server",
  "GM 指令",
  "GM指令",
  "热更",
  "进 Play",
  "不在 Play",
  "Play 模式",
  ".lua",
  ".prefab",
  "配置表",
  "navmesh",
  "NPC",
  "关卡",
  "P4 提交",
  "perforce",
  "shelve",
  "登录客户端",
];
/* #endregion retired-terms */

const SKIP_DIRS = new Set(["node_modules", ".git"]);
const TEXT_EXT = new Set([".js", ".mjs", ".md", ".yml", ".yaml", ".json"]);

const failures = [];
let scanned = 0;

/**
 * Whether `index` sits inside a `#region retired-…` block. Read from the SOURCE,
 * so an allowance is always visible at the place it applies.
 */
function allowRegion(text, index) {
  const open = text.lastIndexOf("#region retired-", index);
  const close = text.lastIndexOf("#endregion retired-", index);
  return open >= 0 && open > close;
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name));
      continue;
    }
    if (!TEXT_EXT.has(path.extname(entry.name))) continue;
    const file = path.join(dir, entry.name);
    const text = fs.readFileSync(file, "utf8");
    const rel = path.relative(repo, file).replace(/\\/g, "/");
    scanned += 1;
    for (const term of RETIRED) {
      let from = 0;
      for (;;) {
        const at = text.indexOf(term, from);
        if (at < 0) break;
        from = at + term.length;
        const lineStart = text.lastIndexOf("\n", at) + 1;
        const lineEnd = text.indexOf("\n", at);
        const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
        if (line.includes("terms-ok:")) continue;
        if (allowRegion(text, at)) continue;
        failures.push(rel + ":" + (text.slice(0, at).split("\n").length) + " → " + term + " | " + line.trim().slice(0, 100));
      }
    }
  }
}

walk(repo);

const failuresTotal = failures.length;
console.log("scanned " + scanned + " files for " + RETIRED.length + " retired terms");
for (const failure of failures.slice(0, 40)) console.log("  FAIL " + failure);
if (failures.length > 40) console.log("  … " + (failures.length - 40) + " more");
console.log(
  failuresTotal === 0
    ? "\n✅ vocabulary is project-agnostic (no retired term outside the two documented allowances)"
    : "\n❌ " + failuresTotal + " retired-term occurrences need genericising",
);

// The generic replacement must actually be THERE — a deleted example with no
// replacement leaves the next reader guessing what a lease is for.
const readme = fs.readFileSync(path.join(repo, "README.md"), "utf8");
const tools = fs.readFileSync(path.join(repo, "lib", "tools.js"), "utf8");
const preset = fs.readFileSync(path.join(repo, "lib", "preset.js"), "utf8");
const positives = [
  ["README names the generic lease example", readme.includes("shared-env")],
  ["the resource tool documents shared-env", tools.includes("shared-env")],
  ["the preset doctrine documents shared-env", preset.includes("shared-env")],
];
for (const [label, passes] of positives) {
  console.log((passes ? "  ok   " : "  FAIL ") + label);
}
process.exitCode = failuresTotal === 0 && positives.every(([, passes]) => passes) ? 0 : 1;
