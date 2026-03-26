import { existsSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const HOOK_MARKER = "# qagent-hook";

const buildHookScript = (runner: string): string => `#!/bin/sh
${HOOK_MARKER}
${runner} qagent run --hook
exit $?
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const findGitDir = (from: string): string | null => {
  const candidate = resolve(from, ".git");
  if (existsSync(candidate)) return candidate;
  const parent = resolve(from, "..");
  if (parent === from) return null;
  return findGitDir(parent);
};

/**
 * Detect Husky by checking for a .husky/ directory or husky in package.json.
 * Returns the husky directory path if detected, null otherwise.
 */
export const detectHuskyDir = (projectRoot: string): string | null => {
  const huskyDir = join(projectRoot, ".husky");
  if (existsSync(huskyDir)) return huskyDir;

  const pkgPath = join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) return null;

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    const hasHusky =
      "husky" in (pkg.devDependencies ?? {}) ||
      "husky" in (pkg.dependencies ?? {});
    return hasHusky ? huskyDir : null;
  } catch {
    return null;
  }
};

const writeHookFile = (hookPath: string, script: string): void => {
  writeFileSync(hookPath, script, "utf8");
  chmodSync(hookPath, 0o755);
};

const appendToHookFile = (hookPath: string, script: string): void => {
  const existing = readFileSync(hookPath, "utf8");
  writeFileSync(hookPath, existing.trimEnd() + "\n\n" + script.trim() + "\n", "utf8");
  chmodSync(hookPath, 0o755);
};

// ─── Public API ───────────────────────────────────────────────────────────────

export interface HookInstallResult {
  hookPath: string;
  target: "husky" | "git";
}

/**
 * Inject qagent into the project's pre-commit hook.
 * Auto-detects Husky — writes to .husky/pre-commit when present,
 * otherwise writes to .git/hooks/pre-commit.
 * Uses the correct runner (bunx / pnpx / npx) based on the project's PM.
 * Idempotent — safe to call multiple times.
 */
export const injectGitHook = (
  cwd: string = process.cwd(),
  runner = "npx"
): HookInstallResult => {
  const gitDir = findGitDir(cwd);
  if (!gitDir) throw new Error("No .git directory found. Is this a git repository?");

  const script = buildHookScript(runner);
  const huskyDir = detectHuskyDir(cwd);

  if (huskyDir !== null) {
    // ── Husky project ────────────────────────────────────────────────────────
    mkdirSync(huskyDir, { recursive: true });
    const hookPath = join(huskyDir, "pre-commit");

    if (existsSync(hookPath)) {
      const existing = readFileSync(hookPath, "utf8");
      if (existing.includes(HOOK_MARKER)) return { hookPath, target: "husky" };
      appendToHookFile(hookPath, script);
    } else {
      writeHookFile(hookPath, script);
    }

    return { hookPath, target: "husky" };
  }

  // ── Raw git hooks ─────────────────────────────────────────────────────────
  const hooksDir = join(gitDir, "hooks");
  const hookPath = join(hooksDir, "pre-commit");

  mkdirSync(hooksDir, { recursive: true });

  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, "utf8");
    if (existing.includes(HOOK_MARKER)) return { hookPath, target: "git" };
    appendToHookFile(hookPath, script);
  } else {
    writeHookFile(hookPath, script);
  }

  return { hookPath, target: "git" };
};

/**
 * Remove qagent from the pre-commit hook (Husky-aware).
 */
export const removeGitHook = (cwd: string = process.cwd()): void => {
  const gitDir = findGitDir(cwd);
  if (!gitDir) return;

  const huskyDir = detectHuskyDir(cwd);
  const hookPath =
    huskyDir !== null
      ? join(huskyDir, "pre-commit")
      : join(gitDir, "hooks", "pre-commit");

  if (!existsSync(hookPath)) return;

  const content = readFileSync(hookPath, "utf8");
  if (!content.includes(HOOK_MARKER)) return;

  const cleaned = content
    .split("\n")
    .filter((line) => !line.includes(HOOK_MARKER) && !/ qagent run --hook/.test(line))
    .join("\n")
    .trimEnd();

  writeFileSync(hookPath, cleaned + "\n", "utf8");
};
