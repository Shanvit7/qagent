import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { detectDevCommand, getAvailablePort } from "./index.js";

const TMP = join(process.cwd(), ".test-server-tmp");

describe("dev server", () => {
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  describe("detectDevCommand", () => {
    it("returns 'npm run dev' when dev script exists", () => {
      writeFileSync(join(TMP, "package.json"), JSON.stringify({
        scripts: { dev: "next dev" },
      }));
      expect(detectDevCommand(TMP)).toBe("npm run dev");
    });

    it("detects Next.js from dependencies", () => {
      writeFileSync(join(TMP, "package.json"), JSON.stringify({
        dependencies: { next: "14.0.0" },
      }));
      expect(detectDevCommand(TMP)).toBe("npx next dev");
    });

    it("detects Vite from devDependencies", () => {
      writeFileSync(join(TMP, "package.json"), JSON.stringify({
        devDependencies: { vite: "5.0.0" },
      }));
      expect(detectDevCommand(TMP)).toBe("npx vite");
    });

    it("detects CRA", () => {
      writeFileSync(join(TMP, "package.json"), JSON.stringify({
        dependencies: { "react-scripts": "5.0.0" },
      }));
      expect(detectDevCommand(TMP)).toBe("npx react-scripts start");
    });

    it("returns null when no package.json", () => {
      expect(detectDevCommand(TMP + "/nonexistent")).toBeNull();
    });

    it("returns null when no recognizable framework", () => {
      writeFileSync(join(TMP, "package.json"), JSON.stringify({
        dependencies: { lodash: "4.0.0" },
      }));
      expect(detectDevCommand(TMP)).toBeNull();
    });

    it("prefers dev script over framework detection", () => {
      writeFileSync(join(TMP, "package.json"), JSON.stringify({
        scripts: { dev: "turbo dev" },
        dependencies: { next: "14.0.0" },
      }));
      expect(detectDevCommand(TMP)).toBe("npm run dev");
    });
  });

  describe("getAvailablePort", () => {
    it("returns a valid port number", async () => {
      const port = await getAvailablePort();
      expect(port).toBeGreaterThan(0);
      expect(port).toBeLessThan(65536);
    });

    it("returns different ports on successive calls", async () => {
      const p1 = await getAvailablePort();
      const p2 = await getAvailablePort();
      // Not guaranteed but very likely
      expect(typeof p1).toBe("number");
      expect(typeof p2).toBe("number");
    });
  });
});
