# qagent

Change-aware behavioral regression testing for Next.js. Generates and runs Playwright tests against your staged changes — in a real browser.

---

## The problem

Every time you change a component, you have to manually verify nothing broke for the user. qagent does that automatically, as part of your normal `git add` workflow.

---

## How it works

Stage a file. qagent runs a pipeline:

**1. Classification** — Diffs the AST. Decides whether the change warrants full QA, a lightweight smoke test, or can be skipped entirely. No AI at this step.

**2. Route mapping** — Traces which Next.js pages actually render the changed component via a reverse import graph.

**3. Browser probe** — Opens real Chromium at the target route. Captures the accessibility tree, interactive elements, and console errors at desktop and mobile viewports. Clicks toggle-like controls and records before/after state. This snapshot is the ground truth for generation.

**4. Test generation** — AI writes behavioral Playwright tests from the probe snapshot and source context. Tests are framed as user goals.

**5. Execution and refinement** — Tests run in Chromium. On failure, runtime errors and probe context are fed back to the AI for a targeted fix. Up to 4 refinement attempts, tracking the best result across iterations.

---

## Usage

```bash
# First run in a project — setup wizard (auto-detects if needed)
qagent

# Watch mode — QA runs automatically on every git add
qagent watch

# One-shot — run against currently staged files
git add src/components/Header.tsx
qagent run
```

---

## Output

```
[10:14:32] header.tsx

  FULL QA   header.tsx
  ├─ ✓  user can toggle mobile menu          1.2s
  ├─ ✓  user can navigate via mobile menu    0.9s
  └─ ✓  desktop navigation renders           0.4s

  3/3 passed · 3.5s
```

---

## Example generated test

```ts
test("user can toggle the mobile menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const openBtn = page.getByRole("button", { name: "Open menu" });
  await openBtn.click();

  // Probe recorded button label changes to "Close menu" after click
  await expect(page.getByRole("button", { name: "Close menu" })).toBeVisible();

  await page.getByRole("button", { name: "Close menu" }).click();
  await expect(openBtn).toBeVisible();
});
```

---

## Classification rules

| Change type                  | Decision      | Reason                                       |
|------------------------------|---------------|----------------------------------------------|
| CSS / Tailwind only          | skip          | No behavioral impact                         |
| Import reorder               | skip          | No runtime effect                            |
| Prop or type change          | lightweight   | Smoke test — verify it renders               |
| JSX markup change            | lightweight   | Minor structural change                      |
| Function body, hooks, state  | full QA       | Logic changed — probe and generate           |
| Server action                | full QA       | Form submission path changed                 |

---

## Commands

| Command                        | Description                                          |
|--------------------------------|------------------------------------------------------|
| `qagent`                       | Run init if project not configured, else show help   |
| `qagent init`                  | Setup wizard — provider, model, Chromium check       |
| `qagent watch`                 | Run QA automatically on every `git add`              |
| `qagent run`                   | One-shot QA on currently staged files                |
| `qagent explain`               | AI explains the last test failure                    |
| `qagent models`                | Switch AI provider or model                          |
| `qagent skill`                 | Generate `qagent-skill.md` project context file      |
| `qagent config iterations <n>` | Set max refinement iterations (1–8)                  |
| `qagent status`                | Check provider, Chromium, and config                 |

---

## Skill file

`qagent-skill.md` is an optional context file that improves test generation accuracy. It tells the AI about your project's routes, user flows, auth patterns, and UI conventions.

```bash
qagent skill   # scaffolds the file
```

Without it, qagent infers context from source and the browser probe. With it, qagent understands your domain.

---

## AI providers

**Local — Ollama (recommended)**

```bash
ollama pull qwen2.5-coder:7b
ollama pull qwen2.5-coder:14b
```

No API key, no cost, runs entirely on your machine.

**Cloud**

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
```

Select provider and model during `qagent init`, or switch at any time with `qagent models`. The configured provider is used for all AI calls — generation, evaluation, and explain. There is no fallback.

---

## Configuration

| File               | Purpose                                    |
|--------------------|--------------------------------------------|
| `.qagentrc`        | Project AI provider and model              |
| `qagent-skill.md`  | Project context for AI (optional)          |
| `.env.local`       | Target project env — auto-loaded by qagent |

---

## Architecture

```
src/
├── probe/        Real browser → accessibility tree + interaction state
├── analyzer/     ts-morph AST analysis — component type, props, security
├── classifier/   AST diff → skip / lightweight / full QA
├── generator/    Prompt construction + AI provider calls
├── sanitizer/    Deterministic post-generation fixes on AI output
├── evaluator/    Behavioral grading + refinement prompt builder
├── runner/       Spawns playwright test, parses JSON results
├── routes/       Reverse import graph: changed file → route(s)
├── server/       Dev server lifecycle + env loading
├── context/      Per-file import graph for prompt context
├── feedback/     Cross-run failure persistence (clears on pass)
├── scanner/      Project structure detection (router type, hooks)
├── preflight/    Pre-run checks — model, API key, Chromium
├── providers/    Unified AI client — Ollama, OpenAI, Anthropic
├── reporter/     Terminal output + markdown run reports
├── config/       Config loading, types, defaults
├── skill/        Skill file scaffolding
└── cli/          Commands: init, watch, run, explain, config, models, skill, status
```

---

## Development

```bash
git clone https://github.com/Shanvit7/qagent.git
cd qagent
bun install
bun run check       # typecheck + tests
bun run dev         # run CLI from source
bun run dev -- run  # pass subcommands
bun run build       # compile to dist/
```

See [docs/local-testing.md](docs/local-testing.md) for the local integration testing guide.

---

## Requirements

- Node.js 18+
- Next.js project (App Router or Pages Router)
- `@playwright/test` in the target project
- One of: Ollama running locally, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`

---

## License

MIT © [Shanvit Shetty](https://github.com/Shanvit7)
