/**
 * Read a PM session's real conversation log.
 *
 * Storage shape in this deployment: `.dsh/sessions/--<encoded-cwd>--/<id>/
 * session.vN.jsonl.zstd` is a zstd-compressed JSONL log. The first line is the
 * session header (`type: "session"`); every later line is a session event.
 * Child sessions of a delegated run live in the SAME workspace directory, with
 * a "session-" id prefix instead of a bare uuid.
 *
 * Usage:
 *   node read-pm-session.mjs <file.vN.jsonl.zstd> [options]
 *     --types            event type histogram only
 *     --view             conversation skeleton (default)
 *     --full             every event
 *     --grep <text>      only events whose summary contains text
 *     --head <n> --tail <n>
 *     --around <n>       n events either side of each --grep hit
 *     --timeline         turn/step boundaries with wall-clock gaps (the "空转" view)
 */
import { readSessionLog } from "./session-log.mjs";

const [, , file, ...flags] = process.argv;
if (file === undefined) {
  console.error("usage: node read-pm-session.mjs <file.vN.jsonl.zstd> [--types|--view|--full|--timeline] [--grep text] [--head n] [--tail n] [--around n]");
  process.exit(2);
}
const has = (name) => flags.includes(name);
const valueOf = (name, fallback = null) => {
  const index = flags.indexOf(name);
  return index >= 0 && flags[index + 1] !== undefined ? flags[index + 1] : fallback;
};
const numberOf = (name, fallback) => {
  const raw = valueOf(name);
  return raw === null ? fallback : Number(raw);
};

// Read through the frame-splitting decoder rather than `zstdDecompressSync`
// directly: the file is a CONCATENATION of frames (frame #1 is the header,
// every later frame holds events), and the one-shot call stops after the first
// — which reports "1 line, 0 events" for a full conversation. See trap 3.
const { header: rawHeader, events, frames } = readSessionLog(file);
const header = rawHeader === null ? undefined : rawHeader;

console.log("file    : " + file);
if (header !== undefined) {
  console.log(
    "session : " + header.id + "  preset=" + header.agentPreset + "  depth=" + header.delegationDepth +
      "  origin=" + (header.origin ?? "-") + "  parent=" + (header.parentSession ?? "-"),
  );
  console.log("cwd     : " + header.cwd + "   created=" + new Date(header.createdAt).toISOString());
}
console.log("frames  : " + frames);
console.log("events  : " + events.length);

const stamps = events.map((event) => (typeof event.time === "number" ? event.time : null)).filter((value) => value !== null);
if (stamps.length > 0) {
  console.log(
    "span    : " + new Date(Math.min(...stamps)).toISOString() + "  →  " + new Date(Math.max(...stamps)).toISOString() +
      "  (" + Math.round((Math.max(...stamps) - Math.min(...stamps)) / 1000) + "s)",
  );
}

if (has("--types")) {
  const counts = new Map();
  for (const event of events) counts.set(String(event.type), (counts.get(String(event.type)) ?? 0) + 1);
  for (const [type, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log("  " + String(count).padStart(5) + "  " + type);
  }
  process.exit(0);
}

function blocksText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (block === null || typeof block !== "object") continue;
    if (block.type === "text") parts.push(String(block.text ?? ""));
    else if (block.type === "reasoning") parts.push("[思考 " + String(block.text ?? "").length + " 字]");
    else if (block.type === "tool-call") parts.push("[调用 " + block.name + " " + String(block.arguments ?? "").slice(0, 300) + "]");
  }
  return parts.join(" ");
}

function toolResultText(data) {
  const blocks = data?.message?.content;
  if (!Array.isArray(blocks)) return "";
  const parts = [];
  for (const block of blocks) {
    if (block?.type === "tool-result" && Array.isArray(block.content)) {
      for (const inner of block.content) if (inner?.type === "text") parts.push(String(inner.text));
    }
  }
  return parts.filter(Boolean).join(" ");
}

function describe(event) {
  const data = event.data ?? {};
  switch (event.type) {
    case "turn/start": return "TURN " + data.turn + " START";
    case "turn/end": return "TURN " + data.turn + " END  reason=" + JSON.stringify(data.reason ?? null);
    case "step/start": return "  step " + data.step + " start";
    case "step/end": return "  step " + data.step + " end";
    case "user/message": return "USER: " + blocksText(data.content);
    case "assistant/message": {
      const usage = data.usage ? " [in " + data.usage.inputTokens + " out " + data.usage.outputTokens + "]" : "";
      return "ASSISTANT: " + blocksText(data.message?.content) + usage + (data.interrupted ? " [interrupted]" : "");
    }
    case "system/message": return "SYSTEM(" + (data.message?.source?.form ?? "?") + "): " + blocksText(data.message?.content);
    case "tool/call": return "→ " + data.name + " " + String(data.arguments ?? "").slice(0, 400);
    case "tool/result": {
      const error = data.error ? "  !! ERROR " + data.error.name + " / " + data.error.code : "";
      return "← result " + toolResultText(data).slice(0, 500) + error;
    }
    case "request/context": return "request/context " + JSON.stringify(data).slice(0, 200);
    case "request/header": return "request/header reason=" + data.reason + " " + JSON.stringify(data.header?.config ?? {}).slice(0, 160);
    case "session/end-seed": return "session/end-seed " + JSON.stringify(data);
    default: return String(event.type) + " " + JSON.stringify(data).slice(0, 200);
  }
}

const rows = events.map((event, index) => ({
  index,
  type: String(event.type),
  at: typeof event.time === "number" ? event.time : null,
  text: describe(event).replace(/\s+/g, " ").trim(),
}));

if (has("--timeline")) {
  // The "idle spin" view: turn boundaries with the wall-clock gap since the
  // previous boundary, so a stream of empty turns is visible at a glance.
  let previous = null;
  for (const row of rows) {
    if (!["turn/start", "turn/end", "assistant/message", "user/message", "tool/call"].includes(row.type)) continue;
    const gap = previous === null || row.at === null ? "" : "  +" + ((row.at - previous) / 1000).toFixed(1) + "s";
    if (row.at !== null) previous = row.at;
    const clock = row.at === null ? "--:--:--" : new Date(row.at).toISOString().slice(11, 19);
    console.log("#" + String(row.index).padStart(4) + " " + clock + gap.padEnd(9) + " " + row.text.slice(0, 200));
  }
  process.exit(0);
}

let selected = rows;
const grep = valueOf("--grep");
if (grep !== null) {
  const hits = rows.filter((row) => row.text.includes(grep)).map((row) => row.index);
  const around = numberOf("--around", 0);
  if (around > 0) {
    const wanted = new Set();
    for (const hit of hits) for (let offset = -around; offset <= around; offset += 1) wanted.add(hit + offset);
    selected = rows.filter((row) => wanted.has(row.index));
  } else {
    selected = rows.filter((row) => row.text.includes(grep));
  }
} else if (!has("--full")) {
  const keep = new Set(["turn/start", "turn/end", "user/message", "assistant/message", "system/message", "tool/call", "tool/result", "session/end-seed"]);
  selected = rows.filter((row) => keep.has(row.type));
}

const head = numberOf("--head", null);
const tail = numberOf("--tail", null);
if (head !== null) selected = selected.slice(0, head);
if (tail !== null) selected = selected.slice(-tail);

for (const row of selected) {
  const clock = row.at === null ? "--:--:--" : new Date(row.at).toISOString().slice(11, 19);
  const body = row.text.length > 900 ? row.text.slice(0, 900) + " …" : row.text;
  console.log("\n#" + String(row.index).padStart(4) + " " + clock + " [" + row.type + "]\n    " + body);
}
console.log("\n(" + selected.length + " shown of " + rows.length + " events)");
