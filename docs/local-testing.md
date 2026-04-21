# Local Testing Guide

How to test qagent locally as a contributor. This guide covers unit testing the package itself and integration testing in a target Next.js project using npm/pnpm link.

---

## Prerequisites

- Node.js 18+
- Bun (for building qagent)
- A target Next.js project with Playwright installed (e.g., `npx playwright install chromium` in the target project)
- Git

## Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Shanvit7/qagent.git
   cd qagent
   ```

2. **Install dependencies:**
   ```bash
   bun install
   ```

3. **Build the package:**
   ```bash
   bun run build
   ```

4. **Run unit tests:**
   ```bash
   bun run test
   ```

5. **Link qagent globally (optional, for global CLI access):**
   ```bash
   npm link
   ```

## Integration Testing in a Target Project

To test qagent's functionality, integrate it into a target Next.js project that uses Playwright.

1. **In the target project directory (e.g., your Next.js app):**
   ```bash
   cd /path/to/your/target/nextjs/project
   # Ensure Playwright is installed
   npx playwright install chromium
   ```

2. **Link qagent into the target project:**
   If you linked globally:
   ```bash
   pnpm link qagent  # or npm link qagent
   ```
   Alternatively, from the qagent directory:
   ```bash
   cd /path/to/qagent
   pnpm link --global
   cd /path/to/your/target/nextjs/project
   pnpm link qagent
   ```

## Testing Commands

Run qagent commands in the target project directory:

```bash
cd /path/to/your/target/nextjs/project

# Run qagent (auto-initializes if this project hasn't been set up yet)
qagent

# Check status
qagent status

# Manual run (after staging changes)
git add <file>
qagent run

# Watch mode (background CI on staged changes)
qagent watch

# Explain last failure
qagent explain

# Change config (e.g., iterations)
qagent config iterations 6

# Re-run setup wizard
qagent init
```

## After Making Changes to qagent

Rebuild and the target project will pick up changes automatically:

```bash
cd /path/to/qagent
bun run build
```

For continuous rebuild during development:

```bash
cd /path/to/qagent
bun run build:watch
```

## Cleanup

To remove the link:

```bash
cd /path/to/your/target/nextjs/project
pnpm unlink qagent

# If linked globally
npm unlink -g qagent
```

## Troubleshooting

- If `qagent: command not found`, add npm's global bin to PATH: `export PATH="$(npm config get prefix)/bin:$PATH"`
- Ensure Chromium is installed in the target project: `npx playwright install chromium`
- qagent reads environment variables from the target project's directory.
- Configuration is per-project (stored in `.qagentrc` in the target project's root). Each Next.js project needs its own setup.
- For issues with dual React versions, qagent handles resolution automatically in test runs.