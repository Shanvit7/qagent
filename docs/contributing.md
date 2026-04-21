# Contributing to qagent

Welcome! This guide helps you get started contributing to qagent, a change-aware behavioral regression testing tool for Next.js projects.

---

## Prerequisites

- **Node.js 18+** (matches `engines` field in package.json)
- **Bun** (fast package manager and runtime)
- **Git** (for version control)
- **AI provider setup**:
  - Ollama running locally (recommended): `ollama pull qwen2.5-coder:7b`
  - Or OpenAI API key: `export OPENAI_API_KEY=sk-...`
  - Or Anthropic API key: `export ANTHROPIC_API_KEY=sk-ant-...`
- **A Next.js target project** for testing (see [docs/local-testing.md](docs/local-testing.md))

---

## Quick Start

```bash
git clone https://github.com/Shanvit7/qagent.git
cd qagent
bun install
bun run check    # typecheck + unit tests
bun run dev      # run CLI from source (no build needed)
```

---

## Development Workflow

### Running the CLI

Use Bun for fast development without building:

```bash
bun run dev              # runs src/cli/index.ts directly
bun run dev -- status    # check connectivity
bun run dev -- run       # run QA on staged files
bun run dev -- watch     # background QA on git add
```

### Building & Testing

```bash
bun run build            # one-time build to dist/ (ESM + DTS)
bun run build:watch      # rebuild on changes

bun run test             # run unit tests (Vitest)
bun run test:watch       # test watch mode

bun run typecheck        # TypeScript check only
bun run check            # full CI check (typecheck + tests)
```

Unit tests are co-located with source files (e.g., `src/classifier/index.test.ts`).

### Integration Testing

For end-to-end testing, link qagent to a Next.js project:

```bash
# In qagent repo
bun run build
npm link

# In your Next.js project
pnpm link qagent
qagent  # runs setup if needed
```

See [docs/local-testing.md](docs/local-testing.md) for detailed integration testing steps.

---

## Code Structure

```
src/
├── cli/
│   ├── index.ts           # Entry point
│   ├── program.tsx        # Commander setup + Ink UI routing
│   └── commands/*.tsx     # CLI commands (Ink-based UIs)
├── ui/
│   ├── screens/*.tsx      # Ink UI screens (InitWizard, HelpScreen, etc.)
│   └── components/*.tsx   # Reusable Ink components
├── config/
│   ├── loader.ts          # Load per-project .qagentrc
│   └── types.ts           # TypeScript interfaces
├── providers/             # AI providers (Ollama, OpenAI, Anthropic)
├── classifier/            # Change classification logic
├── analyzer/              # AST analysis (ts-morph)
├── generator/             # AI prompt construction
├── evaluator/             # Test refinement loops
├── runner/                # Playwright test execution
├── probe/                 # Runtime browser probing
├── sanitizer/             # Post-generation code fixes
├── reporter/              # Terminal output formatting
├── utils/                 # Helpers (package manager detection, etc.)
└── ...                    # Other modules as needed
```

Key files:
- `src/cli/program.tsx` — Root CLI logic (smart detection: init vs. help)
- `src/ui/screens/InitWizard.tsx` — Setup wizard (Next.js check, provider selection)
- `src/config/loader.ts` — Config loading (now per-project `.qagentrc`)

---

## Coding Conventions

### Style Guide (from AGENT.md)

- **Files**: `kebab-case.ts`
- **Functions**: Arrow functions only, `camelCase`
- **Interfaces**: `PascalCase`
- **Constants**: `SCREAMING_SNAKE_CASE`
- **Booleans**: `is`/`has` prefix (`isConfigured`, `hasNextJs`)

### UI Patterns (Ink)

Use Ink for all CLI output. Consistent colors:

| Color | Usage |
|-------|-------|
| `cyan` | Headers, success actions |
| `green` | Success messages |
| `red` | Errors, failures |
| `yellow` | Warnings |
| `dimColor` | Secondary info |

Example:
```tsx
<Text color="cyan">Fetching models...</Text>
<Text color="green">✓ Ready</Text>
<Text color="red">✗ Failed</Text>
```

### Testing

- Co-located with source: `index.test.ts` next to `index.ts`
- Use Vitest: `describe`, `it`, `expect`
- Mock with `vi.mock()` only
- Test behavior, not implementation
- Cover edge cases and failures

---

## Adding Features

### New CLI Command

1. Create `src/cli/commands/<name>.tsx` (Ink-based UI)
2. Export `const <name>Command = async () => { ... }`
3. Register in `src/cli/program.tsx`: `program.command("<name>").action(<name>Command)`

### New UI Screen

1. Create `src/ui/screens/<Name>Screen.tsx`
2. Use Ink components (`Box`, `Text`, `SelectInput`)
3. Handle input with `useInput`, complete with `onComplete`

### New Config Option

1. Add to `QAgentConfig` in `src/config/types.ts`
2. Implement loader in `src/config/loader.ts`
3. Update `InitWizard` or add CLI command to set it

### Modifying Existing Logic

- **Classification**: `src/classifier/`
- **AI Prompts**: `src/generator/`
- **Test Sanitization**: `src/sanitizer/`
- **Evaluation/Refinement**: `src/evaluator/`
- **Output Formatting**: `src/reporter/`

---

## Git & Commits

Use [Conventional Commits](https://conventionalcommits.org/):

```
<type>(<scope>): <description>
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`

Scopes: `cli`, `ui`, `config`, `classifier`, `generator`, etc.

Examples:
```
feat(cli): add smart init vs help detection
fix(config): support per-project .qagentrc
docs: update contributing guide with Ink UI patterns
```

---

## Pre-Commit Checklist

- [ ] `bun run check` passes (types + tests)
- [ ] No `function` keyword (arrows only)
- [ ] Imports use `.js` extensions
- [ ] Node built-ins prefixed with `node:`
- [ ] No `any` types
- [ ] All catches handled or documented
- [ ] New logic has tests
- [ ] Updated docs if needed

---

## Debugging

### Common Issues

- **Provider not responding**: Run `qagent status` or check Ollama/OpenAI keys
- **Tests failing**: Inspect generated code in `.qagent/tmp/` (temporarily disable cleanup in `src/runner/`)
- **Env not loading**: qagent reads from target project root; check `.env*` files

### Logs & Output

- Use `console.log` for debugging (removed before commit)
- Ink screens handle all user-facing output
- Errors go to stderr via Ink

---

## Need Help?

- Check existing issues on GitHub
- Read the code — it's well-commented
- Run `bun run dev -- status` to verify setup
- For UI changes, test with `bun run dev -- init` in a fresh project

Happy contributing! 🚀
