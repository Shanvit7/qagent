import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeFile } from "./index.js";

const SITE_HEADER = "/Users/zosmaai/Desktop/zosma-ai-website/src/components/layout/site-header.tsx";

describe("analyzeFile", () => {
  it("identifies client components via 'use client' directive", () => {
    const result = analyzeFile(SITE_HEADER);
    assert.equal(result.componentType, "client-component");
  });

  it("extracts the default export component name", () => {
    const result = analyzeFile(SITE_HEADER);
    assert.equal(result.componentName, "SiteHeader");
  });

  it("returns source text for prompt injection", () => {
    const result = analyzeFile(SITE_HEADER);
    assert.ok(result.sourceText.includes("use client"));
    assert.ok(result.sourceText.length > 100);
  });

  it("returns the absolute file path", () => {
    const result = analyzeFile(SITE_HEADER);
    assert.ok(result.filePath.startsWith("/"));
    assert.ok(result.filePath.endsWith("site-header.tsx"));
  });
});
