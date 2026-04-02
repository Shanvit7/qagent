# Local Testing Guide

How to build, link, and test qagent locally — including installing it in a Next.js project before publishing to npm.

---

## Quick Reference

| Goal | Command |
|------|---------|
| Run CLI without building | `bun run dev` |
| Build the package | `bun run build` |
| Run unit tests | `bun run test` |
| Typecheck | `bun run typecheck` |
| Full check (CI equivalent) | `bun run check` |
| Link globally | `npm link` (in qagent dir) |
| Install in a target project | `npm link qagent` (in target dir) |
| Unlink from a project | `npm unlink qagent` (in target dir) |
| Unlink globally | `npm unlink -g qagent` (anywhere) |

---

## Method 1: Run Directly via Bun (Fastest)

During development, you don't need to build. Bun runs TypeScript source directly:

```bash
cd /path/to/qagent

bun run dev              # runs src/cli/index.ts (init wizard)
bun run dev -- run       # pass subcommands after --
bun run dev -- watch
bun run dev -- status
bun run dev -- explain
bun run dev -- models
bun run dev -- config iterations 6
```

**Limitation:** Only works from within the qagent directory. For end-to-end testing inside a real Next.js project, use Method 2 or 3.

---

## Method 2: npm link (Recommended for End-to-End Testing)

Creates a global symlink so you can run `qagent` as a real CLI in any target project.

### Step 1: Build

```bash
cd /path/to/qagent
bun run build
```

Produces `dist/cli/index.js` — the actual binary.

### Step 2: Link Globally

```bash
npm link
```

### Step 3: Link Into Your Target Project

```bash
cd /path/to/your-nextjs-project
npm link qagent
```

### Step 4: Test

```bash
cd /path/to/your-nextjs-project

qagent               # setup wizard
qagent status        # check provider + Chromium
qagent watch         # background CI — run on every git add

# Stage something and watch it run
echo "// touch" >> src/components/Header.tsx
git add src/components/Header.tsx
# → qagent detects the stage and fires

qagent run           # manual single run
qagent explain       # explain last failure
qagent config iterations 6   # bump refinement loop budget
```

### Step 5: Rebuild After Changes

```bash
cd /path/to/qagent
bun run build              # rebuild
# Link is live — target project picks up changes immediately
```

Continuous rebuild:

```bash
bun run build:watch
```

### Cleanup

```bash
cd /path/to/your-nextjs-project
npm unlink qagent

npm unlink -g qagent   # anywhere
```

---

## Method 3: Install from Tarball (Simulates Real npm Install)

```bash
cd /path/to/qagent
bun run build
npm pack               # creates qagent-x.y.z.tgz
```

```bash
cd /path/to/your-nextjs-project

# npm
npm install --save-dev /path/to/qagent/qagent-x.y.z.tgz

# yarn
yarn add --dev /path/to/qagent/qagent-x.y.z.tgz

# pnpm
pnpm add -D /path/to/qagent/qagent-x.y.z.tgz

# bun
bun add -d /path/to/qagent/qagent-x.y.z.tgz
```

Then run via the package manager's exec tool:

```bash
npx qagent           # npm / yarn / pnpm
bunx qagent          # bun
```

Reinstall after changes:

```bash
cd /path/to/qagent && bun run build && npm pack
cd /path/to/your-nextjs-project && npm install --save-dev /path/to/qagent/qagent-x.y.z.tgz
```

---

## Method 4: Direct Path Install

```bash
cd /path/to/your-nextjs-project

npm install --save-dev /path/to/qagent    # npm
yarn add --dev /path/to/qagent            # yarn
pnpm add -D /path/to/qagent              # pnpm
bun add -d /path/to/qagent               # bun
```

Behavior varies by package manager (some symlink, others copy). Prefer Method 2 for reliability.

---

## Running Unit Tests

qagent's own test suite (unit tests of classifier, analyzer, runner, etc.):

```bash
cd /path/to/qagent

bun run test           # run all tests once
bun run test:watch     # watch mode — re-runs on changes
```

### Test Stack

- **Framework:** Vitest
- **Environment:** node (qagent's own tests are pure TypeScript, no browser)
- **Pattern:** `src/**/*.test.ts`
- **Location:** Co-located with source files

### Running Specific Tests

```bash
# Run tests matching a pattern
bunx vitest run src/classifier

# Run a single file
bunx vitest run src/classifier/index.test.ts

# With coverage
bunx vitest run --coverage
```

> **Note:** qagent's *own* unit tests use Vitest. The tests it *generates* for your project use Playwright. These are different things.

---

## Testing Stage-Based Triggering

qagent operates on staged files — either automatically (watch mode) or manually.

### Watch mode

```bash
cd /path/to/your-nextjs-project

# Terminal 1 — start watcher
qagent watch

# Terminal 2 — make and stage a change
echo "// touch" >> src/components/Button.tsx
git add src/components/Button.tsx
# → qagent detects the stage event and runs QA
# → results appear in Terminal 1
```

### Manual run

```bash
git add src/components/Button.tsx
qagent run
# → runs and exits
```

### Testing env-based features

To verify env loading works correctly:

```bash
# In your target project, add a variable to .env
echo "MY_TEST_VAR=hello" >> .env

# In watch mode, changing .env triggers automatic dev server restart:
# ⚠  .env changed — restarting dev server with new env…
# ✓ Dev server restarted at http://localhost:3000 with updated env

# Run a manual probe to verify the page renders with the new env:
qagent run
```

---

## Testing with Different Providers and Models

qagent supports Ollama, OpenAI, and Anthropic — all equal choices. Configure once at `qagent init`, switch anytime with `qagent models`.

```bash
# Ollama — pull a model first
ollama pull qwen2.5-coder:14b

# Override active model via env var (highest priority, any provider)
QAGENT_MODEL=qwen2.5-coder:14b qagent run

# Interactive picker — writes to ~/.qagentrc
qagent models

# Edit directly
echo '{"provider":"ollama","model":"qwen2.5-coder:14b"}' > ~/.qagentrc
echo '{"provider":"openai","model":"gpt-4o"}' > ~/.qagentrc
echo '{"provider":"anthropic","model":"claude-sonnet-4-20250514"}' > ~/.qagentrc
```

---

## Testing Without a Running AI

If you want to test non-AI parts (classifier, analyzer, scanner, probe, runner):

1. **Unit tests** — mock the provider calls:
   ```bash
   bun run test
   ```

2. **CLI** — qagent gracefully skips AI steps when unavailable:
   ```bash
   qagent run
   # → AI unavailable — skipping (connection refused)
   ```

The probe, classifier, analyzer, scanner, and route mapping all function without any AI provider. Only `generator/`, `evaluator/`, and `explain` require a live provider.

---

## Troubleshooting

### `qagent: command not found` after npm link

```bash
npm config get prefix     # shows global prefix, e.g. /usr/local
# Add <prefix>/bin to PATH
export PATH="$(npm config get prefix)/bin:$PATH"
```

### Changes not reflected after rebuild

With `npm link`, the symlink points to your local `dist/`. Make sure you ran `bun run build`. Use `bun run build:watch` for continuous rebuilds.

### Ollama not responding

```bash
ollama serve                                    # start the server
curl http://localhost:11434/api/tags            # verify response
qagent status                                   # qagent's own check
```

### Chromium not installed in target project

```bash
cd /path/to/your-nextjs-project
npx playwright install chromium
```

qagent also auto-prompts for this during preflight.

### Env variables not picked up

qagent reads env files from the **target project's directory** (where you run `qagent`), not from qagent's own directory.

In watch mode, changing any `.env*` file automatically restarts the dev server. You'll see:
```
⚠  .env.local changed — restarting dev server with new env…
✓ Dev server restarted at http://localhost:3000 with updated env
```

### Stale `.qagent/` artifacts

```bash
rm -rf .qagent/tmp/          # temp test files (normally auto-cleaned)
rm -rf .qagent/screenshots/  # failure screenshots
rm .qagent/last-failure.txt  # last failure report
```

### TypeScript errors during build

```bash
bun run typecheck    # shows all errors
```

The config enforces strict mode: no `any`, `exactOptionalPropertyTypes`, etc.
