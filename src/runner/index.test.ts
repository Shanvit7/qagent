import { describe, it, expect } from "vitest";
import { parsePlaywrightJson } from "./index.js";

describe("runner", () => {
  describe("parsePlaywrightJson", () => {
    it("parses passing test results", () => {
      const report = {
        suites: [{
          title: "header.spec.ts",
          specs: [{
            title: "page loads",
            tests: [{
              results: [{
                title: "page loads",
                status: "passed",
                duration: 150,
                errors: [],
                attachments: [],
              }],
            }],
          }],
          suites: [],
        }],
      };

      const cases = parsePlaywrightJson(JSON.stringify(report));
      expect(cases).toHaveLength(1);
      expect(cases[0]!.status).toBe("pass");
      expect(cases[0]!.name).toContain("page loads");
      expect(cases[0]!.durationMs).toBe(150);
    });

    it("parses failing test with error message", () => {
      const report = {
        suites: [{
          title: "suite",
          specs: [{
            title: "clicks button",
            tests: [{
              results: [{
                title: "clicks button",
                status: "failed",
                duration: 500,
                errors: [{ message: "Timeout 15000ms exceeded.\nwaiting for getByRole('button')" }],
                attachments: [],
              }],
            }],
          }],
          suites: [],
        }],
      };

      const cases = parsePlaywrightJson(JSON.stringify(report));
      expect(cases).toHaveLength(1);
      expect(cases[0]!.status).toBe("fail");
      expect(cases[0]!.failureMessage).toContain("Timeout");
    });

    it("parses screenshot attachment", () => {
      const report = {
        suites: [{
          title: "suite",
          specs: [{
            title: "test",
            tests: [{
              results: [{
                title: "test",
                status: "failed",
                duration: 100,
                errors: [{ message: "fail" }],
                attachments: [{ name: "screenshot", path: "/tmp/shot.png" }],
              }],
            }],
          }],
          suites: [],
        }],
      };

      const cases = parsePlaywrightJson(JSON.stringify(report));
      expect(cases[0]!.screenshotPath).toBe("/tmp/shot.png");
    });

    it("handles nested suites", () => {
      const report = {
        suites: [{
          title: "outer",
          specs: [],
          suites: [{
            title: "inner",
            specs: [{
              title: "nested test",
              tests: [{
                results: [{
                  title: "nested test",
                  status: "passed",
                  duration: 50,
                  errors: [],
                  attachments: [],
                }],
              }],
            }],
            suites: [],
          }],
        }],
      };

      const cases = parsePlaywrightJson(JSON.stringify(report));
      expect(cases).toHaveLength(1);
      expect(cases[0]!.name).toContain("outer");
      expect(cases[0]!.name).toContain("inner");
    });

    it("returns empty array for invalid JSON", () => {
      expect(parsePlaywrightJson("not json")).toEqual([]);
    });

    it("returns empty array for empty suites", () => {
      expect(parsePlaywrightJson(JSON.stringify({ suites: [] }))).toEqual([]);
    });

    it("maps timedOut status to fail", () => {
      const report = {
        suites: [{
          title: "suite",
          specs: [{
            title: "slow test",
            tests: [{
              results: [{
                title: "slow test",
                status: "timedOut",
                duration: 15000,
                errors: [],
                attachments: [],
              }],
            }],
          }],
          suites: [],
        }],
      };

      const cases = parsePlaywrightJson(JSON.stringify(report));
      expect(cases[0]!.status).toBe("fail");
    });
  });
});
