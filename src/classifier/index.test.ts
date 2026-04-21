import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { classifyFile } from './index';
import type { StagedFile } from '@/git/staged';

const FIXTURES = resolve(import.meta.dirname, '__fixtures__');

const makeFile = (overrides: Partial<StagedFile>): StagedFile => ({
  path: resolve(FIXTURES, 'fixture-with-logic.tsx'),
  status: 'M',
  diff: '',
  ...overrides,
});

describe('classifyFile', () => {
  describe('SKIP — fast-path checks (unchanged)', () => {
    it('skips deleted files', () => {
      expect(classifyFile(makeFile({ status: 'D' })).action).toBe('SKIP');
    });

    it('skips CSS files', () => {
      expect(classifyFile(makeFile({ path: 'styles/Button.css' })).action).toBe('SKIP');
    });

    it('skips SVG files', () => {
      expect(classifyFile(makeFile({ path: 'assets/icon.svg' })).action).toBe('SKIP');
    });

    it('skips pure renames with empty diff', () => {
      expect(classifyFile(makeFile({ status: 'R', diff: '' })).action).toBe('SKIP');
    });

    it('skips JSON config files', () => {
      expect(classifyFile(makeFile({ path: 'config.json' })).action).toBe('SKIP');
    });

    it('skips when diff has no changed lines', () => {
      const diff = '@@ -1,3 +1,3 @@\n context line\n another context\n';
      expect(classifyFile(makeFile({ diff })).action).toBe('SKIP');
    });
  });

  // ─── Styling-only (SKIP) ─────────────────────────────────────────────────────

  describe('SKIP — AST-verified styling-only', () => {
    it('skips className-only changes', () => {
      // Line 16 in fixture-with-logic.tsx: <span className="count-display">{count}</span>
      const diff = `@@ -16,1 +16,1 @@\n-      <span className="count-display">{count}</span>\n+      <span className="count-display text-lg">{count}</span>`;
      const result = classifyFile(makeFile({ diff }));
      expect(result.action).toBe('SKIP');
      expect(result.reason).toContain('Cosmetic');
      expect(result.changedRegions).toContain('jsx-styling');
    });

    it('skips inline style prop changes', () => {
      // Line 18 in fixture-styling.tsx: style={{ fontWeight: "bold" }}
      const diff = `@@ -18,1 +18,1 @@\n-        style={{ fontWeight: "bold" }}\n+        style={{ fontWeight: "semibold" }}`;
      const result = classifyFile(
        makeFile({
          path: resolve(FIXTURES, 'fixture-styling.tsx'),
          diff,
        }),
      );
      expect(result.action).toBe('SKIP');
      expect(result.reason).toContain('Cosmetic');
      expect(result.changedRegions).toContain('jsx-styling');
    });

    it('skips MUI/Chakra sx prop changes', () => {
      // Line 25 in fixture-styling.tsx: <div sx={{ mt: 2, p: 1 }}>
      const diff = `@@ -25,1 +25,1 @@\n-      <div sx={{ mt: 2, p: 1 }}>\n+      <div sx={{ mt: 4, p: 2 }}>`;
      const result = classifyFile(
        makeFile({
          path: resolve(FIXTURES, 'fixture-styling.tsx'),
          diff,
        }),
      );
      expect(result.action).toBe('SKIP');
      expect(result.reason).toContain('Cosmetic');
      expect(result.changedRegions).toContain('jsx-styling');
    });

    it('skips Twin Macro tw prop changes', () => {
      // Line 26 in fixture-styling.tsx: <span tw="text-gray-500">Content</span>
      const diff = `@@ -26,1 +26,1 @@\n-        <span tw="text-gray-500">Content</span>\n+        <span tw="text-blue-500 font-bold">Content</span>`;
      const result = classifyFile(
        makeFile({
          path: resolve(FIXTURES, 'fixture-styling.tsx'),
          diff,
        }),
      );
      expect(result.action).toBe('SKIP');
      expect(result.reason).toContain('Cosmetic');
      expect(result.changedRegions).toContain('jsx-styling');
    });

    it('skips styled-components template literal changes', () => {
      // Line 5 in fixture-styling.tsx: inside styled.div``
      const diff = `@@ -5,1 +5,1 @@\n-  padding: 16px;\n+  padding: 24px;`;
      const result = classifyFile(
        makeFile({
          path: resolve(FIXTURES, 'fixture-styling.tsx'),
          diff,
        }),
      );
      expect(result.action).toBe('SKIP');
      expect(result.reason).toContain('Cosmetic');
      expect(result.changedRegions).toContain('jsx-styling');
    });
  });

  // ─── Cosmetic attributes (SKIP) ──────────────────────────────────────────────

  describe('SKIP — AST-verified cosmetic attributes', () => {
    it('skips data-testid changes', () => {
      // Line 20 in fixture-styling.tsx: data-testid="card-heading"
      const diff = `@@ -20,1 +20,1 @@\n-        data-testid="card-heading"\n+        data-testid="card-title"`;
      const result = classifyFile(
        makeFile({
          path: resolve(FIXTURES, 'fixture-styling.tsx'),
          diff,
        }),
      );
      expect(result.action).toBe('SKIP');
      expect(result.reason).toContain('Cosmetic attribute');
      expect(result.changedRegions).toContain('jsx-cosmetic');
    });

    it('skips aria-label changes', () => {
      // Line 21 in fixture-styling.tsx: aria-label={title}
      const diff = `@@ -21,1 +21,1 @@\n-        aria-label={title}\n+        aria-label="Card heading"`;
      const result = classifyFile(
        makeFile({
          path: resolve(FIXTURES, 'fixture-styling.tsx'),
          diff,
        }),
      );
      expect(result.action).toBe('SKIP');
      expect(result.reason).toContain('Cosmetic attribute');
      expect(result.changedRegions).toContain('jsx-cosmetic');
    });

    it('skips mixed styling + cosmetic changes', () => {
      // Lines 18 (style) + 20 (data-testid) in fixture-styling.tsx
      const diff = [
        `@@ -18,1 +18,1 @@`,
        `-        style={{ fontWeight: "bold" }}`,
        `+        style={{ fontWeight: "semibold" }}`,
        `@@ -20,1 +20,1 @@`,
        `-        data-testid="card-heading"`,
        `+        data-testid="card-title"`,
      ].join('\n');
      const result = classifyFile(
        makeFile({
          path: resolve(FIXTURES, 'fixture-styling.tsx'),
          diff,
        }),
      );
      expect(result.action).toBe('SKIP');
      expect(result.reason).toContain('osmetic');
    });
  });

  // ─── Import-only (SKIP) ──────────────────────────────────────────────────────

  describe('SKIP — AST-verified import-only', () => {
    it('skips import-only changes detected via AST', () => {
      // Line 1 in fixture-with-logic.tsx: import { useState } from "react";
      const diff = `@@ -1,1 +1,1 @@\n-import { useState } from "react";\n+import { useState, useRef } from "react";`;
      const result = classifyFile(makeFile({ diff }));
      expect(result.action).toBe('SKIP');
      expect(result.reason).toContain('Import-only');
      expect(result.reason).toContain('no browser-visible');
    });
  });

  // ─── FULL_QA cases ───────────────────────────────────────────────────────────

  describe('FULL_QA cases', () => {
    it('returns FULL_QA for new component files', () => {
      // Use an existing fixture that has JSX — classifies as component → FULL_QA
      expect(
        classifyFile(makeFile({ status: 'A', path: resolve(FIXTURES, 'fixture-with-logic.tsx') }))
          .action,
      ).toBe('FULL_QA');
    });

    it('returns FULL_QA for function body changes', () => {
      // Line 11 in fixture-with-logic.tsx is inside handleClick function body
      const diff = `@@ -11,1 +11,1 @@\n-    setCount((prev) => prev + 1);\n+    setCount((prev) => prev + 2);`;
      const result = classifyFile(makeFile({ diff }));
      expect(result.action).toBe('FULL_QA');
      expect(result.reason).toContain('logic changed');
      expect(result.changedRegions).toContain('function-body');
    });

    it('returns FULL_QA for hook changes', () => {
      // Lines 7-19 in fixture-hook.tsx are inside useEffect
      const diff = `@@ -18,1 +18,1 @@\n-  }, [userId]);\n+  }, [userId, refresh]);`;
      const result = classifyFile(
        makeFile({
          path: resolve(FIXTURES, 'fixture-hook.tsx'),
          diff,
        }),
      );
      expect(result.action).toBe('FULL_QA');
      expect(result.reason).toContain('Hook');
      expect(result.changedRegions).toContain('hook-deps');
    });

    it('returns FULL_QA for server action changes', () => {
      // Line 6 in fixture-server-action.ts is inside createUser function
      const diff = `@@ -6,1 +6,1 @@\n-  if (!name || name.length < 2) {\n+  if (!name || name.length < 3) {`;
      const result = classifyFile(
        makeFile({
          path: resolve(FIXTURES, 'fixture-server-action.ts'),
          diff,
        }),
      );
      expect(result.action).toBe('FULL_QA');
      expect(result.reason).toContain('Server action');
      expect(result.changedRegions).toContain('server-action');
    });
  });

  // ─── LIGHTWEIGHT cases ───────────────────────────────────────────────────────

  describe('LIGHTWEIGHT cases', () => {
    it('returns LIGHTWEIGHT for prop interface changes', () => {
      // Lines 1-5 in fixture-props-only.tsx are the ButtonProps interface
      const diff = `@@ -3,1 +3,1 @@\n-  disabled?: boolean;\n+  disabled?: boolean | undefined;`;
      const result = classifyFile(
        makeFile({
          path: resolve(FIXTURES, 'fixture-props-only.tsx'),
          diff,
        }),
      );
      expect(result.action).toBe('LIGHTWEIGHT');
      expect(result.reason).toContain('Prop interface');
      expect(result.reason).toContain('rendered output');
      expect(result.changedRegions).toContain('props');
    });

    it('returns LIGHTWEIGHT for JSX markup-only changes (no logic)', () => {
      // Line 18 in fixture-with-logic.tsx: button text inside jsx-markup
      // jsx-markup specificity (7) beats function-body (5)
      const diff = `@@ -18,1 +18,1 @@\n-      <button onClick={handleClick}>Increment</button>\n+      <button onClick={handleClick}>Add one</button>`;
      const result = classifyFile(makeFile({ diff }));
      expect(result.action).toBe('LIGHTWEIGHT');
      expect(result.reason).toContain('JSX structure');
    });
  });

  // ─── Visibility-affecting styling (LIGHTWEIGHT) ──────────────────────────────
  // These are styling changes that look cosmetic but Playwright CAN detect them:
  // hidden elements fail toBeVisible(), pointer-events-none blocks clicks, etc.

  describe('LIGHTWEIGHT — visibility-breaking styling (Tailwind)', () => {
    const visFixture = resolve(FIXTURES, 'fixture-visibility-styling.tsx');

    it('upgrades hidden class to LIGHTWEIGHT', () => {
      // Line 15: <section className="hidden">Hidden section</section>
      const diff = `@@ -15,1 +15,1 @@\n-      <section className="">Hidden section</section>\n+      <section className="hidden">Hidden section</section>`;
      const result = classifyFile(makeFile({ path: visFixture, diff }));
      expect(result.action).toBe('LIGHTWEIGHT');
      expect(result.reason).toContain('visibility');
    });

    it('upgrades invisible class to LIGHTWEIGHT', () => {
      // Line 16: <section className="invisible">
      const diff = `@@ -16,1 +16,1 @@\n-      <section className="">Invisible section</section>\n+      <section className="invisible">Invisible section</section>`;
      const result = classifyFile(makeFile({ path: visFixture, diff }));
      expect(result.action).toBe('LIGHTWEIGHT');
      expect(result.reason).toContain('visibility');
    });

    it('upgrades opacity-0 class to LIGHTWEIGHT', () => {
      // Line 17: <section className="opacity-0">
      const diff = `@@ -17,1 +17,1 @@\n-      <section className="opacity-100">Transparent section</section>\n+      <section className="opacity-0">Transparent section</section>`;
      const result = classifyFile(makeFile({ path: visFixture, diff }));
      expect(result.action).toBe('LIGHTWEIGHT');
      expect(result.reason).toContain('visibility');
    });

    it('upgrades w-0 h-0 classes to LIGHTWEIGHT', () => {
      // Line 18: <section className="w-0 h-0">
      const diff = `@@ -18,1 +18,1 @@\n-      <section className="">Zero-size section</section>\n+      <section className="w-0 h-0">Zero-size section</section>`;
      const result = classifyFile(makeFile({ path: visFixture, diff }));
      expect(result.action).toBe('LIGHTWEIGHT');
      expect(result.reason).toContain('visibility');
    });

    it('upgrades sr-only class to LIGHTWEIGHT', () => {
      // Line 19: <section className="sr-only">
      const diff = `@@ -19,1 +19,1 @@\n-      <section className="">Screen-reader-only text</section>\n+      <section className="sr-only">Screen-reader-only text</section>`;
      const result = classifyFile(makeFile({ path: visFixture, diff }));
      expect(result.action).toBe('LIGHTWEIGHT');
      expect(result.reason).toContain('visibility');
    });
  });

  describe('LIGHTWEIGHT — layout-affecting styling (Tailwind)', () => {
    const visFixture = resolve(FIXTURES, 'fixture-visibility-styling.tsx');

    it('upgrades overflow-hidden to LIGHTWEIGHT', () => {
      // Line 22: <nav className="overflow-hidden">
      const diff = `@@ -22,1 +22,1 @@\n-      <nav className="">Clipped nav</nav>\n+      <nav className="overflow-hidden">Clipped nav</nav>`;
      const result = classifyFile(makeFile({ path: visFixture, diff }));
      expect(result.action).toBe('LIGHTWEIGHT');
      expect(result.reason).toContain('layout');
    });

    it('upgrades pointer-events-none to LIGHTWEIGHT', () => {
      // Line 23: <button className="pointer-events-none">
      const diff = `@@ -23,1 +23,1 @@\n-      <button className="">Non-interactive button</button>\n+      <button className="pointer-events-none">Non-interactive button</button>`;
      const result = classifyFile(makeFile({ path: visFixture, diff }));
      expect(result.action).toBe('LIGHTWEIGHT');
      expect(result.reason).toContain('layout');
    });

    it('upgrades negative translate (off-screen) to LIGHTWEIGHT', () => {
      // Line 24: <div className="-translate-x-full">
      const diff = `@@ -24,1 +24,1 @@\n-      <div className="">Translated off-screen</div>\n+      <div className="-translate-x-full">Translated off-screen</div>`;
      const result = classifyFile(makeFile({ path: visFixture, diff }));
      expect(result.action).toBe('LIGHTWEIGHT');
      expect(result.reason).toContain('layout');
    });

    it('upgrades absolute positioning to LIGHTWEIGHT', () => {
      // Line 25: <div className="absolute z-10">
      const diff = `@@ -25,1 +25,1 @@\n-      <div className="">Positioned element</div>\n+      <div className="absolute z-10">Positioned element</div>`;
      const result = classifyFile(makeFile({ path: visFixture, diff }));
      expect(result.action).toBe('LIGHTWEIGHT');
      expect(result.reason).toContain('layout');
    });
  });

  describe('LIGHTWEIGHT — visibility-breaking styling (inline CSS)', () => {
    const visFixture = resolve(FIXTURES, 'fixture-visibility-styling.tsx');

    it('upgrades display:none to LIGHTWEIGHT', () => {
      // Line 28: <div style={{ display: "none" }}>
      const diff = `@@ -28,1 +28,1 @@\n-      <div style={{ display: "block" }}>Display none</div>\n+      <div style={{ display: "none" }}>Display none</div>`;
      const result = classifyFile(makeFile({ path: visFixture, diff }));
      expect(result.action).toBe('LIGHTWEIGHT');
      expect(result.reason).toContain('visibility');
    });

    it('upgrades visibility:hidden to LIGHTWEIGHT', () => {
      // Line 29: <div style={{ visibility: "hidden" }}>
      const diff = `@@ -29,1 +29,1 @@\n-      <div style={{ visibility: "visible" }}>Visibility hidden</div>\n+      <div style={{ visibility: "hidden" }}>Visibility hidden</div>`;
      const result = classifyFile(makeFile({ path: visFixture, diff }));
      expect(result.action).toBe('LIGHTWEIGHT');
      expect(result.reason).toContain('visibility');
    });

    it('upgrades opacity:0 to LIGHTWEIGHT', () => {
      // Line 30: <div style={{ opacity: 0 }}>
      const diff = `@@ -30,1 +30,1 @@\n-      <div style={{ opacity: 1 }}>Opacity zero</div>\n+      <div style={{ opacity: 0 }}>Opacity zero</div>`;
      const result = classifyFile(makeFile({ path: visFixture, diff }));
      expect(result.action).toBe('LIGHTWEIGHT');
      expect(result.reason).toContain('visibility');
    });

    it('upgrades transform:translateX to LIGHTWEIGHT', () => {
      // Line 36: <div style={{ transform: "translateX(-100%)" }}>
      const diff = `@@ -36,1 +36,1 @@\n-      <div style={{ transform: "none" }}>Off-screen</div>\n+      <div style={{ transform: "translateX(-100%)" }}>Off-screen</div>`;
      const result = classifyFile(makeFile({ path: visFixture, diff }));
      expect(result.action).toBe('LIGHTWEIGHT');
      expect(result.reason).toContain('layout');
    });

    it('upgrades pointerEvents:none (JSX camelCase) to LIGHTWEIGHT', () => {
      // Line 35: <div style={{ pointerEvents: "none" }}>
      const diff = `@@ -35,1 +35,1 @@\n-      <div style={{ pointerEvents: "auto" }}>Non-interactive</div>\n+      <div style={{ pointerEvents: "none" }}>Non-interactive</div>`;
      const result = classifyFile(makeFile({ path: visFixture, diff }));
      expect(result.action).toBe('LIGHTWEIGHT');
      expect(result.reason).toContain('layout');
    });
  });

  describe('SKIP — genuinely cosmetic styling (no behaviour change)', () => {
    const visFixture = resolve(FIXTURES, 'fixture-visibility-styling.tsx');

    it('skips color-only Tailwind changes', () => {
      // Line 41: className="text-blue-500 font-bold text-xl" (own line in multi-line <h2>)
      const diff = `@@ -41,1 +41,1 @@\n-        className="text-blue-500 font-bold text-xl"\n+        className="text-red-600 font-semibold text-2xl"`;
      const result = classifyFile(makeFile({ path: visFixture, diff }));
      expect(result.action).toBe('SKIP');
      expect(result.reason).toContain('Cosmetic');
    });

    it('skips color/font inline style changes', () => {
      // Line 42: style={{ color: "red", fontWeight: "bold", borderRadius: "4px" }}
      // (own line in multi-line <h2> → maps to jsx-styling; cosmetic content → SKIP)
      const diff = `@@ -42,1 +42,1 @@\n-        style={{ color: "red", fontWeight: "bold", borderRadius: "4px" }}\n+        style={{ color: "blue", fontWeight: "semibold", borderRadius: "8px" }}`;
      const result = classifyFile(makeFile({ path: visFixture, diff }));
      expect(result.action).toBe('SKIP');
      expect(result.reason).toContain('Cosmetic');
    });
  });

  // ─── changedRegions metadata ─────────────────────────────────────────────────

  describe('changedRegions is populated', () => {
    it('includes detected regions in result', () => {
      const diff = `@@ -11,1 +11,1 @@\n-    setCount((prev) => prev + 1);\n+    setCount((prev) => prev + 2);`;
      const result = classifyFile(makeFile({ diff }));
      expect(result.changedRegions).toBeDefined();
      expect(result.changedRegions!.length).toBeGreaterThan(0);
    });

    it('does not include changedRegions for fast-path results', () => {
      const result = classifyFile(makeFile({ status: 'D' }));
      expect(result.changedRegions).toBeUndefined();
    });
  });
});
