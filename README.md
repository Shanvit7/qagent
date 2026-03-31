# qagent

> **Change-aware E2E testing for React & Next.js**
> Automatically generates and runs Playwright tests based on your staged changes.

---

## 🚀 Why qagent?

Every time you change a component, you ask:

> *“Did I break something a user would notice?”*

qagent answers that instantly.

* 🧠 Understands your code changes
* 🌐 Observes real browser behavior
* 🧪 Generates meaningful Playwright tests
* ⚡ Runs them before you commit

Built for fast-moving teams without dedicated QA.

---

## ⚙️ How it works

When you stage a file, qagent runs a pipeline:

### 1. Diff Classification

* Skips irrelevant changes (CSS, imports)
* Focuses only on behavioral impact

### 2. Route Mapping

* Identifies which pages render the changed component

### 3. Live Browser Probe

* Opens real Chromium (desktop + mobile)
* Reads accessibility tree
* Interacts with UI (clicks, toggles, flows)

### 4. Test Generation

* AI generates Playwright tests based on observed behavior

### 5. Execution + Refinement

* Runs tests in browser
* Fixes failures iteratively

> 💡 The key advantage:
> Tests are based on **observed UI behavior**, not guessed selectors.

---

## 🧩 Quick Start

```bash
npx qagent@latest   # setup (AI provider, Chromium)
qagent watch        # run on every git add
```

### Example Output

```
$ qagent watch

◆  qagent
◇  ✓ gpt-4o (openai) · Chromium ready
◇  Route map: 21 routes
◇  Dev server ready — http://localhost:3000
◇  Watching for staged changes...

  [10:14:32] header.tsx

   FULL QA   header.tsx
  ├─ ✓ user can toggle mobile menu
  ├─ ✓ user can navigate via mobile menu
  └─ ✓ desktop navigation renders correctly

  3/3 passed · 3.5s
```

---

## 🧪 Example Generated Test

```ts
test("user can toggle the mobile menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const openMenu = page.getByRole("button", { name: "Open menu" });
  await openMenu.click();

  const closeMenu = page.getByRole("button", { name: "Close menu" });
  await expect(closeMenu).toBeVisible();

  await closeMenu.click();
  await expect(openMenu).toBeVisible();
});
```

---

## 🧠 Smart Classification

Not every change needs testing.

| Change Type         | Action                           |
| ------------------- | -------------------------------- |
| Styling / imports   | Skip                             |
| Props / types       | Lightweight test                 |
| Logic / state / JSX | Full QA (probe + generate + run) |

---

## 📦 Commands

| Command          | Description                        |
| ---------------- | ---------------------------------- |
| `qagent watch`   | Run continuously on staged changes |
| `qagent run`     | Run once on staged files           |
| `qagent explain` | Explain last failure               |
| `qagent skill`   | Generate project context file      |
| `qagent models`  | Switch AI provider                 |
| `qagent status`  | Check setup                        |

---

## 🧾 Skill File (Project Context)

`qagent-skill.md` improves accuracy by defining:

* Routes
* User flows
* Auth patterns
* UI conventions

```bash
qagent skill
```

Then let an AI (Cursor / Claude) fill it based on your codebase.

> Without this: qagent guesses
> With this: qagent understands

---

## 🤖 AI Providers

### Local (recommended)

```bash
ollama pull qwen2.5-coder:14b
```

### Cloud

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
```

Switch anytime:

```bash
qagent models
```

---

## ⚙️ Configuration

```
~/.qagentrc           # AI provider + model
.qagent/config.json   # runtime config
qagent-skill.md       # project context
```

---

## 🏗️ Architecture

```
src/
├── probe/        # Browser interaction + a11y extraction
├── analyzer/     # Source code analysis
├── classifier/   # Diff → test decision
├── generator/    # AI prompt + test generation
├── evaluator/    # Test quality + refinement
├── runner/       # Playwright execution
├── routes/       # Component → route mapping
├── server/       # Dev server lifecycle
├── agent/        # Agent loops
├── context/      # Import graph context
├── scanner/      # Project detection
├── feedback/     # Failure memory
├── providers/    # AI integrations
├── reporter/     # CLI output
└── cli/          # Commands
```

---

## 🛠️ Development

### Setup

```bash
git clone https://github.com/Shanvit7/qagent.git
cd qagent
bun install
bun run check
```

### Run locally

```bash
bun run dev
bun run dev -- run
bun run dev -- status
```

### Build & Test

```bash
bun run build
bun run test
bun run typecheck
```

---

## 🧪 Testing

* Tests are co-located with modules
* Run all tests:

```bash
bun test
```

* Run specific module:

```bash
bun test src/classifier
```

---

## 📋 Requirements

* Node.js 18+
* Bun (dev)
* React / Next.js app
* Running dev server
* Git

---

## 🎯 Philosophy

qagent is not trying to replace QA.

It acts as:

> **A fast, deterministic guardrail for user-facing regressions**

* Tests what changed
* Observes real behavior
* Keeps dev velocity high

---

## 📄 License

MIT © [Shanvit Shetty](https://github.com/Shanvit7)
