import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const retiredToken = ["ora", "cle"].join("");
const retiredDisplay = ["Ora", "cle"].join("");
const retiredBarePattern = new RegExp(`\\b${retiredToken}\\b`, "iu");
const retiredJoinedPattern = new RegExp(`\\b${retiredToken}[_.-]?(?:adapter|client|provider|manifest|parser|fixture|config|fallback|endpoint|download|source|url|csv|importer|ingestor|loader|sync|selixir)`, "iu");
const retiredHostPattern = new RegExp(["oe", "data", "lisk", "io"].join("\\."), "iu");
const retiredDownloadPattern = new RegExp(`\\b${["match", "data"].join("")}\\b`, "iu");
const allowedOperatorPhrases = [
  `${retiredDisplay} is not part of the MVP.`,
  `${retiredDisplay} is excluded from the MVP deployment.`,
  `${retiredDisplay} is not an MVP source`,
];

export interface SourceReferenceViolation {
  path: string;
  reason: "retired-host" | "retired-download" | "retired-path" | "retired-content" | "tracked-symlink" | "tracked-non-file";
  line?: number;
}

export type TrackedEntryType = "file" | "symlink" | "other";

export function classifyActiveSourceFile(logicalPath: string, content: string): SourceReferenceViolation[] {
  return classifyTrackedEntry(logicalPath, Buffer.from(content), "file");
}

export function classifyTrackedEntry(logicalPath: string, bytes: Buffer, entryType: TrackedEntryType): SourceReferenceViolation[] {
  const normalizedPath = logicalPath.replaceAll("\\", "/");
  if (entryType === "symlink") return [{ path: normalizedPath, reason: "tracked-symlink" }];
  if (entryType === "other") return [{ path: normalizedPath, reason: "tracked-non-file" }];
  if (isAegisHistory(normalizedPath)) return [];

  const violations: SourceReferenceViolation[] = [];
  if (retiredHostPattern.test(normalizedPath)) violations.push({ path: normalizedPath, reason: "retired-host" });
  if (retiredDownloadPattern.test(normalizedPath)) violations.push({ path: normalizedPath, reason: "retired-download" });
  if (hasRetiredToken(normalizedPath)) violations.push({ path: normalizedPath, reason: "retired-path" });
  if (isBinary(bytes)) return violations;

  const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (retiredHostPattern.test(content)) violations.push({ path: normalizedPath, reason: "retired-host" });
  if (retiredDownloadPattern.test(content)) violations.push({ path: normalizedPath, reason: "retired-download" });
  const operatorDocument = isOperatorDocument(normalizedPath);
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    const containsRetiredToken = hasRetiredToken(line);
    const inspected = operatorDocument ? removeAllowedPolicyPhrases(line) : line;
    if (hasRetiredToken(inspected) || (operatorDocument && containsRetiredToken && !isPolicyOnlyResidue(inspected))) {
      violations.push({ path: normalizedPath, reason: "retired-content", line: index + 1 });
    }
  }
  return violations;
}

export async function collectActiveSourceViolations(root: string): Promise<SourceReferenceViolation[]> {
  const violations: SourceReferenceViolation[] = [];
  for (const logicalPath of await trackedFiles(root)) {
    const absolutePath = resolve(root, logicalPath);
    let stats: Awaited<ReturnType<typeof lstat>>;
    try { stats = await lstat(absolutePath); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
    if (stats.isSymbolicLink()) {
      violations.push(...classifyTrackedEntry(logicalPath, Buffer.alloc(0), "symlink"));
    } else if (!stats.isFile()) {
      violations.push(...classifyTrackedEntry(logicalPath, Buffer.alloc(0), "other"));
    } else {
      violations.push(...classifyTrackedEntry(logicalPath, await readFile(absolutePath), "file"));
    }
  }
  return violations;
}

function hasRetiredToken(value: string): boolean {
  return retiredBarePattern.test(value) || retiredJoinedPattern.test(value);
}

function isAegisHistory(logicalPath: string): boolean {
  return logicalPath === "docs/aegis" || logicalPath.startsWith("docs/aegis/");
}

function isOperatorDocument(logicalPath: string): boolean {
  const lower = logicalPath.toLowerCase();
  return lower === "readme.md" || (lower.startsWith("docs/") && lower.endsWith(".md"));
}

function removeAllowedPolicyPhrases(line: string): string {
  return allowedOperatorPhrases.reduce((remaining, phrase) => remaining.replaceAll(phrase, ""), line.normalize("NFKC"));
}

function isPolicyOnlyResidue(value: string): boolean {
  return /^[\s\p{P}*+>-]*$/u.test(value);
}

function isBinary(bytes: Buffer): boolean {
  if (bytes.includes(0)) return true;
  const sample = bytes.subarray(0, Math.min(bytes.length, 8_192));
  let controls = 0;
  for (const byte of sample) if ((byte < 32 && byte !== 9 && byte !== 10 && byte !== 12 && byte !== 13) || byte === 127) controls += 1;
  if (sample.length > 0 && controls / sample.length > 0.1) return true;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return false;
  } catch {
    return true;
  }
}

async function trackedFiles(root: string): Promise<string[]> {
  const output = await new Promise<Buffer>((resolveOutput, reject) => {
    execFile("git", ["ls-files", "-z", "--"], { cwd: root, encoding: "buffer", maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error !== null) reject(error);
      else resolveOutput(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
    });
  });
  return output.toString("utf8").split("\0").filter(Boolean);
}
