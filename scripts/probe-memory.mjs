/**
 * Throwaway functional probe for lib/memory.js — proves the project-identity
 * rule, the write/read/forget paths and the pruner on real files.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createMemoryStore,
  projectKeyOf,
  resolveProjectIdentity,
  resolveNamedProject,
  resolveProjectRoot,
  isProjectRoot,
  rankEntries,
  MEMORY_KINDS,
} from "../lib/memory.js";

let failed = 0;
function check(label, passes, detail = "") {
  console.log((passes ? "  ok   " : "  FAIL ") + label + (passes || detail === "" ? "" : "  → " + detail));
  if (!passes) failed += 1;
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "pmmem-"));
const fakeHome = path.join(sandbox, "home");
fs.mkdirSync(fakeHome, { recursive: true });
const env = { DSH_HOME: fakeHome, USERPROFILE: fakeHome, HOME: fakeHome };

// A monorepo: root marker + a package with its own package.json + a nested .git.
const repo = path.join(fakeHome, "work", "my-repo");
fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "my-repo" }));
const pkg = path.join(repo, "packages", "core");
fs.mkdirSync(pkg, { recursive: true });
fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "@acme/core" }));
fs.mkdirSync(path.join(pkg, ".git"), { recursive: true });

// A directory with NO marker of its own except a fake package.json in a child.
const loose = path.join(fakeHome, "scratch", "oracle-app");
fs.mkdirSync(loose, { recursive: true });
fs.writeFileSync(path.join(loose, "package.json"), JSON.stringify({ name: "oracle-app" }));

// A tool config dir carrying a content-less package.json (must NOT count).
const toolCfg = path.join(fakeHome, "tools", "some-linter");
fs.mkdirSync(toolCfg, { recursive: true });
fs.writeFileSync(path.join(toolCfg, "package.json"), "{}");

const noMarker = path.join(fakeHome, "plain", "folder");
fs.mkdirSync(noMarker, { recursive: true });

console.log("— project identity —");
check("monorepo root is the OUTERMOST marker", resolveProjectRoot(repo, { env }) === repo, resolveProjectRoot(repo, { env }));
check("deep package resolves UP to the repo root", resolveProjectRoot(pkg, { env }) === repo, resolveProjectRoot(pkg, { env }));
check("nested .git does not win", resolveProjectRoot(path.join(pkg, ".git"), { env }) === repo, resolveProjectRoot(path.join(pkg, ".git"), { env }));
check("home is never a project root", resolveProjectRoot(fakeHome, { env }) === "", resolveProjectRoot(fakeHome, { env }));
check("content-less package.json is not a project", isProjectRoot(toolCfg, { env }) === false);
check("real package.json is a project", isProjectRoot(repo, { env }) === true);
check("no marker anywhere → unidentified", resolveProjectIdentity(noMarker, { env }).reason === "unidentified", resolveProjectIdentity(noMarker, { env }).reason);
check("a bare manifest still identifies a project", resolveProjectIdentity(loose, { env }).reason === "outermost-marker", resolveProjectIdentity(loose, { env }).reason);
check("empty cwd is identified as no-cwd", resolveProjectIdentity("", { env }).reason === "no-cwd");

// An explicit signpost beats everything — in a directory of its own, so the
// monorepo fixtures above stay a pure test of the marker walk.
const declared = path.join(repo, "sub", "declared");
fs.mkdirSync(path.join(declared, ".dsh"), { recursive: true });
fs.writeFileSync(path.join(declared, ".dsh", "project.json"), JSON.stringify({ name: "declared-name" }));
const signposted = resolveProjectIdentity(declared, { env });
check("signpost wins over the outermost marker", signposted.root === declared && signposted.name === "declared-name", JSON.stringify(signposted));

// Two sessions in different subdirs must share one key.
const keyA = projectKeyOf(resolveProjectRoot(repo, { env }));
const keyB = projectKeyOf(resolveProjectRoot(pkg, { env }));
check("subdir session shares the root session's project key", keyA === keyB, keyA + " vs " + keyB);
check("key is filesystem-stable", keyA === projectKeyOf(repo), keyA + " vs " + projectKeyOf(repo));

console.log("— the VCS a real checkout actually uses —");
// The failure this covers, measured on a live deployment: a Perforce workspace
// with NO .git, NO package.json and no language manifest anywhere resolved to
// nothing, so pm_memory refused every write in the directory the dispatcher was
// working in.
const p4 = path.join(fakeHome, "work", "p4-trunk");
fs.mkdirSync(p4, { recursive: true });
fs.writeFileSync(
  path.join(p4, "p4config.txt"),
  "P4PORT=ssl:p4.example.net:1667\nP4USER=someone\nP4CLIENT=p4-trunk\n",
);
fs.writeFileSync(path.join(p4, ".p4ignore"), "*.log\n");
check("a Perforce workspace resolves as a project", resolveProjectRoot(p4, { env }) === p4, resolveProjectRoot(p4, { env }));

// An empty stub proves nothing: a checked-in empty p4config is not a project.
const p4Stub = path.join(fakeHome, "work", "p4-stub");
fs.mkdirSync(p4Stub, { recursive: true });
fs.writeFileSync(path.join(p4Stub, "p4config.txt"), "");
check("an EMPTY p4config.txt is not a project", isProjectRoot(p4Stub, { env }) === false);

// A checkout marked only by ignore files.
const ignoreOnly = path.join(fakeHome, "work", "ignore-only");
fs.mkdirSync(ignoreOnly, { recursive: true });
fs.writeFileSync(path.join(ignoreOnly, ".gitignore"), "build/\n");
check("a .gitignore-only checkout still resolves", resolveProjectRoot(ignoreOnly, { env }) === ignoreOnly, resolveProjectRoot(ignoreOnly, { env }));

// `.envrc` (direnv) and an editor workspace file are project-root facts too.
const envrcOnly = path.join(fakeHome, "work", "envrc-only");
fs.mkdirSync(envrcOnly, { recursive: true });
fs.writeFileSync(path.join(envrcOnly, ".envrc"), "use node\n");
check("a .envrc-only checkout still resolves", resolveProjectRoot(envrcOnly, { env }) === envrcOnly);

const sln = path.join(fakeHome, "work", "sln-only");
fs.mkdirSync(sln, { recursive: true });
fs.writeFileSync(path.join(sln, "Game.sln"), "Microsoft Visual Studio Solution File\n");
check("a *.sln-only checkout still resolves (glob marker)", resolveProjectRoot(sln, { env }) === sln, resolveProjectRoot(sln, { env }));

console.log("— a project the walk cannot recognize, NAMED by the caller —");
// The escape hatch. Guessing must stay conservative (an unidentified cwd gets no
// memory rather than a shared bucket), but a caller that NAMES a directory has
// identified the project itself, and refusing that is what made the feature
// unusable in the one directory that mattered.
const mystery = path.join(fakeHome, "work", "mystery-trunk");
fs.mkdirSync(mystery, { recursive: true });
check("an unmarked directory is NOT guessed to be a project", resolveProjectIdentity(mystery, { env }).reason === "unidentified", resolveProjectIdentity(mystery, { env }).reason);
const namedMystery = resolveNamedProject(mystery);
check("...but NAMING it identifies it", namedMystery.root === mystery && namedMystery.reason === "named", JSON.stringify(namedMystery));
check("naming a home directory is still refused", resolveNamedProject(fakeHome, { env }).root === "");
check("naming a directory that does not exist is refused", resolveNamedProject(path.join(fakeHome, "work", "nope"), { env }).root === "");
check(
  "naming a SUBDIRECTORY of a known project lands on the project",
  resolveNamedProject(path.join(repo, "packages"), { env }).root === repo,
  resolveNamedProject(path.join(repo, "packages"), { env }).root,
);
check(
  "a named project is reachable through the store, and writes land in it",
  (() => {
    const probe = createMemoryStore({ root: path.join(fakeHome, "named-memory") });
    const resolved = probe.resolveNamed(mystery);
    if (resolved.key === "") return false;
    probe.remember(resolved, { title: "named-project write", text: "body", tags: ["named"] });
    return probe.view(resolved).total === 1;
  })(),
);

console.log("— store write / read / forget —");
const memoryRoot = path.join(fakeHome, "pm-mode", "memory");
const store = createMemoryStore({ root: memoryRoot });
const identity = store.resolveIdentity(repo);

const first = store.remember(identity, {
  title: "构建产物在 dist/，不是 build/",
  text: "这个仓库的构建脚本写 dist/；build/ 是另一套工具留下的空目录，改它没有任何效果。",
  kind: "gotcha",
  tags: ["build", "产物"],
  evidence: "npm run build → dist/index.js；build/ 一直是空的",
  sourceSessionId: "session-abc",
  sourceTaskId: "t-1",
});
check("first write reports created", first.created === true);
check("entry got a generated id", /^m-/.test(first.entry.id), first.entry.id);
check("document hit disk", fs.existsSync(store.fileFor(identity.key)));
check("registry recorded the project", store.projects().some((project) => project.key === identity.key));

const second = store.remember(identity, {
  title: "内部镜像 token 放在 ~/.npmrc",
  text: "拉私有包要用的 token 只在本机 ~/.npmrc 里；不要写进仓库，也不要在日志里回显。",
  kind: "token",
  tags: ["token", "npm"],
});
check("second write is a new entry", second.created === true && second.document.entries.length === 2);

const recalled = store.recall(identity, { query: "build" });
check("recall finds the gotcha by its tag", recalled.matches.length >= 1 && recalled.matches[0].entry.id === first.entry.id, JSON.stringify(recalled.matches.map((m) => m.entry.title)));
check("recall records a hit", recalled.matches[0].entry.hits === 1, String(recalled.matches[0].entry.hits));
check("recall reports the total for the project", recalled.total === 2, String(recalled.total));

const byKind = store.recall(identity, { kind: "token" });
check("kind filter isolates the token entry", byKind.matches.length === 1 && byKind.matches[0].entry.title.includes("token"), String(byKind.matches.length));

const byTag = store.recall(identity, { tags: ["npm"] });
check("tag filter works", byTag.matches.length === 1, String(byTag.matches.length));

const emptyQuery = store.recall(identity, {});
check("empty query returns everything", emptyQuery.matches.length === 2, String(emptyQuery.matches.length));

// Idempotent re-state updates instead of duplicating.
const restated = store.remember(identity, { id: first.entry.id, text: "更正：dist/ 只在 CI 里生成，本地要跑 npm run build:local。" });
check("re-stating an id updates in place", restated.created === false && restated.document.entries.length === 2, String(restated.document.entries.length));
check("the update landed", restated.entry.text.includes("build:local"));

// Cross-session sharing: a DIFFERENT session cwd in the same project sees it.
const otherSession = store.resolveIdentity(pkg);
check("a session in another subdir resolves to the same key", otherSession.key === identity.key, otherSession.key + " vs " + identity.key);
const seenByOther = store.recall(otherSession, {});
check("the other session sees both entries", seenByOther.matches.length === 2, String(seenByOther.matches.length));

// Isolation: another project must not see it.
const otherProject = store.resolveIdentity(loose);
check("another project resolves to a different key", otherProject.key !== identity.key);
const isolated = store.recall(otherProject, {});
check("another project starts empty", isolated.total === 0, String(isolated.total));

// An explicit project path also works (and lands on the SAME document).
const explicit = store.recall({ root: "", name: "", cwd: "" }, { project: pkg, query: "token" });
check("an explicit path resolves to the project, not a new one", explicit.matches.length === 1, String(explicit.matches.length));

console.log("— forget —");
const dropped = store.forget(identity, { id: second.entry.id });
check("forget removes the entry", dropped.remaining === 1, String(dropped.remaining));
check("the removal persisted", store.recall(identity, {}).total === 1);
let refused = false;
try {
  store.forget(identity, { id: "m-does-not-exist" });
} catch {
  refused = true;
}
check("forgetting an unknown id refuses loudly", refused);
let needsId = false;
try {
  store.forget(identity, {});
} catch {
  needsId = true;
}
check("forget without an id refuses loudly", needsId);

console.log("— unidentified session —");
const vague = store.resolveIdentity(noMarker);
check("a marker-less session has no key", vague.key === "", vague.key);
const vagueRecall = store.recall(vague, {});
check("recall on an unidentified session answers empty with a reason", vagueRecall.reason === "unidentified" && vagueRecall.matches.length === 0);
let vagueWrite = false;
try {
  store.remember(vague, { title: "x", text: "y" });
} catch (error) {
  vagueWrite = String(error.message).includes("project=");
}
check("an unidentified write refuses WITH the way out", vagueWrite);

console.log("— validation —");
let badKind = false;
try {
  store.remember(identity, { title: "x", text: "y", kind: "nonsense" });
} catch (error) {
  badKind = String(error.message).includes(MEMORY_KINDS[0]);
}
check("an unknown kind is refused with the vocabulary", badKind);
let emptyWrite = false;
try {
  store.remember(identity, {});
} catch {
  emptyWrite = true;
}
check("an empty remember is refused", emptyWrite);

console.log("— pruning —");
const many = path.join(fakeHome, "work", "bulk-repo");
fs.mkdirSync(path.join(many, ".git"), { recursive: true });
const bulkIdentity = store.resolveIdentity(many);
for (let index = 0; index < 305; index += 1) {
  store.remember(bulkIdentity, { title: "entry " + index, text: "body " + index, tags: ["bulk"] });
}
const bulkDoc = store.view(bulkIdentity);
check("the entry cap holds", bulkDoc.total === 300, String(bulkDoc.total));
check("the newest entry survived", bulkDoc.document.entries.some((entry) => entry.title === "entry 304"));

console.log("— ranking —");
const entries = [
  { id: "a", title: "alpha build flag", text: "unrelated body", evidence: "", tags: ["one"], kind: "gotcha", updatedAt: 10 },
  { id: "b", title: "other", text: "the build flag is passed twice", evidence: "", tags: ["two"], kind: "recipe", updatedAt: 20 },
  { id: "c", title: "gamma", text: "nothing here", evidence: "build flag in log", tags: ["three"], kind: "", updatedAt: 30 },
];
const ranked = rankEntries(entries, "build flag");
check("title match outranks body match", ranked[0].entry.id === "a", ranked.map((item) => item.entry.id).join(","));
check("every field is searched", ranked.length === 3, String(ranked.length));
check("a query with no match returns nothing", rankEntries(entries, "zzzz").length === 0);
check("recency breaks a tie", rankEntries(entries, "unrelated")[0].entry.id === "a");

console.log("— hand-editable files —");
const onDisk = JSON.parse(fs.readFileSync(store.fileFor(identity.key), "utf8"));
check("the document is readable JSON with entries", Array.isArray(onDisk.entries), typeof onDisk.entries);
check("the registry lists projects", JSON.parse(fs.readFileSync(path.join(memoryRoot, "index.json"), "utf8")).projects.length >= 2);

fs.rmSync(sandbox, { recursive: true, force: true });
console.log(failed === 0 ? "\n✅ memory module probe: all checks passed" : "\n❌ " + failed + " checks failed");
process.exitCode = failed === 0 ? 0 : 1;
