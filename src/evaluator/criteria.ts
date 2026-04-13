/**
 * Evaluator criteria for Playwright browser tests.
 */

import type { ChangeRegion } from '@/classifier/index';

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
    name: 'page-loads',
    // High (8-10): asserts specific meaningful content from the source (heading text, nav links, key data)
    // Mid (5-7): asserts a landmark or generic element is visible
    // Low (1-4): only checks document.title or body, or no navigation at all
    description:
      'Page navigates and specific, meaningful content from the source is visible — NOT just body or html',
    weight: 3,
    threshold: 6,
  },
  {
    name: 'interactions-work',
    // High (8-10): clicks/fills AND asserts the specific outcome (new text, URL change, element appearing)
    // Mid (5-7): triggers interaction but only re-asserts visibility of the same element
    // Low (1-4): no interactions tested, or interactions with no assertion
    description:
      'Interactive elements are exercised AND the specific outcome is asserted — not just that the element is still visible',
    weight: 3,
    threshold: 6,
  },
  {
    name: 'assertion-depth',
    // High (8-10): assertions check specific text values, counts, URLs, or state changes
    // Mid (5-7): mix of deep and shallow assertions
    // Low (1-4): all assertions are toBeVisible() with no content or value checks
    description:
      'Assertions check specific content, values, or state — not just visibility. toBeVisible()-only tests score ≤ 4.',
    weight: 3,
    threshold: 6,
  },
  {
    name: 'selector-quality',
    // High (8-10): uses getByRole/getByLabel/getByText with values from the source code
    // Mid (5-7): mixes accessible selectors with some CSS selectors
    // Low (1-4): uses CSS selectors (.class, #id), data-testid, or invented aria-labels not in the source
    description:
      'Selectors use getByRole/getByLabel/getByText with values read from the source code — no invented or CSS selectors',
    weight: 2,
    threshold: 6,
  },
  {
    name: 'test-naming',
    // High (8-10): names read like user stories: "user submits form and sees confirmation"
    // Mid (5-7): descriptive but vague: "form works correctly"
    // Low (1-4): generic: "test 1", "page loads", "component renders"
    description:
      'Test names describe user-observable behavior as a sentence, not a technical label',
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
  criteria
    .map((c) => `- **${c.name}** (weight ${c.weight}, pass ≥ ${c.threshold}): ${c.description}`)
    .join('\n');

// ─── Region-aware criteria weighting ─────────────────────────────────────────

/**
 * Build a re-weighted criteria list based on the classifier's changedRegions.
 *
 * Rules (multiple can activate simultaneously):
 * - event-handler      → interactions-work weight → 5
 * - async-logic        → assertion-depth weight → 5; adds async-states criterion
 * - hook-deps          → assertion-depth weight → 5; adds async-states criterion
 * - server-action      → adds security criterion at weight 4
 * - jsx-markup         → selector-quality weight → 4
 * - conditional-render → assertion-depth weight → 5
 *
 * Falls back to DEFAULT_CRITERIA when regions is empty.
 */
export const buildCriteriaForRegions = (regions: ChangeRegion[]): GradingCriterion[] => {
  if (regions.length === 0) return DEFAULT_CRITERIA.map((c) => ({ ...c }));

  const base: GradingCriterion[] = DEFAULT_CRITERIA.map((c) => ({ ...c }));
  const extra: GradingCriterion[] = [];

  const has = (r: ChangeRegion): boolean => regions.includes(r);

  if (has('event-handler')) {
    boost(base, 'interactions-work', 5);
  }

  if (has('async-logic') || has('hook-deps')) {
    boost(base, 'assertion-depth', 5);
    if (!extra.some((c) => c.name === 'async-states')) {
      extra.push({
        name: 'async-states',
        // High (8-10): tests loading, error, and resolved states with specific content checks
        // Mid (5-7): tests only the resolved / happy-path state
        // Low (1-4): no async state assertions at all
        description:
          'Async states (loading, error, resolved) are each asserted with specific content or indicators',
        weight: 4,
        threshold: 5,
      });
    }
  }

  if (has('server-action')) {
    if (!extra.some((c) => c.name === 'security')) {
      extra.push({
        name: 'security',
        // High (8-10): tests unauthorized access rejection, invalid-input validation, safe form submission
        // Mid (5-7): tests happy-path submission with some validation
        // Low (1-4): no security-oriented assertions at all
        description:
          'Security-relevant behaviors tested: auth checks, input validation rejection, and safe form submission',
        weight: 4,
        threshold: 5,
      });
    }
  }

  if (has('jsx-markup')) {
    boost(base, 'selector-quality', 4);
  }

  if (has('conditional-render')) {
    boost(base, 'assertion-depth', 5);
  }

  return [...base, ...extra];
};

/** Raise a criterion's weight; never lower it. */
const boost = (criteria: GradingCriterion[], name: string, weight: number): void => {
  const c = criteria.find((x) => x.name === name);
  if (c) c.weight = Math.max(c.weight, weight);
};
