/**
 * Dev server manager — auto-detect and manage the project's dev server.
 *
 * Starts once (watch mode) or per-run (run mode). Polls until HTTP ready.
 * Handles crash detection and clean shutdown.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

// ─── Env loader ───────────────────────────────────────────────────────────────

/**
 * Load .env files from the target project directory.
 * Reads .env, .env.local, .env.development, .env.development.local in
 * standard priority order (later files override earlier ones).
 * Returns a flat key-value map. Does NOT set process.env — caller decides.
 */
export const loadProjectEnv = (cwd: string): Record<string, string> => {
  const envFiles = [
    ".env",
    ".env.local",
    ".env.development",
    ".env.development.local",
  ];

  const vars: Record<string, string> = {};

  for (const file of envFiles) {
    const filePath = join(cwd, file);
    if (!existsSync(filePath)) continue;
    try {
      const content = readFileSync(filePath, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx < 1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const raw = trimmed.slice(eqIdx + 1).trim();
        // Strip surrounding quotes
        const val = raw.replace(/^["']|["']$/g, "");
        vars[key] = val;
      }
    } catch {
      // Skip unreadable files
    }
  }

  return vars;
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ServerHandle {
  port: number;
  url: string;
  running: boolean;
  stop: () => Promise<void>;
}

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

// ─── Framework detection ──────────────────────────────────────────────────────

const FRAMEWORK_COMMANDS: Array<{ dep: string; command: string }> = [
  { dep: "next", command: "next dev" },
  { dep: "vite", command: "vite" },
  { dep: "react-scripts", command: "react-scripts start" },
  { dep: "nuxt", command: "nuxt dev" },
  { dep: "@sveltejs/kit", command: "vite dev" },
  { dep: "astro", command: "astro dev" },
];

export const detectDevCommand = (cwd: string): string | null => {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return null;

  let pkg: PackageJson;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as PackageJson;
  } catch {
    return null;
  }

  // Check scripts for a "dev" script first
  if (pkg.scripts?.["dev"]) return "npm run dev";

  // Fall back to framework detection from deps
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const { dep, command } of FRAMEWORK_COMMANDS) {
    if (allDeps[dep]) return `npx ${command}`;
  }

  return null;
};

// ─── Port utilities ───────────────────────────────────────────────────────────

export const getAvailablePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
    srv.on("error", reject);
  });

// ─── Ready polling ────────────────────────────────────────────────────────────

export const waitForReady = async (
  url: string,
  timeout: number,
  interval = 500,
): Promise<boolean> => {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok || res.status === 404) return true; // 404 is fine — server is up
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, interval));
  }

  return false;
};

// ─── Server lifecycle ─────────────────────────────────────────────────────────

export const startServer = async (
  cwd: string,
  options: {
    command?: string | undefined;
    port?: number | undefined;
    readyTimeout?: number | undefined;
  } = {},
): Promise<ServerHandle> => {
  const command = options.command ?? detectDevCommand(cwd);
  if (!command) {
    throw new Error(
      "Could not detect dev server command. Add a 'dev' script to package.json or set server.command in .qagent/config.json."
    );
  }

  const port = options.port ?? await getAvailablePort();
  const readyTimeout = options.readyTimeout ?? 30_000;

  // Load target project's .env files and inject PORT
  const projectEnv = loadProjectEnv(cwd);
  const env = { ...process.env, ...projectEnv, PORT: String(port) };

  const [cmd, ...args] = command.split(" ");
  if (!cmd) throw new Error(`Invalid dev command: ${command}`);

  // For Next.js, add -p flag; for Vite, add --port
  const finalArgs = [...args];
  if (command.includes("next dev") && !args.includes("-p")) {
    finalArgs.push("-p", String(port));
  } else if ((command.includes("vite") || command.includes("astro")) && !args.includes("--port")) {
    finalArgs.push("--port", String(port));
  }

  let child: ChildProcess;
  try {
    child = spawn(cmd, finalArgs, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });
  } catch (err) {
    throw new Error(`Failed to spawn dev server: ${err instanceof Error ? err.message : String(err)}`);
  }

  let running = true;
  const exitPromise = new Promise<void>((resolve) => {
    child.on("exit", () => {
      running = false;
      resolve();
    });
  });

  // Consume output to prevent backpressure
  child.stdout?.resume();
  child.stderr?.resume();

  const url = `http://localhost:${port}`;

  const ready = await waitForReady(url, readyTimeout);
  if (!ready) {
    child.kill("SIGTERM");
    throw new Error(`Dev server did not respond within ${readyTimeout}ms at ${url}`);
  }

  const stop = async (): Promise<void> => {
    if (!running) return;
    child.kill("SIGTERM");
    const timeout = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
    }, 5_000);
    await exitPromise;
    clearTimeout(timeout);
  };

  return {
    port,
    url,
    get running() { return running; },
    stop,
  };
};
