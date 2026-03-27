import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import type { QAgentConfig } from "./types";
import type { ProviderName } from "@/providers/index";

// ─── Paths ────────────────────────────────────────────────────────────────────

const SKILL_FILE    = "qagent-skill.md";
const CONFIG_FILE   = ".qagent/config.json";
const RC_FILE       = `${homedir()}/.qagentrc`;

// ─── Persisted config shape (.qagent/config.json) ────────────────────────────

interface PersistedConfig {
  skipTrivial?: boolean;
  timeout?: number;
  evaluator?: {
    enabled?: boolean;
    maxIterations?: number;
    acceptThreshold?: number;
  };
  watch?: {
    debounceMs?: number;
    maxRoutes?: number;
  };
  server?: {
    command?: string;
    port?: number;
    readyTimeout?: number;
  };
  browser?: {
    headless?: boolean;
  };
}

// ─── ~/.qagentrc  (provider=<name> + model=<name>) ──────────────────────────

const readRcValue = (key: string): string | undefined => {
  if (!existsSync(RC_FILE)) return undefined;
  try {
    for (const line of readFileSync(RC_FILE, "utf8").split("\n")) {
      const [k, ...rest] = line.trim().split("=");
      if (k?.trim() === key && rest.length > 0) return rest.join("=").trim();
    }
  } catch { /* fall through */ }
  return undefined;
};

const writeRcValue = (key: string, value: string): void => {
  let content = "";
  if (existsSync(RC_FILE)) {
    const lines = readFileSync(RC_FILE, "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith(`${key}=`));
    content = lines.join("\n").trimEnd();
    if (content) content += "\n";
  }
  writeFileSync(RC_FILE, `${content}${key}=${value}\n`, "utf8");
};

const VALID_PROVIDERS = new Set<ProviderName>(["ollama", "openai", "anthropic"]);

export const readProvider = (): ProviderName | undefined => {
  const env = process.env["QAGENT_PROVIDER"];
  if (env && VALID_PROVIDERS.has(env as ProviderName)) return env as ProviderName;
  const rc = readRcValue("provider");
  if (rc && VALID_PROVIDERS.has(rc as ProviderName)) return rc as ProviderName;
  return undefined;
};

export const readModel = (): string | undefined => {
  const env = process.env["QAGENT_MODEL"];
  if (env) return env;
  return readRcValue("model");
};

export const writeProvider = (provider: ProviderName): void => {
  writeRcValue("provider", provider);
};

export const writeModel = (model: string): void => {
  writeRcValue("model", model);
};

export const isConfigured = (): boolean =>
  readProvider() !== undefined && readModel() !== undefined;

// ─── Iterations (stored in ~/.qagentrc) ──────────────────────────────────────

export const MIN_ITERATIONS = 3;
export const MAX_ITERATIONS = 8;
export const DEFAULT_ITERATIONS = 3;

export const readIterations = (): number => {
  const env = process.env["QAGENT_ITERATIONS"];
  if (env) {
    const n = parseInt(env, 10);
    if (!isNaN(n)) return Math.min(MAX_ITERATIONS, Math.max(MIN_ITERATIONS, n));
  }
  const rc = readRcValue("iterations");
  if (rc) {
    const n = parseInt(rc, 10);
    if (!isNaN(n)) return Math.min(MAX_ITERATIONS, Math.max(MIN_ITERATIONS, n));
  }
  return DEFAULT_ITERATIONS;
};

export const writeIterations = (n: number): void => {
  writeRcValue("iterations", String(n));
};

// ─── .qagent/config.json ─────────────────────────────────────────────────────

const readPersistedConfig = (cwd: string): PersistedConfig => {
  const configPath = resolve(cwd, CONFIG_FILE);
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as PersistedConfig;
  } catch {
    return {};
  }
};

export const writePersistedConfig = (cwd: string, config: PersistedConfig): void => {
  const configPath = resolve(cwd, CONFIG_FILE);
  mkdirSync(join(cwd, ".qagent"), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
};

// ─── Defaults ─────────────────────────────────────────────────────────────────

// ─── Public API ───────────────────────────────────────────────────────────────

export const loadConfig = (cwd: string = process.cwd()): QAgentConfig => {
  const provider = readProvider();
  const model    = readModel();

  if (!provider || !model) {
    throw new Error(
      "No model configured. Run `qagent models` to select a provider and model."
    );
  }

  const persisted = readPersistedConfig(cwd);
  const skillPath = resolve(cwd, SKILL_FILE);

  let skillContext: string | undefined;
  if (existsSync(skillPath)) {
    try {
      const body = readFileSync(skillPath, "utf8").trim();
      if (body) skillContext = body;
    } catch { /* ignore */ }
  }

  return {
    ai: { provider, model },
    playwright: {
      timeout: persisted.timeout ?? 15_000,
      server: {
        autoDetect: true,
        command: persisted.server?.command,
        port: persisted.server?.port,
        readyTimeout: persisted.server?.readyTimeout ?? 30_000,
      },
      browser: {
        headless: persisted.browser?.headless ?? true,
        viewport: { width: 1280, height: 720 },
        screenshotDir: ".qagent/screenshots",
      },
    },
    watch: {
      debounceMs: persisted.watch?.debounceMs ?? 300,
      maxRoutes: persisted.watch?.maxRoutes ?? 3,
    },
    classifier: { skipTrivial: persisted.skipTrivial ?? true },
    evaluator: {
      enabled: persisted.evaluator?.enabled ?? true,
      maxIterations: readIterations(),
      acceptThreshold: persisted.evaluator?.acceptThreshold ?? 7,
    },
    ...(skillContext ? { skillContext } : {}),
  };
};
