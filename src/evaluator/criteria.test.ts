import { describe, it, expect } from "vitest";
import {
  DEFAULT_CRITERIA,
  computeOverallScore,
  allCriteriaPassed,
  buildCriteriaPromptSection,
  buildCriteriaForRegions,
  type EvaluationScore,
} from "./criteria";

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

  describe("buildCriteriaForRegions", () => {
    it("returns DEFAULT_CRITERIA clone when regions is empty", () => {
      const result = buildCriteriaForRegions([]);
      expect(result).toHaveLength(DEFAULT_CRITERIA.length);
      expect(result.map((c) => c.name)).toEqual(DEFAULT_CRITERIA.map((c) => c.name));
      expect(result.map((c) => c.weight)).toEqual(DEFAULT_CRITERIA.map((c) => c.weight));
    });

    it("event-handler boosts interactions-work to weight 5", () => {
      const result = buildCriteriaForRegions(["event-handler"]);
      const c = result.find((c) => c.name === "interactions-work");
      expect(c?.weight).toBe(5);
    });

    it("async-logic boosts assertion-depth to weight 5 and adds async-states", () => {
      const result = buildCriteriaForRegions(["async-logic"]);
      const depth = result.find((c) => c.name === "assertion-depth");
      expect(depth?.weight).toBe(5);
      const asyncStates = result.find((c) => c.name === "async-states");
      expect(asyncStates).toBeDefined();
      expect(asyncStates?.weight).toBe(4);
    });

    it("hook-deps boosts assertion-depth to weight 5 and adds async-states", () => {
      const result = buildCriteriaForRegions(["hook-deps"]);
      const depth = result.find((c) => c.name === "assertion-depth");
      expect(depth?.weight).toBe(5);
      expect(result.find((c) => c.name === "async-states")).toBeDefined();
    });

    it("async-logic + hook-deps adds async-states only once", () => {
      const result = buildCriteriaForRegions(["async-logic", "hook-deps"]);
      const count = result.filter((c) => c.name === "async-states").length;
      expect(count).toBe(1);
    });

    it("server-action adds security criterion at weight 4", () => {
      const result = buildCriteriaForRegions(["server-action"]);
      const sec = result.find((c) => c.name === "security");
      expect(sec).toBeDefined();
      expect(sec?.weight).toBe(4);
    });

    it("server-action + async-logic adds both security and async-states once each", () => {
      const result = buildCriteriaForRegions(["server-action", "async-logic"]);
      expect(result.filter((c) => c.name === "security")).toHaveLength(1);
      expect(result.filter((c) => c.name === "async-states")).toHaveLength(1);
    });

    it("jsx-markup boosts selector-quality weight to at least 4", () => {
      const result = buildCriteriaForRegions(["jsx-markup"]);
      const c = result.find((c) => c.name === "selector-quality");
      expect(c?.weight).toBeGreaterThanOrEqual(4);
    });

    it("conditional-render boosts assertion-depth to weight 5", () => {
      const result = buildCriteriaForRegions(["conditional-render"]);
      const c = result.find((c) => c.name === "assertion-depth");
      expect(c?.weight).toBe(5);
    });

    it("unrelated regions leave weights at defaults", () => {
      const result = buildCriteriaForRegions(["imports", "exports"]);
      expect(result).toHaveLength(DEFAULT_CRITERIA.length);
      for (const c of result) {
        const def = DEFAULT_CRITERIA.find((d) => d.name === c.name);
        expect(c.weight).toBe(def?.weight);
      }
    });

    it("does not mutate DEFAULT_CRITERIA", () => {
      const originalWeights = DEFAULT_CRITERIA.map((c) => c.weight);
      buildCriteriaForRegions(["event-handler", "async-logic", "server-action", "jsx-markup", "conditional-render"]);
      expect(DEFAULT_CRITERIA.map((c) => c.weight)).toEqual(originalWeights);
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
