import { describe, it, expect } from "vitest";
import { sanitizeTestCode } from "./index";

describe("sanitizeTestCode", () => {
  describe("tailwind slash-class fix", () => {
    it("strips slash-opacity from locator selectors", () => {
      const input = `await page.locator('span.text-xs.text-muted-foreground/50').click();`;
      const { code, applied } = sanitizeTestCode(input);
      expect(code).not.toContain("/50");
      expect(code).toContain("span.text-xs");
      expect(code).toContain(".click()");
      expect(applied).toContain("tailwind-slash-class");
    });

    it("handles multiple slash-classes in one selector", () => {
      const input = `page.locator('div.bg-primary/20.text-white/80')`;
      const { code } = sanitizeTestCode(input);
      expect(code).not.toContain("/20");
      expect(code).not.toContain("/80");
      expect(code).toContain("div");
    });

    it("does not touch locators without slash-classes", () => {
      const input = `page.locator('button.btn-primary')`;
      const { code, applied } = sanitizeTestCode(input);
      expect(code).toBe(input);
      expect(applied).not.toContain("tailwind-slash-class");
    });

    it("preserves the tag name when all classes have slashes", () => {
      const input = `page.locator('span.text-muted-foreground/50')`;
      const { code } = sanitizeTestCode(input);
      expect(code).toContain("span");
      expect(code).not.toContain("/50");
    });
  });

  describe("waitForTimeout fix", () => {
    it("replaces waitForTimeout with a comment", () => {
      const input = `await page.waitForTimeout(1000);`;
      const { code, applied } = sanitizeTestCode(input);
      expect(code).not.toContain("await page.waitForTimeout");
      expect(code).toContain("// waitForTimeout removed");
      expect(applied).toContain("waitForTimeout");
    });

    it("does not fire when no waitForTimeout exists", () => {
      const input = `await page.waitForSelector('.foo');`;
      const { code, applied } = sanitizeTestCode(input);
      expect(code).toBe(input);
      expect(applied).not.toContain("waitForTimeout");
    });
  });

  describe("strict-mode CSS fix", () => {
    it("adds .first() to CSS class locators with actions", () => {
      const input = `await page.locator('.card').click();`;
      const { code, applied } = sanitizeTestCode(input);
      expect(code).toContain(".first().click()");
      expect(applied).toContain("strict-mode-css");
    });

    it("does not double-add .first()", () => {
      const input = `await page.locator('.card').first().click();`;
      const { code, applied } = sanitizeTestCode(input);
      expect(code).toBe(input);
      expect(applied).not.toContain("strict-mode-css");
    });

    it("does not touch role-based locators", () => {
      const input = `await page.getByRole('button', { name: 'Submit' }).click();`;
      const { code, applied } = sanitizeTestCode(input);
      expect(code).toBe(input);
      expect(applied).not.toContain("strict-mode-css");
    });
  });

  it("applies multiple transforms in one pass", () => {
    const input = [
      `await page.locator('span.text-muted/50').click();`,
      `await page.waitForTimeout(500);`,
      `await page.locator('.nav-link').hover();`,
    ].join("\n");
    const { applied } = sanitizeTestCode(input);
    expect(applied).toContain("tailwind-slash-class");
    expect(applied).toContain("waitForTimeout");
    expect(applied).toContain("strict-mode-css");
  });

  it("returns empty applied list when nothing fires", () => {
    const input = `await page.getByRole('heading', { name: /hello/i }).toBeVisible();`;
    const { code, applied } = sanitizeTestCode(input);
    expect(code).toBe(input);
    expect(applied).toEqual([]);
  });
});
