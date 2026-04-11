# AGENT.md — qagent Codebase Conventions

This file is the authoritative source of truth for any AI agent (or developer) working on the qagent codebase. Read it in full before writing or modifying any code. All rules below are non-negotiable unless this file explicitly says otherwise.

---

## 1. Language & Syntax Rules

### 1.1 ES6+ Everywhere — No `function` Keyword

All logic must be written as **arrow functions assigned to `const`**. The `function` keyword is banned outside of type-level constructs.

```ts
// ✅ Correct
const greet = (name: string): string => `Hello, ${name}`;

const loadData = async (id: string): Promise<User> => {
  const raw = await fetch(`/users/${id}`);
  return raw.json() as Promise<User>;
};

// ❌ Wrong — never write this
function greet(name: string): string {
  return `Hello, ${name}`;
}

async function loadData(id: string): Promise<User> { ... }
```

This applies to:
- All module-level declarations
- All exported utilities, commands, and handlers
- All local helper functions inside modules
- Callbacks and event handlers

**Exception:** `class` methods in third-party library subclasses where the API demands it. There are none in this codebase today.

---

### 1.2 TypeScript Strict Mode

The `tsconfig.json` enforces strict mode. Every rule it enables is active. Do not suppress or work around them.

- **Never use `any`** — use `unknown` with narrowing, or define a proper interface.
- **Never cast with `as any`** — use type guards or `satisfies`.
- **Always define return types** on exported functions.
- **Use `interface` for object shapes** and `type` for unions/aliases.
- **Import types with `import type`** to keep runtime imports clean.

```ts
// ✅
import type { QAgentConfig } from "./types.js";
const config: QAgentConfig = { ... };

// ❌
import { QAgentConfig } from "./types.js";
const config: any = { ... };
```

---

### 1.3 ESM — Use `.js` Extensions in All Imports

Even though source files are `.ts`, imports must use `.js` extensions for ESM compatibility.

```ts
// ✅
import { loadConfig } from "./config/loader.js";

// ❌
import { loadConfig } from "./config/loader";
import { loadConfig } from "./config/loader.ts";
```

---

### 1.4 `node:` Prefix for Built-ins

Always use the `node:` prefix when importing Node.js built-in modules.

```ts
// ✅
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

// ❌
import { readFileSync } from "fs";
```

---

## 2. Code Organization

### 2.1 One Concept Per File

Each file owns exactly one concern. If a file grows past ~300 lines or has two unrelated responsibilities, split it.

| Module         | Owns                                             |
|---------------|--------------------------------------------------|
| `config/types.ts` | All TypeScript interfaces and type aliases   |
| `config/loader.ts` | Config file loading and merging logic       |
| `classifier/index.ts` | Change classification heuristics         |
| `analyzer/index.ts` | ts-morph AST analysis                     |
| `generator/index.ts` | Prompt building and AI client calls      |
| `runner/index.ts` | Playwright subprocess management |
| `git/staged.ts` | Reading git staged files and diffs           |
| `git/staged.ts` | Reading git staged files and diffs (primary) |
| `cli/commands/*.ts` | One file per CLI command                  |

---

### 2.2 Named Exports — No Barrel Files

Export symbols directly from their source file. Do not create `index.ts` barrel files that re-export everything from a directory.

```ts
// ✅ — consumer imports from the source
import { classifyFile } from "../../classifier/index.js";

// ❌ — no barrel re-export files
// src/classifier/index.ts should not just re-export from ./classifier.ts
```

---

### 2.3 Types at the Top

Define interfaces and type aliases at the top of a file, before any implementation.

```ts
// ✅ — types come first
export interface GeneratedTests { ... }
interface OllamaResponse { ... }

const extractCodeBlock = (raw: string): string => { ... };
export const generateTests = async (...): Promise<GeneratedTests> => { ... };
```

---

### 2.4 Keep Helpers Private

Internal helper functions should be module-scoped `const` arrow functions and **not exported** unless another module genuinely needs them. If a helper starts being used in multiple places, move it to a shared `utils.ts`.

---

## 3. Async Patterns

### 3.1 Always `async/await` — Never `.then()` Chains

```ts
// ✅
const result = await fetchData(id);
const parsed = await parseResult(result);

// ❌
fetchData(id).then((result) => parseResult(result)).then(...);
```

### 3.2 Only Mark a Function `async` if It `await`s

```ts
// ✅
const toUpper = (s: string): string => s.toUpperCase();

// ❌ — unnecessary async wrapper
const toUpper = async (s: string): Promise<string> => s.toUpperCase();
```

### 3.3 `new Promise()` Only for Event-Based APIs

Use `new Promise()` only when wrapping APIs that are genuinely event-based (e.g., `child_process` exit). Do not use it as a manual wrapper around `async/await` code.

```ts
// ✅ — correct use: child process is event-based
const spawnVitest = (path: string): Promise<number> =>
  new Promise((resolve) => {
    const child = spawn("npx", ["vitest", "run", path]);
    child.on("exit", (code) => resolve(code ?? 1));
  });

// ❌ — anti-pattern
const loadFile = (path: string): Promise<string> =>
  new Promise((resolve) => {
    resolve(readFileSync(path, "utf8"));  // just use await
  });
```

---

## 4. Error Handling

### 4.1 Never Silently Swallow Errors

Every `catch` block must do at least one of: log, re-throw, or return an error indicator. An empty catch is only allowed with an explicit comment explaining why.

```ts
// ✅ — logs and continues
try {
  await riskyOperation();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[qagent] Operation failed: ${message}`);
}

// ✅ — intentionally ignored with reason
try {
  unlinkSync(tempPath);
} catch { /* temp file may not exist — non-critical */ }

// ❌ — unexplained empty catch
try {
  await riskyOperation();
} catch {}
```

### 4.2 Narrow Error Types

Never type catch variables as `any`. Use `instanceof Error` narrowing.

```ts
// ✅
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
}

// ❌
} catch (e: any) {
  console.error(e.message);
}
```

### 4.3 Infra Errors Must Exit Cleanly

If qagent fails for any reason that isn't a test failure (Ollama down, file read error, parse failure), exit with a clear warning message. Watch mode continues; manual `qagent run` exits 1 only on genuine test failure.

```ts
// ✅ — infra failure: warn and exit
render(<Text color="yellow">Preflight failed — skipping tests.</Text>);
process.exit(0);
```

---

## 5. Naming Conventions

| Thing              | Convention            | Example                        |
|-------------------|-----------------------|--------------------------------|
| Files              | `kebab-case.ts`       | `staged-files.ts`              |
| Exported constants | `camelCase`           | `loadConfig`, `classifyFile`   |
| Interfaces         | `PascalCase`          | `QAgentConfig`, `StagedFile`   |
| Type aliases       | `PascalCase`          | `QaLens`, `ChangeAction`       |
| Private helpers    | `camelCase`           | `buildPrompt`, `getExtension`  |
| Enum-like constants | `SCREAMING_SNAKE`    | `HOOK_MARKER`, `TEMP_DIR`      |
| Booleans           | `is` / `has` prefix   | `isHook`, `hasUseClient`       |

---

## 6. Testing Conventions

### 6.1 Internal Tests

All internal tests use **Vitest**. No exceptions — not Jest, not node:test.

Test files live co-located with the source file they test:

```
src/classifier/index.ts
src/classifier/index.test.ts   ← test file here
```

### 6.2 Test Structure

```ts
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

- Group with `describe` — outer block names the module, inner blocks name the scenario.
- Name `it()` blocks in plain English: what the unit does, not how.
- Use factory helpers (`makeFile`, `makeConfig`) to reduce boilerplate in test setup.
- Test behavior, not implementation — assert on outputs, not internal state.
- Include at least one negative/edge-case test per module.

### 6.3 No Mocking Frameworks

Use `vi.mock()` from Vitest for module mocking. No sinon, no jest-mock, no third-party mock libraries.

### 6.4 Generated Tests — Playwright Only

qagent generates **Playwright browser tests** against a live dev server. Generated tests must:

- Import from `@playwright/test` only — no jsdom, no RTL, no React test utils, no mocks of any kind
- Use accessible queries: `page.getByRole()`, `page.getByText()`, `page.getByLabel()`
- Never use CSS selectors when accessible queries work
- Always include a smoke test (page loads, no crash, key content visible)
- Use `page.setViewportSize()` before `page.goto()` for viewport-specific tests
- Assert user-observable outcomes, not internal state or DOM attributes

---

## 7. Terminal Output Conventions

All user-facing terminal output uses **Ink** React components (`Text`, `Box`, `Spinner` from `ink-spinner`) for rich, interactive UI. Do not use `@clack/prompts` — it was replaced with Ink for better React-based rendering.

| Pattern              | Usage                                      |
|---------------------|--------------------------------------------|
| `<Text color="cyan">` | Section headers, command names             |
| `<Text color="green">` | Success messages                           |
| `<Text color="red">` | Failures, errors                           |
| `<Text color="yellow">` | Warnings, skipped items                    |
| `<Text dimColor>` | Secondary info, hints, raw output          |
| `<Spinner type="dots" />` | Any operation that takes >100ms            |
| `<Text bold>` | Emphasis for important info                |
| `render(<Box>...</Box>)` | Layout and interactive screens             |

---

## 8. AI / Provider Integration

- **Ollama, OpenAI, and Anthropic are equal first-class providers.** The user picks one at `qagent init` or via `qagent models`.
- All provider calls go through `src/providers/index.ts` — no direct SDK imports elsewhere.
- The model is never hardcoded in logic — always read from `config.ai.model`.
- Prompts live in `generator/index.ts` — the `buildPrompt` function. Keep them clean, specific, and testable.
- Temperature for test generation: **0.2** (deterministic). Temperature for explanations: **0.3**.
- Always extract the code block from AI output with `extractCodeBlock` before writing tests to disk.
- AI-generated test code passes through `src/sanitizer/index.ts` before being executed — deterministic transforms that catch known-bad patterns.
- If AI is unavailable: warn and skip — tests on staged files are best-effort. Never `process.exit(1)` on provider failure.

---

## 9. Git Conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>
```

| Type       | When to Use                              |
|-----------|------------------------------------------|
| `feat`     | New feature or command                   |
| `fix`      | Bug fix                                  |
| `refactor` | Code change that doesn't fix or add      |
| `test`     | Adding or updating tests                 |
| `docs`     | README, AGENT.md, comments               |
| `chore`    | Config, deps, build                      |

**Scopes:** `cli`, `classifier`, `analyzer`, `generator`, `sanitizer`, `evaluator`, `runner`, `probe`, `server`, `git`, `config`, `agent`, `providers`, `routes`, `reporter`

**Examples:**
```
feat(classifier): add LIGHTWEIGHT action for prop-only changes
fix(runner): handle Vitest timeout gracefully
docs: update AGENT.md with error handling rules
chore(deps): bump ollama to 0.6.0
```

---

## 10. What Not to Do

The following are hard bans. Do not do them under any circumstance:

| Banned Pattern                        | Why                                              |
|--------------------------------------|--------------------------------------------------|
| `function foo() {}`                  | Arrow functions only — see §1.1                  |
| `any` type annotations               | Defeats TypeScript's purpose                     |
| Barrel `index.ts` re-export files    | Creates hidden coupling                          |
| Empty `catch {}` without a comment   | Hides bugs silently                              |
| `process.exit(1)` on AI failures     | Warn and skip — tooling issues shouldn't stop the dev |
| Hardcoding model names in logic      | Always read from config                          |
| `.then()` chains                     | Use `async/await` instead                        |
| `import` without `.js` extension     | Breaks ESM resolution                            |
| `import` without `node:` for builtins| Ambiguous resolution, bad practice               |
| Mutable `let` when `const` works     | Prefer immutability by default                   |
| `@clack/prompts` usage               | Replaced with Ink for React-based UI             |

---

## 11. File Checklist Before Committing

Before staging any file:

- [ ] No `function` keyword (only arrow functions)
- [ ] All imports use `.js` extensions
- [ ] All Node.js builtins use `node:` prefix
- [ ] No `any` types
- [ ] Every `catch` block is handled or commented
- [ ] New exports have return types annotated
- [ ] Tests exist or are updated for changed logic
- [ ] `bun run check` passes (typecheck + tests)

---

*This file is maintained by the project authors. When conventions evolve, update this file in the same commit as the code change.*
