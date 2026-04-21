/**
 * Security agent — mini agentic loop for the security lens.
 *
 * When the security lens is active, this agent runs BEFORE the main generation
 * call. It has two tools (grep, read_file) and explores the file's security
 * surface dynamically — auth flow, input validation, data exposure paths.
 *
 * Hard limits: 6 tool calls max, 45s timeout.
 * Falls back gracefully when:
 *   - Model doesn't support tool calling
 *   - Provider is HuggingFace (no reliable tool calling on free tier)
 *   - Timeout exceeded
 *
 * Output: a security context string injected into the main generation prompt,
 * replacing the static SecurityFinding[] from the analyzer.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { execSync } from 'node:child_process';
import type { AiConfig } from '@/config/types';
import type { FileAnalysis } from '@/analyzer/index';
import { chat } from '@/providers/index';
import type { ChatMessage, ToolDef } from '@/providers/index';

export interface SecurityAgentResult {
  context: string;
  toolCallCount: number;
  timedOut: boolean;
  usedAgent: boolean;
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'grep',
      description:
        'Search for a pattern across project files. Use to find auth checks, validation, data flows.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex or literal string to search for' },
          glob: {
            type: 'string',
            description:
              "File glob to restrict search, e.g. 'src/**/*.ts'. Defaults to all TS/TSX files.",
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description:
        'Read the contents of a file. Use to inspect auth middleware, validation schemas, or DB clients.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root' },
        },
        required: ['path'],
      },
    },
  },
];

// ─── Tool execution ───────────────────────────────────────────────────────────

const MAX_OUTPUT = 3_000; // cap tool output to avoid prompt bloat

/** Detect which top-level source dirs actually exist in this project. */
const detectSourceDirs = (cwd: string): string => {
  const candidates = ['src', 'app', 'pages', 'lib', 'components', 'utils', 'server', 'actions'];
  const found = candidates.filter((d) => existsSync(resolve(cwd, d)));
  // If nothing found, scan top-level dirs (capped to avoid huge projects)
  if (found.length === 0) {
    try {
      return (
        readdirSync(cwd, { withFileTypes: true })
          .filter(
            (e) =>
              e.isDirectory() &&
              !['node_modules', '.git', '.next', 'dist', 'build', '.qagent'].includes(e.name),
          )
          .slice(0, 6)
          .map((e) => e.name)
          .join(' ') || '.'
      );
    } catch {
      return '.';
    }
  }
  return found.join(' ');
};

const execGrep = (pattern: string, glob: string, cwd: string): string => {
  const searchTarget = glob || detectSourceDirs(cwd);
  try {
    const result = execSync(
      `grep -rn --include="*.ts" --include="*.tsx" -E "${pattern.replace(/"/g, '\\"')}" ${searchTarget}`,
      { cwd, timeout: 5_000, encoding: 'utf8' },
    );
    const lines = result.trim().split('\n').slice(0, 40);
    return lines.join('\n').slice(0, MAX_OUTPUT) || '(no matches)';
  } catch {
    return '(no matches)';
  }
};

const execReadFile = (filePath: string, cwd: string): string => {
  const abs = resolve(cwd, filePath);
  if (!existsSync(abs)) return `(file not found: ${filePath})`;
  try {
    const content = readFileSync(abs, 'utf8');
    return content.slice(0, MAX_OUTPUT);
  } catch {
    return `(could not read: ${filePath})`;
  }
};

const executeTool = (name: string, args: Record<string, string>, cwd: string): string => {
  if (name === 'grep') {
    return execGrep(args['pattern'] ?? '', args['glob'] ?? '', cwd);
  }
  if (name === 'read_file') {
    return execReadFile(args['path'] ?? '', cwd);
  }
  return '(unknown tool)';
};

// ─── System prompt ────────────────────────────────────────────────────────────

const buildSystemPrompt = (analysis: FileAnalysis, cwd: string): string => {
  const relPath = relative(cwd, analysis.filePath);
  return `You are a security-focused code reviewer for a Next.js / React codebase.

Your job: analyse the security surface of ONE specific file and produce a concise security report.

File under review: ${relPath}
Component type: ${analysis.componentType}

Use your tools to investigate:
1. Authentication — is there an auth check? Where is it enforced? What happens without it?
2. Input validation — is user input validated before use? Which schema/library?
3. Data exposure — does this file return or render sensitive data without filtering?
4. Dangerous patterns — dangerouslySetInnerHTML, eval, unescaped user content, open redirects

Rules:
- Make at most 6 tool calls total — be targeted, not exhaustive
- Start with grep to find auth/validation patterns, then read specific files if needed
- When you have enough context, respond with your report (no more tool calls)
- Report format: bullet points, each starting with [FINDING], [SAFE], or [UNKNOWN]
- Be specific — name the actual functions, modules, and line patterns you found`;
};

// ─── Agent loop ───────────────────────────────────────────────────────────────

const runSecurityAgent = async (
  analysis: FileAnalysis,
  aiConfig: AiConfig,
  cwd: string,
): Promise<SecurityAgentResult> => {
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(analysis, cwd) },
    {
      role: 'user',
      content: `Analyse the security of this file:\n\n\`\`\`tsx\n${analysis.sourceText.slice(0, 4_000)}\n\`\`\`\n\nUse your tools to investigate, then give me your security report.`,
    },
  ];

  let toolCallCount = 0;
  const MAX_CALLS = 6;
  const deadline = Date.now() + 45_000;

  while (toolCallCount < MAX_CALLS && Date.now() < deadline) {
    const response = await chat(aiConfig, messages, {
      tools: TOOLS as ToolDef[],
      temperature: 0.1,
    });

    if (response.toolCalls.length === 0) {
      return {
        context: formatAgentReport(response.content, toolCallCount),
        toolCallCount,
        timedOut: false,
        usedAgent: true,
      };
    }

    messages.push(response.rawAssistantMessage);

    for (const tc of response.toolCalls) {
      const output = executeTool(tc.name, tc.arguments, cwd);
      toolCallCount++;
      messages.push({ role: 'tool', content: output, toolCallId: tc.id });
    }
  }

  messages.push({
    role: 'user',
    content: 'Tool budget used. Give your security report now based on what you found.',
  });
  const final = await chat(aiConfig, messages, { temperature: 0.1 });

  return {
    context: formatAgentReport(final.content, toolCallCount),
    toolCallCount,
    timedOut: Date.now() >= deadline,
    usedAgent: true,
  };
};

const formatAgentReport = (raw: string, callCount: number): string =>
  `## Security analysis (agent — ${callCount} tool calls)\n\n${raw.trim()}`;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the security agent if conditions are met, otherwise return null
 * (caller falls back to static SecurityFinding[] from the analyzer).
 *
 * Only runs with Ollama — HuggingFace free tier doesn't support tool calling.
 */
export const runSecurityAnalysis = async (
  analysis: FileAnalysis,
  aiConfig: AiConfig,
  cwd: string,
): Promise<SecurityAgentResult | null> => {
  try {
    return await runSecurityAgent(analysis, aiConfig, cwd);
  } catch {
    // Tool calling not supported by this model version, or Ollama unavailable
    return null;
  }
};
