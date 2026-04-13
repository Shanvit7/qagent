/**
 * Test pre-classifier — structural analysis of generated Playwright test code.
 *
 * Runs before the LLM evaluator to catch hard failures for free (no AI call).
 * Issues are categorised as hard-fail (block the evaluator, go straight to
 * refinement) or warnings (pass through but inject hints into the prompt).
 */

import type { ChangeRegion } from '@/classifier/index';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PreCheckIssue =
  | 'no-goto' // no page.goto() call
  | 'shallow-assertions' // only toBeVisible(), no content checks
  | 'css-selectors' // .class / #id / [data-testid] selectors present
  | 'flaky-timeout' // waitForTimeout() present
  | 'no-tests' // zero test() blocks
  | 'missing-interaction'; // event-handler region but no .click()/.fill()

export interface PreCheckResult {
  /** True when no hard-fail issues exist (warnings are still surfaced). */
  passed: boolean;
  /** Issues detected, in order of severity. */
  issues: PreCheckIssue[];
  /**
   * Terse fix-prompt string ready to inject into the refinement prompt.
   * Empty string when passed is true and issues is empty.
   */
  feedback: string;
}

// ─── Hard-fail vs. warning classification ────────────────────────────────────

const HARD_FAIL_ISSUES = new Set<PreCheckIssue>(['no-tests', 'no-goto']);

// ─── Detectors ────────────────────────────────────────────────────────────────

const hasTestBlocks = (code: string): boolean => /\btest\s*\(/.test(code);

const hasPageGoto = (code: string): boolean => /\bpage\.goto\s*\(/.test(code);

const hasOnlyVisibilityAssertions = (code: string): boolean => {
  // Count all expect(...).to* calls
  const assertCalls = code.match(/\.to[A-Z][A-Za-z]+\s*\(/g) ?? [];
  if (assertCalls.length === 0) return false;
  const deepAssertions = assertCalls.filter(
    (a) => !/\.toBeVisible\s*\(|\.toBeEnabled\s*\(|\.toBeDisabled\s*\(|\.toBeChecked\s*\(/.test(a),
  );
  return deepAssertions.length === 0;
};

const hasCssSelectors = (code: string): boolean =>
  /page\.locator\s*\(\s*['"`][.#]/.test(code) || /\[data-testid/.test(code);

const hasFlakyTimeout = (code: string): boolean => /waitForTimeout\s*\(/.test(code);

const hasMissingInteraction = (code: string): boolean =>
  !/\.(?:click|fill|check|uncheck|selectOption|press|tap)\s*\(/.test(code);

// ─── Feedback strings ─────────────────────────────────────────────────────────

const FEEDBACK: Record<PreCheckIssue, string> = {
  'no-tests':
    "CRITICAL: Your output contained zero test() blocks. You MUST wrap every test in a test('...', async ({ page }) => { ... }) call.",
  'no-goto':
    'CRITICAL: No page.goto() call found. Every test() must start with await page.goto(route).',
  'shallow-assertions':
    'All assertions are toBeVisible() — add toContainText(), toHaveValue(), or toHaveURL() to check actual content.',
  'css-selectors':
    'CSS selectors (.class, #id, [data-testid]) detected. Replace with getByRole(), getByLabel(), or getByText() using values from the source code.',
  'flaky-timeout':
    'waitForTimeout() detected. Replace with waitForSelector(), waitForLoadState(), or expect(locator).toBeVisible() which auto-retry.',
  'missing-interaction':
    'The changed file contains event handlers but no click()/fill() calls were found. Add interactions that exercise the changed handler.',
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify the structural quality of generated Playwright test code.
 *
 * @param testCode - The raw Playwright test source to inspect.
 * @param changedRegions - Optional classifier regions for region-aware checks.
 */
export const classifyTestCode = (
  testCode: string,
  changedRegions: ChangeRegion[] = [],
): PreCheckResult => {
  const issues: PreCheckIssue[] = [];

  // Hard failures — exit early for the most critical
  if (!hasTestBlocks(testCode)) issues.push('no-tests');
  if (!hasPageGoto(testCode)) issues.push('no-goto');
  if (hasFlakyTimeout(testCode)) issues.push('flaky-timeout');
  if (hasOnlyVisibilityAssertions(testCode)) issues.push('shallow-assertions');
  if (hasCssSelectors(testCode)) issues.push('css-selectors');

  // Region-aware: event-handler region requires at least one interaction call.
  // Only check when test blocks exist (no-tests is not already flagged).
  if (
    changedRegions.includes('event-handler') &&
    !issues.includes('no-tests') &&
    hasMissingInteraction(testCode)
  ) {
    issues.push('missing-interaction');
  }

  const hasHardFail = issues.some((i) => HARD_FAIL_ISSUES.has(i));

  const feedback = issues.length === 0 ? '' : issues.map((i) => FEEDBACK[i]).join('\n');

  return {
    passed: !hasHardFail,
    issues,
    feedback,
  };
};
