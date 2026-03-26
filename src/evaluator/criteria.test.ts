import { describe, it, expect } from "vitest";
import {
  DEFAULT_CRITERIA,
  computeOverallScore,
  allCriteriaPassed,
  buildCriteriaPromptSection,
  type EvaluationScore,
} from "./criteria.js";

describe("criteria", () => {
  describe("DEFAULT_CRITERIA", () => {
    it("has 5 Playwright-oriented criteria", () => {
      expect(DEFAULT_CRITERIA).toHaveLength(5);
      const names = DEFAULT_CRITERIA.map((c) => c.name);
      expect(names).toContain("page-loads");
      expect(names).toContain("interactions-work");
      expect(names).toContain("assertion-depth");
      expect(names).toContain("selector-quality");
      expect(names).toContain("test-naming");
    });

    it("has no Vitest/RTL/jsdom criteria and no old criteria", () => {
      const names = DEFAULT_CRITERIA.map((c) => c.name);
      expect(names).not.toContain("syntactic_correctness");
      expect(names).not.toContain("mock_discipline");
      expect(names).not.toContain("query_discipline");
      // Old criteria replaced by more specific ones
      expect(names).not.toContain("content-correct");
      expect(names).not.toContain("no-console-errors");
      expect(names).not.toContain("responsive");
    });
  });

  describe("computeOverallScore", () => {
    it("computes weighted average", () => {
      const scores: EvaluationScore[] = [
        { criterion: "page-loads", score: 10, reasoning: "", passed: true },
        { criterion: "interactions-work", score: 6, reasoning: "", passed: true },
      ];
      const result = computeOverallScore(scores, DEFAULT_CRITERIA);
      expect(result).toBeGreaterThan(6);
      expect(result).toBeLessThan(10);
    });

    it("returns 5 for empty scores", () => {
      expect(computeOverallScore([], DEFAULT_CRITERIA)).toBe(5);
    });

    it("handles unknown criteria with weight 1", () => {
      const scores: EvaluationScore[] = [
        { criterion: "unknown", score: 8, reasoning: "", passed: true },
      ];
      expect(computeOverallScore(scores, [])).toBe(8);
    });
  });

  describe("allCriteriaPassed", () => {
    it("returns true when all scores meet thresholds", () => {
      const scores: EvaluationScore[] = DEFAULT_CRITERIA.map((c) => ({
        criterion: c.name,
        score: c.threshold,
        reasoning: "",
        passed: true,
      }));
      expect(allCriteriaPassed(scores, DEFAULT_CRITERIA)).toBe(true);
    });

    it("returns false when any score below threshold", () => {
      const scores: EvaluationScore[] = [
        { criterion: "page-loads", score: 3, reasoning: "", passed: false },
      ];
      expect(allCriteriaPassed(scores, DEFAULT_CRITERIA)).toBe(false);
    });
  });

  describe("buildCriteriaPromptSection", () => {
    it("includes all criteria names and weights", () => {
      const result = buildCriteriaPromptSection(DEFAULT_CRITERIA);
      for (const c of DEFAULT_CRITERIA) {
        expect(result).toContain(c.name);
        expect(result).toContain(`weight ${c.weight}`);
        expect(result).toContain(`pass ≥ ${c.threshold}`);
      }
    });

    it("returns empty string for no criteria", () => {
      expect(buildCriteriaPromptSection([])).toBe("");
    });
  });
});
