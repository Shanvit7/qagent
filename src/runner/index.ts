/**
 * Playwright test runner — writes temp test files, spawns Playwright,
 * parses JSON results, captures screenshots on failure.
 */

import { writeFileSync, unlinkSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TestCase {
  name: string;
  status: "pass" | "fail" | "skip";
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

const getTempDir = (cwd: string): string => join(cwd, ".qagent", "tmp");
const getScreenshotDir = (cwd: string): string => join(cwd, ".qagent", "screenshots");

// ─── Playwright browser bootstrap ─────────────────────────────────────────────

/**
 * Detect whether Playwright's Chromium browser binary is installed
 * for the **target project's** Playwright version.
 *
 * Resolves the executable path via the target project's Playwright
 * and checks if the file exists on disk.
 */
export const detectPlaywrightBrowsers = async (cwd: string): Promise<boolean> => {
  return new Promise((resolve) => {
    // Use the target project's node_modules to resolve the executable path
    const script = `
      try {
        const pw = require('@playwright/test');
        const fs = require('fs');
        const execPath = pw.chromium.executablePath();
        process.stdout.write(fs.existsSync(execPath) ? 'ok' : 'missing');
      } catch (e) {
        process.stdout.write('missing');
      }
    `;
    const child = spawn("node", ["-e", script], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: string[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c.toString()));
    child.on("exit", () => resolve(out.join("").trim() === "ok"));
    child.on("error", () => resolve(false));
  });
};

/**
 * Ensure the Playwright Chromium browser binary is installed
 * for the **target project's** Playwright version.
 *
 * Uses the target project's local npx so the correct browser revision is fetched.
 *
 * @returns true when install succeeds.
 * @throws if the install command fails (non-zero exit).
 */
export const ensurePlaywrightBrowsers = (cwd: string): Promise<boolean> =>
  new Promise((resolve, reject) => {
    // Run via node script to ensure we use the target project's @playwright/test
    const script = `
      const { execSync } = require('child_process');
      execSync('npx playwright install chromium', { stdio: 'inherit' });
    `;
    const child = spawn("node", ["-e", script], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stderr: string[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk.toString()));

    child.on("exit", (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        reject(
          new Error(
            `playwright install chromium failed (exit ${code}):\n${stderr.join("").slice(0, 800)}`,
          ),
        );
      }
    });

    child.on("error", (err) => reject(err));
  });

// ─── Playwright config generation ─────────────────────────────────────────────

const buildPlaywrightConfig = (serverUrl: string, timeout: number, screenshotDir: string): string => `
import { defineConfig } from "@playwright/test";

export default defineConfig({
  use: {
    baseURL: "${serverUrl}",
    screenshot: "only-on-failure",
    trace: "off",
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
  },
  timeout: ${timeout},
  reporter: [["json", { outputFile: "results.json" }]],
  outputDir: "${screenshotDir}",
});
`;

// ─── Playwright JSON result shape ─────────────────────────────────────────────

interface PlaywrightTestResult {
  title: string;
  status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
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

        const status: TestCase["status"] =
          result.status === "passed" ? "pass" :
          result.status === "skipped" ? "skip" : "fail";

        const screenshotAttachment = result.attachments.find((a) => a.name === "screenshot");

        cases.push({
          name: suiteName ? `${suiteName} › ${spec.title}` : spec.title,
          status,
          durationMs: Math.round(result.duration),
          ...(result.errors[0]?.message ? { failureMessage: result.errors[0].message.split("\n")[0] } : {}),
          ...(screenshotAttachment?.path ? { screenshotPath: screenshotAttachment.path } : {}),
        });
      }
    }

    for (const child of suite.suites ?? []) {
      walk(child, suiteName);
    }
  };

  for (const suite of suites) {
    walk(suite, "");
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

export const wrapWithNetworkGuard = (testCode: string, serverUrl: string): string => {
  let origin = "";
  try { origin = new URL(serverUrl).origin; } catch { origin = ""; }

  const guardPreamble = `import { test as base, expect } from "@playwright/test";

const ORIGIN = "${origin}";
const BLOCKED_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

const test = base.extend({
  page: async ({ page }, use) => {
    await page.route("**", async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const method = req.method();

      // Block off-origin traffic entirely to avoid accidental prod/3p calls
      if (ORIGIN && url.origin !== ORIGIN) return route.abort();

      // Block mutating requests to avoid backend side-effects
      if (BLOCKED_METHODS.includes(method)) return route.abort();

      // Allow same-origin GET/HEAD to continue (for render/probe)
      return route.continue();
    });

    await use(page);
  },
});
`;

  const stripped = testCode
    .replace(/import\s+\{[^}]*\}\s+from\s+["']@playwright\/test["'];?\s*/g, "")
    .trim();

  return [guardPreamble, stripped].filter(Boolean).join("\n\n");
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
  writeFileSync(testFilePath, guardedCode, "utf8");
  writeFileSync(configPath, buildPlaywrightConfig(serverUrl, timeout, ssDir), "utf8");

  return new Promise((resolve) => {
    const start = Date.now();
    const stderr: string[] = [];

    const child = spawn("npx", [
      "playwright", "test",
      testFilePath,
      "--config", configPath,
      "--reporter", "json",
    ], {
      cwd,
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: resultsPath },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk.toString());
    });

    child.stdout.on("data", () => { /* consume stdout to prevent backpressure */ });

    child.on("exit", (code) => {
      const durationMs = Date.now() - start;
      const errorOutput = stderr.join("").slice(0, 5_000);

      // Check for infra errors (Playwright not installed, etc.)
      const isInfraError = errorOutput.includes("Executable doesn't exist") ||
        errorOutput.includes("browserType.launch") ||
        errorOutput.includes("npx playwright install");

      // Parse results
      let testCases: TestCase[] = [];
      if (existsSync(resultsPath)) {
        try {
          const raw = readFileSync(resultsPath, "utf8");
          testCases = parsePlaywrightJson(raw);
        } catch { /* parse failure — infra error */ }
      }

      const passed = code === 0 && testCases.length > 0 && testCases.every((t) => t.status !== "fail");

      // Cleanup temp files (preserve screenshots)
      try { unlinkSync(testFilePath); } catch { /* may not exist */ }
      try { unlinkSync(configPath); } catch { /* may not exist */ }
      try { unlinkSync(resultsPath); } catch { /* may not exist */ }

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
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
    }, timeout + 10_000);
  });
};
