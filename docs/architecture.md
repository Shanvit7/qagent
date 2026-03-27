# Architecture

qagent generates and runs **Playwright browser tests** against a live dev server. It uses a GAN-inspired loop: an AI **Generator** writes tests, a real browser provides ground truth, and an AI **Evaluator** grades and feeds critique back for refinement.

---

## Pipeline

```
git add .
    │
    ▼
preflight ── model configured? API key? Chromium installed?
    │
    ▼
classify ── AST-based: SKIP / LIGHTWEIGHT / FULL_QA (no AI cost)
    │
    ▼
route map ── reverse import graph: component → pages (max 3 routes)
    │
    ▼
dev server ── auto-detected (Next.js / Vite / CRA), kept warm
    │
    ▼
┌─────────────── GAN Loop (per file, max N iterations) ───────────────┐
│                                                                      │
│  generate ── AI writes Playwright tests from source + context        │
│      │                                                               │
│      ▼                                                               │
│  run ── real Chromium, real page loads, real clicks                   │
│      │                                                               │
│      ▼                                                               │
│  evaluate ── AI grades on 5 weighted criteria + diagnoses failures   │
│      │                                                               │
│      ▼                                                               │
│  refine ── critique + runtime errors → targeted fix prompt           │
│      │                                                               │
│      └──→ loop until pass or budget exhausted (track best score)     │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
    │
    ▼
report ── terminal tree + markdown + failure persistence
```

---

## Module Map

```
src/
├── cli/
│   ├── index.ts              # Entry point (shebang + argv)
│   ├── program.ts            # Commander subcommand registration
│   └── commands/
│       ├── init.ts            # Setup wizard (install, provider, Chromium, lenses, run mode, skill)
│       ├── run.ts             # Core pipeline — preflight → classify → generate → GAN loop → report
│       ├── watch.ts           # Stage-based CI — watches .git/index, warm server + route map
│       ├── explain.ts         # AI explains last failure
│       ├── lens.ts            # Interactive lens selection
│       ├── models.ts          # Interactive provider + model selection
│       ├── skill.ts           # Create skill file + print IDE prompt
│       └── status.ts          # Provider connection + config summary
├── agent/
│   └── security.ts            # Security analysis agent (grep + read_file tools, 6 calls max)
├── analyzer/
│   └── index.ts               # ts-morph AST → component type, props, security findings
├── classifier/
│   └── index.ts               # Rule-based change classification (SKIP/LIGHTWEIGHT/FULL_QA)
├── config/
│   ├── types.ts               # QAgentConfig, AiConfig, PlaywrightConfig, QaLens
│   └── loader.ts              # Merge ~/.qagentrc + .qagent/config.json + skill file
├── context/
│   └── index.ts               # Per-file import graph (2 levels deep) → narrative summary
├── evaluator/
│   ├── criteria.ts            # 5 weighted grading criteria (page-loads, interactions, content, console, responsive)
│   └── index.ts               # AI grader + refinement prompt builder
├── feedback/
│   └── index.ts               # Cross-run failure persistence (auto-clears on pass)
├── generator/
│   └── index.ts               # Prompt builder + AI call → Playwright test code
├── git/
│   ├── staged.ts              # Read staged files + diffs via simple-git
│   └── hook.ts                # (internal) git hook utilities — not wired into CLI
├── preflight/
│   └── index.ts               # Pre-run checks: model, API key, Ollama, Chromium
├── providers/
│   └── index.ts               # Unified AI: Ollama, OpenAI, Anthropic (generate + chat + tools)
├── reporter/
│   └── index.ts               # Terminal tree renderer + markdown report writer
├── routes/
│   └── index.ts               # Reverse import graph → component-to-route mapping
├── runner/
│   └── index.ts               # Spawn `npx playwright test`, parse JSON results, browser detection
├── scanner/
│   └── index.ts               # Project scan: router type, custom hooks
├── server/
│   └── index.ts               # Auto-detect + start dev server, health polling
├── setup/
│   └── providers.ts           # Interactive provider + model wizard
├── skill/
│   └── template.ts            # Playwright-oriented skill file template + IDE prompt
└── utils/
    ├── packageManager.ts      # Detect PM by lockfile, run PM commands
    └── prompt.ts              # Interactive prompts (clack wrappers)
```

---

## The GAN Loop

| Role | Module | What it does |
|------|--------|-------------|
| **Generator** | `generator/index.ts` | AI writes Playwright test code from source + context |
| **Environment** | `runner/index.ts` | Runs tests in real Chromium — pass/fail/timeout ground truth |
| **Evaluator** | `evaluator/index.ts` | AI grades tests on 5 weighted criteria, produces critique |
| **Refinement** | `evaluator/buildRefinementPrompt()` | Combines critique + runtime errors → targeted fix prompt |

Dual feedback is the key: runtime catches wrong selectors, AI catches missing coverage.

---

## AI Providers

`src/providers/index.ts` — unified interface, no SDK deps for cloud (raw fetch).

| Provider | Auth | Generate | Chat (tools) |
|----------|------|----------|-------------|
| Ollama | None (local) | `ollama.generate()` | `ollama.chat()` |
| OpenAI | `OPENAI_API_KEY` | `/v1/chat/completions` | with tools |
| Anthropic | `ANTHROPIC_API_KEY` | `/v1/messages` | with tools |

API keys loaded from: shell env → `.env` / `.env.local` / `.env.development*`.
Provider + model stored in `~/.qagentrc`.

---

## Config

```
~/.qagentrc                  ← provider=, model=
.qagent/config.json          ← lenses, skipTrivial, timeout
qagent-skill.md              ← project context injected into every prompt
```

---

## Key Design Decisions

- **Real browser only** — no mocks, no jsdom, no import resolution tricks. Tests run against a live dev server in Chromium.
- **Route mapping via reverse import graph** — connects "component changed" → "pages to test". Built once, O(1) lookup.
- **Parallel route slots** (`@header`, `@sidebar`) resolve to `/` — not independently navigable.
- **Layout components** test against `/` only — avoids testing every page for a shared header change.
- **Stage-based CI** (primary UX) — `qagent watch` polls `.git/index` for stage events and runs Playwright tests in the background. Developer keeps working; results surface in the terminal when ready. `qagent run` is the manual alternative — both operate purely on staged files, no commits involved.
- **Preflight checks** — interactive prompts to install Chromium, configure model, set API key before first run.
- **Failure feedback** — cross-run persistence means the AI retests previously-broken scenarios.
- **Selector derivation** — prompt instructs AI to read aria-labels/text from source code, not guess. `boundingBox()` for CSS-transform visibility (framer-motion).

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `@clack/prompts` | Interactive terminal UI |
| `commander` | CLI argument parsing |
| `ollama` | Ollama SDK for local AI |
| `picocolors` | Terminal colors |
| `playwright` | Browser automation + test runner |
| `simple-git` | Git operations |
| `ts-morph` | TypeScript AST analysis |
