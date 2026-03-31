/**
 * `qagent watch` — background CI that tests your app in a real browser.
 *
 * Watches .git/index for stage changes, then:
 *   classify → analyze → map routes → generate Playwright tests → run → evaluate
 *
 * Dev server and browser stay warm across runs for speed.
 */

import * as p from "@clack/prompts";
import color from "picocolors";
import { watch, existsSync } from "node:fs";
import { join } from "node:path";
import { getStagedFiles } from "@/git/staged";
import { classifyStagedFiles } from "@/classifier/index";
import { analyzeFile } from "@/analyzer/index";
import { generateTests, type GenerateTestsOptions } from "@/generator/index";
import { runPlaywrightTest } from "@/runner/index";
import { evaluateTests, buildRefinementPrompt } from "@/evaluator/index";
import { refineTests } from "@/generator/index";
import { loadConfig } from "@/config/loader";
import { scanProject, writeScanCache, scanToMarkdown } from "@/scanner/index";
import { buildFileContext } from "@/context/index";
import { buildRouteMap, findRoutesForFile, updateRouteMap, type RouteMap } from "@/routes/index";
import { probeRoute } from "@/probe/index";
import { startServer, type ServerHandle } from "@/server/index";


// ─── State ────────────────────────────────────────────────────────────────────

let routeMap: RouteMap;
let server: ServerHandle;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;

// ─── Single test cycle ────────────────────────────────────────────────────────

const runCycle = async (cwd: string): Promise<void> => {
  if (running) return; // Skip if a cycle is already in progress
  running = true;

  try {
    const config = loadConfig(cwd);
    const scan = scanProject(cwd);
    const scanContext = scanToMarkdown(scan);
    const router = scan.nextjsRouter;

    // Get staged files
    const stagedFiles = await getStagedFiles();
    if (stagedFiles.length === 0) {
      running = false;
      return;
    }

    const toTest = classifyStagedFiles(stagedFiles, config.classifier.skipTrivial);
    if (toTest.length === 0) {
      p.log.message(color.dim(`[${time()}] No QA-worthy changes`));
      running = false;
      return;
    }

    p.log.step(`[${time()}] Testing ${toTest.length} file(s)...`);

    for (const { file, classification } of toTest) {
      const label = file.path.split("/").pop() ?? file.path;

      // Analyze
      let analysis;
      try {
        analysis = analyzeFile(file.path);
      } catch {
        p.log.warn(`${label} — could not analyze file`);
        continue;
      }

      // Map routes
      const routeMatches = findRoutesForFile(file.path, routeMap, config.watch.maxRoutes);
      const routes = routeMatches.map((r) => r.route);

      if (routes.length === 0) {
        p.log.warn(`${label} — no routes found, skipping`);
        continue;
      }

      // Update route map incrementally for this changed file
      updateRouteMap(routeMap, file.path, cwd);

      // Probe: navigate to route in real browser, capture live ground truth
      const runtimeProbe = await probeRoute(routes[0] ?? "/", server.url, cwd);

      // Generate
      const fileContext = buildFileContext(file.path, cwd);
      const genOptions: GenerateTestsOptions = {
        diff: file.diff,
        fileStatus: file.status,
        classificationAction: classification.action,
        classificationReason: classification.reason,
        changedRegions: classification.changedRegions,
        runtimeProbe: runtimeProbe.success ? runtimeProbe : undefined,
      };

      let testCode: string;
      try {
        const generated = await generateTests(
          analysis, config, routes, cwd,
          scanContext, router, fileContext, genOptions,
        );
        testCode = generated.testCode;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        p.log.warn(`${label} — AI unavailable: ${msg}`);
        continue;
      }

      // Run
      const result = await runPlaywrightTest(
        testCode, server.url, cwd,
        config.playwright.timeout,
        config.playwright.browser.screenshotDir,
      );

      // Auto-install Playwright browsers if missing, then retry once
      if (result.isInfraError) {
        p.log.error(`${label} — Playwright browsers not installed`);
        p.log.message(color.dim(`  → Fix: npx playwright install chromium`));
        p.log.message(color.dim(`  → Or:  qagent init`));
        continue;
      }

      // Quick evaluation + optional refinement (1 iteration max in watch mode)
      if (config.evaluator.enabled && !result.passed && result.testCases.length > 0) {
        const failedTests = result.testCases.filter((t) => t.status === "fail");

        try {
          const evaluation = await evaluateTests(testCode, analysis, config.ai, {
            changedRegions: classification.changedRegions,
            failedTests: failedTests.map((t) => ({
              name: t.name,
              error: t.failureMessage,
              screenshotPath: t.screenshotPath,
            })),
            iteration: 1,
          });

          // One refinement attempt
          const prompt = buildRefinementPrompt({
            testCode,
            sourceCode: analysis.sourceText,
            filePath: analysis.filePath,
            route: routes[0] ?? "/",
            kind: "runtime",
            iteration: 1,
            failedTests: failedTests.map((t) => ({ name: t.name, error: t.failureMessage })),
            evaluation,
          });

          const refined = await refineTests(testCode, prompt, config.ai);
          const retryResult = await runPlaywrightTest(
            refined, server.url, cwd,
            config.playwright.timeout,
            config.playwright.browser.screenshotDir,
          );

          // Print retry result
          printResult(label, routes, retryResult, "(retry)");
          continue;
        } catch {
          // Evaluator/refinement failed — print original result
        }
      }

      printResult(label, routes, result);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    p.log.error(`Watch cycle error: ${msg}`);
  } finally {
    running = false;
  }
};

const printResult = (
  label: string,
  routes: string[],
  result: { passed: boolean; testCases: Array<{ name: string; status: string; failureMessage?: string | undefined }> },
  suffix = "",
): void => {
  const passed = result.testCases.filter((t) => t.status === "pass").length;
  const failed = result.testCases.filter((t) => t.status === "fail").length;
  const total = result.testCases.length;
  const routeStr = color.dim(`[${routes.join(", ")}]`);
  const tag = suffix ? color.dim(` ${suffix}`) : "";

  if (result.passed) {
    p.log.success(`${label} ${routeStr} — ${color.green(`${total}/${total} pass`)}${tag}`);
  } else {
    p.log.error(`${label} ${routeStr} — ${color.red(`${failed}/${total} fail`)}${tag}`);
    for (const tc of result.testCases.filter((t) => t.status === "fail").slice(0, 3)) {
      p.log.message(color.dim(`  ✗ ${tc.name}: ${tc.failureMessage?.split("\n")[0]?.slice(0, 100) ?? "unknown"}`));
    }
  }
};

const time = (): string => new Date().toLocaleTimeString("en-US", { hour12: false });

// ─── Cleanup ──────────────────────────────────────────────────────────────────

const cleanup = async (): Promise<void> => {
  p.log.message(color.dim("Shutting down..."));
  if (debounceTimer) clearTimeout(debounceTimer);
  try { await server?.stop(); } catch { /* already stopped */ }
  process.exit(0);
};

// ─── Main command ─────────────────────────────────────────────────────────────

export const watchCommand = async (): Promise<void> => {
  const cwd = process.cwd();

  p.intro(color.cyan("qagent watch"));

  // -- Preflight: model, API key, Playwright --
  const { runPreflight } = await import("../../preflight/index.js");
  const preflight = await runPreflight(cwd, { interactive: true });
  if (!preflight.ok) {
    p.outro(color.dim("Fix the above, then re-run."));
    process.exit(1);
    return;
  }

  const config = loadConfig(cwd);

  // -- Build route map --
  const routeSpinner = p.spinner();
  routeSpinner.start("Building route map");
  routeMap = buildRouteMap(cwd);
  routeSpinner.stop(`Route map: ${routeMap.routeIndex.size} routes`);

  // -- Start dev server --
  const serverSpinner = p.spinner();
  serverSpinner.start("Starting dev server");
  try {
    server = await startServer(cwd, {
      command: config.playwright.server.command,
      port: config.playwright.server.port,
      readyTimeout: config.playwright.server.readyTimeout,
    });
    serverSpinner.stop(`Dev server ready at ${server.url}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    serverSpinner.stop(color.red(`Server failed: ${msg}`));
    process.exit(1);
    return;
  }

  // -- Watch .git/index --
  const gitIndexPath = join(cwd, ".git", "index");
  if (!existsSync(gitIndexPath)) {
    p.log.error("Not a git repository (no .git/index found)");
    await server.stop();
    process.exit(1);
    return;
  }

  // Graceful shutdown
  process.on("SIGINT", () => void cleanup());
  process.on("SIGTERM", () => void cleanup());

  const debounceMs = config.watch.debounceMs;

  watch(gitIndexPath, () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void runCycle(cwd), debounceMs);
  });

  // Write scan cache once on start
  const scan = scanProject(cwd);
  writeScanCache(cwd, scan);

  p.log.success("Watching for staged changes... (Ctrl+C to stop)");
  p.log.message(color.dim(`Debounce: ${debounceMs}ms | Max routes: ${config.watch.maxRoutes}`));
};
