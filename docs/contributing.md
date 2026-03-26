# Contributing

Guide for contributors working on the qagent codebase.

---

## Prerequisites

- **Node.js 18+** (required by the `engines` field and tsup target)
- **Bun** (used as the package manager — lockfile is `bun.lock`)
- **Git** (qagent is a git-integrated tool)
- **AI provider** — at least one of: Ollama running locally, OpenAI API key, or Anthropic API key

---

## Setup

```bash
git clone https://github.com/Shanvit7/qagent.git
cd qagent
bun install
```

Verify everything works:

```bash
bun run check    # typecheck + unit tests
```

---

## Development Workflow

### Running the CLI Locally

```bash
bun run dev              # runs src/cli/index.ts directly via Bun (no build needed)
bun run dev -- run       # pass subcommands after --
bun run dev -- status
```

### Building

```bash
bun run build            # one-time build via tsup → dist/
bun run build:watch      # rebuild on file changes
```

### Testing

```bash
bun run test             # run all tests once
bun run test:watch       # vitest in watch mode
```

Tests use **Vitest** for qagent's own unit tests. Test files live co-located with source:

```
src/classifier/index.ts       ← source
src/classifier/index.test.ts  ← test
```

### Type Checking

```bash
bun run typecheck        # tsc --noEmit
```

### Full Check (CI equivalent)

```bash
bun run check            # tsc --noEmit && vitest run
```

This is what `prepublishOnly` runs before any `npm publish`.

---

## Code Conventions

The full set of conventions lives in `AGENT.md` at the repo root.

### Naming

| Thing | Convention | Example |
|-------|-----------|---------|
| Files | `kebab-case.ts` | `staged-files.ts` |
| Functions | `camelCase` | `classifyFile` |
| Interfaces | `PascalCase` | `QAgentConfig` |
| Constants | `SCREAMING_SNAKE` | `HOOK_MARKER` |
| Booleans | `is`/`has` prefix | `isHook`, `hasUseClient` |

### Terminal Output

- `color.bold` + `color.cyan` → section headers
- `color.green` → success
- `color.red` → failures
- `color.yellow` → warnings
- `color.dim` → secondary info
- `p.spinner()` → any operation >100ms

---

## Project Structure

```
src/
├── agent/           # Agentic loops (security, state)
├── analyzer/        # ts-morph AST analysis
├── classifier/      # Rule-based change classification
├── cli/commands/    # One file per CLI command
├── config/          # Config loading and types
├── context/         # Per-file import graph analysis
├── generator/       # Prompt construction + AI provider calls
├── git/             # Staged files + hook management
├── providers/       # Unified AI abstraction (Ollama, OpenAI, Anthropic)
├── reporter/        # Terminal output + report files
├── runner/          # Vitest subprocess management
├── scanner/         # Project-wide structural scan
├── skill/           # Skill file template + IDE prompt
├── setup/           # Provider setup wizard
└── utils/           # Package manager detection, interactive prompts
```

### Where to Add Things

| I want to... | Where |
|--------------|-------|
| Add a new CLI command | `src/cli/commands/<name>.ts` + register in `src/cli/program.ts` |
| Add a new QA lens | Add to `QaLens` type in `config/types.ts`, add description in `generator/index.ts`, handle in pipeline |
| Add a new agent | `src/agent/<name>.ts` following the existing agent pattern (tools, loop, limits, fallback) |
| Add a new AI provider | `src/providers/index.ts` — add generate + chat functions, wire into switch statements |
| Change classification rules | `src/classifier/index.ts` |
| Change what the analyzer detects | `src/analyzer/index.ts` |
| Change the AI prompt | `src/generator/index.ts` → `buildPrompt()` |
| Change how tests are run | `src/runner/index.ts` |
| Change terminal output | `src/reporter/index.ts` |
| Add a utility | `src/utils/<name>.ts` |

---

## Writing Tests

### Test Location

Co-located with source:

```
src/classifier/index.ts
src/classifier/index.test.ts
```

### Test Structure

```typescript
import { describe, it, expect } from "vitest";
import { classifyFile } from "./index.js";

describe("classifyFile", () => {
  describe("SKIP cases", () => {
    it("skips deleted files", () => {
      expect(classifyFile(makeFile({ status: "D" })).action).toBe("SKIP");
    });
  });
});
```

- Outer `describe` → module name
- Inner `describe` → scenario group
- `it()` → plain English behavior
- Factory helpers for test setup (`makeFile`, `makeConfig`)
- Test behavior, not implementation
- At least one negative/edge-case per module

### Mocking

Use `vi.mock()` only. No sinon, no jest-mock.

---

## Adding a New Agent

All agents follow the same architecture. Here's the pattern:

1. **Define tools** — array of tool definitions (`{ type: "function", function: { name, description, parameters } }`)
2. **Implement tool execution** — a `executeTool(name, args, cwd)` function that dispatches to `grep`, `read_file`, etc.
3. **Write the system prompt** — tells the agent what to investigate and how to format output
4. **Implement the agent loop:**
   ```
   while (callCount < MAX && Date.now() < deadline):
     response = chat(config, messages, { tools })
     if no tool_calls → done, return content
     execute tool calls, append results to messages
   force final synthesis
   ```
5. **Export a public function** that wraps the loop in try/catch and returns `null` on failure
6. **Wire it into the pipeline** — call it from `generator/index.ts` or `run.ts`

Key constraints:
- Set hard limits (max tool calls, timeout)
- Cap tool output (`MAX_OUTPUT = 3_000–3_500`)
- Fall back silently — agents never block commits
- Use `temperature: 0.1–0.2` for deterministic output

---

## Git Conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>
```

| Type | When |
|------|------|
| `feat` | New feature or command |
| `fix` | Bug fix |
| `refactor` | Code change without feature or fix |
| `test` | Adding or updating tests |
| `docs` | Documentation |
| `chore` | Config, deps, build |

Scopes: `cli`, `classifier`, `analyzer`, `generator`, `runner`, `git`, `config`, `agent`, `providers`, `skill`

```
feat(providers): add Anthropic support
fix(runner): handle Vitest timeout gracefully
docs: update contributing guide
chore(deps): bump ollama to 0.6.0
```

---

## Pre-Commit Checklist

Before staging any file:

- [ ] No `function` keyword (arrow functions only)
- [ ] All imports use `.js` extensions
- [ ] All Node.js built-ins use `node:` prefix
- [ ] No `any` types
- [ ] Every `catch` block is handled or commented
- [ ] New exports have return types annotated
- [ ] Tests exist or are updated for changed logic
- [ ] `bun run check` passes

---

## Debugging Tips

### Provider Not Responding

```bash
# Ollama
ollama serve          # start the server
ollama list           # check installed models

# OpenAI / Anthropic
# Check your .env file has the right key
qagent status         # qagent's own connectivity check
```

### Seeing What the AI Generates

The generated test code is written to `.qagent/tmp/` before Vitest runs it. It's cleaned up automatically, but you can add logging in `src/runner/index.ts` before the `finally` block to inspect it.

### Understanding Classification

Run `qagent run` with staged files and look at the `SKIP` / `LIGHTWEIGHT` / `FULL QA` badges in the output. The classifier logs its reason for each file.

### Agent Tool Call Traces

Agent results include `toolCallCount`. For deeper debugging, add logging in the agent loop (`src/agent/*.ts`) to see which tools were called and what they returned.
