import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FileAnalysis } from "@/analyzer/index";
import type { AiConfig } from "@/config/types";

vi.mock("@/providers/index", () => ({
  generate: vi.fn(),
}));

import { evaluateTests, buildRefinementPrompt, HARD_RULES } from "./index";
import { generate } from "@/providers/index";
import type { EvaluationResult } from "./criteria";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGenerate = generate as unknown as { mock: { calls: any[] }; mockResolvedValueOnce: (v: any) => void };

const mockAnalysis: FileAnalysis = {
  filePath: "src/Button.tsx",
  sourceText: "const Button = () => <button>Click</button>;",
  componentName: "Button",
  componentType: "client-component",
  props: [],
  securityFindings: [],
};

const mockAiConfig: AiConfig = {
  provider: "ollama",
  model: "test-model",
};

describe("evaluator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("evaluateTests", () => {
    it("parses valid JSON response into evaluation result", async () => {
      mockGenerate.mockResolvedValueOnce(JSON.stringify({
        scores: [
          { criterion: "page-loads", score: 9, reasoning: "Page loads fine" },
          { criterion: "interactions-work", score: 7, reasoning: "Clicks work" },
          { criterion: "assertion-depth", score: 8, reasoning: "Assertions are deep" },
          { criterion: "selector-quality", score: 9, reasoning: "Good selectors" },
          { criterion: "test-naming", score: 6, reasoning: "Names ok" },
        ],
        critique: "Overall solid. Consider testing error states.",
      }));

      const result = await evaluateTests("const test = 1;", mockAnalysis, mockAiConfig);

      expect(result.scores).toHaveLength(5);
      expect(result.overallScore).toBeGreaterThan(0);
      expect(result.critique).toContain("error states");
      expect(result.iteration).toBe(1);
    });

    it("handles markdown-wrapped JSON response", async () => {
      mockGenerate.mockResolvedValueOnce("```json\n" + JSON.stringify({
        scores: [{ criterion: "page-loads", score: 8, reasoning: "ok" }],
        critique: "Fine.",
      }) + "\n```");

      const result = await evaluateTests("test code", mockAnalysis, mockAiConfig);
      expect(result.scores).toHaveLength(1);
      expect(result.scores[0]!.score).toBe(8);
    });

    it("returns fallback result on unparseable response", async () => {
      mockGenerate.mockResolvedValueOnce("This is not JSON at all");

      const result = await evaluateTests("test code", mockAnalysis, mockAiConfig);
      expect(result.passed).toBe(false);
      expect(result.critique).toContain("not valid JSON");
    });

    it("clamps scores to 1-10 range", async () => {
      mockGenerate.mockResolvedValueOnce(JSON.stringify({
        scores: [
          { criterion: "page-loads", score: 15, reasoning: "over" },
          { criterion: "interactions-work", score: -3, reasoning: "under" },
        ],
        critique: "Clamped.",
      }));

      const result = await evaluateTests("test code", mockAnalysis, mockAiConfig);
      expect(result.scores[0]!.score).toBe(10);
      expect(result.scores[1]!.score).toBe(1);
    });

    it("passes previous critique and iteration to prompt", async () => {
      mockGenerate.mockResolvedValueOnce(JSON.stringify({
        scores: [{ criterion: "page-loads", score: 9, reasoning: "fixed" }],
        critique: "Better now.",
      }));

      const result = await evaluateTests("test code", mockAnalysis, mockAiConfig, {
        previousCritique: "Fix the selectors",
        iteration: 2,
      });

      expect(result.iteration).toBe(2);
      const callArg = mockGenerate.mock.calls[0]![1] as string;
      expect(callArg).toContain("Fix the selectors");
    });

    it("passes failed tests with screenshots to prompt", async () => {
      mockGenerate.mockResolvedValueOnce(JSON.stringify({
        scores: [{ criterion: "page-loads", score: 5, reasoning: "fails" }],
        critique: "Page crashes.",
      }));

      await evaluateTests("test code", mockAnalysis, mockAiConfig, {
        failedTests: [
          { name: "loads page", error: "timeout", screenshotPath: "/tmp/shot.png" },
        ],
      });

      const callArg = mockGenerate.mock.calls[0]![1] as string;
      expect(callArg).toContain("loads page");
      expect(callArg).toContain("timeout");
      expect(callArg).toContain("/tmp/shot.png");
    });

    it("uses jsonMode for structured output", async () => {
      mockGenerate.mockResolvedValueOnce(JSON.stringify({
        scores: [],
        critique: "ok",
      }));

      await evaluateTests("test code", mockAnalysis, mockAiConfig);
      const opts = mockGenerate.mock.calls[0]![2] as Record<string, unknown>;
      expect(opts.jsonMode).toBe(true);
    });

    it("HARD_RULES ban page.request and APIRequestContext", () => {
      expect(HARD_RULES).toContain("page.request.*");
      expect(HARD_RULES).toContain("APIRequestContext");
    });
  });

  describe("buildRefinementPrompt — quality", () => {
    it("includes source, test code, route, and failed criteria", () => {
      const evaluation: EvaluationResult = {
        scores: [
          { criterion: "interactions-work", score: 4, reasoning: "Clicks don't work", passed: false },
          { criterion: "page-loads", score: 9, reasoning: "Clean", passed: true },
        ],
        overallScore: 6,
        passed: false,
        critique: "Button click handler needs testing",
        iteration: 1,
      };

      const prompt = buildRefinementPrompt({
        testCode: "const testCode = 1;",
        sourceCode: "const Button = () => <button />;",
        filePath: "src/Button.tsx",
        route: "/",
        kind: "quality",
        iteration: 1,
        evaluation,
      });

      expect(prompt).toContain("src/Button.tsx");
      expect(prompt).toContain("const testCode = 1;");
      expect(prompt).toContain("const Button = () => <button />;");
      expect(prompt).toContain("interactions-work");
      expect(prompt).toContain("Clicks don't work");
      expect(prompt).toContain("Button click handler");
    });

    it("separates failed and passed criteria", () => {
      const evaluation: EvaluationResult = {
        scores: [
          { criterion: "a", score: 3, reasoning: "bad", passed: false },
          { criterion: "b", score: 9, reasoning: "good", passed: true },
        ],
        overallScore: 6,
        passed: false,
        critique: "Fix a",
        iteration: 1,
      };

      const prompt = buildRefinementPrompt({
        testCode: "test", sourceCode: "source", filePath: "file.tsx",
        route: "/test", kind: "quality", iteration: 1, evaluation,
      });
      expect(prompt).toContain("Quality issues to fix");
      expect(prompt).toContain("Already passing");
      expect(prompt).toContain("**a**");
    });
  });

  describe("buildRefinementPrompt — runtime", () => {
    it("includes failed test names and error messages", () => {
      const prompt = buildRefinementPrompt({
        testCode: "test code",
        sourceCode: "source code",
        filePath: "src/Header.tsx",
        route: "/",
        kind: "runtime",
        iteration: 1,
        failedTests: [
          { name: "renders header", error: "Timeout 15000ms exceeded" },
          { name: "toggles menu", error: "Unable to find role button" },
        ],
      });

      expect(prompt).toContain("src/Header.tsx");
      expect(prompt).toContain("2 test(s) failing");
      expect(prompt).toContain("renders header");
      expect(prompt).toContain("Timeout");
      expect(prompt).toContain("toggles menu");
    });

    it("includes evaluator critique when provided", () => {
      const evaluation: EvaluationResult = {
        scores: [], overallScore: 5, passed: false,
        critique: "Selectors are wrong", iteration: 2,
      };
      const prompt = buildRefinementPrompt({
        testCode: "code", sourceCode: "source", filePath: "file.tsx",
        route: "/", kind: "runtime", iteration: 2,
        failedTests: [{ name: "test1", error: "err" }],
        evaluation,
      });

      expect(prompt).toContain("Selectors are wrong");
    });

    it("truncates long failure messages to 600 chars", () => {
      const longMsg = "e".repeat(1200);
      const prompt = buildRefinementPrompt({
        testCode: "code", sourceCode: "source", filePath: "file.tsx",
        route: "/", kind: "runtime", iteration: 1,
        failedTests: [{ name: "test1", error: longMsg }],
      });

      expect(prompt).not.toContain("e".repeat(601));
    });

    it("includes route in prompt", () => {
      const prompt = buildRefinementPrompt({
        testCode: "code", sourceCode: "source", filePath: "file.tsx",
        route: "/pricing", kind: "runtime", iteration: 1,
        failedTests: [{ name: "t1", error: "err" }],
      });

      expect(prompt).toContain("/pricing");
    });

    it("adds guidance when tests call page.request", () => {
      const prompt = buildRefinementPrompt({
        testCode: "await page.request.post('/api/save');",
        sourceCode: "source",
        filePath: "file.tsx",
        route: "/dashboard",
        kind: "quality",
        iteration: 1,
      });

      expect(prompt).toContain("Remove direct server/API requests");
      expect(prompt).toContain("Do not move on until every server call is deleted");
    });

  });
});
