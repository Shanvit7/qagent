# Architecture

qagent generates **minimal behavioral regression tests** for staged component changes and runs them in a real browser. The core question it answers: *can users still complete the flows this component enables, after this change?*

---

## Pipeline

```
git add .
    │
    ▼
classify ── AST diff analysis (no AI cost)
            SKIP / LIGHTWEIGHT / FULL_QA
    │
    ▼
route map ── reverse import graph: component → pages that render it
    │
    ▼
dev server ── auto-detected (Next.js / Vite / CRA), kept warm
    │
    ▼
probe ── real Chromium navigates to the route at desktop + mobile viewports
         captures: accessible elements, interaction outcomes (before/after state
         on toggle buttons), hidden/inaccessible elements, console errors
         → ground truth fed directly into the generation prompt
    │
    ▼
┌─────────── Generator–Evaluator Loop (per file) ─────────────────────┐
│                                                                       │
│  generate ── AI writes behavioral tests from probe snapshot + source  │
│      │       framed as user goals, not component inspection           │
│      ▼                                                                │
│  run ── real Chromium executes the tests                              │
│      │                                                                │
│      ▼                                                                │
│  evaluate ── AI grades on behavioral coverage criteria                │
│      │       diagnoses selector issues, timing, real bugs             │
│      ▼                                                                │
│  refine ── targeted fix prompt with exact error + probe context       │
│      │                                                                │
│      └──→ loop until pass or budget exhausted (track best score)      │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
    │
    ▼
report ── terminal tree + markdown + screenshot on failure
```

---

## The Probe

The probe is the most important part of the pipeline. It runs before any AI call.

**Problem it solves:** Static analysis of component source can't reliably determine what's accessible and interactive in a running app. CSS-in-JS, animation libraries, responsive breakpoints, portals, server-rendered conditionals — every project does visibility differently. Any static heuristic breaks on projects that use different patterns.

**What the probe does:**
1. Opens real Chromium at the target route
2. Navigates at both desktop (1280×800) and mobile (390×844) viewports
3. Captures the **accessibility tree** — what's actually reachable by role and name
4. For toggle-like buttons (menus, accordions, expanders), clicks them and captures **before/after state** — the name and attributes before and after the click
5. Records elements in the DOM that are NOT accessible (inert, aria-hidden)
6. Records console errors on load

The probe output tells the AI exactly:
- Which `getByRole` locator to use at which viewport
- That after clicking "Open menu", the button becomes "Close menu" — so re-query with the new name (no stale locator bugs)
- Which elements exist at desktop but not mobile (and therefore require `setViewportSize` before `goto`)

**Fallback:** If the probe fails (server unreachable, page error, timeout), generation continues with source-only context. No test run is skipped.

---

## Behavioral Framing

Tests are framed as user goals, not component inspection:

| ❌ Component inspection (old) | ✅ Behavioral regression (new) |
|---|---|
| `expect(btn).toHaveAttribute("aria-expanded", "true")` | `expect(closeMenuButton).toBeVisible()` |
| `expect(btn).toHaveClass(/md:hidden .../)` | `await closeMenuButton.click(); expect(openMenuButton).toBeVisible()` |
| `expect(nav).toHaveAttribute("aria-hidden", "true")` | `expect(page).toHaveURL("/about")` |

A failing behavioral test means a user flow is broken. A failing attribute test means an implementation detail changed. Only the first is signal worth blocking on.

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
│       ├── watch.ts          # Background CI: watches .git/index for stage events
│       ├── explain.ts        # AI explains last failure
│       ├── lens.ts           # Lens configuration
│       ├── models.ts         # Provider + model selection
│       ├── skill.ts          # Skill file creation + IDE prompt
│       └── status.ts         # Config + provider health
├── probe/
│   └── index.ts              # Runtime probe: real browser → a11y tree + interaction outcomes
│                             # probeRoute() + formatProbeForPrompt()
├── analyzer/
│   └── index.ts              # Component type, props, security findings from source
├── classifier/
│   └── index.ts              # AST diff → SKIP / LIGHTWEIGHT / FULL_QA + changed regions
├── generator/
│   └── index.ts              # Builds generation prompt (source + probe) → AI → test code
├── evaluator/
│   ├── criteria.ts           # Weighted grading criteria (behavioral focus)
│   └── index.ts              # AI grader + refinement prompt builder
├── runner/
│   └── index.ts              # Spawns Playwright, parses JSON results, browser detection
├── routes/
│   └── index.ts              # Reverse import graph: component → routes
├── server/
│   └── index.ts              # Dev server lifecycle: auto-detect, start, health poll
├── context/
│   └── index.ts              # Per-file import graph for prompt context
├── scanner/
│   └── index.ts              # Project scan: router type, structure detection
├── agent/
│   └── security.ts           # Security analysis (grep + read_file tool calls)
├── feedback/
│   └── index.ts              # Cross-run failure persistence (clears on pass)
├── preflight/
│   └── index.ts              # Pre-run checks: model, API key, Chromium
├── providers/
│   └── index.ts              # Unified AI: Ollama, OpenAI, Anthropic
├── reporter/
│   └── index.ts              # Terminal tree + markdown report
├── config/
│   ├── types.ts              # QAgentConfig, AiConfig, QaLens
│   └── loader.ts             # Merge ~/.qagentrc + .qagent/config.json + skill file
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
| **Runner** | `runner/index.ts` | Executes in real Chromium — pass/fail/timeout |
| **Evaluator** | `evaluator/index.ts` | Grades behavioral coverage, diagnoses failures |
| **Refinement** | `evaluator/buildRefinementPrompt()` | Targeted fix with runtime error + probe context |

---

## Classifier

The classifier reads the AST diff and outputs SKIP / LIGHTWEIGHT / FULL_QA before any AI call:

| Change type | Decision | Rationale |
|-------------|----------|-----------|
| CSS/Tailwind classes only | **SKIP** | Cosmetic — no behavioral change possible |
| Import reorder | **SKIP** | No runtime effect |
| Prop or type change | **LIGHTWEIGHT** | 1 smoke test — verify the component still renders |
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

- Built once on watch start (1–3s), O(1) lookup per file
- Layout components resolve to `/` to avoid testing every route
- Parallel slots (`@header`, `@footer`) resolve to parent route
- Capped at 3 routes per component

---

## AI Providers

`src/providers/index.ts` — unified interface, raw fetch (no SDK dependencies for cloud).

| Provider | Auth | Notes |
|----------|------|-------|
| Ollama | None | Local, free, private — `qwen2.5-coder:14b` recommended |
| OpenAI | `OPENAI_API_KEY` | `gpt-4o` default |
| Anthropic | `ANTHROPIC_API_KEY` | `claude-3-5-sonnet` default |

Keys loaded from: shell env → `.env` / `.env.local` / `.env.development*`.

---

## Key Design Decisions

**Runtime-first, not source-first.** The probe navigates the real page before generation. The AI receives what's actually accessible in the browser, not what source analysis infers might be there. This makes the system framework-agnostic — it doesn't care how elements are hidden or animated.

**Behavioral not structural.** Tests answer "can users do X?" not "does attribute Y equal Z?". Structural tests break on cosmetic refactors. Behavioral tests only fail when real functionality breaks.

**Interaction outcomes eliminate stale locators.** For toggle elements, the probe clicks them in a fresh context and records what changes. The generator receives explicit before/after state: "Open menu → click → becomes Close menu". No inference needed, no stale locator possible.

**Stage-based, not commit-based.** qagent runs on `git add` (staged changes), not on commit. Developers get feedback before they commit, with no blocking.

**Graceful degradation.** Probe fails → source-only generation. AI unavailable → skip file, report. Browser missing → prompt to install. Nothing hard-fails silently.

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `playwright` | Browser automation + test runner |
| `@clack/prompts` | Terminal UI |
| `commander` | CLI argument parsing |
| `ollama` | Ollama SDK |
| `picocolors` | Terminal colors |
| `simple-git` | Git operations |
| `ts-morph` | TypeScript AST for classifier |
