/**
 * PM Mode — PROJECT-LEVEL EXPERIENCE MEMORY (pure Node, no dsh imports, so it
 * stays standalone-testable and import-safe from a junction-mounted package).
 *
 * The board remembers a SESSION: which request went where, what is running now,
 * what it cost. That is deliberately short-lived — a new session opens a new
 * board, and with it every lesson the previous one learned is gone. This module
 * is the other half: knowledge that outlives the session it was learned in.
 *
 * WHAT BELONGS HERE — and the filter is the feature, not a caveat. An entry is
 * worth its tokens only when it is something a competent agent would get WRONG
 * by assuming the obvious. The model already knows how a repo is laid out, what
 * a test command usually looks like, what the docs of a mainstream library say;
 * writing those down is pure cost. What it cannot know is:
 *
 *   - a token/credential that is valid here and nowhere else (where it lives,
 *     what it unlocks, what it must not be pasted into);
 *   - the handling pattern a particular domain needs (the order two subsystems
 *     must be touched in, the step everyone skips, the format that is
 *     string-matched downstream);
 *   - a measured runtime fact that contradicts the obvious reading (the command
 *     that reports success while doing nothing, the cache that is not a cache,
 *     the two files that must be edited together);
 *   - a past run's conclusion with its evidence, so it is not re-derived.
 *
 * The counterpart rule is stated in the tool description as well: a fact that
 * the next agent would arrive at unaided does NOT go in, because a memory full
 * of the obvious is a memory nobody reads.
 *
 * WHO READS IT — deliberately, only the dispatcher. Nothing here is injected
 * into a child's task text and no expert tool consults it: the dispatcher
 * queries it and decides what (if anything) belongs in a briefing. A subagent
 * that never sees this store cannot be misled by a stale entry, and the store
 * keeps exactly one reader whose queries are visible in the session log.
 *
 * WHERE IT LIVES — `${DSH_HOME|~/.dsh}/pm-mode/memory/`, one JSON document per
 * PROJECT plus a registry:
 *
 *   memory/index.json      the projects this machine has learned about
 *   memory/<key>.json      one project's entries, newest first
 *
 * Written atomically (tmp + rename), read from disk on every call rather than
 * cached — the value decides what the dispatcher is told, the files are small,
 * and "I recorded it but recall did not find it" is the one failure this feature
 * cannot afford.
 *
 * The files are plain, readable JSON on purpose: a human who finds a wrong entry
 * can fix it in an editor, and the panel's 经验 tab is a thin layer over the same
 * documents rather than a second source of truth.
 *
 * @module dsh-pm-mode/memory
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Memory document schema version; bumped when the shape changes incompatibly.
 * A document written by an older revision is read as-is — every reader fills
 * defaults in, so nothing has to be migrated.
 */
export const MEMORY_VERSION = 1;

/** Name of the memory directory inside the board root. */
export const MEMORY_DIR = "memory";

/** Name of the project registry inside the memory directory. */
export const MEMORY_INDEX_FILE = "index.json";

/**
 * What kind of thing an entry is. A closed set, because the field is a
 * retrieval filter rather than free text — and because the four names are the
 * four ways project knowledge actually differs from common sense:
 *
 *   token    a credential/identifier valid only here, plus what it is for;
 *   gotcha   behaviour that contradicts the obvious reading;
 *   recipe   the handling pattern a domain needs (the order, the step);
 *   finding  a measured conclusion, with the evidence that proved it.
 *
 * `kind` is NOT required: a dispatcher mid-flight records what it has, and
 * forcing a classification on a half-formed lesson is how a memory store ends up
 * with a wrong one. The tool offers the vocabulary; it does not demand it.
 */
export const MEMORY_KINDS = ["token", "gotcha", "recipe", "finding"];

/** Per-project entry cap. Oldest, never-recalled entries are dropped first. */
const MAX_ENTRIES = 300;

/** How many entries one project registry document keeps. */
const MAX_PROJECTS = 200;

/**
 * Directory markers that identify a project root.
 *
 * The list has to cover the version-control and build systems an agent actually
 * meets, and it shipped once WITHOUT the one this deployment uses: the checkout
 * at `E:\workflow\Project-Atom-Game-xiangliming-trunk` is a Perforce workspace
 * (`p4config.txt` + `.p4env` + `.p4ignore`) with no `.git`, no `package.json` and
 * no language manifest anywhere, so it resolved to nothing, and `pm_memory`
 * refused every write in the project the dispatcher was actually working in.
 * A memory tool that cannot file anything in the main working directory is
 * worse than no memory tool: it is a feature that reports failure forever.
 *
 * So the vocabulary now includes every marker family a real checkout can present:
 * VCS (git/hg/svn/jj/P4), language or build manifests, and the editor or tooling
 * files that only a project ROOT carries (`*.sln`, `CMakeLists.txt`, `.envrc`,
 * `.vscode/`). Missing one of these is not a cosmetic gap, so the rule is
 * deliberately generous — a false positive files memory under a directory that
 * has a `.gitignore`, which is a far better failure than refusing to file at all.
 *
 * Order is strongest-first only for readability; the walk takes the TOPMOST
 * match, not the first kind (see `resolveProjectRoot`).
 */
const PROJECT_MARKERS = [
  // version control
  ".git",
  ".hg",
  ".svn",
  ".jj",
  "p4config.txt",
  ".p4config",
  "p4config",
  ".p4env",
  // a harness or tool workspace declaring itself
  ".dsh",
  ".agents",
  // language / build manifests
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "CMakeLists.txt",
  "Makefile",
  "composer.json",
  "Gemfile",
  "mix.exs",
  "pubspec.yaml",
  "*.uproject",
  // editor / tool workspaces, which a project root has and a subdirectory does not
  "*.sln",
  "*.code-workspace",
  "*.xcworkspace",
  ".vscode",
  ".idea",
  // the weakest signals, checked last: a checkout that marks itself only this way
  ".gitignore",
  ".gitattributes",
  ".envrc",
];

/**
 * Markers whose CONTENT decides whether they count are enumerated in
 * `markerCounts`, next to the rule that reads them — a set here plus a switch
 * there was two places to forget. What they all have in common: the bare
 * existence of the file proves nothing, because editors, linters and scratch
 * directories leave empty stubs of exactly these names behind.
 */

const SKIP_WALK = new Set(["node_modules", ".git", "dist", "build", "out", "target", "vendor", ".venv", "venv"]);

function nowMs() {
  return Date.now();
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function num(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isDir(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** Home directories are never a project root, however much they look like one. */
export function isHomeDir(dir, env = process.env) {
  const home = env.DSH_HOME && env.DSH_HOME.trim() !== "" ? path.resolve(env.DSH_HOME) : path.resolve(os.homedir());
  const osHome = path.resolve(os.homedir());
  return path.resolve(dir) === home || path.resolve(dir) === osHome;
}

/**
 * Whether `dir` holds a marker named `marker`, with the content rules applied.
 *
 * `marker` may be a GLOB (`*.sln`): editor and project files carry the project's
 * name, so the extension is the whole signal — an exact-name list could never
 * name them. The glob is matched against the directory's own entries rather than
 * through `path.join(dir, "*.sln")`, which would look for a literal file.
 */
function hasMarker(dir, marker) {
  if (!marker.includes("*")) {
    const target = path.join(dir, marker);
    if (!fs.existsSync(target)) return false;
    return markerCounts(marker, target);
  }
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  const pattern = new RegExp("^" + marker.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/\\\\]*") + "$", "i");
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!pattern.test(entry.name)) continue;
    if (markerCounts(entry.name, path.join(dir, entry.name))) return true;
  }
  return false;
}

/** The content rules: what a given marker must actually SAY to count. */
function markerCounts(marker, target) {
  const name = path.basename(marker);
  let isDirectory = false;
  try {
    isDirectory = fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
  switch (name) {
    case "package.json":
      return isPackageManifest(target);
    case ".dsh":
    case ".agents":
    case ".vscode":
    case ".idea":
      // These are directories a workspace root has; a stray FILE by that name is
      // somebody's script, not a project declaration.
      return isDirectory;
    case "pyproject.toml":
    case "Cargo.toml":
    case "go.mod":
    case "pom.xml":
    case "build.gradle":
    case "build.gradle.kts":
    case "settings.gradle":
    case "settings.gradle.kts":
    case "CMakeLists.txt":
    case "Makefile":
    case "composer.json":
    case "Gemfile":
    case "mix.exs":
    case "pubspec.yaml":
      return !isDirectory;
    default:
      break;
  }
  if (name.startsWith("pnpm-")) return !isDirectory && isPnpmMarker(target, name);
  if (name.startsWith("p4config") || name === ".p4config" || name === ".p4env") {
    return !isDirectory && isPerforceMarker(target);
  }
  if (name === ".gitignore" || name === ".gitattributes" || name === ".envrc") return !isDirectory;
  // VCS directories (.git/.hg/.svn/.jj), lock files, and everything else: the
  // name is the signal, whatever kind of entry it is.
  return true;
}

/**
 * Whether `dir` is a project root — the OUTERMOST marker rule documented at
 * `resolveProjectRoot`.
 */
export function isProjectRoot(dir, env = process.env) {
  if (!isDir(dir)) return false;
  if (isHomeDir(dir, env)) return false;
  for (const marker of PROJECT_MARKERS) {
    if (hasMarker(dir, marker)) return true;
  }
  return false;
}

/** A `package.json` that names a package ("name": "…", non-empty). */
function isPackageManifest(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return isPlainObject(raw) && typeof raw.name === "string" && raw.name.trim() !== "";
  } catch {
    return false;
  }
}

/**
 * A Perforce workspace config that is actually configured: `P4PORT=` /
 * `P4CLIENT=` (p4config.txt, `.p4config`) or a `P4PORT=` assignment (`.p4env`).
 * A checked-in empty stub proves nothing about the directory.
 */
function isPerforceMarker(file) {
  try {
    const text = fs.readFileSync(file, "utf8");
    return /^\s*(export\s+)?P4(PORT|CLIENT)\s*[:=]/m.test(text);
  } catch {
    return false;
  }
}

/**
 * The pnpm markers only count when they actually belong to a pnpm project:
 * `pnpm-workspace.yaml` must carry a `packages:` key, and a bare
 * `pnpm-lock.yaml` must be non-empty. A committed empty lockfile is a real
 * pattern (pnpm writes one for a package with no dependencies) and it would
 * otherwise claim a directory that has no other marker.
 */
function isPnpmMarker(file, marker) {
  try {
    const text = fs.readFileSync(file, "utf8");
    if (text.trim() === "") return false;
    if (marker !== "pnpm-workspace.yaml") return true;
    return /^\s*packages\s*:/m.test(text);
  } catch {
    return false;
  }
}

/**
 * Resolve the project a session's working directory belongs to.
 *
 * THE RULE IS "OUTERMOST MARKER", and that choice is what keeps one project from
 * fragmenting into many memory files. In a monorepo — the shape this plugin's
 * own development has — every package carries its own `package.json` AND often
 * its own `.git`; a subdirectory-only build tool (`lib/`, `presets/`) may carry
 * one too. Stopping at the NEAREST marker would give the repository root, each
 * package, and each of those directories a separate memory, so a lesson learned
 * in the root session would be invisible to a session started one directory
 * down.
 *
 * Walking up and keeping the TOPMOST marker instead makes the whole checkout one
 * project, which is the granularity a dispatcher actually reasons at ("this
 * repo's build is like this"), and it degrades safely in the other direction: a
 * session started deep inside a subtree still finds its repository.
 *
 * The walk starts at the cwd and stops at the home directory, so a checkout
 * living under `~` is still found while `~` itself is never claimed.
 *
 * @param {string} cwd absolute working directory of the session
 * @param {{env?: NodeJS.ProcessEnv, exists?: (dir: string) => boolean}} [options]
 *   `exists` is injectable so the rule can be tested without a filesystem.
 * @returns {string} the project root, or "" when nothing identifiable encloses it
 */
export function resolveProjectRoot(cwd, options = {}) {
  const env = options.env ?? process.env;
  const exists = options.exists ?? isProjectRoot;
  const start = str(cwd).trim();
  if (start === "") return "";
  let dir;
  try {
    dir = path.resolve(start);
  } catch {
    return "";
  }
  let best = "";
  for (let depth = 0; depth < 64; depth += 1) {
    if (isHomeDir(dir, env)) break;
    if (exists(dir, env)) best = dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return best;
}

/**
 * The identity a project's memory is filed under.
 *
 * Derived from the project ROOT, never from the session or the cwd: a session is
 * one conversation, and the cwd of a child agent points at whatever subtree it
 * was spawned in. Two sessions started in different subdirectories of one
 * checkout must land on the SAME entry — that is what "shared across PM
 * sessions" means in practice.
 *
 * Exported because the test suite pins the exact string: it is a storage key,
 * and a change to it silently orphans every memory already on disk.
 */
export function projectKeyOf(root) {
  const value = str(root).trim();
  if (value === "") return "";
  let resolved = value;
  try {
    resolved = path.resolve(value);
  } catch {
    /* keep the verbatim value */
  }
  let hashed = 5381;
  for (let index = 0; index < resolved.length; index += 1) {
    hashed = ((hashed << 5) + hashed + resolved.charCodeAt(index)) >>> 0;
  }
  const leaf = path.basename(resolved).replace(/[^A-Za-z0-9._-]/g, "") || "project";
  return leaf.slice(0, 32) + "-" + hashed.toString(36).padStart(7, "0");
}

function keyOfDirectory(dir) {
  const cleaned = String(dir).replace(/[^A-Za-z0-9._-]/g, "_");
  return cleaned === "" || cleaned === "." || cleaned === ".." ? "project" : cleaned.slice(0, 120);
}

/**
 * Find a subdirectory holding a `package.json` that names `name`.
 *
 * The fallback identity for a directory with no marker of its own: a session
 * opened INSIDE one package of a monorepo (no `.git`, no workspace file, but a
 * real `package.json`) must file its memory with that package rather than with
 * nothing at all. Shallow, bounded, and skips the heavy directories.
 */
export function findOwnPackageRoot(dir, name) {
  const wanted = str(name).trim();
  if (wanted === "" || !isDir(dir)) return "";
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return "";
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_WALK.has(entry.name)) continue;
    if (entry.name.startsWith(".")) continue;
    const manifest = path.join(dir, entry.name, "package.json");
    try {
      const raw = JSON.parse(fs.readFileSync(manifest, "utf8"));
      if (isPlainObject(raw) && str(raw.name).trim() === wanted) return path.join(dir, entry.name);
    } catch {
      /* not a readable manifest */
    }
  }
  return "";
}

/**
 * The project a session belongs to, resolved in the order that gets it right
 * most often:
 *
 *   1. the signpost `.dsh/project.json` at (or above) the cwd — an explicit
 *      declaration always wins;
 *   2. the OUTERMOST project marker (see `resolveProjectRoot`);
 *   3. the package inside the cwd whose `package.json` name matches the
 *      directory we are in;
 *   4. a bare `package.json` at or above the cwd, with or without a name.
 *
 * `reason` names the step that answered, because "why is my memory filed under
 * THAT path" is a question the panel has to be able to answer.
 *
 * @returns {{root: string, name: string, reason: string, cwd: string}}
 */
export function resolveProjectIdentity(cwd, options = {}) {
  const env = options.env ?? process.env;
  const start = str(cwd).trim();
  if (start === "") return { root: "", name: "", reason: "no-cwd", cwd: "" };
  let resolved;
  try {
    resolved = path.resolve(start);
  } catch {
    return { root: "", name: "", reason: "no-cwd", cwd: start };
  }

  const outermost = resolveProjectRoot(resolved, { env });
  if (outermost !== "") {
    // The explicit declaration wins only over a marker at the SAME level or
    // above, which is what "declare this project" means. It does not override a
    // checkout the caller is merely inside of: a session in a subdirectory of a
    // repo must still file with the repo, or one project would fragment by
    // subdirectory — the exact failure the outermost rule exists to prevent.
    const signpost = findSignpost(resolved, env);
    if (signpost !== null && (signpost.root === outermost || signpost.root.startsWith(outermost + path.sep))) {
      return { root: signpost.root, name: signpost.name, reason: "signpost", cwd: resolved };
    }
    return { root: outermost, name: path.basename(outermost), reason: "outermost-marker", cwd: resolved };
  }

  // No marker anywhere above. An explicit declaration is still honoured — this
  // is the path for a checkout whose VCS the plugin does not know.
  const signpost = findSignpost(resolved, env);
  if (signpost !== null) {
    return { root: signpost.root, name: signpost.name, reason: "signpost", cwd: resolved };
  }

  const own = findOwnPackageRoot(resolved, path.basename(resolved));
  if (own !== "") {
    return { root: own, name: path.basename(own), reason: "own-package", cwd: resolved };
  }

  const bare = findBareManifestRoot(resolved, env);
  if (bare !== "") {
    return { root: bare, name: path.basename(bare), reason: "bare-manifest", cwd: resolved };
  }

  return { root: "", name: "", reason: "unidentified", cwd: resolved };
}

/**
 * The project a caller NAMED — as opposed to one it merely happens to be in.
 *
 * A marker is not required here. Naming a directory is itself the statement
 * "this is the project", and the caller is the authority on that; the marker
 * walk is what guesses when nobody said. It is also the escape hatch that makes
 * the whole feature usable in a checkout the plugin cannot recognize: before it,
 * `project=E:\…\trunk` was refused in a Perforce workspace, so `pm_memory` was
 * unusable in the very directory the dispatcher was working in.
 *
 * The named directory must still exist and satisfy the two standing rules — it
 * cannot be a home directory or the board root, and it may not be a
 * SUBDIRECTORY of a known project (a caller pointing at `repo/pkg/` means the
 * repo, not a parallel project that would split one checkout's memory in two).
 *
 * @returns {{root: string, name: string, reason: string, cwd: string}}
 */
export function resolveNamedProject(dir, options = {}) {
  const env = options.env ?? process.env;
  const start = str(dir).trim();
  if (start === "") return { root: "", name: "", reason: "no-cwd", cwd: "" };
  let resolved;
  try {
    resolved = path.resolve(start);
  } catch {
    return { root: "", name: "", reason: "unidentified", cwd: start };
  }
  if (!isDir(resolved)) return { root: "", name: "", reason: "not-a-directory", cwd: resolved };
  if (isHomeDir(resolved, env)) return { root: "", name: "", reason: "is-home", cwd: resolved };

  const enclosing = resolveProjectRoot(resolved, { env });
  if (enclosing !== "") {
    // A known project is inside or above what was named: use it, so naming a
    // subdirectory still lands on the project it belongs to.
    return { root: enclosing, name: path.basename(enclosing), reason: "outermost-marker", cwd: resolved };
  }
  return { root: resolved, name: path.basename(resolved), reason: "named", cwd: resolved };
}

/** The explicit declaration: `<dir>/.dsh/project.json` with a `name`. */
function findSignpost(cwd, env) {
  let dir = cwd;
  for (let depth = 0; depth < 64; depth += 1) {
    if (isHomeDir(dir, env)) break;
    const file = path.join(dir, ".dsh", "project.json");
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      if (isPlainObject(raw) && str(raw.name).trim() !== "") {
        return { root: dir, name: str(raw.name).trim() };
      }
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** A `package.json` at or above the cwd, regardless of whether it names a package. */
function findBareManifestRoot(cwd, env) {
  let dir = cwd;
  for (let depth = 0; depth < 64; depth += 1) {
    if (isHomeDir(dir, env)) break;
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "";
}

/** One entry, with every field the readers expect present. */
export function normalizeMemoryEntry(raw, fallbackId = "") {
  const entry = isPlainObject(raw) ? raw : {};
  const createdAt = num(entry.createdAt, nowMs());
  const kind = str(entry.kind).trim();
  return {
    id: str(entry.id, fallbackId) || fallbackId,
    // The one-line index form. Kept short by the tool layer, which is also what
    // keeps a 200-entry project readable inside one dispatcher turn.
    title: str(entry.title).trim(),
    // The entry itself: the non-obvious fact, in the form the next reader needs.
    text: str(entry.text).trim(),
    kind: MEMORY_KINDS.includes(kind) ? kind : "",
    tags: Array.isArray(entry.tags) ? entry.tags.filter((tag) => typeof tag === "string" && tag.trim() !== "").map((tag) => tag.trim()) : [],
    // What PROVED it — a command, a log line, a path, a run id. An entry with
    // evidence is one the next reader can re-check instead of re-deriving.
    evidence: str(entry.evidence).trim(),
    sourceSessionId: str(entry.sourceSessionId).trim(),
    sourceTaskId: str(entry.sourceTaskId).trim(),
    createdAt,
    updatedAt: num(entry.updatedAt, createdAt),
    // How many times `recall` has surfaced it. Feeds the store's pruning order
    // and the panel's "what is actually being used" question.
    hits: num(entry.hits, 0),
    lastHitAt: num(entry.lastHitAt, 0),
  };
}

/** One project document, with every field the readers expect present. */
export function normalizeProjectDocument(raw, key) {
  const document = isPlainObject(raw) ? raw : {};
  const entries = [];
  if (Array.isArray(document.entries)) {
    for (const item of document.entries) {
      if (!isPlainObject(item)) continue;
      if (str(item.id).trim() === "" && str(item.title).trim() === "") continue;
      entries.push(normalizeMemoryEntry(item, "m-" + entries.length));
    }
  }
  return {
    version: MEMORY_VERSION,
    key: str(document.key, key) || key,
    root: str(document.root).trim(),
    name: str(document.name).trim(),
    cwds: Array.isArray(document.cwds) ? document.cwds.filter((item) => typeof item === "string") : [],
    createdAt: num(document.createdAt, nowMs()),
    updatedAt: num(document.updatedAt, nowMs()),
    entries,
  };
}

/** One project registry document. */
export function normalizeRegistry(raw) {
  const registry = isPlainObject(raw) ? raw : {};
  const projects = [];
  if (Array.isArray(registry.projects)) {
    for (const item of registry.projects) {
      if (!isPlainObject(item)) continue;
      const key = str(item.key).trim();
      if (key === "") continue;
      projects.push({
        key,
        root: str(item.root).trim(),
        name: str(item.name).trim(),
        createdAt: num(item.createdAt, nowMs()),
        updatedAt: num(item.updatedAt, nowMs()),
        entries: num(item.entries, 0),
        lastEntryAt: num(item.lastEntryAt, 0),
      });
    }
  }
  return { version: MEMORY_VERSION, updatedAt: num(registry.updatedAt, nowMs()), projects };
}

// ── retrieval ─────────────────────────────────────────────────────────────

function fold(value) {
  return String(value).toLowerCase();
}

/**
 * Rank entries against a free-text query.
 *
 * A SUBSTRING scorer, not a keyword matcher, and deliberately so. The previous
 * design of the sibling routing feature ranked domains by matching keyword
 * arrays with a bigram score, and it failed for a reason worth not repeating:
 * the score was a lexical accident standing where a judgement belongs, and it
 * pushed whoever maintained it into writing keyword soup so the matcher would
 * fire. Retrieval here does the opposite — it answers "which recorded entries
 * mention this", hands over the text, and lets the dispatcher decide what
 * matters. No stemming, no synonyms, no confidence.
 *
 * Scoring is simple and explainable: containing the whole query is worth more
 * than containing one token, and a hit in the title or a tag outranks one in the
 * body, because those are the fields a writer chose on purpose.
 *
 * @param {object[]} entries normalized entries
 * @param {string} query free text; empty means "everything, newest first"
 * @param {{tags?: string[], kind?: string, limit?: number}} [options]
 * @returns {Array<{entry: object, score: number, hits: string[]}>}
 */
export function rankEntries(entries, query = "", options = {}) {
  const wantedTags = Array.isArray(options.tags) ? options.tags.map((tag) => fold(tag).trim()).filter((tag) => tag !== "") : [];
  const wantedKind = fold(str(options.kind).trim());
  const limit = Number.isSafeInteger(options.limit) && options.limit > 0 ? options.limit : 40;
  const needle = fold(query).trim();
  const tokens = needle === "" ? [] : needle.split(/[\s,，、;；]+/).filter((token) => token !== "");

  const scored = [];
  for (const entry of entries) {
    if (wantedKind !== "" && fold(entry.kind) !== wantedKind) continue;
    const tags = entry.tags.map((tag) => fold(tag));
    if (wantedTags.length > 0 && !wantedTags.every((tag) => tags.some((held) => held.includes(tag)))) continue;

    const title = fold(entry.title);
    const text = fold(entry.text);
    const evidence = fold(entry.evidence);
    const tagText = tags.join(" ");
    const hits = [];
    let score = 0;
    if (needle === "") {
      score = 1;
    } else {
      if (title.includes(needle)) {
        score += 100;
        hits.push("标题");
      }
      if (tagText.includes(needle)) {
        score += 70;
        hits.push("标签");
      }
      if (text.includes(needle)) {
        score += 50;
        hits.push("正文");
      }
      if (evidence.includes(needle)) {
        score += 30;
        hits.push("证据");
      }
      for (const token of tokens) {
        if (title.includes(token)) {
          score += 12;
          if (!hits.includes("标题")) hits.push("标题");
        }
        if (tagText.includes(token)) {
          score += 10;
          if (!hits.includes("标签")) hits.push("标签");
        }
        if (text.includes(token)) {
          score += 6;
          if (!hits.includes("正文")) hits.push("正文");
        }
        if (evidence.includes(token)) {
          score += 4;
          if (!hits.includes("证据")) hits.push("证据");
        }
      }
    }
    if (score <= 0) continue;
    scored.push({ entry, score, hits });
  }
  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    // A tie is broken by recency rather than by id: the newer of two equally
    // relevant entries is normally the one that corrected the older.
    return right.entry.updatedAt - left.entry.updatedAt;
  });
  return scored.slice(0, limit);
}

// ── storage ───────────────────────────────────────────────────────────────

/**
 * Default memory root: a `memory/` directory INSIDE the board root, so one
 * `$DSH_HOME/pm-mode` holds the boards and the knowledge they produced.
 *
 * It is a directory rather than a file beside the boards, and that is load-
 * bearing: `BoardStore.listBoardIds()` treats every subdirectory as a candidate
 * board, but only reports one when `board.json` actually reads — so `memory/`
 * is skipped there without a special case, and every board reader keeps working
 * untouched.
 */
export function defaultMemoryRoot(env = process.env) {
  const home = env.DSH_HOME && env.DSH_HOME.trim() !== "" ? env.DSH_HOME : path.join(os.homedir(), ".dsh");
  return path.join(home, "pm-mode", MEMORY_DIR);
}

function writeJsonAtomic(file, value) {
  const tmp = file + ".tmp-" + process.pid;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(value), "utf8");
  fs.renameSync(tmp, file);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function mintMemoryId() {
  return "m-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

/**
 * The project-memory store. One instance per process, owned by the host half.
 *
 * Every read goes to disk; every write replaces one document atomically. There
 * is no cache to invalidate and no lock to hold, which is what makes the same
 * documents safe to read from another process and safe to hand-edit.
 */
export function createMemoryStore(options = {}) {
  const root = options.root ?? defaultMemoryRoot();
  const logger = typeof options.logger === "function" ? options.logger : () => {};

  function indexFile() {
    return path.join(root, MEMORY_INDEX_FILE);
  }

  function fileFor(key) {
    return path.join(root, keyOfDirectory(key) + ".json");
  }

  function warn(message) {
    logger("warn", "pm-mode/memory: " + message);
  }

  /** The project registry: what this machine has learned about so far. */
  function registry() {
    return normalizeRegistry(readJson(indexFile()));
  }

  function saveRegistry(projects) {
    const document = { version: MEMORY_VERSION, updatedAt: nowMs(), projects: projects.slice(0, MAX_PROJECTS) };
    try {
      writeJsonAtomic(indexFile(), document);
    } catch (error) {
      warn("registry write failed: " + String(error && error.message ? error.message : error));
    }
    return document;
  }

  function touchRegistry(key, patch) {
    const current = registry();
    const existing = current.projects.find((item) => item.key === key);
    if (existing === undefined) {
      current.projects.unshift({ key, root: "", name: "", createdAt: nowMs(), updatedAt: nowMs(), entries: 0, lastEntryAt: 0, ...patch });
    } else {
      Object.assign(existing, patch, { updatedAt: nowMs() });
    }
    current.projects.sort((left, right) => right.updatedAt - left.updatedAt);
    return saveRegistry(current.projects);
  }

  /** Read one project document, or null when it has never been written. */
  function readProject(key) {
    if (str(key).trim() === "") return null;
    const raw = readJson(fileFor(key));
    if (raw === null) return null;
    return normalizeProjectDocument(raw, key);
  }

  /** Write one project document, recording the memo in the registry. */
  function writeProject(document) {
    document.updatedAt = nowMs();
    const names = new Set(document.cwds);
    document.cwds = [...names].slice(-12);
    try {
      writeJsonAtomic(fileFor(document.key), document);
    } catch (error) {
      warn("project write failed (" + document.key + "): " + String(error && error.message ? error.message : error));
      throw new Error("经验记忆写入失败：" + String(error && error.message ? error.message : error));
    }
    touchRegistry(document.key, {
      root: document.root,
      name: document.name,
      entries: document.entries.length,
      lastEntryAt: document.entries.reduce((max, entry) => Math.max(max, entry.createdAt), 0),
    });
    return document;
  }

  /**
   * An empty document for a project identity, not yet on disk.
   *
   * `cwds` holds the working directories that have filed into this project, and
   * an EMPTY one is not a directory. Stringifying an absent `cwd` into the array
   * is how `cwds: [null]` reached the panel for a project nobody had written to
   * yet — it is rendered to explain where a project's memory comes from, so a
   * null row is a visible wart with no meaning.
   */
  function blankProject(project) {
    const cwd = str(project.cwd).trim();
    return {
      version: MEMORY_VERSION,
      key: project.key,
      root: project.root,
      name: project.name,
      cwds: cwd === "" ? [] : [cwd],
      createdAt: nowMs(),
      updatedAt: nowMs(),
      entries: [],
    };
  }

  /**
   * Resolve a project identity into a keyed document, creating the document in
   * memory (NOT on disk — an empty read must not leave a file behind).
   *
   * `explicit` lets a caller name the project directly. It is accepted as either
   * a project key already on disk or an absolute directory, because both are
   * things a dispatcher legitimately holds: the key it was shown in `recall`,
   * or a path it wants to file against.
   *
   * A KEY WITH NO ROOT AND NO DOCUMENT IS A REFUSAL, not an empty project. That
   * combination is what a caller produces by handing over an identity object
   * whose `key` it filled in but whose `project` it forgot — and it is precisely
   * the bug this store shipped once: the write was accepted, went to a document
   * filed under the empty key, and was never seen again. An empty key is also
   * how "this session is in no identifiable project" arrives, so silently
   * treating it as a project would be the same mistake from the other side.
   */
  function projectFor(identity, explicit = "") {
    const wanted = str(explicit).trim();
    if (wanted !== "") {
      // An explicit KEY this machine knows, before anything is derived from it:
      // two identities can hash to the same key in principle, and looking up the
      // real document first keeps that theoretical collision from ever picking
      // the wrong project.
      const asKey = readProject(wanted);
      if (asKey !== null) return asKey;
      const resolved = resolveInjected(wanted);
      if (resolved.root !== "") {
        const key = projectKeyOf(resolved.root);
        return readProject(key) ?? blankProject({ key, root: resolved.root, name: resolved.name, cwd: resolved.cwd });
      }
      const derived = projectKeyOf(wanted);
      const existing = derived === "" ? null : readProject(derived);
      if (existing !== null) return existing;
      throw new Error(
        `找不到项目「${wanted}」：它既不是本机记录过的项目 key，也不是一个可识别的项目目录（绝对路径）`,
      );
    }
    // A KEYED identity with no root: the caller resolved a project earlier (off a
    // board, or from `projects()`) and is naming it. It must already exist —
    // falling through to a hash of the key would file the entry under a country
    // nobody visits, which is silently losing it.
    const named = str(identity.key).trim();
    if (named !== "" && str(identity.root).trim() === "") {
      const document = readProject(named);
      if (document === null) throw new Error(`项目「${named}」在这台机器上没有记录（可能已被删除）`);
      return document;
    }
    const key = projectKeyOf(identity.root);
    if (key === "") return null;
    return readProject(key) ?? blankProject({ key, root: identity.root, name: identity.name, cwd: identity.cwd });
  }

  /**
   * Resolve a caller-supplied PATH. Named projects go through
   * `resolveNamedProject`, not the guessing walk: a caller that names a
   * directory has identified the project itself, so a checkout with no marker
   * the plugin knows (`project=E:\…\trunk` in a Perforce workspace, the case
   * that made this necessary) is filed under exactly that directory instead of
   * being refused. A subdirectory of a known project still lands on the project.
   */
  function resolveInjected(value) {
    const asPath = str(value).trim();
    if (asPath === "" || !path.isAbsolute(asPath)) return { root: "", name: "", cwd: "" };
    const identity = resolveNamedProject(asPath);
    return { root: identity.root, name: identity.name, cwd: identity.cwd };
  }

  /** Record the cwd a session used, so the panel can explain the filing. */
  function noteCwd(document, cwd) {
    const value = str(cwd).trim();
    if (value === "" || document.cwds.includes(value)) return;
    document.cwds = [...document.cwds, value].slice(-12);
  }

  function trimEntries(document) {
    if (document.entries.length <= MAX_ENTRIES) return 0;
    // Prune by "never used, then oldest": an entry nobody has ever recalled is
    // the cheapest thing to lose, and among those the oldest goes first.
    const ordered = [...document.entries].sort((left, right) => {
      if (left.hits !== right.hits) return left.hits - right.hits;
      return left.updatedAt - right.updatedAt;
    });
    const doomed = new Set(ordered.slice(0, document.entries.length - MAX_ENTRIES).map((entry) => entry.id));
    const before = document.entries.length;
    document.entries = document.entries.filter((entry) => !doomed.has(entry.id));
    return before - document.entries.length;
  }

  return {
    root,

    /** Path of one project's document — surfaced so a human can open the file. */
    fileFor,

    /** The cwd→project rule, exposed so the tool and the panel share one answer. */
    resolveIdentity(cwd) {
      const identity = resolveProjectIdentity(cwd);
      return { ...identity, key: projectKeyOf(identity.root) };
    },

    /**
     * The caller-named-project rule: a key this machine knows, or a directory
     * that IS the project whether or not it carries a marker we recognize.
     * Exposed next to `resolveIdentity` because the two answer different
     * questions — "where am I" (guess) and "which project did I name" (obey) —
     * and every caller has to pick the right one.
     */
    resolveNamed(value) {
      const identity = resolveNamedProject(value);
      return { ...identity, key: projectKeyOf(identity.root) };
    },

    /** Every project this machine knows about, newest first. */
    projects() {
      return registry().projects;
    },

    /**
     * The dispatcher's write path.
     *
     * `identity` is the caller's project, already resolved — by the board (a
     * session's own cwd) or by the panel (a key off the board). `input.project`
     * is the ALTERNATIVE: a key or absolute path that names a DIFFERENT project
     * than the caller's, which is how a dispatcher files a lesson it learned
     * while looking at a checkout other than its own working directory. When it
     * is given it replaces the identity entirely, and it is resolved through
     * `projectFor`'s explicit path — so an identity whose key names a project
     * that does not exist YET (the ordinary case for the first write) is never
     * asked to resolve itself twice.
     *
     * `id` is optional and an id that already exists is an UPDATE rather than an
     * error: a dispatcher that re-states a lesson has usually learned it more
     * precisely, and refusing the second write would leave the weaker version in
     * place. What a duplicate id may NOT do is change the filing — the project is
     * the caller's, not the entry being edited.
     */
    remember(identity, input = {}) {
      const named = str(input.project).trim();
      const document = named === "" ? projectFor(identity) : projectFor(identity, named);
      if (document === null) {
        throw new Error(
          "无法确定当前会话属于哪个项目（会话没有工作目录，或那个目录不在任何可识别的项目里）—— " +
            "传 project=<绝对路径> 手动指定归属，记忆需要挂在项目上才能跨会话共享",
        );
      }
      const title = str(input.title).trim();
      const text = str(input.text).trim();
      if (title === "" && text === "") throw new Error("remember 需要 title（索引行）或 text（经验正文）");
      const kind = str(input.kind).trim();
      if (kind !== "" && !MEMORY_KINDS.includes(kind)) {
        throw new Error(`未知 kind: ${kind}（可选 ${MEMORY_KINDS.join("/")}，或留空）`);
      }
      const at = nowMs();
      const wantedId = str(input.id).trim();
      const existing = wantedId === "" ? undefined : document.entries.find((entry) => entry.id === wantedId);
      if (existing !== undefined) {
        if (input.title !== undefined) existing.title = title === "" ? existing.title : title;
        if (input.text !== undefined) existing.text = text;
        if (input.kind !== undefined) existing.kind = MEMORY_KINDS.includes(kind) ? kind : "";
        if (input.tags !== undefined) existing.tags = normalizeMemoryEntry({ tags: input.tags }).tags;
        if (input.evidence !== undefined) existing.evidence = str(input.evidence).trim();
        if (input.sourceTaskId !== undefined) existing.sourceTaskId = str(input.sourceTaskId).trim();
        existing.updatedAt = at;
        noteCwd(document, identity.cwd);
        writeProject(document);
        return { entry: existing, created: false, document };
      }
      const entry = normalizeMemoryEntry(
        {
          id: wantedId === "" ? mintMemoryId() : wantedId,
          title: title === "" ? text.slice(0, 60) : title,
          text: text === "" ? title : text,
          kind,
          tags: input.tags,
          evidence: input.evidence,
          sourceSessionId: str(input.sourceSessionId),
          sourceTaskId: str(input.sourceTaskId),
          createdAt: at,
          updatedAt: at,
        },
        mintMemoryId(),
      );
      if (document.entries.some((item) => item.id === entry.id)) entry.id = mintMemoryId();
      document.entries.unshift(entry);
      const pruned = trimEntries(document);
      noteCwd(document, identity.cwd);
      writeProject(document);
      return { entry, created: true, pruned, document };
    },

    /**
     * The dispatcher's read path. Records a hit on everything returned, because
     * "which entries are actually earning their place" is a question only the
     * read side can answer.
     */
    recall(identity, input = {}) {
      const named = str(input.project).trim();
      let document;
      try {
        document = named === "" ? projectFor(identity) : projectFor(identity, named);
      } catch (error) {
        // A named project that does not exist is a legitimate EMPTY answer for a
        // read (nothing has been recorded there yet), unlike for a write.
        if (named === "") throw error;
        return { document: null, identity, matches: [], total: 0, reason: "unknown-project" };
      }
      if (document === null) {
        return { document: null, identity, matches: [], total: 0, reason: "unidentified" };
      }
      const ranked = rankEntries(document.entries, str(input.query), {
        tags: input.tags,
        kind: input.kind,
        limit: input.limit,
      });
      if (ranked.length > 0) {
        const at = nowMs();
        for (const match of ranked) {
          match.entry.hits += 1;
          match.entry.lastHitAt = at;
        }
        writeProject(document);
      }
      return { document, identity, matches: ranked, total: document.entries.length, reason: "" };
    },

    /**
     * The dispatcher's delete path — the one the user asked for by name:
     * a wrong entry must be removable, and removable by the agent that wrote it
     * without anyone opening a file.
     */
    forget(identity, input = {}) {
      const named = str(input.project).trim();
      const document = named === "" ? projectFor(identity) : projectFor(identity, named);
      if (document === null) throw new Error("无法确定当前会话属于哪个项目；传 project=<绝对路径> 指定");
      const id = str(input.id).trim();
      if (id === "") throw new Error("forget 需要 id（先用 action=recall 或 list 拿到它）");
      const before = document.entries.length;
      document.entries = document.entries.filter((entry) => entry.id !== id);
      if (document.entries.length === before) {
        throw new Error(`没有这条经验: ${id}（用 action=list 看现有条目）`);
      }
      writeProject(document);
      return { removed: id, remaining: document.entries.length, document };
    },

    /**
     * Read-only view for the panel: never counts a hit, never writes.
     *
     * Takes an ALREADY RESOLVED identity — `{key, root}` from `resolveNamed`,
     * `projects()`, or a board — not a bare string. A caller that has resolved a
     * project holds both halves, and passing only the key threw the root away,
     * which made this method re-derive a key from the key and fail on the
     * project it had just been handed. `null` is returned for "no project",
     * which the panel renders as "this conversation has none"; anything the
     * store cannot find is a refusal, not an empty list.
     */
    view(identity, options = {}) {
      const project = projectFor(identity === null || identity === undefined ? { key: "", root: "", cwd: "" } : identity);
      if (project === null) return null;
      const ranked = rankEntries(project.entries, str(options.query), {
        tags: options.tags,
        kind: options.kind,
        limit: options.limit,
      });
      return { document: project, total: project.entries.length, matches: ranked };
    },

    /** Every project's summary, for the panel's project switcher. */
    overview() {
      return registry().projects.map((project) => {
        const document = readProject(project.key);
        return {
          key: project.key,
          root: project.root,
          name: project.name,
          entries: document === null ? project.entries : document.entries.length,
          lastEntryAt: project.lastEntryAt,
          updatedAt: project.updatedAt,
        };
      });
    },
  };
}
