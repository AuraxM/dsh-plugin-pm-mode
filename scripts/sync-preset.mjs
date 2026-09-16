/**
 * Keep the `pm` agent preset's SNAPSHOT (this repo) in step with its LIVE copy
 * (`$DSH_HOME/.agent-presets/pm/`), which is the one the roster actually reads.
 *
 * Why a tool instead of "just remember to copy": the live copy is the one that
 * has to be edited, so the repo silently rots unless something checks. A stale
 * snapshot is worse than none — it reads as the source of truth while the
 * running session uses something else.
 *
 * Usage (from anywhere):
 *   node scripts/sync-preset.mjs            check; non-zero exit when behind, prints diff
 *   node scripts/sync-preset.mjs --write    refresh the snapshot from the live copy
 *   node scripts/sync-preset.mjs --diff     always print the full diff
 *
 * `PM_PRESET_DIR` overrides the live directory (useful for a disabled preset
 * such as `.agent-presets/pm.disabled`, or for a test fixture).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.join(HERE, "..", "preset");
const LIVE_DIR =
  process.env.PM_PRESET_DIR ?? path.join(os.homedir(), ".dsh", ".agent-presets", "pm");

const FILES = ["preset.yml", "agent.cordis.yml"];
const write = process.argv.includes("--write");
const alwaysDiff = process.argv.includes("--diff");

console.log("snapshot : " + SNAPSHOT_DIR);
console.log("live     : " + LIVE_DIR);

if (!fs.existsSync(LIVE_DIR)) {
  console.error("\nthe live preset directory does not exist: " + LIVE_DIR);
  console.error("(if the preset is retired it may be renamed `pm.disabled` — point PM_PRESET_DIR at it)");
  process.exit(2);
}

/** Unified-ish diff: enough to see WHAT drifted without pulling in a library. */
function lineDiff(label, liveText, snapshotText) {
  const live = liveText.split("\n");
  const snap = snapshotText.split("\n");
  const lines = [];
  const max = Math.max(live.length, snap.length);
  for (let index = 0; index < max; index += 1) {
    if (live[index] === snap[index]) continue;
    lines.push(
      "  " + label + " line " + (index + 1) + "\n" +
        "    live    : " + JSON.stringify(live[index] ?? "<missing>") + "\n" +
        "    snapshot: " + JSON.stringify(snap[index] ?? "<missing>"),
    );
  }
  return lines;
}

let behind = 0;
let missing = 0;
const reports = [];

for (const name of FILES) {
  const livePath = path.join(LIVE_DIR, name);
  const snapshotPath = path.join(SNAPSHOT_DIR, name);
  if (!fs.existsSync(livePath)) {
    console.error("\nlive file is missing: " + livePath);
    missing += 1;
    continue;
  }
  const liveText = fs.readFileSync(livePath, "utf8");
  const snapshotText = fs.existsSync(snapshotPath) ? fs.readFileSync(snapshotPath, "utf8") : "";
  const same = liveText === snapshotText;
  if (!same) behind += 1;
  reports.push({ name, livePath, snapshotPath, liveText, snapshotText, same });
}

if (missing > 0) {
  console.error("\n" + missing + " live file(s) missing; nothing to sync");
  process.exit(2);
}

if (write) {
  let changed = 0;
  for (const report of reports) {
    if (report.same) continue;
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(report.snapshotPath, report.liveText, "utf8");
    console.log("refreshed snapshot: " + path.relative(process.cwd(), report.snapshotPath));
    changed += 1;
  }
  console.log(changed === 0 ? "\nalready in sync" : "\n" + changed + " file(s) refreshed — commit them");
  process.exit(0);
}

if (behind === 0) {
  console.log("\nin sync (" + FILES.length + " files)");
  process.exit(0);
}

console.log("\nSNAPSHOT IS BEHIND on " + behind + " file(s):");
for (const report of reports) {
  if (report.same) continue;
  console.log("\n" + report.name + ":");
  for (const line of lineDiff(report.name, report.liveText, report.snapshotText)) console.log(line);
}
if (!alwaysDiff) {
  console.log("\n(run with --write to refresh the snapshot, then commit)");
}
process.exit(1);
