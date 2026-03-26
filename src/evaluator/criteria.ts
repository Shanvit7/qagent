/**
 * Evaluator criteria for Playwright browser tests.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GradingCriterion {
  name: string;
  description: string;
  weight: number;
  threshold: number;
}

export interface EvaluationScore {
  criterion: string;
  score: number;
  reasoning: string;
  passed: boolean;
}

export interface EvaluationResult {
  scores: EvaluationScore[];
  overallScore: number;
  passed: boolean;
  critique: string;
  iteration: number;
}

// ─── Default criteria — Playwright-oriented ───────────────────────────────────
// Each description defines exactly what earns a HIGH score vs. a LOW score
// so the evaluator AI grades consistently rather than generously.

export const DEFAULT_CRITERIA: readonly GradingCriterion[] = [
  {
    name: "page-loads",
    // High (8-10): asserts specific meaningful content from the source (heading text, nav links, key data)
    // Mid (5-7): asserts a landmark or generic element is visible
    // Low (1-4): only checks document.title or body, or no navigation at all
    description: "Page navigates and specific, meaningful content from the source is visible — NOT just body or html",
    weight: 3,
    threshold: 6,
  },
  {
    name: "interactions-work",
    // High (8-10): clicks/fills AND asserts the specific outcome (new text, URL change, element appearing)
    // Mid (5-7): triggers interaction but only re-asserts visibility of the same element
    // Low (1-4): no interactions tested, or interactions with no assertion
    description: "Interactive elements are exercised AND the specific outcome is asserted — not just that the element is still visible",
    weight: 3,
    threshold: 6,
  },
  {
    name: "assertion-depth",
    // High (8-10): assertions check specific text values, counts, URLs, or state changes
    // Mid (5-7): mix of deep and shallow assertions
    // Low (1-4): all assertions are toBeVisible() with no content or value checks
    description: "Assertions check specific content, values, or state — not just visibility. toBeVisible()-only tests score ≤ 4.",
    weight: 3,
    threshold: 6,
  },
  {
    name: "selector-quality",
    // High (8-10): uses getByRole/getByLabel/getByText with values from the source code
    // Mid (5-7): mixes accessible selectors with some CSS selectors
    // Low (1-4): uses CSS selectors (.class, #id), data-testid, or invented aria-labels not in the source
    description: "Selectors use getByRole/getByLabel/getByText with values read from the source code — no invented or CSS selectors",
    weight: 2,
    threshold: 6,
  },
  {
    name: "test-naming",
    // High (8-10): names read like user stories: "user submits form and sees confirmation"
    // Mid (5-7): descriptive but vague: "form works correctly"
    // Low (1-4): generic: "test 1", "page loads", "component renders"
    description: "Test names describe user-observable behavior as a sentence, not a technical label",
    weight: 1,
    threshold: 5,
  },
] as const;

// ─── Scoring helpers ──────────────────────────────────────────────────────────

export const computeOverallScore = (
  scores: EvaluationScore[],
  criteria: readonly GradingCriterion[],
): number => {
  const criteriaMap = new Map(criteria.map((c) => [c.name, c]));
  let totalWeight = 0;
  let weightedSum = 0;

  for (const s of scores) {
    const w = criteriaMap.get(s.criterion)?.weight ?? 1;
    totalWeight += w;
    weightedSum += s.score * w;
  }

  return totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : 5;
};

export const allCriteriaPassed = (
  scores: EvaluationScore[],
  criteria: readonly GradingCriterion[],
): boolean => {
  const criteriaMap = new Map(criteria.map((c) => [c.name, c]));
  return scores.every((s) => s.score >= (criteriaMap.get(s.criterion)?.threshold ?? 5));
};

export const buildCriteriaPromptSection = (criteria: readonly GradingCriterion[]): string =>
  criteria.map((c) => `- **${c.name}** (weight ${c.weight}, pass ≥ ${c.threshold}): ${c.description}`).join("\n");
