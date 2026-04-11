import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getStagedFiles } from '@/git/staged';
import { classifyStagedFiles, type ClassifiedFile } from '@/classifier/index';
import { analyzeFile } from '@/analyzer/index';
import { generateTests, refineTests, type GenerateTestsOptions } from '@/generator/index';
import { runPlaywrightTest, type StructuredTestResult } from '@/runner/index';
import { evaluateTests, buildRefinementPrompt, HARD_RULES } from '@/evaluator/index';
import type { EvaluationResult } from '@/evaluator/index';
import { classifyTestCode } from '@/test-classifier/index';
import { loadConfig } from '@/config/loader';
import { runPreflight } from '@/preflight/index';
import { scanProject, writeScanCache, scanToMarkdown } from '@/scanner/index';
import { buildFileContext } from '@/context/index';
import { buildRouteMap, findRoutesForFile, type RouteMap } from '@/routes/index';
import { startServer, type ServerHandle } from '@/server/index';
import { probeRoute } from '@/probe/index';
import {
  renderFileReport,
  writeRunReport,
  type FileReport,
} from '@/reporter/index';
import { loadFailureContext, updateFailureContext, type FailureContext } from '@/feedback/index';
import { getSessionUsage, resetSessionUsage, formatTokenDelta, formatTokenSummary, ProviderError, formatProviderError } from '@/providers/index';
import { sanitizeTestCode } from '@/sanitizer/index';
import { MIN_ITERATIONS, MAX_ITERATIONS } from '@/config/loader';

const QAGENT_DIR = join(process.cwd(), '.qagent');
const LAST_FAILURE_PATH = join(QAGENT_DIR, 'last-failure.txt');

const ACTION_BADGE: Record<string, string> = {
  FULL_QA: '[FULL QA]',
  LIGHTWEIGHT: '[LIGHTWEIGHT]',
};

interface RunScreenProps {
  options: { iterations?: string | undefined };
  onComplete: () => void;
}

export const RunScreen: React.FC<RunScreenProps> = ({ options, onComplete }) => {
  const [status, setStatus] = useState<string>('Initializing...');
  const [details, setDetails] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      const cwd = process.cwd();

      setStatus('Running preflight checks...');
      const preflight = await runPreflight(cwd, { interactive: true });
      if (!preflight.ok) {
        setDetails(preflight.messages || []);
        setError(preflight.reason || 'Preflight failed');
        onComplete();
        return;
      }
      setDetails(preflight.messages || []);

      // ... rest of the code

      const config = loadConfig(cwd);
      const failureCtx = loadFailureContext(cwd);
      resetSessionUsage();

      if (options.iterations !== undefined) {
        const n = parseInt(options.iterations, 10);
        if (!isNaN(n) && n >= MIN_ITERATIONS && n <= MAX_ITERATIONS) {
          config.evaluator.maxIterations = n;
        } else {
          setDetails(prev => [...prev, `Warning: Invalid --iterations value "${options.iterations}" — using default.`]);
        }
      }

      setStatus('Scanning project...');
      const scan = scanProject(cwd);
      writeScanCache(cwd, scan);
      const scanContext = scanToMarkdown(scan);
      const router = scan.nextjsRouter;

      if (router === 'none') {
        setError('qagent requires a Next.js project (app/ or pages/ directory not found).');
        onComplete();
        return;
      }

      setStatus('Reading staged files...');
      let stagedFiles;
      try {
        stagedFiles = await getStagedFiles();
        setDetails(prev => [...prev, `Found ${stagedFiles.length} staged file(s)`]);
      } catch (err) {
        setError(`Could not read staged files: ${err instanceof Error ? err.message : String(err)}`);
        onComplete();
        return;
      }

      if (stagedFiles.length === 0) {
        setStatus('Nothing staged — nothing to test.');
        onComplete();
        return;
      }

      const toTest = classifyStagedFiles(stagedFiles, config.classifier.skipTrivial);
      const skippedCount = stagedFiles.length - toTest.length;

      if (skippedCount > 0) {
        setDetails(prev => [...prev, `Skipped ${skippedCount} trivial file(s)`]);
      }

      if (toTest.length === 0) {
        setStatus('No QA-worthy changes — nothing to test.');
        onComplete();
        return;
      }

      setStatus('Building route map...');
      const routeMap = buildRouteMap(cwd);
      setDetails(prev => [...prev, `Route map: ${routeMap.routeIndex.size} routes`]);

      setStatus('Starting dev server...');
      let server: ServerHandle;
      try {
        server = await startServer(cwd, {
          command: config.playwright.server.command,
          port: config.playwright.server.port,
          readyTimeout: config.playwright.server.readyTimeout,
        });
        setDetails(prev => [...prev, `Dev server ready at ${server.url}`]);
      } catch (err) {
        setError(`Server failed: ${err instanceof Error ? err.message : String(err)}`);
        onComplete();
        return;
      }

      try {
        setStatus(`Processing ${toTest.length} file(s)...`);

        const results = await Promise.all(
          toTest.map((cf) => processFile(cf, config, scanContext, router, cwd, routeMap, server.url, failureCtx, (msg) => setDetails(prev => [...prev, msg]))),
        );

        const failureTexts = results
          .map((r) => r.failureText)
          .filter((t): t is string => t !== null);

        mkdirSync(QAGENT_DIR, { recursive: true });

        if (failureTexts.length > 0) {
          writeFileSync(LAST_FAILURE_PATH, failureTexts.join('\n\n---\n\n'), 'utf8');
        } else {
          try { writeFileSync(LAST_FAILURE_PATH, '', 'utf8'); } catch { /* ignore */ }
        }

        const fileReports = results.map((r) => r.report).filter((r): r is FileReport => r !== null);
        updateFailureContext(cwd, fileReports);

        const usage = getSessionUsage();
        const reportPath = await writeRunReport(cwd, fileReports, usage);

        const hasFailed = fileReports.some((r) => r.status === 'fail');
        const hasErrors = fileReports.some((r) => r.status === 'error');

        const tokenSummary = formatTokenSummary(usage);
        setDetails(prev => [...prev, `Report → ${reportPath.replace(cwd + '/', '')}${tokenSummary ? '\n  ' + tokenSummary : ''}`]);

        if (!hasFailed && !hasErrors) {
          setStatus('QA passed.');
        } else if (hasErrors && !hasFailed) {
          setStatus('Could not run tests for some files — check generated code or Playwright setup.');
          setDetails(prev => [...prev, 'Run `qagent explain` for details.']);
        } else {
          setStatus('QA issues found.');
          setDetails(prev => [...prev, 'Run `qagent explain` to understand the failures.']);
        }
      } catch (err) {
        if (err instanceof ProviderError) {
          setError(formatProviderError(err));
          if (err.kind === 'quota') {
            setDetails(prev => [...prev, 'Add credits to your provider account, then re-run.']);
          }
        } else {
          setError(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
      } finally {
        await server.stop();
      }

      onComplete();
    };

    run();
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan">qagent run</Text>
      <Text>{''}</Text>
      <Text>{status}</Text>
      {details.map((detail, i) => (
        <Text key={i} dimColor>{detail}</Text>
      ))}
      {error && (
        <Text color="red">{error}</Text>
      )}
    </Box>
  );
};

// Helper function for processing files
const processFile = async (
  { file, classification }: ClassifiedFile,
  config: ReturnType<typeof loadConfig>,
  scanContext: string,
  router: 'app' | 'pages' | 'none',
  cwd: string,
  routeMap: RouteMap,
  serverUrl: string,
  failureCtx: FailureContext,
  logDetail: (msg: string) => void,
): Promise<{ report: FileReport | null; failureText: string | null }> => {
  const label = file.path.split('/').pop() ?? file.path;
  logDetail(`${ACTION_BADGE[classification.action] ?? ''} ${label}`);
  logDetail(`→ ${classification.reason}`);

  let analysis;
  try {
    analysis = analyzeFile(file.path);
  } catch {
    logDetail(`${label} — could not analyze file`);
    return { report: null, failureText: null };
  }

  const routeMatches = findRoutesForFile(file.path, routeMap, config.watch.maxRoutes);
  const routes = routeMatches.map((r) => r.route);

  if (routes.length === 0) {
    logDetail(`${label} — no routes found, skipping`);
    return { report: null, failureText: null };
  }

  logDetail(`Routes: ${routes.join(', ')}`);

  const runtimeProbe = await probeRoute(routes[0] ?? '/', serverUrl, cwd);
  if (runtimeProbe.success) {
    const elementCount = runtimeProbe.snapshots.reduce(
      (n, s) => n + s.interactiveElements.length, 0,
    );
    logDetail(`Live snapshot: ${elementCount} interactive elements across ${runtimeProbe.snapshots.length} viewports`);
  } else {
    logDetail(`Probe skipped (${runtimeProbe.error ?? 'unavailable'}) — falling back to source-only`);
  }

  let testCode: string;
  try {
    const fileContext = buildFileContext(file.path, cwd);
    const genOptions: GenerateTestsOptions = {
      diff: file.diff,
      fileStatus: file.status,
      classificationAction: classification.action,
      classificationReason: classification.reason,
      changedRegions: classification.changedRegions,
      runtimeProbe: runtimeProbe.success ? runtimeProbe : undefined,
    };

    const generated = await generateTests(
      analysis, config, routes, cwd,
      scanContext, router, fileContext, genOptions,
    );
    testCode = generated.testCode;
  } catch (err) {
    const message = formatProviderError(err);
    logDetail(`${label} — AI unavailable: ${message}`);
    return { report: null, failureText: null };
  }

  const result = await runPlaywrightTest(testCode, serverUrl, cwd);
  const action = classification.action as 'FULL_QA' | 'LIGHTWEIGHT';

  const lastTestPath = join(cwd, '.qagent', 'last-test.ts');
  try { mkdirSync(join(cwd, '.qagent'), { recursive: true }); writeFileSync(lastTestPath, testCode, 'utf8'); } catch { /* ignore */ }

  let report: FileReport;
  let failureText: string | null = null;

  if (result.testCases.length === 0) {
    report = {
      sourceFile: file.path,
      action,
      status: 'error',
      testCases: [],
      totalMs: result.durationMs,
    };
    failureText = `File: ${file.path}\nError: ${result.errorOutput}`;
  } else {
    report = {
      sourceFile: file.path,
      action,
      status: result.passed ? 'pass' : 'fail',
      testCases: result.testCases,
      totalMs: result.durationMs,
    };
    renderFileReport(report);

    if (!result.passed) {
      failureText = `File: ${file.path}\nFailed tests: ${result.testCases.filter((t) => t.status === 'fail').map((t) => t.name).join(', ')}`;
    }
  }

  return { report, failureText };
};