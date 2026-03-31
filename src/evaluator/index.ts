/**
 * Evaluator agent — grades Playwright test results and provides
 * actionable critique for the generator's refinement loop.
 *
 * Screenshot-aware: when tests fail, failure screenshots are described
 * to the AI alongside error messages for better diagnosis.
 */

import type { AiConfig } from "@/config/types";
import type { FileAnalysis } from "@/analyzer/index";
import { generate } from "@/providers/index";
import type { ChangeRegion } from "@/classifier/index";
import {
  type GradingCriterion,
  type EvaluationScore,
  type EvaluationResult,
  DEFAULT_CRITERIA,
  computeOverallScore,
  allCriteriaPassed,
  buildCriteriaPromptSection,
  buildCriteriaForRegions,
} from "./criteria";

// ─── Shared rules ─────────────────────────────────────────────────────────────

export const HARD_RULES = `## Hard rules — non-negotiable
- **Output a single \`\`\`ts code block and nothing else**
- Playwright only: \`import { test, expect } from "@playwright/test"\`
- Every \`test()\` must call \`page.goto(route)\` — use the route provided
- **Every action must be followed by an assertion of its OUTCOME** — not just re-checking the same element
- **Selectors come from the live probe snapshot and source code** — use the exact roles, names, and labels shown
- When a live probe snapshot is provided, treat it as the source of truth for what exists at each viewport
- Never invent selectors: no \`.my-class\`, no \`#some-id\`, no guessed aria-labels
- Query hierarchy: \`getByRole\` → \`getByLabel\` → \`getByText\` → \`page.locator("tag")\`
- \`waitForLoadState("domcontentloaded")\` after navigation — NOT "networkidle"
- NO vi.mock(), NO jest.mock(), NO mocks, NO jsdom, NO @testing-library, NO \`page.request.*\`, NO APIRequestContext
- **Locators that match by name/label become stale after interactions that change that name/label.**
  If you click a button \`{ name: "Open menu" }\` and it changes to \`"Close menu"\`, the original locator
  no longer matches. Use a STABLE locator for toggle elements — e.g. a CSS selector on an attribute
  that doesn't change: \`page.locator('button[aria-label]').first()\`, or re-query after the interaction:
  \`const closeBtn = page.getByRole("button", { name: "Close menu" })\`
- **Strict mode — NEVER let a locator match more than one element:**
  If your locator could match multiple elements, scope it:
  \`page.locator("header").first()\`  — when there are two
  \`page.locator("nav").filter({ hasText: /about/i })\`  — filter by content
  \`page.getByRole("img", { name: /logo/i }).first()\`  — first matching
- **Network guard is ALWAYS active — POST/PUT/PATCH/DELETE are blocked and will never complete:**
  NEVER assert success messages, confirmation text, redirects, or any outcome that requires a server response
  after a form submission or mutating action. The request is aborted — the server never replies.
  ✅ DO assert: validation messages ("required", "invalid email"), disabled/loading button states,
     error boundaries ("Something went wrong"), or the form's pre-submission state.
  ❌ NEVER assert: "Thank you", "Submitted", "Success", URL redirects, or any post-write UI state.`;

const SERVER_CALL_REGEX = /\b(?:page|context)\.request\b|\bAPIRequestContext\b/i;

// ─── Evaluator prompt ─────────────────────────────────────────────────────────

const buildEvaluatorPrompt = (
  testCode: string,
  sourceCode: string,
  filePath: string,
  componentType: string,
  criteria: readonly GradingCriterion[],
  failedTests?: Array<{ name: string; error?: string | undefined; screenshotPath?: string | undefined }>,
  previousCritique?: string | undefined,
  iteration?: number | undefined,
): string => {
  const criteriaSection = buildCriteriaPromptSection(criteria);

  // Grading rubric anchors — make explicit what earns high vs low scores
  const gradingAnchors = `## Grading anchors — be strict
A test scores HIGH (8-10) when:
- It asserts SPECIFIC text, counts, URLs, or values from the source code (not just toBeVisible())
- Each action is followed by an assertion of the actual OUTCOME (new element, URL change, text appearing)
- Selectors use getByRole/getByLabel/getByText with values read from the JSX
- Test names describe the user behavior: "user submits form and sees confirmation"

A test scores LOW (1-4) when:
- Assertions are only toBeVisible() or toBeEnabled() with no content check
- It clicks a button but only re-asserts the button is still there
- Selectors use CSS classes (.btn), IDs (#hero), or invented aria-labels not in the source
- Test names are generic: "test 1", "page loads", "component renders"`;

  const historyBlock = previousCritique
    ? `## Previous critique (iteration ${(iteration ?? 1) - 1}) — flag if issues persist
${previousCritique}`
    : "";

  const failureBlock = failedTests?.length
    ? `## Runtime failures — diagnose each before scoring
${failedTests.map((t) => {
  const screenshot = t.screenshotPath ? `\n  Screenshot saved: ${t.screenshotPath}` : "";
  return `**"${t.name}"**\n\`\`\`\n${t.error ?? "unknown error"}\n\`\`\`${screenshot}`;
}).join("\n\n")}

For each failure, determine:
- **network-blocked** — the test timed out waiting for an outcome that requires a server mutation (POST/PUT/PATCH/DELETE).
  The network guard blocks all mutating requests — the server never replies, so the expected text/redirect never appears.
  → Fix: replace success/confirmation assertions with client-side-only assertions:
    validation messages, disabled/loading buttons, error boundaries, or pre-submission form state.
  → NEVER assert "Thank you", "Submitted", "Success", or URL redirects after a button click.
- **selector-issue** — element exists in the app but the query doesn't match (wrong role, label, or text)
  → Fix: look at the source code and use the exact aria-label/text/role shown there
- **timing-issue** — element exists but wasn't awaited properly (missing waitForLoadState or waitForSelector)
  → Fix: add explicit wait before the assertion
- **real-bug** — the app genuinely doesn't behave as the test expects
  → Note this in fixSuggestions so the developer can investigate`
    : "";



  return `You are a strict QA evaluator for Playwright browser tests. Your job is to catch weak, shallow, or broken tests before they ship.

You are NOT generous. A test suite that only checks \`toBeVisible()\` on generic elements is NEARLY WORTHLESS and must score ≤ 4 on assertion-depth.

## Source under test: \`${filePath}\` (${componentType})
\`\`\`tsx
${sourceCode}
\`\`\`

## Test code to grade
\`\`\`ts
${testCode}
\`\`\`

${failureBlock}

${historyBlock}

${gradingAnchors}

## Criteria — score each 1-10
${criteriaSection}

Respond with a single JSON object (no markdown, no explanation outside the JSON):
{
  "scores": [
    { "criterion": "<name>", "score": <1-10>, "reasoning": "<one specific sentence referencing actual test or line>" }
  ],
  "critique": "<3-5 sentences. Name specific tests. Say exactly what's wrong and what good looks like. No vague praise.>",
  "fixSuggestions": [
    "<one concrete, actionable fix per issue — e.g. 'In test X, replace getByText(\"Click\") with getByRole(\"button\", { name: /submit/i }) from line 42 of source'>"
  ],
  "diagnosis": "<network-blocked | selector-issue | timing-issue | real-bug | mixed | pass>"
}`;
};

// ─── Response parser ──────────────────────────────────────────────────────────

const parseEvaluatorResponse = (
  raw: string,
  criteria: readonly GradingCriterion[],
  iteration: number,
): EvaluationResult => {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
  }

  try {
    const parsed = JSON.parse(cleaned) as {
      scores?: Array<{ criterion: string; score: number; reasoning: string }>;
      critique?: string;
      fixSuggestions?: string[];
      diagnosis?: string;
    };

    const criteriaMap = new Map(criteria.map((c) => [c.name, c]));

    const scores: EvaluationScore[] = (parsed.scores ?? []).map((s) => {
      const threshold = criteriaMap.get(s.criterion)?.threshold ?? 5;
      return {
        criterion: s.criterion,
        score: Math.max(1, Math.min(10, s.score)),
        reasoning: s.reasoning ?? "",
        passed: s.score >= threshold,
      };
    });

    const overall = computeOverallScore(scores, criteria);
    const passed = allCriteriaPassed(scores, criteria);

    // Combine critique + fix suggestions into a single actionable string
    // so the refinement prompt has concrete steps, not just prose criticism
    const fixLines = (parsed.fixSuggestions ?? []).filter(Boolean);
    const critique = [
      parsed.critique ?? "No critique provided.",
      fixLines.length > 0 ? `\nFixes needed:\n${fixLines.map((f) => `- ${f}`).join("\n")}` : "",
    ].filter(Boolean).join("");

    return { scores, overallScore: overall, passed, critique, iteration };
  } catch {
    return {
      scores: criteria.map((c) => ({
        criterion: c.name,
        score: 5,
        reasoning: "Evaluator response could not be parsed",
        passed: 5 >= c.threshold,
      })),
      overallScore: 5,
      passed: false,
      critique: "Evaluator response was not valid JSON. Regenerate tests.",
      iteration,
    };
  }
};

// ─── Public API ───────────────────────────────────────────────────────────────

export interface EvaluateTestsOptions {
  criteria?: readonly GradingCriterion[] | undefined;
  changedRegions?: ChangeRegion[] | undefined;
  failedTests?: Array<{ name: string; error?: string | undefined; screenshotPath?: string | undefined }> | undefined;
  previousCritique?: string | undefined;
  iteration?: number | undefined;
}

export const evaluateTests = async (
  testCode: string,
  analysis: FileAnalysis,
  aiConfig: AiConfig,
  options: EvaluateTestsOptions = {},
): Promise<EvaluationResult> => {
  const criteria =
    options.criteria ??
    (options.changedRegions ? buildCriteriaForRegions(options.changedRegions) : DEFAULT_CRITERIA);
  const iteration = options.iteration ?? 1;

  const prompt = buildEvaluatorPrompt(
    testCode,
    analysis.sourceText,
    analysis.filePath,
    analysis.componentType,
    criteria,
    options.failedTests,
    options.previousCritique,
    iteration,
  );

  const raw = await generate(aiConfig, prompt, { temperature: 0.1, jsonMode: true });
  return parseEvaluatorResponse(raw, criteria, iteration);
};

// ─── Refinement prompt ────────────────────────────────────────────────────────

export type RefinementKind = "quality" | "runtime";

export interface RefinementContext {
  testCode: string;
  sourceCode: string;
  filePath: string;
  route: string;
  kind: RefinementKind;
  iteration: number;
  evaluation?: EvaluationResult | undefined;
  failedTests?: Array<{ name: string; error?: string | undefined }> | undefined;
  previousCritique?: string | undefined;
}

export const buildRefinementPrompt = (ctx: RefinementContext): string => {
  const sections: string[] = [
    `You wrote Playwright tests for \`${ctx.filePath}\` (route: \`${ctx.route}\`).`,
    `Iteration ${ctx.iteration} — fix the specific issues below. Do NOT rewrite from scratch.`,
    `Do NOT change tests that are currently passing.`,
    "",
    `## Source code — re-read to find correct selectors`,
    "```tsx",
    ctx.sourceCode,
    "```",
    "",
    `## Your current test code`,
    "```ts",
    ctx.testCode,
    "```",
    "",
  ];

  const usesServerRequests = SERVER_CALL_REGEX.test(ctx.testCode);
  if (usesServerRequests) {
    sections.push(
      "## Remove direct server/API requests",
      "These tests call page.request.* or APIRequestContext. qagent only validates DOM-level regressions.",
      "Replace every direct HTTP request with the real user flow: click the buttons, fill the inputs, and assert DOM changes.",
      "Example:",
      "```ts",
      "// ❌ Bad",
      'const res = await page.request.get("/api/data");',
      "expect(res.status()).toBe(200);",
      "",
      "// ✅ Good",
      'await page.goto("/dashboard");',
      'await page.getByRole("button", { name: /refresh/i }).click();',
      'await expect(page.getByRole("row", { name: /invoice/i })).toBeVisible();',
      "```",
      "Do not move on until every server call is deleted.",
      "",
    );
  }

  // Animation / CSS-transition timing detection
  // If any failing test timed out while asserting a UI element that likely lives
  // behind an animation (menu, drawer, dialog, accordion, tab), inject concrete
  // wait guidance — the generic timeout fix never surfaces this root cause.
  const ANIMATION_TRIGGER_RE = /menu|drawer|modal|dialog|accordion|tab|collapse|slide|fade|dropdown/i;
  const animationFailed = ctx.failedTests?.some((t) => {
    const isTimeout = /TimeoutError|waiting for|locator\.nth|toBeVisible|toHaveAttribute/i.test(t.error ?? "");
    const targetIsAnimated = ANIMATION_TRIGGER_RE.test(t.name) || ANIMATION_TRIGGER_RE.test(ctx.testCode);
    return isTimeout && targetIsAnimated;
  }) ?? false;

  if (animationFailed) {
    sections.push(
      "## Animation / CSS transition timing",
      "One or more failures are most likely animation race conditions — the assertion ran before",
      "the element finished entering. This is common with CSS transitions, JS-driven show/hide",
      "that doesn't update aria-hidden synchronously, and animated component libraries.",
      "",
      "Fix pattern — wait for the element to be stable BEFORE asserting it:",
      "```ts",
      "// After clicking a trigger that starts an animation:",
      "await page.getByRole('button', { name: /open menu/i }).click();",
      "// Wait for the animated element to reach its final visible state",
      "await page.waitForSelector('[data-state=\"open\"], [aria-expanded=\"true\"], nav.open', { state: 'visible' });",
      "// OR wait for a known child element inside the animated container:",
      "await page.waitForSelector('nav a[href=\"/contact\"]', { state: 'visible' });",
      "// THEN assert",
      "await expect(page.getByRole('link', { name: /contact/i })).toBeVisible();",
      "```",
      "If the component uses a JS animation library or custom CSS transition, there is no reliable",
      "aria signal during the animation — use waitForSelector with a short timeout (2000ms)",
      "targeting the final DOM state (e.g. a data-attribute, aria-expanded, or a child element).",
      "",
    );
  }

  // Runtime failures — most actionable signal
  if (ctx.kind === "runtime" && ctx.failedTests?.length) {
    sections.push(`## ${ctx.failedTests.length} test(s) failing at runtime — fix these first`);
    for (const t of ctx.failedTests) {
      const msg = t.error?.slice(0, 600) ?? "unknown error";
      const isStrictMode   = msg.includes("strict mode violation") || msg.includes("resolved to");
      const isTimeout      = msg.includes("TimeoutError") || msg.includes("waiting for");

      // Detect network-blocked: timeout + test code contains success/confirmation assertions
      // after a click — this is the "guard blocked the POST, success message never appeared" pattern
      const hasSubmitClick = ctx.testCode.includes(".click(") || ctx.testCode.includes(".click()");
      const hasSuccessAssert = /success|thank.you|submitted|confirmed|redirect/i.test(ctx.testCode);
      const isNetworkBlocked = isTimeout && hasSubmitClick && hasSuccessAssert;

      // Extract what the locator was, e.g. "locator('header') resolved to 2 elements"
      const strictMatch = msg.match(/locator\(([^)]+)\)\s+resolved to (\d+) elements/);
      const locatorStr  = strictMatch ? strictMatch[1] : null;
      const countStr    = strictMatch ? strictMatch[2] : null;

      sections.push(`### ❌ "${t.name}"`, "```", msg, "```", "");

      if (isNetworkBlocked) {
        sections.push(
          `**Fix — network-blocked (POST/PUT/PATCH/DELETE are aborted by the network guard):**`,
          `The test timed out because it asserted an outcome that requires a server response (e.g. success message,`,
          `redirect, confirmation text). The network guard blocks all mutating requests — the server never replies.`,
          ``,
          `Replace every success/confirmation assertion with a client-side-only assertion:`,
          `\`\`\``,
          `// ❌ Remove — server never replies, this will always timeout:`,
          `// await expect(page.getByText(/success|thank you|submitted/i)).toBeVisible();`,
          ``,
          `// ✅ Replace with — assert client-side validation or error state instead:`,
          `await page.getByRole("button", { name: /submit/i }).click();`,
          `// Option A: assert validation fires (empty required field)`,
          `await expect(page.getByText(/required|please fill|invalid/i)).toBeVisible();`,
          `// Option B: assert button becomes disabled/loading`,
          `await expect(page.getByRole("button", { name: /submit/i })).toBeDisabled();`,
          `// Option C: assert error boundary on blocked write`,
          `await expect(page.getByText(/error|unavailable|try again/i)).toBeVisible();`,
          `\`\`\``,
          `Pick the option that matches what the source code actually renders on validation failure.`,
          "",
        );
      } else if (isStrictMode) {
        sections.push(
          `**Fix — strict mode violation${locatorStr ? ` on ${locatorStr}` : ""}:**`,
          `Your selector matched ${countStr ?? "multiple"} elements. Responsive layouts duplicate elements (desktop + mobile hidden via CSS).`,
          `Choose the fix that matches what you see in the source code above:`,
          `- Scope to first visible: \`page.locator("header").first()\``,
          `- Filter by content: \`page.locator("nav").filter({ hasText: /specific text/i })\``,
          `- Use a unique parent: \`page.locator("#desktop-nav a", { hasText: /about/i })\``,
          `- For images: \`page.getByRole("img", { name: /logo/i }).first()\``,
          `Re-read the JSX above — find an attribute or wrapper that exists on only ONE of the duplicates and use that.`,
          "",
        );
      } else if (isTimeout) {
        // Check if this looks like a stale locator after toggle (common pattern)
        const isToggleStale = msg.includes("toHaveAttribute") && (msg.includes("aria-label") || msg.includes("aria-expanded"));
        if (isToggleStale) {
          sections.push(
            `**Fix — stale locator after toggle interaction:**`,
            `Your locator matches by name/label (e.g. \`{ name: "Open menu" }\`). After clicking, the label changes`,
            `to "Close menu" — the original locator no longer finds any element, so the assertion times out.`,
            `Fix: re-query with the NEW name after the click:`,
            `\`\`\``,
            `await page.getByRole("button", { name: "Open menu" }).click();`,
            `const closeBtn = page.getByRole("button", { name: "Close menu" });`,
            `await expect(closeBtn).toHaveAttribute("aria-label", "Close menu");`,
            `\`\`\``,
            "",
          );
        } else {
          sections.push(
            `**Fix — selector not found or element not visible:**`,
            `1. Check the live probe snapshot (if provided) — is this element listed at this viewport?`,
            `2. Re-read the source code above and find the exact aria-label, role, or text content`,
            `3. Check the route — does \`${ctx.route}\` actually render this component?`,
            `4. If the element only exists at a certain viewport, call \`page.setViewportSize()\` BEFORE \`page.goto()\``,
            `5. If the element appears after interaction, add a \`waitFor\` before the assertion`,
            "",
          );
        }
      } else {
        sections.push(
          `**Fix:**`,
          `1. If the error is a selector mismatch — re-read the source code and use exact text/role/label`,
          `2. If it's an app error (404, crash) — adjust the assertion to match what the app actually shows`,
          "",
        );
      }
    }
  }

  // Evaluator quality feedback
  if (ctx.evaluation) {
    const failed = ctx.evaluation.scores.filter((s) => !s.passed);
    const passed = ctx.evaluation.scores.filter((s) => s.passed);

    if (failed.length > 0) {
      sections.push(`## Quality issues to fix (scored below threshold):`);
      for (const s of failed) {
        sections.push(`- **${s.criterion}** scored ${s.score}/10: ${s.reasoning}`);
      }
      sections.push("");
    }

    if (passed.length > 0) {
      sections.push(`## Already passing — do NOT regress these:`);
      for (const s of passed) {
        sections.push(`- **${s.criterion}** (${s.score}/10) ✓`);
      }
      sections.push("");
    }

    sections.push(`## Evaluator critique and specific fixes:`, ctx.evaluation.critique, "");
  } else if (ctx.previousCritique) {
    sections.push(`## Previous critique (iteration ${ctx.iteration - 1}):`, ctx.previousCritique, "");
  }

  sections.push(
    `## Refinement rules`,
    `- Fix ONLY the failing tests and the quality issues listed above`,
    `- Preserve every passing test exactly as-is`,
    `- For selector fixes: look up the correct value in the source code above — do not guess`,
    `- For assertion depth fixes: replace bare \`toBeVisible()\` with \`toContainText()\`, \`toHaveValue()\`, or \`toHaveURL()\``,
    `- For test naming fixes: rename to a user-story format: "user does X and sees Y"`,
    "",
    HARD_RULES,
  );

  return sections.join("\n");
};

export { DEFAULT_CRITERIA, type GradingCriterion, type EvaluationScore, type EvaluationResult } from "./criteria";
