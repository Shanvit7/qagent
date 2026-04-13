import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { QAgentConfig } from './types';
import type { ProviderName } from '@/providers/index';

// ─── Paths ────────────────────────────────────────────────────────────────────

const SKILL_FILE = 'qagent-skill.md';
const RC_FILE = resolve(process.cwd(), '.qagentrc');

// ─── ~/.qagentrc  (provider=<name> + model=<name>) ──────────────────────────

const readRcValue = (key: string): string | undefined => {
  if (!existsSync(RC_FILE)) return undefined;
  try {
    for (const line of readFileSync(RC_FILE, 'utf8').split('\n')) {
      const [k, ...rest] = line.trim().split('=');
      if (k?.trim() === key && rest.length > 0) return rest.join('=').trim();
    }
  } catch {
    /* fall through */
  }
  return undefined;
};

const writeRcValue = (key: string, value: string): void => {
  let content = '';
  if (existsSync(RC_FILE)) {
    const lines = readFileSync(RC_FILE, 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith(`${key}=`));
    content = lines.join('\n').trimEnd();
    if (content) content += '\n';
  }
  writeFileSync(RC_FILE, `${content}${key}=${value}\n`, 'utf8');
};

const VALID_PROVIDERS = new Set<ProviderName>(['ollama', 'openai', 'anthropic']);

export const readProvider = (): ProviderName | undefined => {
  const env = process.env['QAGENT_PROVIDER'];
  if (env && VALID_PROVIDERS.has(env as ProviderName)) return env as ProviderName;
  const rc = readRcValue('provider');
  if (rc && VALID_PROVIDERS.has(rc as ProviderName)) return rc as ProviderName;
  return undefined;
};

export const readModel = (): string | undefined => {
  const env = process.env['QAGENT_MODEL'];
  if (env) return env;
  return readRcValue('model');
};

export const writeProvider = (provider: ProviderName): void => {
  writeRcValue('provider', provider);
};

export const writeModel = (model: string): void => {
  writeRcValue('model', model);
};

export const isConfigured = (): boolean =>
  readProvider() !== undefined && readModel() !== undefined;

// ─── Iterations (stored in ~/.qagentrc) ──────────────────────────────────────

export const MIN_ITERATIONS = 3;
export const MAX_ITERATIONS = 8;
export const DEFAULT_ITERATIONS = 3;

export const readIterations = (): number => {
  const env = process.env['QAGENT_ITERATIONS'];
  if (env) {
    const n = parseInt(env, 10);
    if (!isNaN(n)) return Math.min(MAX_ITERATIONS, Math.max(MIN_ITERATIONS, n));
  }
  const rc = readRcValue('iterations');
  if (rc) {
    const n = parseInt(rc, 10);
    if (!isNaN(n)) return Math.min(MAX_ITERATIONS, Math.max(MIN_ITERATIONS, n));
  }
  return DEFAULT_ITERATIONS;
};

export const writeIterations = (n: number): void => {
  writeRcValue('iterations', String(n));
};

// ─── Public API ───────────────────────────────────────────────────────────────

export const loadConfig = (cwd: string = process.cwd()): QAgentConfig => {
  const provider = readProvider();
  const model = readModel();

  if (!provider || !model) {
    throw new Error('No model configured. Run `qagent models` to select a provider and model.');
  }

  const skillPath = resolve(cwd, SKILL_FILE);

  let skillContext: string | undefined;
  if (existsSync(skillPath)) {
    try {
      const body = readFileSync(skillPath, 'utf8').trim();
      if (body) skillContext = body;
    } catch {
      /* ignore */
    }
  }

  return {
    ai: { provider, model },
    playwright: {
      timeout: 30_000,
      server: {
        autoDetect: true,
        readyTimeout: 30_000,
      },
      browser: {
        headless: true,
        viewport: { width: 1280, height: 720 },
        screenshotDir: '.qagent/screenshots',
      },
    },
    watch: {
      debounceMs: 300,
      maxRoutes: 3,
    },
    classifier: { skipTrivial: true },
    evaluator: {
      enabled: true,
      maxIterations: readIterations(),
      acceptThreshold: 7,
    },
    ...(skillContext ? { skillContext } : {}),
  };
};
