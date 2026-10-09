/**
 * Unit checks for the timeline collector (lib/collector.js) — the one module
 * every other suite stubbed out with `{ liveStatus: () => ({}) }`.
 *
 * A fake Cordis context captures the event handlers and the interval callback;
 * a real BoardStore over a temp directory provides the boards. No dsh imports
 * are needed because the collector itself imports none.
 *
 *   node scripts/check-collector.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BoardStore } from "../lib/store.js";
import { startCollector } from "../lib/collector.js";

let checks = 0;
const failures = [];
function ok(label, condition, detail = "") {
  checks += 1;
  if (condition) console.log("  ok   " + label);
  else {
    failures.push(label + (detail ? " —— " + detail : ""));
    console.log("  FAIL " + label + (detail ? " —— " + detail : ""));
  }
}
function section(title) {
  console.log("\n" + title);
}

/** A minimal Cordis stand-in: event capture, interval capture, lazy services. */
function fakeCtx(services = {}) {
  const handlers = new Map();
  const intervals = [];
  return {
    handlers,
    intervals,
    on(name, fn) {
      handlers.set(name, fn);
    },
    interval(fn, ms) {
      intervals.push({ fn, ms });
    },
    get(name) {
      return services[name];
    },
  };
}

function fakeAgents(list) {
  return { list: () => list };
}

function emitStatus(handlers, sessionId, status) {
  handlers.get("agent/status")({ agent: { id: sessionId }, status });
}
function emitToolCall(handlers, sessionId, callId, name) {
  handlers.get("session/event")({ id: sessionId }, { type: "tool/call", data: { callId, name } });
}
function emitToolResult(handlers, sessionId, callId) {
  handlers.get("session/event")(
    { id: sessionId },
    { type: "tool/result", data: { message: { source: { callId } } } },
  );
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-collector-"));
const store = new BoardStore({ root });
const DISPATCHER = "session-disp";
const board = store.open(DISPATCHER, "调度台");

const agentsList = [{ id: DISPATCHER, status: "running" }];
const childrenByParent = new Map();
const services = {
  agents: fakeAgents(agentsList),
  subagents: {
    listChildren: async (parentId) => childrenByParent.get(parentId) ?? [],
  },
};
const ctx = fakeCtx(services);
const collector = startCollector({ ctx, store, logger: () => {} });

section("wiring");
ok("the collector listens on the four runtime events", ["agent/status", "subagent/start", "subagent/end", "session/event"].every((name) => ctx.handlers.has(name)));
ok("the reconciliation poll is armed at 5s", ctx.intervals.length === 1 && ctx.intervals[0].ms === 5000, JSON.stringify(ctx.intervals));

section("the dispatcher's own activity is not a worker span");
emitStatus(ctx.handlers, DISPATCHER, "running");
emitToolCall(ctx.handlers, DISPATCHER, "c1", "pm_mode");
emitToolResult(ctx.handlers, DISPATCHER, "c1");
ok("dispatcher status transitions are not recorded", board.timeline.length === 0, JSON.stringify(board.timeline.map((e) => e.kind)));
ok("dispatcher tool calls are not recorded", board.timeline.every((e) => e.sessionId !== DISPATCHER));

section("adoption and spans");
// An unknown child with exactly ONE running board owner is adopted onto it.
ctx.handlers.get("subagent/start")({ id: "child-a", provider: "spawn" });
ok("a child observed with one running dispatcher is adopted", board.timeline.some((e) => e.kind === "agent-start" && e.sessionId === "child-a"));
emitToolCall(ctx.handlers, "child-a", "c1", "read");
emitToolResult(ctx.handlers, "child-a", "c1");
ok("the adopted child's tool pair is recorded", board.timeline.some((e) => e.kind === "tool-result" && e.sessionId === "child-a"));

section("one ending, one event");
emitStatus(ctx.handlers, "child-a", "idle");
const endsAfterStatus = board.timeline.filter((e) => e.kind === "agent-end" && e.sessionId === "child-a").length;
ctx.handlers.get("subagent/end")({ id: "child-a", stopReason: "completed" });
const endsAfterBoth = board.timeline.filter((e) => e.kind === "agent-end" && e.sessionId === "child-a").length;
ok("agent/status idle records the end", endsAfterStatus === 1, String(endsAfterStatus));
ok("subagent/end for an already-idle child does NOT double-record", endsAfterBoth === 1, String(endsAfterBoth));

section("the activity rollup survives without a timeline rescan");
const rollup = board.activity["child-a"];
ok("the rollup saw one open/close pair", rollup !== undefined && rollup.lastStart === 0 && rollup.totalMs >= 0, JSON.stringify(rollup));
ctx.handlers.get("subagent/start")({ id: "child-b", provider: "spawn" });
ok("a second child opens a span", board.activity["child-b"] !== undefined && board.activity["child-b"].lastStart > 0);

section("ambiguous parents are NOT guessed");
// Two running board-owning sessions: the guess must refuse and defer to the
// registry-driven reconcile, or a child lands on the wrong board.
const other = store.open("session-other", "另一台调度");
agentsList.push({ id: "session-other", status: "running" });
ctx.handlers.get("subagent/start")({ id: "child-ambiguous", provider: "spawn" });
ok(
  "with two running dispatchers, no adoption happens on the spot",
  !board.timeline.some((e) => e.sessionId === "child-ambiguous") && !other.timeline.some((e) => e.sessionId === "child-ambiguous"),
);
ok("the ambiguous child's tool events are held off until attribution", !board.timeline.some((e) => e.kind === "tool-call" && e.sessionId === "child-ambiguous"));
emitToolCall(ctx.handlers, "child-ambiguous", "c9", "read");

section("reconcile attributes exactly via the registry");
childrenByParent.set("session-other", [{ id: "child-ambiguous", kind: "child" }]);
collector.reconcile();
// adoptFromRegistry is fire-and-forget (the registry call is async); give the
// microtask queue a turn so the adoption lands before the next event.
await new Promise((resolve) => setTimeout(resolve, 0));
ok(
  "reconcile does not record the dispatcher's own status as a span either",
  !other.timeline.some((e) => e.sessionId === "session-other") && !board.timeline.some((e) => e.sessionId === DISPATCHER),
  "other=" + JSON.stringify(other.timeline.map((e) => e.kind + ":" + e.sessionId)),
);
emitToolCall(ctx.handlers, "child-ambiguous", "c10", "read");
ok(
  "after reconcile, the child writes to its TRUE parent's board",
  other.timeline.some((e) => e.kind === "tool-call" && e.sessionId === "child-ambiguous" && e.detail === "c10"),
  "other=" + JSON.stringify(other.timeline.map((e) => e.kind + ":" + e.sessionId)),
);
ok("and not to the guessed one", !board.timeline.some((e) => e.sessionId === "child-ambiguous"));

section("result");
console.log("\n" + (checks - failures.length) + "/" + checks + " checks passed");
if (failures.length > 0) {
  console.log("failures:\n  - " + failures.join("\n  - "));
  process.exitCode = 1;
}
fs.rmSync(root, { recursive: true, force: true });
