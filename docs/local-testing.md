# Local Testing Guide

How to build, link, and test qagent locally — including installing it in one of your React or Next.js projects before publishing to npm.

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
| Install in a React/Next.js project | `npm link qagent` (in project dir) |
| Unlink from a project | `npm unlink qagent` (in project dir) |
| Unlink globally | `npm unlink -g qagent` (anywhere) |

---

## Method 1: Run Directly via Bun (Fastest)

During development, you don't need to build at all. Bun can run TypeScript source directly:

```bash
cd /path/to/qagent

# Run the default command (init wizard)
bun run dev

# Run a specific subcommand
bun run dev -- run
bun run dev -- status
bun run dev -- explain
bun run dev -- models
```

This executes `src/cli/index.ts` directly. Fast iteration, no build step.

**Limitation:** This only works from within the qagent directory. To test qagent inside a React or Next.js project, use Method 2 or 3.

---

## Method 2: npm link (Recommended for End-to-End Testing)

This creates a global symlink so you can run `qagent` as a real CLI command in any React or Next.js project.

### Step 1: Build qagent

```bash
cd /path/to/qagent
bun run build
```

This produces `dist/cli/index.js` — the actual binary that npm would publish.

### Step 2: Link Globally

```bash
cd /path/to/qagent
npm link
```

This registers the `qagent` binary globally. You can now run `qagent` from anywhere.

### Step 3: Link Into Your React/Next.js Project

```bash
cd /path/to/your-react-or-nextjs-project
npm link qagent
```

This creates a symlink in your project's `node_modules/qagent` pointing to your local qagent build. The target project must be a React or Next.js project — qagent analyzes `.tsx`/`.ts` components, hooks, server actions, and API routes specific to these frameworks.

### Step 4: Test It

```bash
cd /path/to/your-react-or-nextjs-project

# Run the setup wizard
qagent

# Or run QA directly (stage some React/Next.js files first)
git add src/MyComponent.tsx
qagent run

# Check status
qagent status

# Other commands
qagent lens
qagent models
qagent explain
qagent skill
```

### Step 5: Iterate

When you make changes to qagent:

```bash
cd /path/to/qagent
bun run build              # rebuild
# Changes are immediately available in your linked React/Next.js project — no re-link needed
```

For continuous rebuilds:

```bash
bun run build:watch        # tsup watches for changes and rebuilds automatically
```

### Cleanup

When you're done testing:

```bash
# Remove the link from your project
cd /path/to/your-react-or-nextjs-project
npm unlink qagent

# Remove the global link
npm unlink -g qagent
```

---

## Method 3: Install from Local Path (Simulates Real Install) [Recommended]

This installs qagent from the local filesystem, similar to how a user would install from npm — but from your local build.

### Step 1: Build and Pack

```bash
cd /path/to/qagent
bun run build
npm pack                   # creates qagent-0.1.0.tgz
```

### Step 2: Install the Tarball

Install the tarball in your React or Next.js project using whichever package manager the project uses:

```bash
cd /path/to/your-react-or-nextjs-project

# npm
npm install --save-dev /path/to/qagent/qagent-0.1.0.tgz

# yarn
yarn add --dev /path/to/qagent/qagent-0.1.0.tgz

# pnpm
pnpm add -D /path/to/qagent/qagent-0.1.0.tgz

# bun
bun add -d /path/to/qagent/qagent-0.1.0.tgz
```

This installs qagent exactly as it would from the npm registry — copies files from the `dist/` directory (per the `files` field in `package.json`), sets up the bin link, etc. Run this inside a React or Next.js project to get meaningful results.

### Step 3: Test

```bash
cd /path/to/your-react-or-nextjs-project

# npm / yarn / pnpm
npx qagent               # runs the setup wizard
npx qagent run            # runs QA on staged files
npx qagent status         # checks setup

# pnpm (alternative)
pnpx qagent
pnpx qagent run

# bun
bunx qagent
bunx qagent run
```

### Step 4: Update After Changes

Rebuild, repack, and reinstall:

```bash
cd /path/to/qagent
bun run build
npm pack

cd /path/to/your-react-or-nextjs-project

# npm
npm install --save-dev /path/to/qagent/qagent-0.1.0.tgz

# yarn
yarn add --dev /path/to/qagent/qagent-0.1.0.tgz

# pnpm
pnpm add -D /path/to/qagent/qagent-0.1.0.tgz

# bun
bun add -d /path/to/qagent/qagent-0.1.0.tgz
```

### Cleanup

To remove qagent from your project after testing:

```bash
# npm
npm uninstall qagent

# yarn
yarn remove qagent

# pnpm
pnpm remove qagent

# bun
bun remove qagent
```

---

## Method 4: Direct Path Install (Quickest Link Alternative)

```bash
cd /path/to/your-react-or-nextjs-project

# npm
npm install --save-dev /path/to/qagent

# yarn
yarn add --dev /path/to/qagent

# pnpm
pnpm add -D /path/to/qagent

# bun
bun add -d /path/to/qagent
```

This installs directly from the source directory into your React or Next.js project. Note: behavior varies across package managers — some create a symlink, others copy files. Prefer Method 2 or 3 for reliability.

---

## Running Unit Tests

qagent's own test suite:

```bash
cd /path/to/qagent

bun run test               # run all tests once
bun run test:watch         # watch mode — re-runs on changes
```

### Test Configuration

- **Framework:** Vitest
- **Environment:** jsdom (for React Testing Library compatibility)
- **Setup file:** `src/test-setup.ts` (imports `@testing-library/jest-dom`)
- **Pattern:** `src/**/*.test.ts` and `src/**/*.test.tsx`
- **Coverage:** v8 provider, reports in `coverage/`

### Running Specific Tests

```bash
# Run tests matching a pattern
bunx vitest run src/classifier

# Run a single test file
bunx vitest run src/classifier/index.test.ts

# Run with coverage
bunx vitest run --coverage
```

---

## Testing the Pre-Commit Hook

To test hook mode end-to-end:

### In a Linked React/Next.js Project

```bash
cd /path/to/your-react-or-nextjs-project

# Install the hook
qagent hook               # interactive — choose "install"

# Or during init
qagent                    # choose "On every commit" mode

# Make a change and commit
echo "// test" >> src/App.tsx
git add src/App.tsx
git commit -m "test qagent hook"
# → qagent runs automatically before the commit
```

### What the Hook Does

The hook script runs `<runner> qagent run --hook`. The `--hook` flag tells qagent:
- Exit 0 on infrastructure errors (never block commits due to tooling issues)
- Exit 1 only on genuine test failures

### Testing Hook Installation

```bash
# Check what was written
cat .git/hooks/pre-commit    # raw git hook
# or
cat .husky/pre-commit        # husky hook

# The script should contain:
# # qagent-hook
# npx qagent run --hook
# exit $?
```

---

## Testing with Different Models

qagent uses Ollama. To test with different models:

```bash
# Pull a model
ollama pull qwen2.5-coder:7b

# Set model via env var (overrides all config)
QAGENT_MODEL=qwen2.5-coder:14b qagent run

# Or set interactively (writes to ~/.qagentrc)
qagent models

# Or edit directly
echo "model=codellama:7b" > ~/.qagentrc
```

---

## Testing Without Ollama

If you need to test the non-AI parts of qagent (classifier, analyzer, scanner, etc.), you can:

1. **Unit tests** — mock the Ollama calls:
   ```bash
   bun run test
   ```

2. **Run the CLI** — qagent gracefully handles Ollama being unavailable:
   ```bash
   qagent run
   # → AI unavailable — skipping (connection refused)
   # → commit is allowed through (not blocked)
   ```

The classifier, analyzer, scanner, and context modules all work without Ollama. Only `generator/`, `agent/`, and `explain` require a running Ollama instance.

---

## Troubleshooting

### `qagent: command not found` After npm link

Make sure you ran `npm link` (not `bun link`) and that your npm global bin is in your `PATH`:

```bash
npm config get prefix     # shows npm's global prefix
# Add <prefix>/bin to your PATH if not already there
```

### Changes Not Reflected After Rebuild

With `npm link`, the symlink points to your local `dist/` directory. Make sure you ran `bun run build` after making changes. Use `bun run build:watch` for automatic rebuilds.

### Permission Errors on Hook

The hook file needs to be executable:

```bash
chmod +x .git/hooks/pre-commit
# or
chmod +x .husky/pre-commit
```

qagent sets this automatically during `qagent hook`, but manual edits may reset it.

### Ollama Connection Issues

```bash
ollama serve              # ensure the server is running
curl http://localhost:11434/api/tags   # verify it responds
qagent status             # qagent's connectivity check
```

### Stale `.qagent/` Artifacts

If tests behave unexpectedly, clear the local cache:

```bash
rm -rf .qagent/tmp/       # temp test files (normally auto-cleaned)
rm -rf .qagent/reports/   # historical reports
rm .qagent/last-failure.txt
```
### TypeScript Errors During Build

```bash
bun run typecheck         # see all errors
# tsconfig.json is strict — no any, exactOptionalPropertyTypes, etc.
```

