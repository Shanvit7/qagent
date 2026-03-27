/**
 * Project scanner — structural analysis pass over the whole codebase.
 *
 * Finds things that exist at project level (not per-file):
 *   - Router type (App Router vs Pages Router)
 *   - Custom hooks exported anywhere under hooks/ or use* files
 *
 * Output is injected into every Playwright test generation prompt so the
 * AI understands the project shape without us having to describe it.
 *
 * Output cached to .qagent/project.md (gitignored).
 * Refreshed on every qagent run.
 *
 * For per-file dynamic context (what a specific component actually imports
 * and depends on) see src/context/index.ts.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProjectScan {
  nextjsRouter: "app" | "pages" | "none";
  /** Custom hooks exported from the project */
  customHooks: string[];
}

// ─── File walker ──────────────────────────────────────────────────────────────

const CODE_EXTS   = new Set([".ts", ".tsx", ".js", ".jsx"]);
const IGNORE_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", ".qagent"]);

const walkFiles = (dir: string, maxDepth = 4, depth = 0): string[] => {
  if (depth > maxDepth || !existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return IGNORE_DIRS.has(entry.name) ? [] : walkFiles(join(dir, entry.name), maxDepth, depth + 1);
    }
    return CODE_EXTS.has(extname(entry.name)) ? [join(dir, entry.name)] : [];
  });
};

const readSafe = (path: string): string => {
  try { return readFileSync(path, "utf8"); } catch { return ""; }
};

// ─── Structural detectors ─────────────────────────────────────────────────────

const detectRouter = (cwd: string): ProjectScan["nextjsRouter"] => {
  if (existsSync(join(cwd, "app")))   return "app";
  if (existsSync(join(cwd, "pages"))) return "pages";
  return "none";
};

/**
 * Find custom hooks by reading use* exports from hook files.
 */
const detectCustomHooks = (sourceFiles: string[]): string[] => {
  const found = new Set<string>();
  const hookFiles = sourceFiles.filter((f) => /\/hooks?\/|\/use[A-Z]/i.test(f));

  for (const file of hookFiles) {
    const source = readSafe(file);
    for (const [, name] of source.matchAll(/export\s+(?:const|function)\s+(use[A-Z]\w+)/g)) {
      if (name) found.add(name);
    }
  }

  return [...found].slice(0, 15); // cap — too many is noise
};

// ─── Public API ───────────────────────────────────────────────────────────────

export const scanProject = (cwd: string): ProjectScan => {
  const allFiles    = walkFiles(cwd);
  const sourceFiles = allFiles.filter((f) => !/\.test\.|\.spec\.|__tests__/i.test(f));

  return {
    nextjsRouter: detectRouter(cwd),
    customHooks:  detectCustomHooks(sourceFiles),
  };
};

// ─── Markdown serialiser ──────────────────────────────────────────────────────

export const scanToMarkdown = (scan: ProjectScan): string => {
  const lines: string[] = ["## Project structure (auto-scanned)\n"];

  if (scan.nextjsRouter !== "none") {
    lines.push(`- **Router:** Next.js ${scan.nextjsRouter === "app" ? "App Router (`app/`)" : "Pages Router (`pages/`)"}`);
  }

  if (scan.customHooks.length > 0) {
    lines.push(`- **Custom hooks:** \`${scan.customHooks.join("`, `")}\``);
  }



  return lines.join("\n");
};

export const writeScanCache = (cwd: string, scan: ProjectScan): void => {
  const dir = join(cwd, ".qagent");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "project.md"), scanToMarkdown(scan), "utf8");
};


