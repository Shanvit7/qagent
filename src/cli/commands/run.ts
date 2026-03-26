/**
 * `qagent run` — on-demand Playwright test generation and execution.
 *
 * Pipeline: staged files → classify → analyze → map routes → start server →
 * generate Playwright tests → run → evaluate → report.
 */

import * as p from "@clack/prompts";
import color from "picocolors";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getStagedFiles } from "../../git/staged.js";
import { classifyStagedFiles, type ClassifiedFile } from "../../classifier/index.js";
import { analyzeFile } from "../../analyzer/index.js";
import { generateTests, refineTests, type GenerateTestsOptions } from "../../generator/index.js";
import { runPlaywrightTest, type StructuredTestResult } from "../../runner/index.js";
import { evaluateTests, buildRefinementPrompt, type RefinementContext } from "../../evaluator/index.js";
import type { EvaluationResult } from "../../evaluator/index.js";
import { loadConfig } from "../../config/loader.js";
import { runPreflight } from "../../preflight/index.js";
import { scanProject, writeScanCache, scanToMarkdown } from "../../scanner/index.js";
import { buildFileContext } from "../../context/index.js";
import { buildRouteMap, findRoutesForFile, type RouteMap } from "../../routes/index.js";
import { startServer, type ServerHandle } from "../../server/index.js";
import {
  renderFileReport,
  writeRunReport,
  type FileReport,
} from "../../reporter/index.js";
import { loadFailureContext, updateFailureContext, type FailureContext } from "../../feedback/index.js";

// -- Constants --

const QAGENT_DIR        = join(process.cwd(), ".qagent");
const LAST_FAILURE_PATH = join(QAGENT_DIR, "last-failure.txt");

const ACTION_BADGE: Record<string, string> = {
  FULL_QA:     color.bgRed(color.white(" FULL QA ")),
  LIGHTWEIGHT: color.bgYellow(color.black(" LIGHTWEIGHT ")),
};

// -- Per-file processor --

interface ProcessResult {
  report: FileReport | null;
  failureText: string | null;
}

const processFile = async (
  { file, classification }: ClassifiedFile,
  config: ReturnType<typeof loadConfig>,
  scanContext: string,
  router: "app" | "pages" | "none",
  cwd: string,
  routeMap: RouteMap,
  serverUrl: string,
  failureCtx: FailureContext,
): Promise<ProcessResult> => {
  const label = color.bold(file.path.split("/").pop() ?? file.path);
  p.log.step(`${ACTION_BADGE[classification.action] ?? ""}  ${label}`);
  p.log.message(color.dim(`→ ${classification.reason}`));

  // -- Analyze --
  let analysis;
  try {
    analysis = analyzeFile(file.path);
  } catch {
    p.log.warn("Could not analyze file — skipping");
    return { report: null, failureText: null };
  }

  // -- Map routes --
  const routeMatches = findRoutesForFile(file.path, routeMap, config.watch.maxRoutes);
  const routes = routeMatches.map((r) => r.route);

  if (routes.length === 0) {
    p.log.warn(color.dim("No routes found for this file — skipping"));
    return { report: null, failureText: null };
  }

  p.log.message(color.dim(`  Routes: ${routes.join(", ")}`));

  // -- Generate tests --
  const s = p.spinner();
  s.start(`Generating Playwright tests via ${config.ai.model}`);

  let testCode: string;
  try {
    const fileContext = buildFileContext(file.path, cwd);
    const genOptions: GenerateTestsOptions = {
      diff: file.diff,
      fileStatus: file.status,
      classificationAction: classification.action,
      classificationReason: classification.reason,
      changedRegions: classification.changedRegions,
    };

    const generated = await generateTests(
      analysis, config, config.playwright.lenses, routes, cwd,
      scanContext, router, fileContext, genOptions,
    );
    testCode = generated.testCode;
    s.stop("Tests generated");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    s.stop(color.yellow(`AI unavailable — skipping (${message})`));
    return { report: null, failureText: null };
  }

  // -- Evaluator loop: run → evaluate → refine --
  const evalConfig = config.evaluator;
  let bestResult: StructuredTestResult | undefined;
  let bestCode = testCode;
  let bestScore = 0;
  let lastCritique: string | undefined;

  const maxIter = evalConfig.enabled ? evalConfig.maxIterations : 1;

  for (let iter = 1; iter <= maxIter; iter++) {
    const runSpinner = p.spinner();
    runSpinner.start(`Running tests (iteration ${iter}/${maxIter})`);

    const result = await runPlaywrightTest(
      testCode, serverUrl, cwd, config.playwright.timeout,
      config.playwright.browser.screenshotDir,
    );

    if (result.isInfraError) {
      runSpinner.stop(color.red("Playwright infrastructure error"));
      p.log.message(color.dim(result.errorOutput.slice(0, 400)));
      p.log.warn(
        `Chromium is not installed. Run ${color.cyan("npx playwright install chromium")} ` +
        `in this project, or re-run ${color.cyan("qagent init")} to set it up interactively.`,
      );
      bestResult = result;
      break;
    }

    const failedTests = result.testCases.filter((t) => t.status === "fail");
    const passedCount = result.testCases.length - failedTests.length;

    if (failedTests.length === 0 && result.testCases.length > 0) {
      runSpinner.stop(color.green(`All ${result.testCases.length} tests pass`));
    } else {
      runSpinner.stop(
        color.yellow(`${passedCount}/${result.testCases.length} pass, ${failedTests.length} failed`),
      );
    }

    // Track best
    const runtimePenalty = Math.min(3, failedTests.length * 0.5);

    if (!evalConfig.enabled) {
      bestResult = result;
      bestCode = testCode;
      break;
    }

    // -- Evaluate --
    const evalSpinner = p.spinner();
    evalSpinner.start(`Evaluating (iteration ${iter}/${maxIter})`);

    let evaluation: EvaluationResult;
    try {
      evaluation = await evaluateTests(testCode, analysis, config.ai, {
        failedTests: failedTests.map((t) => ({
          name: t.name,
          error: t.failureMessage,
          screenshotPath: t.screenshotPath,
        })),
        previousCritique: lastCritique,
        iteration: iter,
      });
    } catch {
      evalSpinner.stop(color.dim("Evaluator unavailable — using current tests"));
      bestResult = result;
      bestCode = testCode;
      break;
    }

    const adjustedScore = Math.max(1, evaluation.overallScore - runtimePenalty);

    if (adjustedScore > bestScore) {
      bestScore = adjustedScore;
      bestCode = testCode;
      bestResult = result;
    }

    if (failedTests.length === 0 && (evaluation.passed || adjustedScore >= evalConfig.acceptThreshold)) {
      evalSpinner.stop(color.green(`Passed (score: ${adjustedScore.toFixed(1)}/10)`));
      break;
    }

    evalSpinner.stop(color.yellow(`Score: ${adjustedScore.toFixed(1)}/10`));

    if (iter === maxIter) {
      testCode = bestCode;
      p.log.message(color.dim(`  Using best iteration (score: ${bestScore.toFixed(1)})`));
      break;
    }

    // -- Refine --
    const refineSpinner = p.spinner();
    refineSpinner.start("Refining tests");
    try {
      const prompt = buildRefinementPrompt({
        testCode,
        sourceCode: analysis.sourceText,
        filePath: analysis.filePath,
        route: routes[0] ?? "/",
        kind: failedTests.length > 0 ? "runtime" : "quality",
        iteration: iter,
        failedTests: failedTests.map((t) => ({ name: t.name, error: t.failureMessage })),
        evaluation,
      });
      testCode = await refineTests(testCode, prompt, config.ai);
      lastCritique = evaluation.critique;
      refineSpinner.stop("Refined");
    } catch {
      refineSpinner.stop(color.dim("Refinement failed — using best"));
      testCode = bestCode;
      break;
    }
  }

  const result = bestResult ?? await runPlaywrightTest(testCode, serverUrl, cwd);
  const action = classification.action as "FULL_QA" | "LIGHTWEIGHT";

  // Save generated test for debugging
  const lastTestPath = join(cwd, ".qagent", "last-test.ts");
  try { mkdirSync(join(cwd, ".qagent"), { recursive: true }); writeFileSync(lastTestPath, testCode, "utf8"); } catch { /* ignore */ }

  // -- Build report --
  let report: FileReport;
  let failureText: string | null = null;

  if (result.testCases.length === 0) {
    report = {
      sourceFile: file.path,
      action,
      status: "error",
      testCases: [],
      totalMs: result.durationMs,
      ...(result.errorOutput ? { errorOutput: result.errorOutput } : {}),
    };
    failureText = buildFailureText(file.path, result.errorOutput, []);
  } else {
    report = {
      sourceFile: file.path,
      action,
      status: result.passed ? "pass" : "fail",
      testCases: result.testCases,
      totalMs: result.durationMs,
    };
    renderFileReport(report);

    if (!result.passed) {
      failureText = buildFailureText(
        file.path,
        result.errorOutput,
        result.testCases.filter((t) => t.status === "fail"),
      );
    }
  }

  return { report, failureText };
};

// -- Failure text builder --

const buildFailureText = (
  filePath: string,
  errorOutput: string,
  failedCases: Array<{ name: string; failureMessage?: string | undefined }>,
): string => {
  const lines: string[] = [`File: ${filePath}`, `Time: ${new Date().toISOString()}`, ""];

  if (failedCases.length > 0) {
    lines.push("Failed tests:");
    for (const tc of failedCases) {
      lines.push(`  ✗ ${tc.name}`);
      if (tc.failureMessage) lines.push(`    ${tc.failureMessage}`);
    }
  }

  if (errorOutput) {
    lines.push("", "Error output:", errorOutput.slice(0, 3_000));
  }

  return lines.join("\n");
};

// -- Main command --

interface RunOptions {
  hook?: boolean | undefined;
}

export const runCommand = async (options: RunOptions = {}): Promise<void> => {
  const isHook = options.hook === true;
  const cwd    = process.cwd();

  p.intro(color.cyan("qagent"));

  // -- Preflight: model, API key, Playwright --
  const preflight = await runPreflight(cwd, { interactive: !isHook });
  if (!preflight.ok) {
    if (isHook) {
      p.log.warn(preflight.reason ?? "Preflight failed — skipping tests.");
      process.exit(0); // Don't block the commit
    }
    p.outro(color.dim("Fix the above, then re-run."));
    process.exit(1);
    return;
  }

  const config     = loadConfig(cwd);
  const failureCtx = loadFailureContext(cwd);

  // -- 0. Project scan --
  const scan = scanProject(cwd);
  writeScanCache(cwd, scan);
  const scanContext = scanToMarkdown(scan);
  const router      = scan.nextjsRouter;

  // -- 1. Staged files --
  const s = p.spinner();
  s.start("Reading staged files");
  let stagedFiles;
  try {
    stagedFiles = await getStagedFiles();
    s.stop(`Found ${stagedFiles.length} staged file(s)`);
  } catch (err) {
    s.stop(color.red("Could not read staged files"));
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(isHook ? 0 : 1);
    return;
  }

  if (stagedFiles.length === 0) {
    p.log.info("Nothing staged — nothing to test.");
    p.outro("");
    process.exit(0);
    return;
  }

  // -- 2. Classify --
  const toTest = classifyStagedFiles(stagedFiles, config.classifier.skipTrivial);
  const skippedCount = stagedFiles.length - toTest.length;

  if (skippedCount > 0) {
    p.log.info(`Skipped ${skippedCount} trivial file(s)`);
  }

  if (toTest.length === 0) {
    p.log.success("No QA-worthy changes — commit allowed.");
    p.outro("");
    process.exit(0);
    return;
  }

  // -- 3. Build route map --
  const routeSpinner = p.spinner();
  routeSpinner.start("Building route map");
  const routeMap = buildRouteMap(cwd);
  routeSpinner.stop(`Route map: ${routeMap.routeIndex.size} routes found`);

  // -- 4. Start dev server --
  const serverSpinner = p.spinner();
  serverSpinner.start("Starting dev server");
  let server: ServerHandle;
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
    process.exit(isHook ? 0 : 1);
    return;
  }

  try {
    // -- 5. Process all files --
    p.log.step(`Processing ${toTest.length} file(s)`);

    const results = await Promise.all(
      toTest.map((cf) =>
        processFile(cf, config, scanContext, router, cwd, routeMap, server.url, failureCtx),
      ),
    );

    // -- 6. Persist last failure --
    const failureTexts = results
      .map((r) => r.failureText)
      .filter((t): t is string => t !== null);

    mkdirSync(QAGENT_DIR, { recursive: true });

    if (failureTexts.length > 0) {
      writeFileSync(LAST_FAILURE_PATH, failureTexts.join("\n\n---\n\n"), "utf8");
    } else {
      try { writeFileSync(LAST_FAILURE_PATH, "", "utf8"); } catch { /* ignore */ }
    }

    // -- 7. Update failure feedback --
    const fileReports = results.map((r) => r.report).filter((r): r is FileReport => r !== null);
    updateFailureContext(cwd, fileReports);

    // -- 8. Write report --
    const reportPath = await writeRunReport(cwd, fileReports);
    const allPassed  = fileReports.every((r) => r.status === "pass");

    p.log.info(`Report → ${reportPath.replace(cwd + "/", "")}`);

    if (allPassed) {
      p.outro(color.green("QA passed."));
    } else {
      p.log.error("QA issues found.");
      p.outro("Run " + color.cyan("`qagent explain`") + " to understand the failures.");
    }
  } finally {
    // Always stop the dev server
    await server.stop();
  }

  process.exit(0);
};
