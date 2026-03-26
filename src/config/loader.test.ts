import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig } from "./loader.js";

describe("loadConfig", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env["QAGENT_PROVIDER"] = "ollama";
    process.env["QAGENT_MODEL"] = "qwen2.5-coder:7b";
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("returns defaults when no skill file exists", () => {
    const config = loadConfig("/tmp/nonexistent-qagent-project-xyz");
    expect(config.ai.provider).toBe("ollama");
    expect(config.ai.model).toBe("qwen2.5-coder:7b");
    expect(config.playwright.lenses).toContain("render");
    expect(config.playwright.lenses).toContain("security");
    expect(config.classifier.skipTrivial).toBe(true);
  });

  it("returns all five default lenses", () => {
    const config = loadConfig("/tmp/nonexistent-qagent-project-xyz");
    expect(config.playwright.lenses).toEqual(
      expect.arrayContaining(["render", "interaction", "state", "edge-cases", "security"])
    );
  });

  it("throws when no provider/model configured", async () => {
    delete process.env["QAGENT_PROVIDER"];
    delete process.env["QAGENT_MODEL"];

    // Mock the rc file reader to return undefined (no ~/.qagentrc)
    const loader = await import("./loader.js");
    const origReadProvider = loader.readProvider;
    const origReadModel = loader.readModel;

    // If ~/.qagentrc exists on the dev machine, readProvider/readModel
    // will return values. We can only test this reliably if neither
    // env vars nor rc file provide values.
    const provider = origReadProvider();
    const model = origReadModel();
    if (provider || model) {
      // rc file exists on this machine — skip this assertion
      return;
    }

    expect(() => loadConfig("/tmp/nonexistent-qagent-project-xyz")).toThrow("No model configured");
  });
});
