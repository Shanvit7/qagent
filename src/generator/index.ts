/**
 * Playwright test generator — AI builds browser-based test code
 * for routes that render changed components.
 */

import type { FileAnalysis, ComponentType } from "@/analyzer/index";
import type { AiConfig, QAgentConfig } from "@/config/types";

// All lenses — always available internally, filtered by region at generation time
type QaLens = "render" | "interaction" | "state" | "edge-cases" | "security";
const ALL_LENSES: QaLens[] = ["render", "interaction", "state", "edge-cases", "security"];
import type { FileContext } from "@/context/index";
import { runSecurityAnalysis } from "@/agent/security";
import { generate } from "@/providers/index";
import { HARD_RULES } from "@/evaluator/index";

export interface GeneratedTests {
  filePath: string;
  testCode: string;
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
  - **Rapid clicks**: click a button 3× quickly — assert no duplicate submissions or broken UI
  - **Animation settle**: instead of \`page.waitForTimeout()\`, use \`await page.locator("header").waitFor({ state: "hidden" })\` or \`await expect(locator).toBeHidden()\` — Playwright auto-waits on locator assertions`,

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
await expect(page.locator("header")).toBeHidden(); // auto-waits for animation
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
  lenses: readonly QaLens[],
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

import type { ChangeRegion } from "@/classifier/index";

// ─── Selector rules (shared between generate + refine prompts) ────────────────

const SELECTOR_RULES = `## Selector rules

**Rule 1 — Read from source, never invent**
Every \`getByRole()\`, \`getByText()\`, \`getByLabel()\` must match the EXACT aria-label, link text, or heading in the JSX above.

**Rule 2 — Query hierarchy**
1. \`page.getByRole("button", { name: /exact label from source/i })\`
2. \`page.getByLabel(/label text/i)\`
3. \`page.getByText(/visible text/i)\`
4. \`page.locator("semantic-tag")\` — only when no role/label exists

**Rule 3 — HTML roles**
- \`<header>\` → role "banner" only when direct child of \`<body>\`. Otherwise \`page.locator("header").first()\`
- \`<nav aria-label="X">\` → \`page.getByRole("navigation", { name: "X" })\`

**Rule 4 — CSS transforms are NOT visibility**
\`transform: translateY(-100%)\` does NOT affect \`toBeVisible()\`.
For elements moved off-screen by CSS/animation, check position with \`boundingBox()\`:
\`expect((await page.locator("header").boundingBox())?.y).toBeLessThan(0)\`

**Rule 5 — Read the source for visibility signals**
Before asserting hidden/visible state on any element, read how the source ACTUALLY hides it:
- Is it \`display:none\`? → \`toBeHidden()\` works
- Is it a CSS class toggle (\`hidden\`, \`invisible\`)? → check the class or use \`boundingBox()\`
- Is it an attribute like \`aria-hidden\` or \`inert\`? → \`toHaveAttribute("aria-hidden", "true")\`
- Is it a CSS transform? → \`boundingBox()\`
Do not assume \`toBeVisible()\` / \`toBeHidden()\` work — check the source first.

**Rule 6 — Viewport before navigation**
If the element you're testing is only visible at a specific breakpoint (e.g. a mobile menu, a sidebar),
set the viewport BEFORE \`page.goto()\`:
\`await page.setViewportSize({ width: 390, height: 844 }); // mobile\`
Read the source for responsive classes (\`md:hidden\`, \`lg:flex\`, etc.) to know which viewport to use.`;

// Maps classifier regions to plain-English test focus hints.
const REGION_FOCUS: Partial<Record<ChangeRegion, string>> = {
  "function-body":  "Focus on the component's primary behavior and user interactions",
  "hook-deps":      "Focus on state transitions, async updates, and side-effect outcomes",
  "server-action":  "Focus on form submission, success/error states, and redirects",
  "jsx-markup":     "Focus on element presence, text content, and structure",
  "jsx-styling":    "Focus on visibility — confirm elements still render and are reachable",
  "jsx-cosmetic":   "One smoke test — confirm the page loads and key elements are visible",
  "props":          "Focus on how the new/changed prop affects rendered output",
  "types":          "One smoke test — type change shouldn't affect browser behavior",
  "imports":        "One smoke test — verify the page still loads after the import change",
  "exports":        "One smoke test — verify the component still renders correctly",
};

// Which lenses are relevant for each changed region.
// A className-only change doesn't need interaction/state/edge-cases tests.
const REGION_LENS_MAP: Partial<Record<ChangeRegion, QaLens[]>> = {
  "imports":            ["render"],
  "exports":            ["render"],
  "types":              ["render"],
  "props":              ["render", "state"],
  "jsx-styling":        ["render"],
  "jsx-cosmetic":       ["render"],
  "jsx-markup":         ["render", "interaction"],
  "conditional-render": ["render", "state"],
  "event-handler":      ["interaction", "edge-cases"],
  "async-logic":        ["state", "edge-cases"],
  "function-body":      ["render", "interaction", "state", "edge-cases"],
  "hook-deps":          ["state", "interaction", "edge-cases"],
  "server-action":      ["interaction", "state", "security"],
};

const filterLensesToRegions = (lenses: QaLens[], regions: ChangeRegion[]): QaLens[] => {
  const allowed = new Set<QaLens>();
  for (const region of regions) {
    for (const lens of REGION_LENS_MAP[region] ?? lenses) {
      allowed.add(lens);
    }
  }
  // Keep only lenses the user has enabled
  return lenses.filter((l) => allowed.has(l));
};

const buildRegionScopeHint = (regions: ChangeRegion[]): string => {
  // Pick the highest-signal region (first match in priority order)
  const priority: ChangeRegion[] = [
    "server-action", "hook-deps", "function-body",
    "jsx-markup", "props", "jsx-styling", "jsx-cosmetic",
    "types", "exports", "imports",
  ];
  const dominant = priority.find((r) => regions.includes(r));
  const hint = dominant ? REGION_FOCUS[dominant] : null;
  return hint ? `Focus hint: ${hint}.` : "";
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

  // Derive a focused instruction from the changed regions so the AI doesn't
  // test the whole component when only a slice of it changed.
  const regionScope = changedRegions?.length
    ? buildRegionScopeHint(changedRegions as ChangeRegion[])
    : null;

  return `## Scope: FULL QA — ${reason}${regionLine}
Write 3-5 focused tests. **Test ONLY the changed behavior — not the whole component.**
${regionScope ? regionScope + "\n" : ""}Cover each enabled lens that applies to the changed region. Skip lenses for code that did NOT change.`;
};

// ─── Prompt builder ───────────────────────────────────────────────────────────

interface PromptInput {
  analysis: FileAnalysis;
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
  const isNewFile = input.fileStatus === "A";
  const hasDiff   = !!input.diff?.trim() && !isNewFile;

  // Server actions always get security lens
  const activeLenses: QaLens[] = analysis.componentType === "server-action"
    ? [...new Set([...ALL_LENSES, "security" as QaLens])]
    : ALL_LENSES;

  // For modified files filter to only lenses relevant to what changed.
  // New files and unknown regions get all lenses.
  const relevantLenses = hasDiff && input.changedRegions?.length
    ? filterLensesToRegions(activeLenses, input.changedRegions as ChangeRegion[])
    : activeLenses;

  const lensBlock = relevantLenses
    .map((l) => `### ${l}\n${LENS_DESCRIPTIONS[l]}`)
    .join("\n\n");

  const routeStr = input.routes.length > 0
    ? input.routes.map((r) => `\`${r}\``).join(", ")
    : `\`/\` (inferred)`;

  const propsBlock = analysis.props.length > 0
    ? `**Props:** \`${analysis.props.join("`, `")}\``
    : "";

  // ── New file: cover the whole component ──────────────────────────────────
  if (isNewFile) {
    return [
      `You are a senior QA engineer writing Playwright tests for a LIVE app running in Chromium.`,
      ``,
      `## New file — full coverage`,
      `Route: ${routeStr} | Component: **${analysis.componentName ?? analysis.filePath}** (${analysis.componentType})`,
      propsBlock,
      ``,
      `## Source code — read carefully, derive every selector from this`,
      "```tsx",
      analysis.sourceText,
      "```",
      ``,
      `## ${STRATEGY[analysis.componentType]}`,
      ``,
      buildSecurityBlock(analysis, activeLenses, input.agentSecurityContext),
      input.fileContext?.summary ?? "",
      input.scanContext ? `## Project context\n${input.scanContext}` : "",
      input.skillContext ? `## Project skill file\n${input.skillContext}` : "",
      ``,
      `## Test goals — write 4-6 tests covering these lenses`,
      lensBlock,
      ``,
      SELECTOR_RULES,
      ``,
      HARD_RULES,
    ].filter(Boolean).join("\n");
  }

  // ── Modified file: delta-first ────────────────────────────────────────────
  // Lead with WHAT CHANGED so the AI derives test scope from the diff,
  // not from a broad "cover all lenses" instruction.
  const changeContext = buildChangeContextBlock(
    input.classificationAction,
    input.classificationReason,
    input.fileStatus,
    input.changedRegions,
  );

  const testCountHint = input.classificationAction === "LIGHTWEIGHT"
    ? "Write **1-2 tests** that directly cover this change. No more."
    : `Write **2-4 tests** focused on the changed behavior. Do NOT write tests for parts of the component that did not change.`;

  return [
    `You are a senior QA engineer writing Playwright tests for a LIVE app running in Chromium.`,
    ``,
    `## What changed`,
    buildDiffBlock(input.diff, input.fileStatus),
    changeContext,
    ``,
    `## Your task`,
    testCountHint,
    `Ask yourself: "What user-visible behavior could this diff break?" — write tests for THAT, nothing else.`,
    ``,
    `## File: \`${analysis.filePath}\``,
    `Route: ${routeStr} | Component: **${analysis.componentName ?? analysis.filePath}** (${analysis.componentType})`,
    propsBlock,
    ``,
    `## Source code — read carefully, derive every selector from this`,
    "```tsx",
    analysis.sourceText,
    "```",
    ``,
    `## ${STRATEGY[analysis.componentType]}`,
    ``,
    buildSecurityBlock(analysis, activeLenses, input.agentSecurityContext),
    input.fileContext?.summary ?? "",
    input.scanContext ? `## Project context\n${input.scanContext}` : "",
    input.skillContext ? `## Project skill file\n${input.skillContext}` : "",
    relevantLenses.length > 0
      ? `## Relevant lenses for this change\n${lensBlock}`
      : "",
    ``,
    SELECTOR_RULES,
    ``,
    HARD_RULES,
  ].filter(Boolean).join("\n");
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
  routes: string[],
  cwd: string,
  scanContext?: string | undefined,
  router: "app" | "pages" | "none" = "none",
  fileContext?: FileContext | undefined,
  options: GenerateTestsOptions = {},
): Promise<GeneratedTests> => {
  // Security agent runs when the component type warrants it — no user config needed
  const needsSecurity = analysis.componentType === "server-action" || analysis.securityFindings.length > 0;
  const securityResult = needsSecurity
    ? await runSecurityAnalysis(analysis, config.ai, cwd)
    : null;

  const prompt = buildPrompt({
    analysis,
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
    routes,
  };
};
