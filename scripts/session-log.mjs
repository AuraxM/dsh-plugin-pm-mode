/**
 * Decode this deployment's `session.vN.jsonl.zstd`.
 *
 * The file is a CONCATENATION of zstd frames, not one frame per line and not a
 * single frame: frame #1 holds the session header, and every later frame holds
 * messages/events. `zlib.zstdDecompressSync` stops after the first frame, so a
 * naive read reports "1 line, 0 events" and a whole conversation looks empty.
 *
 * Frames are located by the zstd magic `28 B5 2F FD` and decompressed one at a
 * time; the decoded text is then line-split, because a frame may carry several
 * JSONL records.
 *
 * @module dsh-pm-mode/scripts/session-log
 */
import fs from "node:fs";
import zlib from "node:zlib";

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/**
 * Offset of every zstd frame in a buffer, ascending.
 * A magic-prefixed byte pair inside a compressed frame could in principle look
 * like a frame start, so each candidate is VERIFIED by successfully decoding
 * from it; a candidate that fails is treated as payload and skipped.
 */
function frameOffsets(buffer) {
  const offsets = [];
  let at = buffer.indexOf(MAGIC, 0);
  while (at !== -1) {
    offsets.push(at);
    const next = buffer.indexOf(MAGIC, at + 4);
    if (next === -1) {
      try {
        zlib.zstdDecompressSync(buffer.subarray(at));
        break;
      } catch {
        offsets.pop();
        at = buffer.indexOf(MAGIC, at + 1);
        continue;
      }
    }
    try {
      zlib.zstdDecompressSync(buffer.subarray(at, next));
      at = next;
    } catch {
      // Not a real frame boundary: keep scanning inside the current frame.
      offsets.pop();
      at = buffer.indexOf(MAGIC, at + 1);
    }
  }
  return offsets;
}

/**
 * @param {string} file path to `session.vN.jsonl.zstd`
 * @returns {{ header: object | null, events: object[], frames: number, bytes: number }}
 */
export function readSessionLog(file) {
  const buffer = fs.readFileSync(file);
  const offsets = frameOffsets(buffer);
  const chunks = [];
  for (let index = 0; index < offsets.length; index += 1) {
    const start = offsets[index];
    const end = index + 1 < offsets.length ? offsets[index + 1] : buffer.length;
    try {
      chunks.push(zlib.zstdDecompressSync(buffer.subarray(start, end)).toString("utf8"));
    } catch {
      /* verified once during scanning; tolerate a racing read */
    }
  }
  const text = chunks.join("");
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const parsed = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      parsed.push({ type: "<unparsable>", raw: line.slice(0, 200) });
    }
  }
  const header = parsed.length > 0 && parsed[0].type === "session" ? parsed.shift() : null;
  return { header, events: parsed, frames: offsets.length, bytes: buffer.length };
}
