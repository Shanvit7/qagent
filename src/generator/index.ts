/**
 * Playwright test generator — AI builds browser-based test code
 * for routes that render changed components.
 */

import type { FileAnalysis, ComponentType } from "@/analyzer/index";
import type { AiConfig, QAgentConfig } from "@/config/types";

// All lenses — always available internally, filtered by region at generation time
type QaLens = "render" | "interaction" | "state" | "edge-cases" | "security";
const ALL_LENSES: QaLens[] = ["render", "interaction", "state", "edge-cases", "security"];
import type { RuntimeProbe } from "@/probe/index";
import { formatProbeForPrompt } from "@/probe/index";
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
  render: `**Render** — the page loads and the user sees meaningful content.
  - Navigate to the route, wait for \`domcontentloaded\`
  - Assert a specific heading, landmark, or content element the user would actually see
  - Assert no error boundary text ("Something went wrong", "Error:", "500") is visible
  - Use elements from the live probe snapshot or source — never assert \`body\` or \`html\``,

  interaction: `**Interaction** — a user can complete the primary action this component enables.
  - Frame as a user goal: "user opens menu", "user submits form", "user selects option"
  - Use the interaction outcomes from the live probe snapshot to know the exact before/after locators
  - Assert the USER-VISIBLE OUTCOME: something new appears, URL changes, content updates
  - If the probe shows a button changes name after click (e.g. "Open menu" → "Close menu"),
    re-query with the NEW name: \`page.getByRole("button", { name: "Close menu" })\`
  - Never assert implementation details (CSS classes, aria attributes for their own sake)`,

  state: `**State** — async data loads and error states are handled gracefully.
  - If the component fetches data: assert the loaded content (list items, user name, prices)
  - If there's a loading state: navigate and assert the spinner appears then content loads
  - If there's an error state: assert a human-readable message, not a stack trace`,

  "edge-cases": `**Edge cases** — the user flow works across contexts.
  - Mobile viewport: set \`page.setViewportSize()\` matching the probe snapshot viewport where the element appears
  - Keyboard: Tab through interactive elements and assert focus is visible
  - Back navigation: navigate away and back, assert content is restored`,

  security: `**Security** — protected routes are inaccessible without auth, forms validate correctly.
  - Navigate without session — assert redirect or 401
  - Submit form with empty required fields — assert validation message, no submission
  - Assert no raw secrets/tokens visible in the DOM`,
};

// ─── Component-type strategy blocks ──────────────────────────────────────────
// Each strategy maps the component type to the correct Playwright approach + concrete assertions.

const STRATEGY_DEFAULT: Record<ComponentType, string> = {
  "client-component": `**Strategy: Client component**
Navigate to the route. The component is hydrated — test initial render AND interactions.
\`\`\`ts
await page.goto("/route");
await page.waitForLoadState("domcontentloaded");
// Assert specific visible content from the SOURCE (not generic "body")
await expect(page.getByRole("heading", { name: /actual heading text/i })).toBeVisible();
// Test interactive elements — assert the client-side OUTCOME of the action
// e.g. toggle open → assert the toggled element is visible
// e.g. fill form → assert validation message (NOT success — writes are blocked)
await page.getByRole("button", { name: /open|toggle|show/i }).click();
await expect(page.getByRole("dialog")).toBeVisible(); // or whatever the source shows
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

  "api-route": `**Strategy: API route (front-end regression)**
These files power the UI, but qagent NEVER hits endpoints directly.
- Navigate to the route(s) listed above that consume this API
- Trigger the UI that would call the API (click "Refresh", search, filter, etc.)
- Assert what the user sees before and after the interaction: skeletons, empty states, hydrated data
- Simulate failures by asserting fallback copy or inline errors that already render client-side
- **Never** use Playwright's request context, custom fetch helpers, or \`page.request.*\`
\`\`\`ts
await page.goto("/dashboard");
await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
await page.getByRole("button", { name: "Refresh invoices" }).click();
await expect(page.getByRole("row", { name: /invoice #/i })).toBeVisible();
\`\`\``,

  "server-action": `**Strategy: Server action**
Writes are blocked by the network guard. Test ONLY client-side behavior: validation, field states, error boundaries.
\`\`\`ts
await page.goto("/route-with-form");
await page.waitForLoadState("domcontentloaded");

// Test 1: required-field validation — submit empty form, assert client message
await page.getByRole("button", { name: /submit/i }).click();
await expect(page.getByText(/required|please fill|cannot be empty/i)).toBeVisible();

// Test 2: inline field validation — fill invalid value, assert error
await page.getByLabel(/email/i).fill("not-an-email");
await page.getByRole("button", { name: /submit/i }).click();
await expect(page.getByText(/invalid email|valid email/i)).toBeVisible();
\`\`\`
DO NOT assert success messages, "Thank you", "Submitted", redirects, or any text that requires a server reply.`,

  "hook": `**Strategy: Custom hook**
Hooks have no UI — test through the page that uses them. Find the route that renders a component using this hook.
\`\`\`ts
await page.goto("/route-using-hook");
await page.waitForLoadState("domcontentloaded");
// Test the USER-VISIBLE BEHAVIOR the hook enables
// e.g. if the hook manages scroll → scroll the page and assert the visual outcome
// e.g. if the hook manages form state → fill inputs and assert the result
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

**Rule 1 — Use the live probe snapshot as primary source**
When a live probe snapshot is provided above, use the exact \`getByRole\` / \`getByLabel\` locators listed there.
If an element appears in one viewport but not another, set the matching viewport BEFORE \`page.goto()\`.

**Rule 2 — Fall back to source code when no probe is available**
Read the JSX and extract exact aria-labels, roles, and text content. Never invent selectors.

**Rule 3 — Query hierarchy**
1. \`page.getByRole("button", { name: /exact label/i })\`
2. \`page.getByLabel(/label text/i)\`
3. \`page.getByText(/visible text/i)\`
4. \`page.locator("semantic-tag")\` — only when no role/label exists

**Rule 4 — No Tailwind classes in selectors**
CSS selectors cannot contain \`/\`. Tailwind opacity classes like \`text-primary/50\` or \`bg-muted/20\` CRASH the selector engine.
Never use \`.locator('tag.tw-class/opacity')\`. Use \`getByRole\`, \`getByText\`, or parent scoping instead.

**Rule 5 — HTML roles**
- \`<header>\` → role "banner" only when direct child of \`<body>\`. Otherwise \`page.locator("header").first()\`
- \`<nav aria-label="X">\` → \`page.getByRole("navigation", { name: "X" })\``;

const NETWORK_GUARD_BLOCK = `## Front-end regression guard — ALWAYS active
qagent validates DOM and interaction regressions only. Network writes and Playwright's request context are blocked.

Rules:
- NEVER use \`page.request.*\`, custom fetch helpers, or APIRequestContext — stay inside the browser page
- POST, PUT, PATCH, DELETE are blocked — the server never receives or replies to them
- NEVER assert success messages, confirmation text, or redirects after a form submit or mutating click
- NEVER use \`waitForResponse()\`, \`waitForRequest()\`, or \`waitForNavigation()\` tied to a mutation
- DO assert client-side validation, inline errors, disabled/loading states, or unchanged forms
- Focus on what the user sees before and after the interaction — that's the regression surface
- Any assertion that depends on a backend reply will time out — remove it
`;

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
  /** Live page snapshot captured before generation — ground truth for selectors */
  runtimeProbe?: RuntimeProbe | undefined;
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

  // ── Runtime probe — live page ground truth (takes priority over source analysis) ──
  const probeBlock = input.runtimeProbe
    ? formatProbeForPrompt(input.runtimeProbe)
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
      probeBlock,
      NETWORK_GUARD_BLOCK,
      `## ${STRATEGY_DEFAULT[analysis.componentType]}`,
      ``,
      buildSecurityBlock(analysis, activeLenses, input.agentSecurityContext),
      input.fileContext?.summary ?? "",
      input.scanContext ? `## Project context\n${input.scanContext}` : "",
      input.skillContext ? `## Project skill file\n${input.skillContext}` : "",
      ``,
      `## Test goals — write 2-4 behavioral regression tests`,
      `Each test should answer: "can a user still complete this action after the change?"`,
      `Frame tests as user goals, not component inspection.`,
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

  const lightweightIsInteractive = (input.changedRegions ?? []).some((r) =>
    ["event-handler", "hook-deps", "server-action", "jsx-markup"].includes(r),
  );
  const testCountHint = input.classificationAction === "LIGHTWEIGHT"
    ? lightweightIsInteractive
      ? "Write **2 focused tests**: one smoke test (page loads, element visible) and one interaction test (the changed behavior still works). No more than 2."
      : "Write **1 test** that directly verifies the changed behavior still works for a user. No more."
    : `Write **2-3 behavioral regression tests**. Each answers: "can a user still do X after this change?" Test the flow, not the implementation.`;

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
    probeBlock,
    NETWORK_GUARD_BLOCK,
    `## ${STRATEGY_DEFAULT[analysis.componentType]}`,
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
  generate(config, prompt, { temperature: 0 });

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
  /** Live page snapshot — when provided, used as ground truth for selectors */
  runtimeProbe?: RuntimeProbe | undefined;
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
    runtimeProbe: options.runtimeProbe,
  });

  const raw = await callProvider(prompt, config.ai);

  return {
    filePath: analysis.filePath,
    testCode: extractCodeBlock(raw),
    routes,
  };
};

export const __testables = {
  buildPrompt,
  STRATEGY_DEFAULT,
  NETWORK_GUARD_BLOCK,
  SELECTOR_RULES,
};
