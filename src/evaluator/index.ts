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
- NO vi.mock(), NO jest.mock(), NO mocks, NO jsdom, NO @testing-library
- **Locators that match by name/label become stale after interactions that change that name/label.**
  If you click a button \`{ name: "Open menu" }\` and it changes to \`"Close menu"\`, the original locator
  no longer matches. Use a STABLE locator for toggle elements — e.g. a CSS selector on an attribute
  that doesn't change: \`page.locator('button[aria-label]').first()\`, or re-query after the interaction:
  \`const closeBtn = page.getByRole("button", { name: "Close menu" })\`
- **Strict mode — NEVER let a locator match more than one element:**
  If your locator could match multiple elements, scope it:
  \`page.locator("header").first()\`  — when there are two
  \`page.locator("nav").filter({ hasText: /about/i })\`  — filter by content
  \`page.getByRole("img", { name: /logo/i }).first()\`  — first matching`;

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
  "diagnosis": "<selector-issue | timing-issue | real-bug | mixed | pass>"
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

  // Runtime failures — most actionable signal
  if (ctx.kind === "runtime" && ctx.failedTests?.length) {
    sections.push(`## ${ctx.failedTests.length} test(s) failing at runtime — fix these first`);
    for (const t of ctx.failedTests) {
      const msg = t.error?.slice(0, 600) ?? "unknown error";
      const isStrictMode   = msg.includes("strict mode violation") || msg.includes("resolved to");
      const isTimeout      = msg.includes("TimeoutError") || msg.includes("waiting for");

      // Extract what the locator was, e.g. "locator('header') resolved to 2 elements"
      const strictMatch = msg.match(/locator\(([^)]+)\)\s+resolved to (\d+) elements/);
      const locatorStr  = strictMatch ? strictMatch[1] : null;
      const countStr    = strictMatch ? strictMatch[2] : null;

      sections.push(`### ❌ "${t.name}"`, "```", msg, "```", "");

      if (isStrictMode) {
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
