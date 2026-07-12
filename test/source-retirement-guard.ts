import { readdir, readFile } from "node:fs/promises";
import { basename, extname, relative, resolve } from "node:path";

const retiredToken = ["ora", "cle"].join("");
const retiredTokenPattern = new RegExp(retiredToken, "iu");
const retiredHostPattern = new RegExp(["oe", "data", "lisk", "io"].join("\\."), "iu");
const retiredDownloadPattern = new RegExp(["match", "data"].join(""), "iu");

const generatedOrVendorDirectories = new Set([".git", ".worktrees", "node_modules", "dist", "coverage"]);
const textExtensions = new Set([
  ".bash", ".cjs", ".css", ".cts", ".dockerfile", ".env", ".fish", ".html", ".js", ".json", ".jsonc", ".jsx",
  ".md", ".mjs", ".mts", ".sh", ".sql", ".toml", ".ts", ".tsx", ".yaml", ".yml", ".zsh",
]);
const extensionlessTextFiles = new Set(["containerfile", "dockerfile", "makefile"]);

export interface SourceReferenceViolation {
  path: string;
  reason: "retired-host" | "retired-download" | "retired-path" | "retired-content";
  line?: number;
}

export function classifyActiveSourceFile(logicalPath: string, content: string): SourceReferenceViolation[] {
  const normalizedPath = logicalPath.replaceAll("\\", "/");
  if (isExcluded(normalizedPath) || !isScannable(normalizedPath)) return [];

  const violations: SourceReferenceViolation[] = [];
  if (retiredHostPattern.test(normalizedPath) || retiredHostPattern.test(content)) violations.push({ path: normalizedPath, reason: "retired-host" });
  if (retiredDownloadPattern.test(normalizedPath) || retiredDownloadPattern.test(content)) violations.push({ path: normalizedPath, reason: "retired-download" });
  if (retiredTokenPattern.test(normalizedPath)) violations.push({ path: normalizedPath, reason: "retired-path" });

  const operatorDocument = isOperatorDocument(normalizedPath);
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    if (!retiredTokenPattern.test(line)) continue;
    if (operatorDocument && isAllowedPolicyLine(line)) continue;
    violations.push({ path: normalizedPath, reason: "retired-content", line: index + 1 });
  }
  return violations;
}

export async function collectActiveSourceViolations(root: string): Promise<SourceReferenceViolation[]> {
  const violations: SourceReferenceViolation[] = [];
  for (const file of await activeFiles(root)) {
    const logicalPath = relative(root, file).replaceAll("\\", "/");
    violations.push(...classifyActiveSourceFile(logicalPath, await readFile(file, "utf8")));
  }
  return violations;
}

function isExcluded(logicalPath: string): boolean {
  const segments = logicalPath.split("/");
  if (segments.some((segment) => generatedOrVendorDirectories.has(segment))) return true;
  return logicalPath === "docs/aegis" || logicalPath.startsWith("docs/aegis/");
}

function isScannable(logicalPath: string): boolean {
  const name = basename(logicalPath).toLowerCase();
  if (name.startsWith(".env") || name.startsWith("dockerfile.") || name.startsWith("containerfile.")) return true;
  if (extensionlessTextFiles.has(name) || name.endsWith(".dockerfile")) return true;
  return textExtensions.has(extname(name));
}

function isOperatorDocument(logicalPath: string): boolean {
  const lower = logicalPath.toLowerCase();
  return lower === "readme.md" || (lower.startsWith("docs/") && lower.endsWith(".md"));
}

function isAllowedPolicyLine(line: string): boolean {
  const normalized = line.normalize("NFKC");
  const token = `\\b${retiredToken}\\b`;
  const flags = "iu";
  return (
    new RegExp(`${token}.*\\b(?:is|remains)\\s+not\\b.*\\bmvp\\b`, flags).test(normalized)
    || new RegExp(`${token}.*\\b(?:was|is|has been)\\s+retired\\b`, flags).test(normalized)
    || new RegExp(`${token}.*\\bexcluded\\b.*\\b(?:mvp|deployment)\\b`, flags).test(normalized)
    || new RegExp(`(?:\\breintroduc\\w*\\b.*${token}|${token}.*\\breintroduc\\w*\\b).*\\brequires?\\b.*\\bnew\\b.*\\breviewed\\b.*\\bdecision\\b.*\\bpublic(?:ly)?\\b.*\\bdirect\\b.*\\bevidence\\b`, flags).test(normalized)
  );
}

async function activeFiles(root: string, directory = root): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    const logicalPath = relative(root, absolute).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      if (!isExcluded(logicalPath)) output.push(...await activeFiles(root, absolute));
      continue;
    }
    if (isScannable(logicalPath)) output.push(absolute);
  }
  return output;
}
