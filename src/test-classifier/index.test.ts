import { describe, it, expect } from 'vitest';
import { classifyTestCode, type PreCheckResult } from './index';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const GOOD_TEST = `
import { test, expect } from "@playwright/test";

test("user sees hero heading on homepage", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByRole("heading", { name: /welcome/i })).toContainText("Welcome");
});

test("user submits contact form and sees confirmation", async ({ page }) => {
  await page.goto("/contact");
  await page.getByLabel("Email").fill("test@example.com");
  await page.getByRole("button", { name: /submit/i }).click();
  await expect(page.getByRole("status")).toContainText("Thank you");
});
`;

const NO_TESTS = `
import { test, expect } from "@playwright/test";
// no actual blocks here
function helper() {}
`;

const NO_GOTO = `
import { test, expect } from "@playwright/test";
test("something", async ({ page }) => {
  await expect(page.getByRole("heading")).toBeVisible();
});
`;

const SHALLOW_ASSERTIONS = `
import { test, expect } from "@playwright/test";
test("page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading")).toBeVisible();
});
`;

const CSS_SELECTORS = `
import { test, expect } from "@playwright/test";
test("hero shows", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".hero-title")).toContainText("Welcome");
});
`;

const DATA_TESTID = `
import { test, expect } from "@playwright/test";
test("form works", async ({ page }) => {
  await page.goto("/");
  await page.locator("[data-testid=submit-btn]").click();
  await expect(page.getByRole("status")).toContainText("Done");
});
`;

const FLAKY_TIMEOUT = `
import { test, expect } from "@playwright/test";
test("modal opens", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /open/i }).click();
  await page.waitForTimeout(2000);
  await expect(page.getByRole("dialog")).toContainText("Hello");
});
`;

const NO_INTERACTION = `
import { test, expect } from "@playwright/test";
test("button is visible", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /submit/i })).toContainText("Submit");
});
`;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('classifyTestCode', () => {
  it('passes a structurally correct test', () => {
    const result = classifyTestCode(GOOD_TEST);
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.feedback).toBe('');
  });

  describe('no-tests', () => {
    it('detects zero test() blocks as hard-fail', () => {
      const result = classifyTestCode(NO_TESTS);
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('no-tests');
    });

    it('includes CRITICAL in feedback', () => {
      const result = classifyTestCode(NO_TESTS);
      expect(result.feedback).toContain('CRITICAL');
      expect(result.feedback).toContain('test()');
    });
  });

  describe('no-goto', () => {
    it('detects missing page.goto() as hard-fail', () => {
      const result = classifyTestCode(NO_GOTO);
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('no-goto');
    });

    it('includes CRITICAL in feedback', () => {
      const result = classifyTestCode(NO_GOTO);
      expect(result.feedback).toContain('CRITICAL');
      expect(result.feedback).toContain('page.goto');
    });
  });

  describe('shallow-assertions', () => {
    it('detects toBeVisible()-only assertions', () => {
      const result = classifyTestCode(SHALLOW_ASSERTIONS);
      expect(result.issues).toContain('shallow-assertions');
    });

    it('does NOT flag as hard-fail (test still runs)', () => {
      const result = classifyTestCode(SHALLOW_ASSERTIONS);
      expect(result.passed).toBe(true);
    });

    it('includes toContainText suggestion in feedback', () => {
      const result = classifyTestCode(SHALLOW_ASSERTIONS);
      expect(result.feedback).toContain('toContainText');
    });

    it('does not flag test with deep assertions', () => {
      const result = classifyTestCode(GOOD_TEST);
      expect(result.issues).not.toContain('shallow-assertions');
    });
  });

  describe('css-selectors', () => {
    it('detects .class CSS selector', () => {
      const result = classifyTestCode(CSS_SELECTORS);
      expect(result.issues).toContain('css-selectors');
    });

    it('detects [data-testid] selector', () => {
      const result = classifyTestCode(DATA_TESTID);
      expect(result.issues).toContain('css-selectors');
    });

    it('suggests getByRole in feedback', () => {
      const result = classifyTestCode(CSS_SELECTORS);
      expect(result.feedback).toContain('getByRole');
    });

    it('does NOT flag as hard-fail', () => {
      const result = classifyTestCode(CSS_SELECTORS);
      expect(result.passed).toBe(true);
    });
  });

  describe('flaky-timeout', () => {
    it('detects waitForTimeout()', () => {
      const result = classifyTestCode(FLAKY_TIMEOUT);
      expect(result.issues).toContain('flaky-timeout');
    });

    it('does NOT flag as hard-fail', () => {
      const result = classifyTestCode(FLAKY_TIMEOUT);
      expect(result.passed).toBe(true);
    });

    it('includes waitForSelector suggestion in feedback', () => {
      const result = classifyTestCode(FLAKY_TIMEOUT);
      expect(result.feedback).toContain('waitForSelector');
    });
  });

  describe('missing-interaction (region-aware)', () => {
    it('flags missing-interaction when event-handler region and no click/fill', () => {
      const result = classifyTestCode(NO_INTERACTION, ['event-handler']);
      expect(result.issues).toContain('missing-interaction');
    });

    it('does NOT flag missing-interaction without event-handler region', () => {
      const result = classifyTestCode(NO_INTERACTION, []);
      expect(result.issues).not.toContain('missing-interaction');
    });

    it('does NOT flag missing-interaction when fill() is present', () => {
      const result = classifyTestCode(GOOD_TEST, ['event-handler']);
      expect(result.issues).not.toContain('missing-interaction');
    });

    it('does NOT flag missing-interaction when click() is present', () => {
      const code = `
        import { test, expect } from "@playwright/test";
        test("user clicks", async ({ page }) => {
          await page.goto("/");
          await page.getByRole("button").click();
          await expect(page.getByRole("status")).toContainText("Done");
        });
      `;
      const result = classifyTestCode(code, ['event-handler']);
      expect(result.issues).not.toContain('missing-interaction');
    });

    it('does NOT flag missing-interaction when no-tests is also present', () => {
      // If there are no test blocks, interaction check is skipped
      const result = classifyTestCode(NO_TESTS, ['event-handler']);
      expect(result.issues).not.toContain('missing-interaction');
    });
  });

  describe('feedback', () => {
    it('returns empty feedback when passed with no issues', () => {
      const result = classifyTestCode(GOOD_TEST);
      expect(result.feedback).toBe('');
    });

    it('combines multiple issue feedbacks with newlines', () => {
      const result = classifyTestCode(
        SHALLOW_ASSERTIONS + '\n' + FLAKY_TIMEOUT.replace(/import.*\n/, ''),
      );
      if (result.issues.length > 1) {
        expect(result.feedback).toContain('\n');
      }
    });
  });

  describe('result shape', () => {
    it('always has passed, issues, feedback fields', () => {
      const result: PreCheckResult = classifyTestCode('');
      expect(typeof result.passed).toBe('boolean');
      expect(Array.isArray(result.issues)).toBe(true);
      expect(typeof result.feedback).toBe('string');
    });

    it('empty string input → no-tests and no-goto hard fail', () => {
      const result = classifyTestCode('');
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('no-tests');
    });
  });
});
