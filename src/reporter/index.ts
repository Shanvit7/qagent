import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import simpleGit from 'simple-git';
import type { TokenUsage } from '@/providers/index';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TestCase {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  durationMs: number;
  failureMessage?: string | undefined;
}

export interface FileReport {
  sourceFile: string;
  action: 'FULL_QA' | 'LIGHTWEIGHT';
  status: 'pass' | 'fail' | 'error';
  testCases: TestCase[];
  totalMs: number;
  /** Raw stderr captured when Playwright fails to run */
  errorOutput?: string | undefined;
}

export interface RunReport {
  timestamp: string;
  branch: string;
  files: FileReport[];
  totalPassed: number;
  totalFailed: number;
  totalMs: number;
  overallPassed: boolean;
  tokenUsage?: TokenUsage | undefined;
}

// ─── Terminal renderer ────────────────────────────────────────────────────────

const STATUS_ICON: Record<TestCase['status'], string> = {
  pass: '✓',
  fail: '✗',
  skip: '○',
};

const ACTION_BADGE: Record<FileReport['action'], string> = {
  FULL_QA: '[FULL QA]',
  LIGHTWEIGHT: '[LIGHTWEIGHT]',
};

export const renderFileReport = (report: FileReport): string => {
  const lines: string[] = [];
  const name = basename(report.sourceFile);
  lines.push('');
  lines.push(`  ${ACTION_BADGE[report.action]}  ${name}`);

  if (report.status === 'error') {
    lines.push('  ✗ Could not run tests');
    if (report.errorOutput) lines.push(report.errorOutput.slice(0, 400));
  } else {
    const tree = report.testCases;
    tree.forEach((tc, i) => {
      const connector = i === tree.length - 1 ? '└─' : '├─';
      const dur = `${tc.durationMs}ms`;
      const icon = STATUS_ICON[tc.status];
      lines.push(`  ${connector} ${icon}  ${tc.name}  ${dur}`);
      if (tc.failureMessage) {
        lines.push(`     ${tc.failureMessage}`);
      }
    });

    const _passed = tree.filter((t) => t.status === 'pass').length;
    const failed = tree.filter((t) => t.status === 'fail').length;
    const total = tree.length;
    const summary = failed > 0 ? `${failed}/${total} failed` : `${total}/${total} passed`;
    lines.push('');
    lines.push(`  ${summary}  ·  ${report.totalMs}ms`);
  }

  const output = lines.join('\n');
  process.stdout.write(output + '\n');
  return output;
};

// ─── Git helpers ──────────────────────────────────────────────────────────────

const getBranch = async (cwd: string): Promise<string> => {
  try {
    const git = simpleGit(cwd);
    const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
    return branch.trim();
  } catch {
    return 'unknown';
  }
};

// ─── Report writers ───────────────────────────────────────────────────────────

const REPORTS_DIR = '.qagent/reports';

const buildMarkdown = (report: RunReport): string => {
  const lines: string[] = [
    `# QAgent Report`,
    ``,
    `**Date:** ${report.timestamp}  `,
    `**Branch:** ${report.branch}  `,
    `**Staged changes QA** — ${report.overallPassed ? '✅ All tests passed' : '❌ Tests failed'}`,
    ``,
    `---`,
    ``,
  ];

  for (const file of report.files) {
    lines.push(`## ${basename(file.sourceFile)}  \`${file.action}\``);
    lines.push(``);

    if (file.status === 'error') {
      lines.push(`> ❌ Could not run tests`);
      if (file.errorOutput) lines.push(`\`\`\`\n${file.errorOutput.slice(0, 600)}\n\`\`\``);
    } else {
      lines.push(`| Test | Result | Duration |`);
      lines.push(`|------|--------|----------|`);
      for (const tc of file.testCases) {
        const icon = tc.status === 'pass' ? '✅' : tc.status === 'skip' ? '⏭️' : '❌';
        lines.push(`| ${tc.name} | ${icon} | ${tc.durationMs}ms |`);
      }
      if (file.testCases.some((t) => t.status === 'fail')) {
        lines.push(``);
        lines.push(`### Failures`);
        for (const tc of file.testCases.filter((t) => t.status === 'fail')) {
          lines.push(`**${tc.name}**`);
          if (tc.failureMessage) lines.push(`\`\`\`\n${tc.failureMessage}\n\`\`\``);
        }
      }
    }
    lines.push(``);
  }

  lines.push(`---`);
  const tokenSuffix = report.tokenUsage
    ? ` · in ${report.tokenUsage.promptTokens.toLocaleString()} · out ${report.tokenUsage.completionTokens.toLocaleString()} tokens`
    : '';
  lines.push(
    `*${report.totalPassed} passed · ${report.totalFailed} failed · ${report.totalMs}ms total${tokenSuffix}*`,
  );

  return lines.join('\n');
};

export const writeRunReport = async (
  cwd: string,
  files: FileReport[],
  tokenUsage?: TokenUsage,
): Promise<string> => {
  const branch = await getBranch(cwd);

  const totalPassed = files.flatMap((f) => f.testCases).filter((t) => t.status === 'pass').length;
  const totalFailed = files.flatMap((f) => f.testCases).filter((t) => t.status === 'fail').length;
  const totalMs = files.reduce((s, f) => s + f.totalMs, 0);

  const report: RunReport = {
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    branch,
    files,
    totalPassed,
    totalFailed,
    totalMs,
    overallPassed: totalFailed === 0 && files.every((f) => f.status !== 'error'),
    ...(tokenUsage ? { tokenUsage } : {}),
  };

  const slug = report.timestamp.replace(/[: ]/g, '-').slice(0, 16);
  const reportsDir = join(cwd, REPORTS_DIR);
  mkdirSync(reportsDir, { recursive: true });

  const mdPath = join(reportsDir, `${slug}.md`);
  const jsonPath = join(reportsDir, `${slug}.json`);

  writeFileSync(mdPath, buildMarkdown(report), 'utf8');
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');

  return mdPath;
};

// ─── Gitignore helper ─────────────────────────────────────────────────────────

export const ensureQAgentIgnored = (cwd: string): void => {
  const gitignorePath = join(cwd, '.gitignore');
  const entry = '.qagent/';

  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, 'utf8');
    if (content.split('\n').some((l) => l.trim() === entry)) return;
    appendFileSync(gitignorePath, `\n# qagent — local QA artifacts\n${entry}\n`);
  } else {
    writeFileSync(gitignorePath, `# qagent — local QA artifacts\n${entry}\n`);
  }
};
