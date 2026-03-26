# qagent

**Local CI that tests your app in a real browser.**

qagent watches your staged changes, generates Playwright tests with AI, and runs them against your live dev server — automatically, in the background, with zero test maintenance.

## Quick Start

```bash
npx qagent@latest        # setup wizard — picks AI model, installs Chromium, configures hook
qagent watch             # start background CI (primary UX)
```

The setup wizard walks you through everything: AI provider, model selection, Chromium browser install, QA lenses, and pre-commit hook.

## How It Works

qagent uses an adversarial **Generator–Evaluator loop** inspired by Anthropic's [harness design pattern for long-running AI applications](https://www.anthropic.com/engineering/harness-design-long-running-apps). An AI Generator writes tests, a real browser provides ground truth, and an AI Evaluator grades and critiques — refining until tests both pass and cover meaningful behavior.

```
git add .
    │
    ▼
preflight ── model configured? API key? Chromium installed?
    │
    ▼
classify ── AST-based: which files need QA? (zero AI cost)
    │
    ▼
route map ── reverse import graph: component → pages (max 3)
    │
    ▼
dev server ── auto-detected (Next.js / Vite / CRA), kept warm
    │
    ▼
┌─────────── Generator–Evaluator Loop (per file) ───────────┐
│                                                             │
│  generate ── AI writes Playwright tests from source + diff  │
│      ↓                                                      │
│  run ── real Chromium, real page loads, real clicks          │
│      ↓                                                      │
│  evaluate ── AI grades on 5 criteria, diagnoses failures    │
│      ↓                                                      │
│  refine ── critique + runtime errors → targeted fix         │
│      ↓                                                      │
│      └──→ loop until pass or budget exhausted               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
results ── pass/fail per file, screenshots on failure
```

### Why Two Judges?

The loop has dual feedback — **runtime** (did the test actually pass in a real browser?) and **evaluator** (did the test cover real behavior, not just trivially pass?). Neither alone works:

- Without runtime: AI writes tests that look right but click elements that don't exist
- Without evaluator: tests that pass by asserting nothing meaningful
- Together: tests must both execute correctly AND cover the business logic that changed

## Commands

| Command | Description |
|---------|-------------|
| `qagent watch` | **Primary UX** — background CI, watches for staged changes |
| `qagent run` | One-shot QA on current staged files |
| `qagent explain` | AI explains the last failure in plain English |
| `qagent models` | Switch AI model (Ollama / OpenAI / Anthropic) |
| `qagent lens` | Configure which QA lenses run |
| `qagent hook` | Enable/disable pre-commit hook |
| `qagent skill` | Create `qagent-skill.md` with project context |
| `qagent status` | Show config and provider status |

## Watch Mode

`qagent watch` is the primary way to use qagent:

1. **Preflight** — verifies model, API key, and Chromium are ready
2. **Starts your dev server** (auto-detects `next dev`, `vite`, etc.)
3. **Builds a route map** (reverse import graph: component → pages)
4. **Watches `.git/index`** for stage changes
5. On change: classify → map routes → generate → run → evaluate
6. **Results inline** — pass/fail per file, screenshot links on failure

The dev server stays warm across runs. Typical cycle: **~5-10 seconds**.

```
$ qagent watch
◆  qagent watch
│
◇  ✓ Ready — qwen2.5-coder:14b (ollama) + Chromium
◇  Route map: 21 routes
◇  Dev server ready at http://localhost:3847
◇  Watching for staged changes... (Ctrl+C to stop)
│
│  [14:23:01] Testing 1 file(s)...
│
│   FULL QA   site-header.tsx
│  ├─ ✓  page loads and header is visible     1229ms
│  ├─ ✓  mobile menu toggle interaction       1345ms
│  └─ ✓  header hides on scroll down          1821ms
│
│  3/3 passed  ·  5368ms
```

## QA Lenses

Each lens generates a different class of tests:

| Lens | What It Tests |
|------|---------------|
| `render` | Page loads, no crash, key elements visible |
| `interaction` | Click, fill, submit — outcomes correct |
| `state` | Loading, empty, error, populated states |
| `edge-cases` | Mobile viewport, rapid clicks, back/forward |
| `security` | Auth gates, no sensitive data in DOM, input validation |

## Smart Classification

Not every file change needs AI-generated tests. The classifier examines the actual AST diff and makes instant, free decisions:

| Change Type | Action | AI Cost |
|-------------|--------|---------|
| Tailwind classes only | **SKIP** | $0 |
| Import reorders | **SKIP** | $0 |
| Prop/type changes | **LIGHTWEIGHT** | Minimal |
| Function logic, hooks | **FULL_QA** | Full loop |

On a typical 8-file commit, 2-3 files get FULL_QA. That's 60-70% cost savings.

## Route Mapping

qagent builds a **reverse import graph** to connect component changes to testable routes:

```
developer changes:  src/components/layout/site-header.tsx
                            ↓
reverse import graph:  who imports this?
                            ↓
                    app/@header/page.tsx  →  route: /
                            ↓
playwright tests:   page.goto("/")  →  assert header behavior
```

- Built once on watch start (~1-3s), O(1) lookup per file
- Layout components test `/` only (not every page)
- Parallel route slots (`@header`, `@sidebar`) resolve to parent route
- Capped at 3 routes per component to keep test time bounded

## Architecture

```
src/
├── preflight/      # Pre-run checks: model, API key, Ollama, Chromium
├── classifier/     # AST-based diff classification (SKIP / LIGHTWEIGHT / FULL_QA)
├── analyzer/       # ts-morph component analysis (type, props, exports, security)
├── routes/         # Reverse import graph — component → route mapping
├── server/         # Dev server lifecycle (auto-detect, start, health poll)
├── generator/      # AI prompt builder → Playwright test code
├── runner/         # Spawn Playwright, parse JSON results, browser detection
├── evaluator/      # AI grades results on weighted criteria, builds refinement prompts
├── reporter/       # Terminal tree renderer + markdown reports
├── context/        # Per-file import graph (2 levels deep) for prompt context
├── scanner/        # Project structure detection (router type, hooks)
├── agent/          # Security analysis agent (tool-calling: grep + read_file)
├── feedback/       # Cross-run failure memory (auto-clears on pass)
├── git/            # Staged file reader, pre-commit hook management
├── providers/      # Unified AI abstraction (Ollama, OpenAI, Anthropic)
├── config/         # Config types, loader (~/.qagentrc + .qagent/config.json)
├── skill/          # Playwright-oriented skill file template + IDE prompt
├── cli/commands/
│   ├── init.ts     # Setup wizard (provider, Chromium, lenses, hook, skill)
│   ├── watch.ts    # Background CI (primary UX)
│   ├── run.ts      # One-shot QA with preflight + GAN loop
│   ├── explain.ts  # AI failure explanation
│   └── ...
└── utils/          # Package manager detection, prompt helpers
```

See [docs/architecture.md](docs/architecture.md) for the full technical deep-dive.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Test execution | **Playwright** (real Chromium browser) |
| Test generation | AI (Ollama / OpenAI / Anthropic) |
| Code analysis | ts-morph (TypeScript AST) |
| Diff classification | AST-based heuristics (zero AI cost) |
| Route mapping | Precomputed reverse import graph |
| CLI | Commander + @clack/prompts |
| Git | simple-git |

## Configuration

AI provider configured in `~/.qagentrc`:
```
provider=ollama
model=qwen2.5-coder:14b
```

Project config in `.qagent/config.json`:
```json
{
  "lenses": ["render", "interaction", "state", "edge-cases", "security"],
  "evaluator": {
    "enabled": true,
    "maxIterations": 3,
    "acceptThreshold": 7
  },
  "watch": {
    "debounceMs": 300,
    "maxRoutes": 3
  }
}
```

## Skill File

`qagent-skill.md` gives the test generator project-specific context — routes, auth patterns, UI components, navigation structure, accessibility landmarks. Without it, the AI guesses. With it, tests use correct selectors on the first try.

```bash
qagent skill    # creates template + prints IDE prompt
```

Paste the IDE prompt into Cursor / Claude Code / ChatGPT and let it explore your codebase to fill in the skill file automatically.

## How It's Different

| Tool | Approach | qagent |
|------|----------|--------|
| Copilot / ChatGPT | Single-shot generation, you verify | **Adversarial loop, self-verifying** |
| Vitest / Jest | You write tests manually | **Zero test maintenance** |
| Cypress Cloud | You write E2E tests | **AI generates from diffs, delta-focused** |
| Codium / Diffblue | Generate unit tests | **Real browser, no mocks, no jsdom** |

## Design Inspiration

The Generator–Evaluator architecture is inspired by Anthropic's [harness design pattern](https://www.anthropic.com/engineering/harness-design-long-running-apps) for building reliable long-running AI applications. The key insight: instead of trusting a single AI call, use an adversarial structure where one agent generates and another evaluates — with a real-world environment (the browser) as the ultimate arbiter of correctness.

## Requirements

- Node.js 18+
- Git repository
- React / Next.js project with a dev server
- AI provider: local [Ollama](https://ollama.com) (free) or cloud API key (OpenAI / Anthropic)

## License

MIT — built by [Shanvit Shetty](https://github.com/Shanvit7)
