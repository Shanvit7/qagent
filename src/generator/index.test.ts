import { describe, it, expect } from "vitest";
import type { FileAnalysis } from "@/analyzer/index.js";
import { __testables } from "./index.js";

type PartialAnalysis = Partial<FileAnalysis>;

const makeAnalysis = (overrides: PartialAnalysis = {}): FileAnalysis => ({
  filePath: "/app/app/api/users/route.ts",
  sourceText: "export async function GET() { return Response.json({ ok: true }); }",
  componentType: "api-route",
  componentName: "GET",
  props: [],
  securityFindings: [],
  ...overrides,
});

describe("generator prompts", () => {
  it("describes API routes with fullstack guidance", () => {
    const { STRATEGY_DEFAULT } = __testables;
    const apiStrategy = STRATEGY_DEFAULT["api-route"];

    expect(apiStrategy).toMatch(/fullstack/i);
    expect(apiStrategy).toContain("waitForResponse()");
    expect(apiStrategy).toContain("**Never** use");
    expect(apiStrategy).not.toMatch(/Use `page\.request` to call the endpoint/i);
  });

  it("warns against Tailwind slash-classes in selector rules", () => {
    const { SELECTOR_RULES } = __testables;
    expect(SELECTOR_RULES).toContain("/");
    expect(SELECTOR_RULES).toMatch(/Tailwind/i);
    expect(SELECTOR_RULES).toMatch(/opacity/i);
  });

  it("builds API-route prompts without network call instructions", () => {
    const { buildPrompt } = __testables;

    const prompt = buildPrompt({
      analysis: makeAnalysis(),
      routes: ["/dashboard"],
      router: "app",
      skillContext: undefined,
      scanContext: undefined,
      fileContext: undefined,
      agentSecurityContext: undefined,
      diff: "diff --git a/app/api/users/route.ts b/app/api/users/route.ts",
      fileStatus: "M",
      classificationAction: "FULL_QA",
      classificationReason: "API route feeding dashboard",
      changedRegions: ["function-body"],
      runtimeProbe: undefined,
    });

    expect(prompt).toContain("Network guard");
    expect(prompt).toContain("page.request.*");
    expect(prompt).toContain("waitForResponse()");
    expect(prompt).not.toMatch(/Use `page\.request` to call the endpoint/i);
  });
});
