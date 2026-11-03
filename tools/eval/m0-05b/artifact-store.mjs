import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { manifestPath, repoRoot } from "./paths.mjs";

let cached;

export function loadManifest() {
  if (!cached) cached = JSON.parse(fs.readFileSync(manifestPath(), "utf8"));
  return cached;
}

export function findSample(artifactId) {
  const sample = loadManifest().samples.find((row) => row.artifactId === artifactId);
  if (!sample) throw new Error(`unknown artifact ${artifactId}`);
  if (!sample.locator || !sample.contentHash) throw new Error(`artifact ${artifactId} has no frozen body`);
  return sample;
}

function bodyText(sample) {
  const file = path.join(repoRoot(), sample.locator);
  const text = fs.readFileSync(file, "utf8");
  const hash = crypto.createHash("sha256").update(text, "utf8").digest("hex");
  if (hash !== sample.contentHash) {
    throw new Error(`artifact ${sample.artifactId} hash drifted`);
  }
  return text;
}

export function readRange(artifactId, start, end) {
  const sample = findSample(artifactId);
  const text = bodyText(sample);
  const from = Math.max(0, Number(start) || 0);
  const to = Math.min(text.length, Number(end));
  if (!(to > from)) throw new Error(`empty range ${artifactId} ${from}:${to}`);
  const slice = text.slice(from, to);
  const again = text.slice(from, to);
  if (slice !== again) throw new Error(`range reread mismatch ${artifactId}`);
  return {
    artifactId,
    frozenVersion: sample.frozenVersion,
    start: from,
    end: to,
    unit: "chars",
    length: slice.length,
    text: slice,
  };
}
