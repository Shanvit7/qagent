# Local Testing Guide

How to test qagent locally in a target Next.js project using npm link.

---

## Prerequisites

- Node.js 18+
- Bun (for building qagent)
- pnpm (for the target project, e.g., portfolio-site)
- Playwright installed in the target project: `npx playwright install chromium`

## Setup

1. **Build qagent:**
   ```bash
   cd /Users/zosmaai/Desktop/qagent
   bun run build
   ```

2. **Link qagent globally:**
   ```bash
   cd /Users/zosmaai/Desktop/qagent
   npm link
   ```

3. **Link into the target project (portfolio-site):**
   ```bash
   cd /Users/zosmaai/Desktop/portfolio-site
   pnpm link qagent
   ```

## Testing

Run qagent commands in the target project directory:

```bash
cd /Users/zosmaai/Desktop/portfolio-site

# Initialize qagent (first time)
qagent

# Check status
qagent status

# Manual run (after staging changes)
git add <file>
qagent run

# Watch mode (background CI)
qagent watch

# Explain last failure
qagent explain

# Change config (e.g., iterations)
qagent config iterations 6
```

## After Making Changes to qagent

Rebuild and the target project will pick up changes automatically:

```bash
cd /Users/zosmaai/Desktop/qagent
bun run build
```

For continuous rebuild during development:

```bash
cd /Users/zosmaai/Desktop/qagent
bun run build:watch
```

## Cleanup

To remove the link:

```bash
cd /Users/zosmaai/Desktop/portfolio-site
pnpm unlink qagent

# Globally
npm unlink -g qagent
```

## Troubleshooting

- If `qagent: command not found`, add npm's global bin to PATH: `export PATH="$(npm config get prefix)/bin:$PATH"`
- Ensure Chromium is installed: `npx playwright install chromium` in the target project.
- For env variables, qagent reads from the target project's directory.</content>
<parameter name="path">docs/local-testing.md