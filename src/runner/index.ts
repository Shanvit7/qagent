/**
 * Playwright test runner — writes temp test files, spawns Playwright,
 * parses JSON results, captures screenshots on failure.
 */

import { writeFileSync, unlinkSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { loadProjectEnv } from '@/server/index';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TestCase {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  durationMs: number;
  failureMessage?: string | undefined;
  screenshotPath?: string | undefined;
}

export interface StructuredTestResult {
  passed: boolean;
  testCases: TestCase[];
  errorOutput: string;
  durationMs: number;
  testFilePath: string;
  isInfraError: boolean;
}

// ─── Paths ────────────────────────────────────────────────────────────────────

const getTempDir = (cwd: string): string => join(cwd, '.qagent', 'tmp');
const getScreenshotDir = (cwd: string): string => join(cwd, '.qagent', 'screenshots');

// ─── Playwright browser bootstrap ─────────────────────────────────────────────

/**
 * Detect whether Playwright's Chromium browser binary is installed
 * for the **target project's** Playwright version.
 *
 * Checks if @playwright/test is installed and Chromium executable is available.
 */
export const detectPlaywrightBrowsers = async (cwd: string): Promise<boolean> => {
  return new Promise((resolve) => {
    const script = `
      try {
        const { chromium } = require('@playwright/test');
        chromium.executablePath();
        process.stdout.write('ok');
      } catch {
        process.stdout.write('missing');
      }
    `;
    const child = spawn('node', ['-e', script], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out: string[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c.toString()));
    child.on('exit', () => resolve(out.join('').trim() === 'ok'));
    child.on('error', () => resolve(false));
  });
};

/**
 * Ensure the Playwright Chromium browser binary is installed
 * for the **target project's** Playwright version.
 *
 * Spawns `npx playwright install chromium` directly in the target project's cwd
 * so the correct browser revision is fetched using the project's local Playwright.
 *
 * @returns true when install succeeds.
 * @throws if the install command fails (non-zero exit).
 */
export const ensurePlaywrightBrowsers = (cwd: string): Promise<boolean> =>
  new Promise((resolve, reject) => {
    // Spawn npx directly — no need to wrap in a node -e script
    const child = spawn('npx', ['playwright', 'install', 'chromium'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stderr: string[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk.toString()));

    child.on('exit', (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        reject(
          new Error(
            `playwright install chromium failed (exit ${code}):\n${stderr.join('').slice(0, 800)}`,
          ),
        );
      }
    });

    child.on('error', (err) => reject(err));
  });

// ─── Playwright config generation ─────────────────────────────────────────────

const buildPlaywrightConfig = (
  serverUrl: string,
  timeout: number,
  screenshotDir: string,
): string => `
import { defineConfig } from "@playwright/test";

export default defineConfig({
  use: {
    baseURL: "${serverUrl}",
    screenshot: "only-on-failure",
    trace: "off",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  timeout: ${timeout},
  reporter: [["json", { outputFile: "results.json" }]],
  outputDir: "${screenshotDir}",
});
`;

// ─── Playwright JSON result shape ─────────────────────────────────────────────

interface PlaywrightTestResult {
  title: string;
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
  duration: number;
  errors: Array<{ message?: string }>;
  attachments: Array<{ name: string; path?: string }>;
}

interface PlaywrightSuite {
  title: string;
  specs: Array<{
    title: string;
    tests: Array<{
      results: PlaywrightTestResult[];
    }>;
  }>;
  suites?: PlaywrightSuite[];
}

interface PlaywrightJsonReport {
  suites: PlaywrightSuite[];
}

// ─── Result parser ────────────────────────────────────────────────────────────

const flattenSuites = (suites: PlaywrightSuite[]): TestCase[] => {
  const cases: TestCase[] = [];

  const walk = (suite: PlaywrightSuite, prefix: string): void => {
    const suiteName = prefix ? `${prefix} › ${suite.title}` : suite.title;

    for (const spec of suite.specs) {
      for (const test of spec.tests) {
        const result = test.results[0];
        if (!result) continue;

        const status: TestCase['status'] =
          result.status === 'passed' ? 'pass' : result.status === 'skipped' ? 'skip' : 'fail';

        const screenshotAttachment = result.attachments.find((a) => a.name === 'screenshot');

        cases.push({
          name: suiteName ? `${suiteName} › ${spec.title}` : spec.title,
          status,
          durationMs: Math.round(result.duration),
          ...(result.errors[0]?.message
            ? { failureMessage: result.errors[0].message.split('\n')[0] }
            : {}),
          ...(screenshotAttachment?.path ? { screenshotPath: screenshotAttachment.path } : {}),
        });
      }
    }

    for (const child of suite.suites ?? []) {
      walk(child, suiteName);
    }
  };

  for (const suite of suites) {
    walk(suite, '');
  }

  return cases;
};

export const parsePlaywrightJson = (raw: string): TestCase[] => {
  try {
    const report = JSON.parse(raw) as PlaywrightJsonReport;
    return flattenSuites(report.suites);
  } catch {
    return [];
  }
};

// ─── Runner ───────────────────────────────────────────────────────────────────

/**
 * Wrap generated test code with an origin-scoped network guard.
 *
 * Allows ALL HTTP methods to the dev server (fullstack testing).
 * Only blocks off-origin requests to prevent accidental calls to
 * production APIs, analytics, third-party services, etc.
 */
export const wrapWithNetworkGuard = (testCode: string, serverUrl: string): string => {
  let origin = '';
  try {
    origin = new URL(serverUrl).origin;
  } catch {
    origin = '';
  }

  const guardPreamble = `import { test as base, expect } from "@playwright/test";

const ORIGIN = "${origin}";

const test = base.extend({
  page: async ({ page }, use) => {
    await page.route("**", async (route) => {
      const req = route.request();
      const url = new URL(req.url());

      // Block off-origin traffic to avoid accidental prod/3p calls
      if (ORIGIN && url.origin !== ORIGIN) return route.abort();

      // Allow all same-origin traffic — fullstack testing
      return route.continue();
    });

    await use(page);
  },
});
`;

  const stripped = testCode
    .replace(/import\s+\{[^}]*\}\s+from\s+["']@playwright\/test["'];?\s*/g, '')
    .trim();

  return [guardPreamble, stripped].filter(Boolean).join('\n\n');
};

export const runPlaywrightTest = (
  testCode: string,
  serverUrl: string,
  cwd: string,
  timeout = 15_000,
  screenshotDir?: string | undefined,
): Promise<StructuredTestResult> => {
  const tmpDir = getTempDir(cwd);
  const ssDir = screenshotDir ?? getScreenshotDir(cwd);
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(ssDir, { recursive: true });

  const hash = Date.now().toString(36);
  const testFilePath = join(tmpDir, `${hash}.spec.ts`);
  const configPath = join(tmpDir, `${hash}.config.ts`);
  const resultsPath = join(tmpDir, `results.json`);

  const guardedCode = wrapWithNetworkGuard(testCode, serverUrl);
  writeFileSync(testFilePath, guardedCode, 'utf8');
  writeFileSync(configPath, buildPlaywrightConfig(serverUrl, timeout, ssDir), 'utf8');

  return new Promise((resolve) => {
    const start = Date.now();
    const stderr: string[] = [];

    const child = spawn(
      'npx',
      ['playwright', 'test', testFilePath, '--config', configPath, '--reporter', 'json'],
      {
        cwd,
        env: { ...process.env, ...loadProjectEnv(cwd), PLAYWRIGHT_JSON_OUTPUT_NAME: resultsPath },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk.toString());
    });

    child.stdout.on('data', () => {
      /* consume stdout to prevent backpressure */
    });

    child.on('exit', (code) => {
      const durationMs = Date.now() - start;
      const errorOutput = stderr.join('').slice(0, 5_000);

      // Check for infra errors (Playwright not installed, etc.)
      const isInfraError =
        errorOutput.includes("Executable doesn't exist") ||
        errorOutput.includes('browserType.launch') ||
        errorOutput.includes('npx playwright install');

      // Parse results
      let testCases: TestCase[] = [];
      if (existsSync(resultsPath)) {
        try {
          const raw = readFileSync(resultsPath, 'utf8');
          testCases = parsePlaywrightJson(raw);
        } catch {
          /* parse failure — infra error */
        }
      }

      const passed =
        code === 0 && testCases.length > 0 && testCases.every((t) => t.status !== 'fail');

      // Cleanup temp files (preserve screenshots)
      try {
        unlinkSync(testFilePath);
      } catch {
        /* may not exist */
      }
      try {
        unlinkSync(configPath);
      } catch {
        /* may not exist */
      }
      try {
        unlinkSync(resultsPath);
      } catch {
        /* may not exist */
      }

      resolve({
        passed,
        testCases,
        errorOutput,
        durationMs,
        testFilePath,
        isInfraError,
      });
    });

    // Safety timeout — kill if Playwright hangs
    setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already dead */
      }
    }, timeout + 10_000);
  });
};
