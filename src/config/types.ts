import type { ProviderName } from "@/providers/index";

export type QaLens = "render" | "interaction" | "state" | "edge-cases" | "security";

export interface AiConfig {
  provider: ProviderName;
  model: string;
}

export interface ServerConfig {
  /** Auto-detect dev server command from package.json. Default: true */
  autoDetect: boolean;
  /** Override dev command (e.g. "next dev", "vite"). Used when autoDetect is false. */
  command?: string | undefined;
  /** Fixed port. If unset, uses a random available port. */
  port?: number | undefined;
  /** Max time (ms) to wait for dev server to respond. Default: 30000 */
  readyTimeout: number;
}

export interface BrowserConfig {
  /** Run Chromium in headless mode. Default: true */
  headless: boolean;
  /** Default viewport size for tests. */
  viewport: { width: number; height: number };
  /** Directory for failure screenshots. Default: ".qagent/screenshots" */
  screenshotDir: string;
}

export interface WatchConfig {
  /** Debounce interval (ms) after git stage detection. Default: 300 */
  debounceMs: number;
  /** Max routes to test per changed component. Default: 3 */
  maxRoutes: number;
}

export interface PlaywrightConfig {
  lenses: QaLens[];
  /** Per-test timeout (ms). Default: 15000 */
  timeout: number;
  server: ServerConfig;
  browser: BrowserConfig;
}

export interface EvaluatorConfig {
  /** Enable the evaluator feedback loop. Default: true */
  enabled: boolean;
  /** Max refinement iterations. Default: 3 */
  maxIterations: number;
  /** Minimum score (1-10) to accept. Default: 7 */
  acceptThreshold: number;
}

export interface ClassifierConfig {
  skipTrivial: boolean;
}

export interface QAgentConfig {
  ai: AiConfig;
  playwright: PlaywrightConfig;
  watch: WatchConfig;
  classifier: ClassifierConfig;
  evaluator: EvaluatorConfig;
  /**
   * Freeform markdown body of qagent-skill.md.
   * Injected into every test generation prompt as project context.
   */
  skillContext?: string | undefined;
}
