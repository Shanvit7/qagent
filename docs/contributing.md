# Contributing

Guide for contributors working on the qagent codebase.

---

## Prerequisites

- **Node.js 18+** (required by `engines` field and tsup target)
- **Bun** (package manager — lockfile is `bun.lock`)
- **Git**
- **AI provider** — at least one of: Ollama running locally, OpenAI API key, or Anthropic API key
- **A Next.js target project** to run end-to-end tests against

---

## Setup

```bash
git clone https://github.com/Shanvit7/qagent.git
cd qagent
bun install
bun run check    # typecheck + unit tests
```

---

## Development Workflow

### Running the CLI

```bash
bun run dev              # runs src/cli/index.ts directly via Bun (no build needed)
bun run dev -- run       # pass subcommands after --
bun run dev -- watch
bun run dev -- status
bun run dev -- config iterations 6
```

### Building

```bash
bun run build            # one-time build via tsup → dist/
bun run build:watch      # rebuild on file changes
```

### Testing

```bash
bun run test             # run all unit tests once
bun run test:watch       # vitest in watch mode
```

Unit tests use **Vitest** and are co-located with source:

```
src/classifier/index.ts       ← source
src/classifier/index.test.ts  ← unit test
```

### Type Checking

```bash
bun run typecheck        # tsc --noEmit
```

### Full Check (CI equivalent)

```bash
bun run check            # tsc --noEmit && vitest run
```

`prepublishOnly` runs this before any `npm publish`.

---

## Code Conventions

The full authoritative conventions are in `AGENT.md` at the repo root. Key points:

### Style

| Thing | Convention | Example |
|-------|-----------|---------|
| Files | `kebab-case.ts` | `staged-files.ts` |
| Functions | `camelCase` arrow functions | `classifyFile` |
| Interfaces | `PascalCase` | `QAgentConfig` |
| Constants | `SCREAMING_SNAKE` | `HOOK_MARKER` |
| Booleans | `is`/`has` prefix | `isHook`, `hasUseClient` |

### Terminal Output

Use **Ink** components (`Text`, `Box`, `Spinner` from `ink-spinner`) for UI.
| Pattern | Usage |
|---------|-------|
| `<Text color="cyan">` | Section headers |
| `<Text color="green">` | Success |
| `<Text color="red">` | Failures, errors |
| `<Text color="yellow">` | Warnings |
| `<Text dimColor>` | Secondary info |
| `<Spinner type="dots" />` | Any operation >100ms |

---

## Project Structure

```
src/
├── agent/           # Agentic loops (security analysis)
├── analyzer/        # ts-morph AST analysis
├── classifier/      # Rule-based change classification
├── cli/commands/    # One file per CLI command
├── config/          # Config loading and types
├── context/         # Per-file import graph analysis
├── evaluator/       # Test quality grading + refinement prompts
├── feedback/        # Cross-run failure persistence
├── generator/       # Prompt construction + AI provider calls
├── git/             # Staged files reader + git hook management
├── preflight/       # Pre-run checks: model, API key, Chromium
├── probe/           # Runtime browser probe (a11y tree, interactions)
├── providers/       # Unified AI abstraction (Ollama, OpenAI, Anthropic)
├── reporter/        # Terminal output + report files
├── routes/          # Reverse import graph: file → route(s)
├── runner/          # Playwright test runner wrapper
├── sanitizer/       # Deterministic post-gen transforms on AI test code
├── scanner/         # Project-wide structural scan
├── server/          # Dev server lifecycle + env loading
├── skill/           # Skill file template
├── setup/           # Provider setup wizard
└── utils/           # Package manager detection, interactive prompts
```

### Where to Add Things

| I want to… | Where |
|------------|-------|
| Add a new CLI command | `src/cli/commands/<name>.ts` + register in `src/cli/program.ts` |
| Change classification rules | `src/classifier/index.ts` |
| Change what the analyzer detects | `src/analyzer/index.ts` |
| Change the generation prompt | `src/generator/index.ts` → `buildPrompt()` |
| Add post-gen sanitizer rules | `src/sanitizer/index.ts` |
| Change how tests are run | `src/runner/index.ts` |
| Change grading / refinement | `src/evaluator/index.ts` |
| Change terminal output | `src/reporter/index.ts` |
| Add a new AI provider | `src/providers/index.ts` — add generate/chat functions, wire into switch |
| Add a new agent | `src/agent/<name>.ts` — see adding a new agent below |
| Add a config key | `src/config/types.ts` + `src/config/loader.ts` |
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

All agents follow the same architecture:

1. **Define tools** — array of tool definitions (`{ type: "function", function: { name, description, parameters } }`)
2. **Implement tool execution** — `executeTool(name, args, cwd)` dispatches to `grep`, `readFile`, etc.
3. **Write the system prompt** — tells the agent what to investigate and how to format output
4. **Implement the agent loop:**
   ```
   while (callCount < MAX && Date.now() < deadline):
     response = chat(config, messages, { tools })
     if no tool_calls → done, return content
     execute tool calls, append results to messages
   force final synthesis
   ```
5. **Export a public function** wrapping the loop in try/catch, returning `null` on failure
6. **Wire it into the pipeline** — call from `generator/index.ts` or `run.ts`

Key constraints:
- Set hard limits (max tool calls, deadline timeout)
- Cap tool output (`MAX_OUTPUT = 3_000–3_500` chars)
- Fall back silently — agents warn and skip on infra failures
- Use `temperature: 0.1–0.2` for deterministic analysis output

---

## Adding a New CLI Command

1. Create `src/cli/commands/<name>.ts` — export a `<name>Command` async arrow function
2. Register it in `src/cli/program.ts`
3. Follow the pattern: `p.intro()` → work → `p.outro()` or `p.log.*`
4. Handle `SIGINT` / `SIGTERM` for watch-like commands

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

**Scopes:** `cli`, `classifier`, `analyzer`, `generator`, `sanitizer`, `evaluator`, `runner`, `probe`, `server`, `git`, `config`, `agent`, `providers`, `reporter`, `routes`

```
feat(probe): inject target project env into subprocess
fix(watch): restart dev server on .env file changes
docs: update architecture with env loading flow
chore(deps): bump ink to 4.4.1
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
ollama serve          # start Ollama
ollama list           # check installed models
qagent status         # qagent's own connectivity check
```

### Inspecting Generated Test Code

Generated tests are written to `.qagent/tmp/` before Playwright runs them and cleaned up in `finally`. To inspect them, temporarily comment out the `unlinkSync` in `src/runner/index.ts` — they'll stay in `.qagent/tmp/` after the run.

### Understanding Classification

Run `qagent run` with staged files and observe the `SKIP` / `LIGHTWEIGHT` / `FULL QA` badges. The classifier logs its decision for each file.

### Probe Failures

If the probe returns `success: false`, generation falls back to source-only mode. Common causes:
- Dev server not started / not ready yet
- Target route returns 404 or 500
- Chromium not installed in target project (`npx playwright install chromium`)
- `.env*` vars missing — check that `loadProjectEnv` is loading the right file

### Env Not Loading

qagent reads env from the **directory where you run it** (target project root). Run `qagent status` to confirm the cwd. In watch mode, changing `.env*` files triggers automatic dev server restart — watch for the `⚠ .env changed` message.
