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
import { getStagedFiles } from "@/git/staged";
import { classifyStagedFiles, type ClassifiedFile } from "@/classifier/index";
import { analyzeFile } from "@/analyzer/index";
import { generateTests, refineTests, type GenerateTestsOptions } from "@/generator/index";
import { runPlaywrightTest, type StructuredTestResult } from "@/runner/index";
import { evaluateTests, buildRefinementPrompt, HARD_RULES } from "@/evaluator/index";
import type { EvaluationResult } from "@/evaluator/index";
import { classifyTestCode } from "@/test-classifier/index";
import { loadConfig } from "@/config/loader";
import { runPreflight } from "@/preflight/index";
import { scanProject, writeScanCache, scanToMarkdown } from "@/scanner/index";
import { buildFileContext } from "@/context/index";
import { buildRouteMap, findRoutesForFile, type RouteMap } from "@/routes/index";
import { startServer, type ServerHandle } from "@/server/index";
import {
  renderFileReport,
  writeRunReport,
  type FileReport,
} from "@/reporter/index";
import { loadFailureContext, updateFailureContext, type FailureContext } from "@/feedback/index";
import { getSessionUsage, resetSessionUsage, formatTokenDelta, formatTokenSummary } from "@/providers/index";
import { MIN_ITERATIONS, MAX_ITERATIONS } from "@/config/loader";

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

    const beforeGen = getSessionUsage();
    const generated = await generateTests(
      analysis, config, routes, cwd,
      scanContext, router, fileContext, genOptions,
    );
    testCode = generated.testCode;
    const genTokens = formatTokenDelta(beforeGen, getSessionUsage());
    s.stop(`Tests generated${genTokens ? color.dim(`  ${genTokens}`) : ""}`);
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
    // Pre-validate: if the generated code has no test() blocks, skip the
    // Playwright spawn entirely — a compile error or wrong structure will just
    // waste time and return 0 results anyway. Go straight to refinement.
    const testCallCount = (testCode.match(/\btest\s*\(/g) ?? []).length;
    if (testCallCount === 0) {
      p.log.warn(color.yellow(`  Iteration ${iter}: generated code has no test() blocks — skipping run, going straight to refinement`));

      if (iter === maxIter) {
        p.log.message(color.dim("  Max iterations reached with no runnable tests — skipping file"));
        break;
      }

      const beforeRefineNoTest = getSessionUsage();
      const noTestPrompt = [
        `Your previous output for \`${analysis.filePath}\` contained ZERO test() blocks.`,
        `Playwright found nothing to run.`,
        ``,
        `This usually happens when you:`,
        `- Wrap tests inside a plain function instead of test()`,
        `- Output only comments or type definitions`,
        `- Use describe() without any test() inside`,
        ``,
        `You MUST output a \`\`\`ts code block containing at least 2 actual test() calls.`,
        ``,
        `## Source code`,
        "```tsx",
        analysis.sourceText,
        "```",
        ``,
        `## Route: \`${routes[0] ?? "/"}\``,
        ``,
        HARD_RULES,
      ].join("\n");

      try {
        testCode = await refineTests(testCode, noTestPrompt, config.ai);
        const refineTokens = formatTokenDelta(beforeRefineNoTest, getSessionUsage());
        p.log.message(color.dim(`  Regenerated${refineTokens ? `  ${refineTokens}` : ""}`));
      } catch {
        p.log.message(color.dim("  Regeneration failed — skipping file"));
        break;
      }
      continue;
    }

    // -- Pre-classify: catch structural failures before LLM evaluator --
    const preCheck = classifyTestCode(testCode, classification.changedRegions);
    if (preCheck.issues.length > 0) {
      const issueList = preCheck.issues.join(", ");
      if (!preCheck.passed) {
        // Hard-fail — skip Playwright spawn entirely, go straight to refinement
        p.log.warn(color.yellow(`  Iteration ${iter}: pre-classifier hard-fail [${issueList}] — skipping run`));

        if (iter === maxIter) {
          p.log.message(color.dim("  Max iterations reached — skipping file"));
          break;
        }

        const beforePreRefine = getSessionUsage();
        try {
          testCode = await refineTests(testCode, preCheck.feedback, config.ai);
          const refineTokens = formatTokenDelta(beforePreRefine, getSessionUsage());
          p.log.message(color.dim(`  Refined (pre-check)${refineTokens ? `  ${refineTokens}` : ""}`));
        } catch {
          p.log.message(color.dim("  Refinement failed — skipping file"));
          break;
        }
        continue;
      } else {
        // Warnings — let the run proceed but surface the hints
        p.log.message(color.dim(`  Pre-classifier warnings [${issueList}]`));
      }
    }

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
    const noTestsFound = result.testCases.length === 0;

    if (noTestsFound) {
      runSpinner.stop(color.yellow("No tests discovered — generated code had no runnable test() blocks"));
    } else if (failedTests.length === 0) {
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
    const beforeEval = getSessionUsage();
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

    const evalTokens = formatTokenDelta(beforeEval, getSessionUsage());
    const tokenSuffix = evalTokens ? color.dim(`  ${evalTokens}`) : "";

    const adjustedScore = Math.max(1, evaluation.overallScore - runtimePenalty);

    // Never promote a zero-test result as "best" — even a high evaluator score
    // on code that produced no runnable tests is worse than any real test run.
    if (!noTestsFound && adjustedScore > bestScore) {
      bestScore = adjustedScore;
      bestCode = testCode;
      bestResult = result;
    }

    // 0 test cases means the generated code had no runnable tests — don't
    // accept this as a pass regardless of evaluator score. Force refinement.
    if (!noTestsFound && failedTests.length === 0 && (evaluation.passed || adjustedScore >= evalConfig.acceptThreshold)) {
      evalSpinner.stop(color.green(`Passed (score: ${adjustedScore.toFixed(1)}/10)`) + tokenSuffix);
      break;
    }

    if (noTestsFound) {
      evalSpinner.stop(color.yellow(`Score: ${adjustedScore.toFixed(1)}/10 — no tests ran, refining`) + tokenSuffix);
    } else {
      evalSpinner.stop(color.yellow(`Score: ${adjustedScore.toFixed(1)}/10`) + tokenSuffix);
    }

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
      const beforeRefine = getSessionUsage();
      testCode = await refineTests(testCode, prompt, config.ai);
      lastCritique = evaluation.critique;
      const refineTokens = formatTokenDelta(beforeRefine, getSessionUsage());
      refineSpinner.stop(`Refined${refineTokens ? color.dim(`  ${refineTokens}`) : ""}`);
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
    failureText = buildFailureText(file.path, result.errorOutput, [], file.diff);
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
        file.diff,
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
  diff?: string,
): string => {
  const lines: string[] = [`File: ${filePath}`, `Time: ${new Date().toISOString()}`, ""];

  if (diff?.trim()) {
    lines.push("Code changes (git diff --staged):", "```diff", diff.trim().slice(0, 4_000), "```", "");
  }

  if (failedCases.length > 0) {
    lines.push("Failed tests:");
    for (const tc of failedCases) {
      lines.push(`  ✗ ${tc.name}`);
      if (tc.failureMessage) lines.push(`    ${tc.failureMessage.slice(0, 400)}`);
    }
  }

  if (errorOutput) {
    lines.push("", "Error output:", errorOutput.slice(0, 2_000));
  }

  return lines.join("\n");
};

// -- Main command --

interface RunOptions {
  iterations?: string | undefined;
}

export const runCommand = async (options: RunOptions = {}): Promise<void> => {
  const cwd = process.cwd();

  p.intro(color.cyan("qagent"));

  // -- Preflight: model, API key, Playwright --
  const preflight = await runPreflight(cwd, { interactive: true });
  if (!preflight.ok) {
    p.outro(color.dim("Fix the above, then re-run."));
    process.exit(1);
    return;
  }

  const config     = loadConfig(cwd);
  const failureCtx = loadFailureContext(cwd);
  resetSessionUsage();

  // --iterations flag overrides persisted value for this run only
  if (options.iterations !== undefined) {
    const n = parseInt(options.iterations, 10);
    if (!isNaN(n) && n >= MIN_ITERATIONS && n <= MAX_ITERATIONS) {
      config.evaluator.maxIterations = n;
    } else {
      p.log.warn(`Invalid --iterations value "${options.iterations}" — must be ${MIN_ITERATIONS}–${MAX_ITERATIONS}. Using default.`);
    }
  }

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
    process.exit(1);
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
    p.log.success("No QA-worthy changes — nothing to test.");
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
    process.exit(1);
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
    const usage      = getSessionUsage();
    const reportPath = await writeRunReport(cwd, fileReports, usage);

    const hasFailed = fileReports.some((r) => r.status === "fail");
    const hasErrors = fileReports.some((r) => r.status === "error");

    const tokenSummary = formatTokenSummary(usage);
    p.log.info(`Report → ${reportPath.replace(cwd + "/", "")}${tokenSummary ? "\n" + color.dim(`  ${tokenSummary}`) : ""}`);

    if (!hasFailed && !hasErrors) {
      p.outro(color.green("QA passed."));
    } else if (hasErrors && !hasFailed) {
      // Tests couldn't run (0 test cases, infra error) but none actually failed
      p.log.warn("Could not run tests for some files — check generated code or Playwright setup.");
      p.outro("Run " + color.cyan("`qagent explain`") + " for details.");
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
