# qagent

> **Change-aware behavioral regression testing for Next.js**  
> Automatically generates and runs Playwright tests based on your staged changes — in a real browser.

---

## Why qagent?

Every time you change a component, you ask:

> *"Did I break something a user would notice?"*

qagent answers that automatically — as you develop.

- 🧠 Understands your code changes (AST diff, not file diffs)
- 🌐 Probes real browser behavior at desktop and mobile viewports
- 🧪 Generates meaningful Playwright tests from what's actually accessible
- ⚡ Runs them, refines failures, and reports results
- 🔁 Background CI in watch mode — zero blocking, zero interruption

Built for fast-moving teams without dedicated QA.

---

## How it works

When you stage a file (`git add`), qagent runs this pipeline:

### 1. Diff Classification
- Skips irrelevant changes (CSS-only, import reorder)
- Lightweight test for prop/type changes
- Full QA for logic, state, hooks, and markup changes
- Zero AI cost at this step

### 2. Route Mapping
- Traces which Next.js pages render the changed component
- Reverse import graph built once, O(1) lookup per file
- Layout components resolve to `/` only

### 3. Environment Load
- Reads `.env`, `.env.local`, `.env.development`, `.env.development.local` from the target project
- Injected into both the dev server process and the probe process
- In watch mode: automatically restarts the dev server if any `.env*` file changes

### 4. Live Browser Probe
- Opens real Chromium at the target route
- Desktop (1280×800) and mobile (390×844) viewports
- Captures: accessibility tree, interactive elements, hidden elements, console errors
- Clicks toggle-like buttons and records before/after state (so generated tests never have stale locators)
- Probe result is the ground truth fed into the generation prompt — no static JSX heuristics

### 5. Test Generation
- AI writes behavioral Playwright tests from the probe snapshot + source context
- Framed as user goals ("user can toggle mobile menu"), not component inspection
- Sanitizer applies deterministic fixes to known AI-generated bad patterns before running

### 6. Execution + Refinement Loop
- Tests run in real Chromium via `npx playwright test --reporter json`
- On failure: runtime errors + probe context fed back to AI for targeted fix
- Tracks best score across iterations; up to 4 refinement attempts (configurable)
- Parallel execution across multiple changed files

---

## Quick Start

```bash
npx qagent@latest   # setup wizard — AI provider, Chromium check
qagent watch        # run QA on every git add, in the background
```

### Manual run

```bash
git add src/MyComponent.tsx
qagent run
```

---

## Example Output

```
$ qagent watch

◆  qagent watch
◇  ✓ qwen2.5-coder:7b (ollama) · Chromium ready
◇  Route map: 21 routes
◇  Dev server ready — http://localhost:3000
◇  Watching for staged changes... (Ctrl+C to stop)

  [10:14:32] header.tsx

   FULL QA   header.tsx
  ├─ ✓ user can toggle mobile menu
  ├─ ✓ user can navigate via mobile menu
  └─ ✓ desktop navigation renders correctly

  3/3 passed · 3.5s
```

Behavioral regression tests ensure user flows work after code changes.

---

## Example Generated Test

```ts
test("user can toggle the mobile menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const openMenu = page.getByRole("button", { name: "Open menu" });
  await openMenu.click();

  // Probe recorded that the button name changes to "Close menu" after click
  const closeMenu = page.getByRole("button", { name: "Close menu" });
  await expect(closeMenu).toBeVisible();

  await closeMenu.click();
  await expect(openMenu).toBeVisible();
});
```

---

## Smart Classification

| Change Type                   | Decision    | Rationale                                   |
|-------------------------------|-------------|---------------------------------------------|
| CSS / Tailwind classes only   | **SKIP**    | Cosmetic — no behavioral impact              |
| Import reorder                | **SKIP**    | No runtime effect                            |
| Prop or type change           | **LIGHTWEIGHT** | Smoke test — verify component renders    |
| JSX markup change             | **LIGHTWEIGHT** | Minor structural change                  |
| Function body, hooks, state   | **FULL_QA** | Logic changed — full probe + generate needed |
| Server action                 | **FULL_QA** + security scan | Form submission path changed  |

---

## Commands

| Command                         | Description                                       |
|---------------------------------|---------------------------------------------------|
| `qagent watch`                  | Background CI — runs on every `git add`           |
| `qagent run`                    | Run once on currently staged files, then exit     |
| `qagent explain`                | AI explains the last test failure                 |
| `qagent config iterations <n>`  | Set max refinement loop iterations (1–8)          |
| `qagent models`                 | Switch AI provider / model interactively          |
| `qagent skill`                  | Generate project context file (`qagent-skill.md`) |
| `qagent status`                 | Check setup — provider, Chromium, config          |

---

## Skill File

`qagent-skill.md` improves generation accuracy by telling the AI about your project:

- Routes and their purpose
- User flows and auth patterns
- UI conventions (component library, design system)
- API patterns

```bash
qagent skill   # scaffolds the file, then let Cursor/Claude fill it in
```

> Without this: qagent infers from source and probe.  
> With this: qagent understands your domain.

---

## AI Providers

### Local (recommended — free, private)

```bash
ollama pull qwen2.5-coder:7b    # fast, private
ollama pull qwen2.5-coder:14b   # higher quality
```

### Cloud

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
```

All three providers — Ollama, OpenAI, Anthropic. Select one during `qagent init` or switch anytime:

```bash
qagent models
```

The selected provider and model are used for all AI calls (generation, evaluation, explain). There is no fallback — whichever you configure is what runs.

---

## Configuration

| File                    | Purpose                                      |
|-------------------------|----------------------------------------------|
| `~/.qagentrc`           | Global AI provider + model                   |
| `qagent-skill.md`       | Project context for the AI                   |
| `.env` / `.env.local`   | Target project env — auto-loaded by qagent   |

---

## Architecture

```
src/
├── probe/        # Real browser → accessibility tree + interaction ground truth
├── analyzer/     # ts-morph AST analysis (component type, props, security)
├── classifier/   # AST diff → SKIP / LIGHTWEIGHT / FULL_QA
├── generator/    # Prompt construction + AI provider calls
├── sanitizer/    # Deterministic post-generation fixes on AI output
├── evaluator/    # Behavioral grading + refinement prompt builder
├── runner/       # Spawns `npx playwright test`, parses JSON results
├── routes/       # Reverse import graph: file → route(s)
├── server/       # Dev server lifecycle + env loading
├── agent/        # Agentic loops (security analysis)
├── context/      # Per-file import graph for prompt context
├── feedback/     # Cross-run failure persistence (clears on pass)
├── scanner/      # Project detection (Next.js router, structure)
├── preflight/    # Pre-run checks: model, API key, Chromium
├── providers/    # Unified AI: Ollama, OpenAI, Anthropic
├── reporter/     # Terminal output + markdown reports
├── config/       # Config loading, types, defaults
├── skill/        # Skill file template
└── cli/          # Commands: watch, run, explain, config, models, skill, status
```

---

## Development

```bash
git clone https://github.com/Shanvit7/qagent.git
cd qagent
bun install
bun run check        # typecheck + unit tests
```

```bash
bun run dev          # run CLI from source (no build needed)
bun run dev -- run   # pass subcommands
bun run build        # compile to dist/
bun run test         # vitest unit tests
bun run typecheck    # tsc --noEmit
```

See [docs/local-testing.md](docs/local-testing.md) for full local + integration testing guide.

---

## Requirements

- Node.js 18+
- Bun (for development)
- Next.js project (App Router or Pages Router)
- `@playwright/test` installed in the target project
- Ollama, OpenAI key, or Anthropic key (at least one)

---

## License

MIT © [Shanvit Shetty](https://github.com/Shanvit7)
