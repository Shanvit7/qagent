import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { join, basename } from "node:path";
import color from "picocolors";
import simpleGit from "simple-git";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TestCase {
  name: string;
  status: "pass" | "fail" | "skip";
  durationMs: number;
  failureMessage?: string | undefined;
}

export interface FileReport {
  sourceFile: string;
  action: "FULL_QA" | "LIGHTWEIGHT";
  status: "pass" | "fail" | "error";
  testCases: TestCase[];
  totalMs: number;
  /** Raw stderr captured when Playwright fails to run */
  errorOutput?: string | undefined;
}

export interface RunReport {
  timestamp: string;
  branch: string;
  commitHash: string;
  files: FileReport[];
  totalPassed: number;
  totalFailed: number;
  totalMs: number;
  overallPassed: boolean;
}

// ─── Playwright JSON shape ─────────────────────────────────────────────────────
// (Parsing also available via runner's parsePlaywrightJson for internal use)

// ─── Parser ───────────────────────────────────────────────────────────────────

export const parseVitestJson = (raw: string): TestCase[] => {
  // Legacy — kept for backward compatibility but no longer primary path.
  // Playwright results are parsed by runner/index.ts parsePlaywrightJson().
  try {
    const json = JSON.parse(raw) as { testResults?: Array<{ assertionResults?: Array<{ title: string; status: string; duration: number | null; failureMessages: string[]; ancestorTitles: string[] }>; status?: string; message?: string }> };
    return (json.testResults ?? []).flatMap((suite) => {
      if ((suite.assertionResults?.length ?? 0) > 0) {
        return (suite.assertionResults ?? []).map((a): TestCase => ({
          name: a.ancestorTitles.length > 0 ? `${a.ancestorTitles.join(" › ")} › ${a.title}` : a.title,
          status: a.status === "passed" ? "pass" : a.status === "pending" || a.status === "skipped" ? "skip" : "fail",
          durationMs: Math.round(a.duration ?? 0),
          ...(a.failureMessages[0] != null ? { failureMessage: a.failureMessages[0].split("\n")[0] } : {}),
        }));
      }
      if (suite.status === "failed" && suite.message) {
        return [{ name: "(suite failed to load)", status: "fail" as const, durationMs: 0, ...(suite.message ? { failureMessage: suite.message.split("\n")[0] } : {}) }];
      }
      return [];
    });
  } catch {
    return [];
  }
};

// ─── Terminal renderer ────────────────────────────────────────────────────────

const STATUS_ICON: Record<TestCase["status"], string> = {
  pass: color.green("✓"),
  fail: color.red("✗"),
  skip: color.dim("○"),
};

const ACTION_BADGE: Record<FileReport["action"], string> = {
  FULL_QA: color.bgRed(color.white(" FULL QA ")),
  LIGHTWEIGHT: color.bgYellow(color.black(" LIGHTWEIGHT ")),
};

export const renderFileReport = (report: FileReport): void => {
  const name = color.bold(basename(report.sourceFile));
  console.log(`\n  ${ACTION_BADGE[report.action]}  ${name}`);

  if (report.status === "error") {
    console.log(color.red("  ✗ Could not run tests"));
    if (report.errorOutput) console.log(color.dim(report.errorOutput.slice(0, 400)));
    return;
  }

  const tree = report.testCases;
  tree.forEach((tc, i) => {
    const connector = i === tree.length - 1 ? "└─" : "├─";
    const dur = color.dim(`${tc.durationMs}ms`);
    const icon = STATUS_ICON[tc.status];
    console.log(`  ${color.dim(connector)} ${icon}  ${tc.name}  ${dur}`);
    if (tc.failureMessage) {
      console.log(`  ${color.dim("   ")} ${color.red(tc.failureMessage)}`);
    }
  });

  const passed = tree.filter((t) => t.status === "pass").length;
  const failed = tree.filter((t) => t.status === "fail").length;
  const total = tree.length;
  const summary = failed > 0
    ? color.red(`${failed}/${total} failed`)
    : color.green(`${total}/${total} passed`);
  console.log(color.dim(`\n  ${summary}  ·  ${report.totalMs}ms`));
};

// ─── Git helpers ──────────────────────────────────────────────────────────────

const getGitInfo = async (cwd: string): Promise<{ branch: string; commitHash: string }> => {
  try {
    const git = simpleGit(cwd);
    const [branch, log] = await Promise.all([
      git.revparse(["--abbrev-ref", "HEAD"]),
      git.log(["--oneline", "-1"]),
    ]);
    return {
      branch: branch.trim(),
      commitHash: log.latest?.hash?.slice(0, 7) ?? "unknown",
    };
  } catch {
    return { branch: "unknown", commitHash: "unknown" };
  }
};

// ─── Report writers ───────────────────────────────────────────────────────────

const REPORTS_DIR = ".qagent/reports";

const buildMarkdown = (report: RunReport): string => {
  const lines: string[] = [
    `# QAgent Report`,
    ``,
    `**Date:** ${report.timestamp}  `,
    `**Branch:** ${report.branch}  `,
    `**Commit:** ${report.commitHash}  `,
    `**Result:** ${report.overallPassed ? "✅ All tests passed" : "❌ Tests failed"}`,
    ``,
    `---`,
    ``,
  ];

  for (const file of report.files) {
    lines.push(`## ${basename(file.sourceFile)}  \`${file.action}\``);
    lines.push(``);

    if (file.status === "error") {
      lines.push(`> ❌ Could not run tests`);
      if (file.errorOutput) lines.push(`\`\`\`\n${file.errorOutput.slice(0, 600)}\n\`\`\``);
    } else {
      lines.push(`| Test | Result | Duration |`);
      lines.push(`|------|--------|----------|`);
      for (const tc of file.testCases) {
        const icon = tc.status === "pass" ? "✅" : tc.status === "skip" ? "⏭️" : "❌";
        lines.push(`| ${tc.name} | ${icon} | ${tc.durationMs}ms |`);
      }
      if (file.testCases.some((t) => t.status === "fail")) {
        lines.push(``);
        lines.push(`### Failures`);
        for (const tc of file.testCases.filter((t) => t.status === "fail")) {
          lines.push(`**${tc.name}**`);
          if (tc.failureMessage) lines.push(`\`\`\`\n${tc.failureMessage}\n\`\`\``);
        }
      }
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`*${report.totalPassed} passed · ${report.totalFailed} failed · ${report.totalMs}ms total*`);

  return lines.join("\n");
};

export const writeRunReport = async (
  cwd: string,
  files: FileReport[]
): Promise<string> => {
  const { branch, commitHash } = await getGitInfo(cwd);

  const totalPassed = files.flatMap((f) => f.testCases).filter((t) => t.status === "pass").length;
  const totalFailed = files.flatMap((f) => f.testCases).filter((t) => t.status === "fail").length;
  const totalMs = files.reduce((s, f) => s + f.totalMs, 0);

  const report: RunReport = {
    timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
    branch,
    commitHash,
    files,
    totalPassed,
    totalFailed,
    totalMs,
    overallPassed: totalFailed === 0 && files.every((f) => f.status !== "error"),
  };

  const slug = report.timestamp.replace(/[: ]/g, "-").slice(0, 16);
  const reportsDir = join(cwd, REPORTS_DIR);
  mkdirSync(reportsDir, { recursive: true });

  const mdPath = join(reportsDir, `${slug}_${commitHash}.md`);
  const jsonPath = join(reportsDir, `${slug}_${commitHash}.json`);

  writeFileSync(mdPath, buildMarkdown(report), "utf8");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

  return mdPath;
};

// ─── Gitignore helper ─────────────────────────────────────────────────────────

export const ensureQAgentIgnored = (cwd: string): void => {
  const gitignorePath = join(cwd, ".gitignore");
  const entry = ".qagent/";

  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf8");
    if (content.split("\n").some((l) => l.trim() === entry)) return;
    appendFileSync(gitignorePath, `\n# qagent — local QA artifacts\n${entry}\n`);
  } else {
    writeFileSync(gitignorePath, `# qagent — local QA artifacts\n${entry}\n`);
  }
};
