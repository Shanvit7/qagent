import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

export interface PmMeta {
  name: PackageManager;
  lockfile: string;
  /** Args to install a package as a dev dependency */
  addDevArgs: (pkg: string) => string[];
  /** The npx-equivalent runner for this PM (e.g. bunx, pnpx, npx) */
  runner: string;
}

const PM_CANDIDATES: PmMeta[] = [
  { name: "bun",  lockfile: "bun.lockb",        runner: "bunx", addDevArgs: (p) => ["add", "-d", p] },
  { name: "bun",  lockfile: "bun.lock",          runner: "bunx", addDevArgs: (p) => ["add", "-d", p] },
  { name: "pnpm", lockfile: "pnpm-lock.yaml",    runner: "pnpx", addDevArgs: (p) => ["add", "-D", p] },
  { name: "yarn", lockfile: "yarn.lock",         runner: "npx",  addDevArgs: (p) => ["add", "-D", p] },
  { name: "npm",  lockfile: "package-lock.json", runner: "npx",  addDevArgs: (p) => ["install", "--save-dev", p] },
];

const NPM_FALLBACK: PmMeta = {
  name: "npm",
  lockfile: "package-lock.json",
  runner: "npx",
  addDevArgs: (p) => ["install", "--save-dev", p],
};

/**
 * Detect the package manager by lockfile presence.
 * Falls back to npm when nothing is found.
 */
export const detectPackageManager = (cwd: string = process.cwd()): PmMeta => {
  for (const candidate of PM_CANDIDATES) {
    if (existsSync(join(cwd, candidate.lockfile))) return candidate;
  }
  return NPM_FALLBACK;
};

/**
 * Run a package manager command and stream output to the terminal.
 * Resolves with exit code.
 */
export const runPm = (pm: PackageManager, args: string[], cwd: string): Promise<number> =>
  new Promise((resolve) => {
    const child = spawn(pm, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
