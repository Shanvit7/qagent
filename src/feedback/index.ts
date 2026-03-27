/**
 * Failure feedback loop — persists test failure context across runs.
 *
 * When a file's tests fail, the failed test names are saved to
 * .qagent/failure-context.json. On the next run, if the same file is staged
 * again, those failure hints are injected into the AI prompt so it
 * specifically retests the previously-broken scenarios.
 *
 * Files that pass on a subsequent run are automatically removed from the
 * failure context — no manual cleanup needed.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FileReport } from "@/reporter/index";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FailureEntry {
  testNames: string[];
  timestamp: string;
}

export type FailureContext = Record<string, FailureEntry>;

// ─── Paths ────────────────────────────────────────────────────────────────────

const FAILURE_CONTEXT_FILE = "failure-context.json";

const getFailureContextPath = (cwd: string): string =>
  join(cwd, ".qagent", FAILURE_CONTEXT_FILE);

// ─── Public API ───────────────────────────────────────────────────────────────

export const loadFailureContext = (cwd: string): FailureContext => {
  const filePath = getFailureContextPath(cwd);
  if (!existsSync(filePath)) return {};

  try {
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as FailureContext;
  } catch {
    return {};
  }
};

/**
 * Merge run results into the persisted failure context.
 * - Failed files: store their failed test names (overwrites previous entry)
 * - Passed files: remove from context (regression fixed)
 * - Files not in this run: left untouched
 */
export const updateFailureContext = (
  cwd: string,
  fileReports: FileReport[],
): void => {
  const ctx = loadFailureContext(cwd);
  const now = new Date().toISOString();

  for (const report of fileReports) {
    const failedTests = report.testCases
      .filter((tc) => tc.status === "fail")
      .map((tc) => tc.name);

    if (failedTests.length > 0) {
      ctx[report.sourceFile] = { testNames: failedTests, timestamp: now };
    } else {
      delete ctx[report.sourceFile];
    }
  }

  const dir = join(cwd, ".qagent");
  mkdirSync(dir, { recursive: true });
  writeFileSync(getFailureContextPath(cwd), JSON.stringify(ctx, null, 2), "utf8");
};

/**
 * Build a prompt-ready string of previous failure hints for a specific file.
 * Returns an empty string if no prior failures exist.
 */
export const getFileFailureHints = (
  ctx: FailureContext,
  filePath: string,
): string => {
  const entry = ctx[filePath];
  if (!entry || entry.testNames.length === 0) return "";

  return entry.testNames.map((name) => `- ${name}`).join("\n");
};
