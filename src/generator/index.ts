/**
 * Playwright test generator — AI builds browser-based test code
 * for routes that render changed components.
 */

import type { FileAnalysis, ComponentType } from "../analyzer/index.js";
import type { QaLens, AiConfig, QAgentConfig } from "../config/types.js";
import type { FileContext } from "../context/index.js";
import { runSecurityAnalysis } from "../agent/security.js";
import { generate } from "../providers/index.js";
import { HARD_RULES } from "../evaluator/index.js";

export interface GeneratedTests {
  filePath: string;
  testCode: string;
  lenses: QaLens[];
  routes: string[];
}

// ─── Lens descriptions ────────────────────────────────────────────────────────
// Each description gives the AI a concrete goal + assertion pattern, not just a label.

const LENS_DESCRIPTIONS: Record<QaLens, string> = {
  render: `**Render** — the page loads and meaningful content is visible.
  - Navigate to the route, wait for \`domcontentloaded\`
  - Assert the page title or a key heading exists: \`expect(page.getByRole("heading", { name: /…/i })).toBeVisible()\`
  - Assert at least one landmark is present (nav, main, header) using the ACTUAL element from source
  - Assert no error boundary text ("Something went wrong", "Error:", "500") is visible
  - DO NOT just assert \`body\` or \`html\` — pick specific, meaningful elements from the source code`,

  interaction: `**Interaction** — user actions produce the correct observable outcome.
  - Identify every interactive element in the source: buttons, links, inputs, selects
  - For each action, assert the SPECIFIC OUTCOME: new text appears, URL changes, element shows/hides, form clears
  - Example: fill input → click submit → \`expect(page.getByText("Success")).toBeVisible()\`
  - Example: click toggle → \`expect(page.getByRole("menu")).toBeVisible()\`
  - A test that clicks a button but only re-checks \`toBeVisible()\` on the same element is WORTHLESS`,

  state: `**State** — async data states are handled and visible.
  - If the component fetches data: assert the loaded state (populated list items, user name, prices)
  - If there's a loading state: navigate and check the spinner appears then disappears (\`toBeHidden()\`)
  - If there's an empty state: assert the "no results" / "empty" message text from the source
  - If there's an error boundary: assert it shows human-readable error copy, not a stack trace
  - Use \`page.waitForSelector()\` or \`toBeVisible({ timeout: 5000 })\` for async content`,

  "edge-cases": `**Edge cases** — the component holds up under non-happy-path conditions.
  - **Mobile**: \`page.setViewportSize({ width: 375, height: 667 })\` before navigating — check nav collapses, tap targets ≥ 44px, no horizontal scroll (\`page.evaluate(() => document.body.scrollWidth <= window.innerWidth)\`)
  - **Keyboard**: \`page.keyboard.press("Tab")\` through interactive elements — assert focus is visible
  - **Back/forward**: navigate to route, click a link, press \`page.goBack()\` — assert original content restored
  - **Rapid clicks**: click a button 3× quickly — assert no duplicate submissions or broken UI`,

  security: `**Security** — auth gates hold and sensitive data stays hidden.
  - Navigate to the route in a fresh context (no cookies) — assert redirect to \`/login\` or \`/auth\` or a 401 response
  - Assert that raw API keys, tokens, or passwords are NOT visible in the DOM: \`expect(page.getByText(/Bearer /)).not.toBeVisible()\`
  - For forms: submit with empty required fields — assert validation message appears, form does NOT submit
  - For server actions: attempt CSRF / direct POST via \`page.request.post()\` without session — assert 401 or redirect`,
};

// ─── Component-type strategy blocks ──────────────────────────────────────────
// Each strategy maps the component type to the correct Playwright approach + concrete assertions.

const STRATEGY: Record<ComponentType, string> = {
  "client-component": `**Strategy: Client component**
Navigate to the route. The component is hydrated — test both initial render AND interactions.
\`\`\`ts
await page.goto("/route");
await page.waitForLoadState("domcontentloaded");
// Assert specific visible content from the SOURCE (not generic "body")
await expect(page.getByRole("heading", { name: /actual heading text/i })).toBeVisible();
// Then test each interactive element — assert the outcome, not just the click
await page.getByRole("button", { name: /submit/i }).click();
await expect(page.getByText(/success message from source/i)).toBeVisible();
\`\`\``,

  "server-component": `**Strategy: Server component**
Content is server-rendered — no hydration step needed. Test what the user sees on arrival.
\`\`\`ts
await page.goto("/route");
await page.waitForLoadState("domcontentloaded");
// Assert specific rendered data — headings, paragraphs, list items — from the SOURCE
await expect(page.getByRole("heading", { level: 1 })).toContainText(/actual title/i);
// Assert no hydration mismatch error in console
const errors: string[] = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
expect(errors.filter(e => e.includes("Hydration"))).toHaveLength(0);
\`\`\``,

  "api-route": `**Strategy: API route**
Use \`page.request\` to call the endpoint directly — no browser navigation needed.
\`\`\`ts
// Happy path
const res = await page.request.get("/api/route");
expect(res.status()).toBe(200);
const body = await res.json();
expect(body).toHaveProperty("expectedField");
// Auth gate
const unauthed = await page.request.get("/api/route", { headers: {} });
expect(unauthed.status()).toBe(401);
// Validation error
const invalid = await page.request.post("/api/route", { data: {} });
expect(invalid.status()).toBe(400);
\`\`\``,

  "server-action": `**Strategy: Server action**
Server actions are invoked via form submission. Navigate to the form page, fill inputs, submit, assert.
\`\`\`ts
await page.goto("/route-with-form");
await page.waitForLoadState("domcontentloaded");
// Fill each input using the aria-label or placeholder from the SOURCE
await page.getByLabel(/name/i).fill("Test User");
await page.getByRole("button", { name: /submit/i }).click();
// Assert the success outcome — redirect URL or success message text from SOURCE
await expect(page).toHaveURL(/success|dashboard/);
// OR: await expect(page.getByText(/created successfully/i)).toBeVisible();
// Also test the error path — empty required fields
await page.getByRole("button", { name: /submit/i }).click();
await expect(page.getByText(/required|please fill/i)).toBeVisible();
\`\`\``,

  "hook": `**Strategy: Custom hook**
Hooks have no UI — test through the page that uses them. Find the route that renders a component using this hook.
\`\`\`ts
await page.goto("/route-using-hook");
await page.waitForLoadState("domcontentloaded");
// Test the USER-VISIBLE BEHAVIOR the hook enables
// e.g. if useScroll → test that header hides on scroll
await page.evaluate(() => window.scrollTo(0, 300));
await page.waitForTimeout(300); // allow animation
const box = await page.locator("header").boundingBox();
expect(box?.y).toBeLessThan(0); // scrolled off-screen
\`\`\``,

  "utility": `**Strategy: Utility function**
Utilities affect output — test through the pages that use them.
\`\`\`ts
// Navigate to a page that renders output from this utility
await page.goto("/route");
await page.waitForLoadState("domcontentloaded");
// Assert the FORMATTED OUTPUT is correct — dates, prices, strings, etc.
await expect(page.getByText(/\$1,234\.56/)).toBeVisible(); // if it's a formatter
\`\`\``,

  "unknown": `**Strategy: Unknown file type**
Navigate to the most relevant route and assert meaningful content.
\`\`\`ts
await page.goto("/");
await page.waitForLoadState("domcontentloaded");
await expect(page.getByRole("main")).toBeVisible();
\`\`\``,
};

// ─── Code block extraction ────────────────────────────────────────────────────

const extractCodeBlock = (raw: string): string => {
  const tagged = raw.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  if (tagged) return tagged[1]?.trim() ?? raw.trim();

  const untagged = raw.match(/```\n([\s\S]*?)```/);
  if (untagged) return untagged[1]?.trim() ?? raw.trim();

  return raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("```"))
    .join("\n")
    .trim() || raw.trim();
};

// ─── Context block builders ───────────────────────────────────────────────────

const buildSecurityBlock = (
  analysis: FileAnalysis,
  lenses: QaLens[],
  agentContext?: string | undefined,
): string => {
  if (!lenses.includes("security")) return "";
  if (agentContext) return agentContext;
  if (analysis.securityFindings.length === 0) return "";
  const items = analysis.securityFindings.map((f) => `- [${f.type}] ${f.detail}`).join("\n");
  return `## Security findings — write browser tests for each\n${items}`;
};

const buildDiffBlock = (diff: string | undefined, fileStatus: string | undefined): string => {
  if (!diff || fileStatus === "A") return "";
  return `## Git diff (what changed)
\`\`\`diff
${diff.slice(0, 2_000)}
\`\`\``;
};

const buildChangeContextBlock = (
  action: string | undefined,
  reason: string | undefined,
  fileStatus: string | undefined,
  changedRegions?: string[] | undefined,
): string => {
  if (!action || !reason) return "";

  if (fileStatus === "A") {
    return `## Scope: NEW FILE
Write comprehensive tests covering all visible behavior. Target 5-8 focused tests across the enabled lenses.`;
  }

  const regionLine = changedRegions?.length
    ? `\nChanged regions: \`${changedRegions.join("`, `")}\``
    : "";

  if (action === "LIGHTWEIGHT") {
    return `## Scope: LIGHTWEIGHT — ${reason}${regionLine}
Write 1-3 targeted tests. Focus only on what the classifier flagged:
- One smoke test confirming the page still loads and the changed element is present
- One test verifying the specific element renders correctly after the change
- Skip lenses that don't apply to this change type`;
  }

  return `## Scope: FULL QA — ${reason}${regionLine}
Write 4-8 focused tests covering the changed behavior. Cover all enabled lenses that apply.
Prioritise tests for the CHANGED regions — don't write tests for unrelated behavior.`;
};

// ─── Prompt builder ───────────────────────────────────────────────────────────

interface PromptInput {
  analysis: FileAnalysis;
  lenses: QaLens[];
  routes: string[];
  router: "app" | "pages" | "none";
  skillContext?: string | undefined;
  scanContext?: string | undefined;
  fileContext?: FileContext | undefined;
  agentSecurityContext?: string | undefined;
  diff?: string | undefined;
  fileStatus?: string | undefined;
  classificationAction?: string | undefined;
  classificationReason?: string | undefined;
  changedRegions?: string[] | undefined;
}

const buildPrompt = (input: PromptInput): string => {
  const { analysis, router } = input;

  const activeLenses = analysis.componentType === "server-action"
    ? [...new Set([...input.lenses, "security" as QaLens])]
    : input.lenses;

  const lensBlock = activeLenses
    .map((l) => `### ${l}\n${LENS_DESCRIPTIONS[l]}`)
    .join("\n\n");

  const routeBlock = input.routes.length > 0
    ? [
        `## Routes to test`,
        input.routes.map((r) => `- \`${r}\``).join("\n"),
        ``,
        `Navigate to each route above. Every \`test()\` must call \`page.goto()\` with one of these routes.`,
      ].join("\n")
    : [
        `## Route unknown`,
        `The component couldn't be traced to a specific route. Use \`page.goto("/")\` and adapt.`,
        `If you can infer the route from the source file path, use that instead.`,
      ].join("\n");

  const propsBlock = analysis.props.length > 0
    ? `**Props:** \`${analysis.props.join("`, `")}\` — use these to infer what the component renders`
    : "";
  const exportsBlock = analysis.exportedSymbols.length > 0
    ? `**Exports:** \`${analysis.exportedSymbols.join("`, `")}\``
    : "";

  const sections = [
    `You are a senior QA engineer writing Playwright tests against a LIVE running app in Chromium.`,
    ``,
    `## Quality bar — internalize before writing`,
    `- Tests must catch REAL bugs. A test that only calls \`toBeVisible()\` on a generic element catches nothing.`,
    `- **Name tests like user stories**: \`"user submits form and sees confirmation"\`, NOT \`"form test"\``,
    `- **Assert specific outcomes**: after every action, assert the RESULT — new text, URL change, element appearing/hiding`,
    `- **Read selectors from source code**: use the EXACT aria-labels, text content, and roles you see in the JSX below`,
    `- **One behaviour per test**: don't cram 5 assertions into one \`test()\` — split them`,
    `- Target ${input.classificationAction === "LIGHTWEIGHT" ? "1-3" : "4-8"} focused tests for this file`,
    ``,
    `## File: \`${analysis.filePath}\``,
    `- Component type: **${analysis.componentType}**${router !== "none" ? ` | Router: **${router}**` : ""}`,
    analysis.componentName ? `- Component name: **${analysis.componentName}**` : "",
    propsBlock,
    exportsBlock,
    ``,
    `## Source code — READ THIS CAREFULLY to derive selectors`,
    "```tsx",
    analysis.sourceText,
    "```",
    ``,
    routeBlock,
    ``,
    `## ${STRATEGY[analysis.componentType]}`,
    ``,
    buildDiffBlock(input.diff, input.fileStatus),
    buildChangeContextBlock(
      input.classificationAction,
      input.classificationReason,
      input.fileStatus,
      input.changedRegions,
    ),
    buildSecurityBlock(analysis, activeLenses, input.agentSecurityContext),
    input.fileContext?.summary ?? "",
    input.scanContext ? `## Project context\n${input.scanContext}` : "",
    input.skillContext ? `## Project skill file\n${input.skillContext}` : "",
    ``,
    `## Lenses — write at least one \`test()\` per lens`,
    `(Skip a lens only if it genuinely doesn't apply to this component type)`,
    ``,
    lensBlock,
    ``,
    `## Selector rules — the most common cause of bad tests`,
    ``,
    `**Rule 1 — Read selectors from source, never invent them**`,
    `The source code is above. Read it. Every \`getByRole()\`, \`getByText()\`, \`getByLabel()\` must`,
    `match exactly what's in the JSX — the actual aria-label string, the actual link text, the actual heading.`,
    ``,
    `**Rule 2 — Prefer accessible queries in this order:**`,
    `1. \`page.getByRole("button", { name: /label from source/i })\``,
    `2. \`page.getByLabel(/label text from source/i)\``,
    `3. \`page.getByText(/visible text from source/i)\``,
    `4. \`page.locator("semantic-tag")\` — only when no role/label exists in source`,
    ``,
    `**Rule 3 — HTML implicit roles:**`,
    `- \`<header>\` → role "banner" ONLY when direct child of \`<body>\`. If wrapped, use \`page.locator("header")\``,
    `- \`<nav>\` → role "navigation". If it has \`aria-label\`, include it: \`page.getByRole("navigation", { name: "Main" })\``,
    `- \`<main>\` → role "main". \`<footer>\` → role "contentinfo"`,
    ``,
    `**Rule 4 — CSS transforms are NOT visibility:**`,
    `Framer-motion, CSS transitions, and \`transform: translateY(-100%)\` do NOT affect \`toBeVisible()\`.`,
    `For scroll-hide/show patterns, use \`boundingBox()\`:`,
    `\`\`\`ts`,
    `const box = await page.locator("header").boundingBox();`,
    `expect(box?.y).toBeLessThan(0); // transformed off-screen`,
    `\`\`\``,
    ``,
    `**Rule 5 — Viewport and timing:**`,
    `- Set viewport BEFORE \`page.goto()\`: \`await page.setViewportSize({ width: 375, height: 667 })\``,
    `- After scroll or animation triggers: \`await page.waitForTimeout(300)\``,
    `- Use \`waitForLoadState("domcontentloaded")\` not "networkidle"`,
    ``,
    HARD_RULES,
  ];

  return sections.filter(Boolean).join("\n");
};

// ─── AI call ──────────────────────────────────────────────────────────────────

const callProvider = async (prompt: string, config: AiConfig): Promise<string> =>
  generate(config, prompt, { temperature: 0.2 });

// ─── Refine ───────────────────────────────────────────────────────────────────

export const refineTests = async (
  _originalTestCode: string,
  refinementPrompt: string,
  config: AiConfig,
): Promise<string> => {
  const raw = await callProvider(refinementPrompt, config);
  return extractCodeBlock(raw);
};

// ─── Public API ───────────────────────────────────────────────────────────────

export interface GenerateTestsOptions {
  diff?: string | undefined;
  fileStatus?: string | undefined;
  classificationAction?: string | undefined;
  classificationReason?: string | undefined;
  changedRegions?: string[] | undefined;
}

export const generateTests = async (
  analysis: FileAnalysis,
  config: QAgentConfig,
  lenses: QaLens[],
  routes: string[],
  cwd: string,
  scanContext?: string | undefined,
  router: "app" | "pages" | "none" = "none",
  fileContext?: FileContext | undefined,
  options: GenerateTestsOptions = {},
): Promise<GeneratedTests> => {
  const activeLenses = analysis.componentType === "server-action"
    ? [...new Set([...lenses, "security" as QaLens])]
    : lenses;

  const securityResult = activeLenses.includes("security")
    ? await runSecurityAnalysis(analysis, config.ai, cwd)
    : null;

  const prompt = buildPrompt({
    analysis,
    lenses: activeLenses,
    routes,
    router,
    skillContext: config.skillContext,
    scanContext,
    fileContext,
    agentSecurityContext: securityResult?.context,
    diff: options.diff,
    fileStatus: options.fileStatus,
    classificationAction: options.classificationAction,
    classificationReason: options.classificationReason,
    changedRegions: options.changedRegions,
  });

  const raw = await callProvider(prompt, config.ai);

  return {
    filePath: analysis.filePath,
    testCode: extractCodeBlock(raw),
    lenses: activeLenses,
    routes,
  };
};
