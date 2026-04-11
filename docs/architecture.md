# Architecture

qagent generates **minimal behavioral regression tests** for staged component changes and runs them in a real browser. The core question it answers: *can users still complete the flows this component enables, after this change?*

---

## Pipeline

```
git add .
    │
    ▼
classify ── AST diff analysis (ts-morph, no AI cost)
            SKIP / LIGHTWEIGHT / FULL_QA
    │
    ▼
route map ── reverse import graph: component → pages that render it
             built once on watch start, O(1) lookup per file
    │
    ▼
env load ── reads .env / .env.local / .env.development / .env.development.local
            injected into dev server process + probe process
            watch mode restarts dev server automatically on .env* changes
    │
    ▼
dev server ── auto-detected (Next.js), started with target project env
              kept warm across runs in watch mode
    │
    ▼
probe ── real Chromium navigates to the route at desktop + mobile viewports
         captures: accessible elements, interaction outcomes (before/after state
         on toggle buttons), hidden/inaccessible elements, console errors
         → ground truth injected into the generation prompt
         → runs with target project env loaded
    │
    ▼
┌─────────── Generator–Evaluator Loop (per file) ────────────────────────┐
│                                                                          │
│  generate ── AI writes behavioral tests from probe snapshot + source     │
│      │       framed as user goals, not component inspection              │
│      ▼                                                                   │
│  sanitize ── deterministic post-gen fixes (known AI bad patterns)        │
│      │                                                                   │
│      ▼                                                                   │
│  run ── real Chromium executes tests via `npx playwright test --json`    │
│      │                                                                   │
│      ▼                                                                   │
│  evaluate ── AI grades on behavioral coverage criteria                   │
│      │       diagnoses selector issues, timing, real bugs                │
│      ▼                                                                   │
│  refine ── targeted fix prompt with exact error + probe context          │
│      │                                                                   │
│      └──→ loop until pass or budget exhausted (track best score)         │
│           default: 4 iterations, configurable via `qagent config`        │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
    │
    ▼
report ── terminal tree + markdown + screenshot on failure
```

---

## The Probe

The probe is the most important part of the pipeline. It runs before any AI call.

**Problem it solves:** Static analysis of component source can't reliably determine what's accessible and interactive in a running Next.js app. CSS-in-JS, animation libraries, responsive breakpoints, portals, server-rendered conditionals — every Next.js project does visibility differently. Any static heuristic breaks on projects that use different patterns.

**What the probe does:**
1. Opens real Chromium at the target route
2. Navigates at both desktop (1280×800) and mobile (390×844) viewports
3. Captures the **accessibility tree** — what's actually reachable by role and name
4. For toggle-like buttons (menus, accordions, expanders), clicks them and captures **before/after state** — name and aria attributes before and after the click
5. Records elements in the DOM that are NOT accessible (inert, aria-hidden)
6. Records console errors on load

The probe output tells the AI exactly:
- Which `getByRole` locator to use at which viewport
- That after clicking "Open menu", the button becomes "Close menu" — re-query with the new name (no stale locator bugs)
- Which elements exist at desktop but not mobile (require `setViewportSize` before `goto`)

**Environment:** The probe spawns a child node process that inherits the target project's env vars (loaded via `loadProjectEnv`), so pages that require API keys or feature flags render correctly.

**Fallback:** If the probe fails (server unreachable, page error, timeout), generation continues with source-only context. No test run is skipped.

---

## Environment Loading

`src/server/index.ts` — `loadProjectEnv(cwd)`

Reads `.env`, `.env.local`, `.env.development`, `.env.development.local` from the target project directory in standard priority order (later files override earlier ones). Returns a flat key-value map. Does NOT mutate `process.env` — callers decide what to do with it.

Used in three places:

| Call site | Purpose |
|-----------|---------|
| `startServer()` in `server/index.ts` | Injects env into the dev server subprocess |
| `probeRoute()` in `probe/index.ts` | Injects env into the probe node subprocess |
| `runTests()` in `runner/index.ts` | Injects env when spawning `npx playwright test` |

**Watch mode env hot-reload:** `watch.ts` watches all 4 `.env*` files with `node:fs.watch`. When any changes, the dev server is gracefully stopped and restarted with fresh env. A warning message is printed so the user knows why the restart happened.

---

## Behavioral Framing

Tests are framed as user goals, not component inspection:

| ❌ Component inspection | ✅ Behavioral regression |
|---|---|
| `expect(btn).toHaveAttribute("aria-expanded", "true")` | `expect(closeMenuButton).toBeVisible()` |
| `expect(nav).toHaveClass(/hidden/)` | `await closeMenuButton.click(); expect(openMenuButton).toBeVisible()` |
| `expect(nav).toHaveAttribute("aria-hidden", "true")` | `expect(page).toHaveURL("/about")` |

A failing behavioral test means a user flow is broken. A failing attribute test means an implementation detail changed. Only the first is signal worth acting on.

---

## Module Map

```
src/
├── cli/
│   ├── index.ts              # Entry point
│   ├── program.ts            # Commander subcommand registration
│   └── commands/
│       ├── init.ts           # Setup wizard
│       ├── run.ts            # Core pipeline: classify → probe → generate → loop → report
│       ├── watch.ts          # Background CI: watches .git/index + .env* files
│       ├── explain.ts        # AI explains last failure
│       ├── hook.ts           # Enable/disable pre-commit git hook
│       ├── config.ts         # Runtime config (e.g., qagent config iterations 6)
│       ├── models.ts         # Provider + model selection
│       ├── skill.ts          # Skill file creation + IDE prompt
│       └── status.ts         # Config + provider health
├── probe/
│   └── index.ts              # Runtime probe: real browser → a11y tree + interaction outcomes
│                             # probeRoute() + formatProbeForPrompt()
│                             # Env-aware: injects loadProjectEnv() into subprocess
├── analyzer/
│   └── index.ts              # Component type, props, security findings from source
├── classifier/
│   └── index.ts              # AST diff → SKIP / LIGHTWEIGHT / FULL_QA + changed regions
├── generator/
│   └── index.ts              # Builds generation prompt (source + probe) → AI → test code
├── sanitizer/
│   └── index.ts              # Deterministic post-generation transforms on AI test code
├── evaluator/
│   ├── criteria.ts           # Weighted grading criteria (behavioral focus)
│   └── index.ts              # AI grader + refinement prompt builder
├── runner/
│   └── index.ts              # Spawns `npx playwright test --reporter json`, parses results
│                             # Browser detection + auto-install, screenshot capture on failure
├── routes/
│   └── index.ts              # Reverse import graph: component → routes
├── server/
│   └── index.ts              # Dev server lifecycle + loadProjectEnv()
│                             # Auto-detect command, health poll, clean shutdown
├── context/
│   └── index.ts              # Per-file import graph for prompt context
├── scanner/
│   └── index.ts              # Project scan: router type, structure detection
├── agent/
│   └── security.ts           # Security analysis via agentic grep/read loop
├── feedback/
│   └── index.ts              # Cross-run failure persistence (clears on pass)
├── preflight/
│   └── index.ts              # Pre-run checks: model, API key, Chromium
├── providers/
│   └── index.ts              # Unified AI: Ollama (primary), OpenAI, Anthropic (fallback)
├── reporter/
│   └── index.ts              # Terminal tree + markdown report
├── config/
│   ├── types.ts              # QAgentConfig, AiConfig, QaLens
│   └── loader.ts             # Merge ~/.qagentrc + skill file
│                             # readIterations() / writeIterations()
├── skill/
│   └── template.ts           # Skill file template + IDE prompt
└── utils/
    ├── packageManager.ts     # Detect PM by lockfile
    └── prompt.ts             # Interactive prompt helpers
```

---

## Generator–Evaluator Loop

| Role | Module | What it does |
|------|--------|-------------|
| **Probe** | `probe/index.ts` | Real browser → live a11y + interaction ground truth |
| **Generator** | `generator/index.ts` | AI writes behavioral tests from probe + source |
| **Sanitizer** | `sanitizer/index.ts` | Deterministic fixes on AI output before run |
| **Runner** | `runner/index.ts` | Executes in real Chromium — pass/fail/timeout |
| **Evaluator** | `evaluator/index.ts` | Grades behavioral coverage, diagnoses failures |
| **Refinement** | `evaluator/buildRefinementPrompt()` | Targeted fix with runtime error + probe context |

Loop budget: default 4 iterations, min 1, max 8. Configure via `qagent config iterations <n>`.

---

## Classifier

The classifier reads the AST diff and outputs SKIP / LIGHTWEIGHT / FULL_QA before any AI call:

| Change type | Decision | Rationale |
|-------------|----------|-----------|
| CSS/Tailwind classes only | **SKIP** | Cosmetic — no behavioral change possible |
| Import reorder | **SKIP** | No runtime effect |
| Prop or type change | **LIGHTWEIGHT** | 1 smoke test — verify the component renders |
| JSX markup change | **LIGHTWEIGHT** | Minor structural change |
| Function body, hooks, state | **FULL_QA** | Logic changed — full behavioral probe needed |
| Server action | **FULL_QA** + security | Form submission path changed |

Changed regions are passed to the generator to scope tests to the actual change.

---

## Route Mapping

```
changed file: src/components/layout/site-header.tsx
                        ↓
reverse import graph traversal
                        ↓
layout component → test at "/" only (not every page)
                        ↓
playwright: page.goto("/") → assert header behavior
```

- Built once on watch start (1–3s), O(1) lookup per file change
- Layout components resolve to `/` to avoid testing every route
- Parallel slots (`@header`, `@footer`) resolve to parent route
- Capped at 3 routes per component (configurable via `watch.maxRoutes`)

---

## AI Providers

`src/providers/index.ts` — unified interface, raw fetch (no heavy SDK dependencies for cloud providers).

| Provider | Auth | Default model |
|----------|------|--------------|
| Ollama | None (local) | any installed model — `qwen2.5-coder:7b` recommended |
| OpenAI | `OPENAI_API_KEY` | `gpt-4o` |
| Anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-4` |

All three are equal first-class choices. The user selects a provider and model during `qagent init` or via `qagent models` — whichever is configured is used for all AI calls. Keys loaded from: shell env → target project `.env*` files → `~/.qagentrc`.

---

## Test Runner

`src/runner/index.ts` — wraps `npx playwright test` from the **target project's** node_modules.

Key responsibilities:
- Writes AI-generated test code to `.qagent/tmp/<hash>.spec.ts`
- Detects whether Chromium is installed in the target project; prompts install if not
- Spawns `npx playwright test --reporter json` with target project's env injected
- Parses JSON output into structured `TestCase[]` with pass/fail/skip + failure messages
- Captures screenshots on failure to `.qagent/screenshots/`
- Cleans up temp files in `finally` — always, even on infra errors

This is not a reimplementation of Playwright — it is a thin orchestration wrapper that gives the evaluator loop structured access to Playwright's real test runner output.

---

## Key Design Decisions

**Runtime-first, not source-first.** The probe navigates the real page before generation. The AI receives what's actually accessible in the browser, not what static analysis infers. This makes the system Next.js-specific — it understands App Router and Pages Router conventions for routing and component detection.

**Behavioral not structural.** Tests answer "can users do X?" not "does attribute Y equal Z?". Structural tests break on cosmetic refactors. Behavioral tests only fail when real functionality breaks.

**Interaction outcomes eliminate stale locators.** For toggle elements, the probe clicks them in a fresh context and records what changes. The generator receives explicit before/after state: "Open menu → click → becomes Close menu". No inference needed, no stale locator possible.

**Stage-based, not commit-based.** qagent runs on `git add` (staged changes), not on commit. Developers get feedback before they commit, with no blocking in watch mode.

**Env loaded everywhere it matters.** The same `loadProjectEnv()` call feeds the dev server, the probe subprocess, and the Playwright test runner. Env file changes trigger automatic dev server restart in watch mode.

**Graceful degradation.** Probe fails → source-only generation. AI unavailable → skip file, report. Browser missing → prompt to install. Env file missing → continue with existing env. Nothing hard-fails silently.

**Sanitizer before runner.** AI-generated test code passes through a deterministic sanitizer before hitting Playwright. This catches known-bad patterns (wrong imports, bad async patterns, framework-specific assumptions) without burning a refinement iteration.

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `@playwright/test` (peer) | Browser automation + test runner — must be in target project |
| `ink` | Terminal UI (React-based components for spinners, prompts, log formatting) |
| `ink-box` | Layout components for terminal UI |
| `ink-select-input` | Select input component for terminal UI |
| `ink-text-input` | Text input component for terminal UI |
| `react` | React for Ink UI components |
| `commander` | CLI argument parsing |
| `ollama` | Ollama SDK (primary AI provider) |
| `simple-git` | Git operations (staged files, diffs) |
| `ts-morph` | TypeScript AST for classifier and analyzer |
