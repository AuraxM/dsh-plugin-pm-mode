/**
 * Survey one workspace's session store: read each session header (the first
 * line of `session.vN.jsonl.zstd`) and report preset, lineage, and event count.
 *
 * Usage: node survey-sessions.mjs "<session-dir>" [limit]
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const base = process.argv[2];
const limit = Number(process.argv[3] ?? 20);
if (base === undefined) {
  console.error("usage: node survey-sessions.mjs <session-dir> [limit]");
  process.exit(2);
}

function firstLine(file) {
  const raw = fs.readFileSync(file);
  const text = zlib.zstdDecompressSync(raw).toString("utf8");
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  let header = null;
  try {
    header = JSON.parse(lines[0]);
  } catch {
    /* keep null */
  }
  return { header, lines: lines.length, bytes: raw.length, text };
}

const rows = [];
for (const id of fs.readdirSync(base)) {
  const dir = path.join(base, id);
  if (!fs.statSync(dir).isDirectory()) continue;
  const candidates = fs.readdirSync(dir).filter((name) => name.startsWith("session.v") && name.endsWith(".jsonl.zstd"));
  if (candidates.length === 0) continue;
  const file = path.join(dir, candidates[0]);
  try {
    const info = firstLine(file);
    const header = info.header ?? {};
    rows.push({
      id,
      file,
      lines: info.lines,
      bytes: info.bytes,
      extraFiles: fs.readdirSync(dir).filter((name) => name !== candidates[0]),
      mtime: fs.statSync(file).mtime,
      preset: header.agentPreset ?? null,
      depth: header.delegationDepth ?? null,
      parent: header.parentSession ?? null,
      origin: header.origin ?? null,
      createdAt: header.createdAt ?? null,
      cwd: header.cwd ?? null,
    });
  } catch (error) {
    rows.push({ id, file, error: String(error.message), mtime: fs.statSync(file).mtime });
  }
}

rows.sort((a, b) => b.mtime - a.mtime);
const fmt = (ms) => (ms === null || ms === undefined ? "-" : new Date(ms).toISOString().replace("T", " ").slice(5, 19));
console.log(
  ["mtime", "lines", "KB", "preset", "depth", "origin", "created", "id", "parent", "extra"].join(" | "),
);
for (const row of rows.slice(0, limit)) {
  console.log(
    [
      fmt(row.mtime),
      row.lines ?? "?",
      row.bytes === undefined ? "?" : Math.round(row.bytes / 1024),
      row.preset ?? "-",
      row.depth ?? "-",
      row.origin ?? "-",
      fmt(row.createdAt),
      row.id,
      row.parent === null || row.parent === undefined ? "-" : String(row.parent).slice(0, 8),
      (row.extraFiles ?? []).join(",") || "-",
    ].join(" | "),
  );
}
console.log("\n(" + rows.length + " sessions, newest first)");
