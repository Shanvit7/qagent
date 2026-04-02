/**
 * Runtime probe — navigates to a route in a real browser and captures
 * ground-truth state before test generation.
 *
 * Instead of trying to statically infer how a component hides/shows
 * elements (animation libraries, CSS tricks, custom hooks, portals …),
 * we let the browser tell us what's actually accessible, visible, and
 * interactive at each relevant viewport.
 *
 * The probe result becomes the primary source of truth for selector
 * derivation and assertion strategy in the generated tests.
 */

import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { loadProjectEnv } from "@/server/index";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProbeViewport {
  label: "desktop" | "mobile";
  width: number;
  height: number;
}

export interface AccessibleNode {
  role: string;
  name?: string | undefined;
  /** aria-label or accessible name */
  description?: string | undefined;
  /** Whether the element is currently visible (not hidden/inert/opacity:0) */
  visible?: boolean | undefined;
  /** Nested children */
  children?: AccessibleNode[] | undefined;
}

export interface ProbeSnapshot {
  viewport: ProbeViewport;
  /** Serialised accessibility tree from the live page */
  a11yTree: AccessibleNode | null;
  /**
   * Flat list of interactive elements actually reachable at this viewport.
   * Role + accessible name pairs — what the test generator should use for locators.
   */
  interactiveElements: Array<{ role: string; name: string }>;
  /**
   * Elements present in the DOM but not in the a11y tree — inert, aria-hidden,
   * or display:none. The generator should NOT use getByRole on these.
   */
  hiddenElements: Array<{ selector: string; reason: "inert" | "aria-hidden" | "not-visible" }>;
  /**
   * Observed state changes from clicking toggle-like buttons (buttons whose
   * accessible name or aria attributes change after click).
   * Gives the generator ground truth for before/after locators — eliminates
   * stale locator bugs on toggle interactions.
   */
  interactionOutcomes: Array<{
    /** Role + name of the element clicked */
    trigger: { role: string; name: string };
    /** Attributes on the element BEFORE clicking */
    before: Record<string, string>;
    /** Attributes on the element (re-queried by position) AFTER clicking */
    after: Record<string, string>;
    /** New accessible name after the click (if changed) */
    nameAfter?: string | undefined;
  }>;
  /** Any console errors captured during load */
  consoleErrors: string[];
}

export interface RuntimeProbe {
  route: string;
  url: string;
  snapshots: ProbeSnapshot[];
  /** True if the dev server responded and the page loaded without hard error */
  success: boolean;
  error?: string | undefined;
}

// ─── Viewports to probe ───────────────────────────────────────────────────────

const PROBE_VIEWPORTS: ProbeViewport[] = [
  { label: "desktop", width: 1280, height: 800 },
  { label: "mobile",  width: 390,  height: 844 },
];

// ─── Probe script (runs inside a child node process) ─────────────────────────
// Written to a temp file and executed via `node` in the target project's cwd
// so it resolves @playwright/test from the correct node_modules.

const buildProbeScript = (
  url: string,
  outputPath: string,
  timeoutMs: number,
): string => `
const { chromium } = require('@playwright/test');
const fs = require('fs');

const VIEWPORTS = ${JSON.stringify(PROBE_VIEWPORTS)};

async function probeViewport(browser, baseUrl, vp) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
  });
  const page = await ctx.newPage();
  const consoleErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  try {
    await page.goto(baseUrl, {
      waitUntil: 'domcontentloaded',
      timeout: ${timeoutMs},
    });

    // Wait for React hydration: the body gets data-* attrs stripped after hydration.
    // Simpler signal: wait for first interactive element to be attached.
    try {
      await page.waitForFunction(
        () => document.readyState === 'complete',
        { timeout: ${Math.round(timeoutMs * 0.4)} },
      );
    } catch (_) { /* proceed with partial hydration */ }

    // ── Accessibility tree ──────────────────────────────────────────────────
    let a11yTree = null;
    try {
      a11yTree = await page.accessibility.snapshot({ interestingOnly: false });
    } catch (_) {}

    // ── Interactive elements reachable via a11y ─────────────────────────────
    const interactiveRoles = [
      'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
      'listbox', 'menuitem', 'tab', 'switch', 'searchbox', 'spinbutton',
    ];

    const interactiveElements = [];
    const walk = (node) => {
      if (!node) return;
      if (interactiveRoles.includes((node.role || '').toLowerCase()) && node.name) {
        interactiveElements.push({ role: node.role, name: node.name });
      }
      (node.children || []).forEach(walk);
    };
    walk(a11yTree);

    // ── Hidden / inaccessible elements ──────────────────────────────────────
    const hiddenElements = await page.evaluate(() => {
      const results = [];

      // Inert elements
      document.querySelectorAll('[inert], [inert=""]').forEach((el) => {
        const tag = el.tagName.toLowerCase();
        const cls = (el.getAttribute('class') || '').slice(0, 60);
        results.push({ selector: cls ? \`\${tag}.\${cls.split(' ')[0]}\` : tag, reason: 'inert' });
      });

      // aria-hidden elements that contain interactive children
      document.querySelectorAll('[aria-hidden="true"]').forEach((el) => {
        if (el.querySelector('button, a, input, select, textarea')) {
          const tag = el.tagName.toLowerCase();
          const cls = (el.getAttribute('class') || '').slice(0, 60);
          results.push({ selector: cls ? \`\${tag}.\${cls.split(' ')[0]}\` : tag, reason: 'aria-hidden' });
        }
      });

      return results;
    });

    // ── Interaction outcomes — click toggle buttons and capture state change ─
    // Only probe buttons whose name or aria attributes are likely to change
    // (toggles, menus, accordions). Cap at 3 to keep probe time bounded.
    const interactionOutcomes = [];
    const toggleCandidates = interactiveElements.filter(
      (el) => el.role === 'button' &&
        /menu|toggle|open|close|expand|collapse|show|hide|nav/i.test(el.name)
    ).slice(0, 3);

    for (const candidate of toggleCandidates) {
      try {
        // Fresh context so each interaction starts clean
        const ictx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
        const ipage = await ictx.newPage();
        await ipage.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: ${timeoutMs} });
        try { await ipage.waitForFunction(() => document.readyState === 'complete', { timeout: ${Math.round(timeoutMs * 0.3)} }); } catch (_) {}

        const btn = ipage.getByRole(candidate.role, { name: candidate.name });
        const btnCount = await btn.count();
        if (btnCount !== 1) { await ictx.close(); continue; }

        // Capture before state
        const beforeAttrs = await btn.evaluate((el) => {
          const attrs = {};
          for (const attr of ['aria-expanded', 'aria-pressed', 'aria-label', 'aria-selected']) {
            const val = el.getAttribute(attr);
            if (val !== null) attrs[attr] = val;
          }
          return attrs;
        });

        await btn.click();
        await ipage.waitForTimeout(300); // allow animation/state settle

        // Re-query by position (name may have changed)
        const afterEl = ipage.locator('button').filter({ hasText: '' }).nth(
          await ipage.evaluate((name) => {
            const btns = Array.from(document.querySelectorAll('button'));
            // find the button that previously had this aria-label, now by position
            const idx = btns.findIndex(b => b.getAttribute('aria-label') !== name);
            return idx >= 0 ? idx : 0;
          }, candidate.name)
        );

        // Simpler: just re-query all buttons at the same index
        const allBtnsBefore = await ipage.evaluate(() =>
          Array.from(document.querySelectorAll('button')).map(b => b.getAttribute('aria-label'))
        );
        // Find the button that is now "Close menu" or similar
        const afterAttrs = await ipage.evaluate((beforeName) => {
          const btns = Array.from(document.querySelectorAll('button'));
          // Find the button at the same DOM position (by matching initial siblings)
          // We'll just read all buttons' aria attributes to show what changed
          return btns
            .filter(b => b.getAttribute('aria-expanded') !== null || b.getAttribute('aria-label') !== null)
            .map(b => ({
              ariaLabel: b.getAttribute('aria-label'),
              ariaExpanded: b.getAttribute('aria-expanded'),
              ariaPressed: b.getAttribute('aria-pressed'),
            }));
        }, candidate.name);

        // Find the button whose state changed
        const changedBtn = afterAttrs.find(b =>
          b.ariaLabel !== candidate.name ||
          b.ariaExpanded !== beforeAttrs['aria-expanded']
        );

        if (changedBtn) {
          const afterState = {};
          if (changedBtn.ariaLabel) afterState['aria-label'] = changedBtn.ariaLabel;
          if (changedBtn.ariaExpanded !== null) afterState['aria-expanded'] = changedBtn.ariaExpanded;
          if (changedBtn.ariaPressed !== null) afterState['aria-pressed'] = changedBtn.ariaPressed;

          interactionOutcomes.push({
            trigger: candidate,
            before: beforeAttrs,
            after: afterState,
            nameAfter: changedBtn.ariaLabel !== candidate.name ? changedBtn.ariaLabel : undefined,
          });
        }

        await ictx.close();
      } catch (_) { /* skip this candidate */ }
    }

    await ctx.close();

    return {
      viewport: vp,
      a11yTree,
      interactiveElements,
      hiddenElements,
      interactionOutcomes,
      consoleErrors,
    };
  } catch (err) {
    await ctx.close();
    return {
      viewport: vp,
      a11yTree: null,
      interactiveElements: [],
      hiddenElements: [],
      interactionOutcomes: [],
      consoleErrors: [err.message],
    };
  }
}

(async () => {
  let browser;
  const result = { route: '${url}', url: '${url}', snapshots: [], success: false };

  try {
    browser = await chromium.launch({ headless: true });

    for (const vp of VIEWPORTS) {
      const snapshot = await probeViewport(browser, '${url}', vp);
      result.snapshots.push(snapshot);
    }

    result.success = result.snapshots.some(
      (s) => s.a11yTree !== null || s.interactiveElements.length > 0,
    );
  } catch (err) {
    result.error = err.message;
    result.success = false;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  fs.writeFileSync('${outputPath}', JSON.stringify(result, null, 2), 'utf8');
})();
`;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Navigate to `route` against the running dev server at `serverUrl`,
 * capture the accessibility tree and DOM state at desktop + mobile
 * viewports, and return a structured `RuntimeProbe`.
 *
 * Uses the target project's `@playwright/test` (resolved from `cwd`)
 * so the browser binary matches what the project already has installed.
 *
 * Fails gracefully — if the server is unavailable or the page errors,
 * `success: false` is returned and generation falls back to source-only mode.
 *
 * @param route   URL path, e.g. "/" or "/about"
 * @param serverUrl  Full base URL of the dev server, e.g. "http://localhost:3000"
 * @param cwd     Target project root (used to resolve Playwright)
 * @param timeoutMs  Per-viewport timeout in ms (default: 8000)
 */
export const probeRoute = async (
  route: string,
  serverUrl: string,
  cwd: string,
  timeoutMs = 8_000,
): Promise<RuntimeProbe> => {
  const url = `${serverUrl.replace(/\/$/, "")}${route}`;
  const hash = randomBytes(4).toString("hex");
  const scriptPath = join(cwd, ".qagent", "tmp", `probe-${hash}.cjs`);
  const outputPath = join(cwd, ".qagent", "tmp", `probe-${hash}.json`);

  // Ensure tmp dir exists
  const { mkdirSync } = await import("node:fs");
  mkdirSync(join(cwd, ".qagent", "tmp"), { recursive: true });

  writeFileSync(scriptPath, buildProbeScript(url, outputPath, timeoutMs), "utf8");

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("node", [scriptPath], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: timeoutMs * PROBE_VIEWPORTS.length + 5_000,
        // Inject target project's .env so the browser (and any node-level
        // Playwright config) sees the same environment as the dev server.
        env: { ...process.env, ...loadProjectEnv(cwd) },
      });

      child.on("exit", (code) => {
        if (code === 0 || existsSync(outputPath)) resolve();
        else reject(new Error(`Probe script exited with code ${code}`));
      });
      child.on("error", reject);
    });

    if (!existsSync(outputPath)) {
      return { route, url, snapshots: [], success: false, error: "Probe produced no output" };
    }

    const raw = JSON.parse(readFileSync(outputPath, "utf8")) as RuntimeProbe;
    raw.route = route;
    return raw;
  } catch (err) {
    return {
      route,
      url,
      snapshots: [],
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    try { unlinkSync(scriptPath); } catch { /* ignore */ }
    try { unlinkSync(outputPath); } catch { /* ignore */ }
  }
};

// ─── Probe → prompt serialisation ────────────────────────────────────────────

/**
 * Render a `RuntimeProbe` as a structured prompt block that the test
 * generator injects directly above the test-writing instructions.
 *
 * The block tells the LLM exactly what's reachable at each viewport
 * so it can write correct locators and skip elements that aren't there.
 */
export const formatProbeForPrompt = (probe: RuntimeProbe): string => {
  if (!probe.success || probe.snapshots.length === 0) return "";

  const lines: string[] = [
    `## 🔍 Live page snapshot — ground truth for selectors and interactions`,
    `Route probed: \`${probe.route}\` at ${probe.snapshots.length} viewports before generation.`,
    ``,
  ];

  for (const snap of probe.snapshots) {
    lines.push(`### ${snap.viewport.label} (${snap.viewport.width}×${snap.viewport.height})`);

    if (snap.interactiveElements.length > 0) {
      lines.push(`**Reachable interactive elements** (use these exact locators):`);
      for (const el of snap.interactiveElements) {
        lines.push(`- \`page.getByRole("${el.role}", { name: "${el.name}" })\``);
      }
    } else {
      lines.push(`_No interactive elements found at this viewport._`);
    }

    // ── Interaction outcomes — the most important section ─────────────────
    // Shows what ACTUALLY happens when toggle buttons are clicked.
    // Use these to avoid stale locator bugs — never assume a locator
    // that matches by name is still valid after an interaction.
    if (snap.interactionOutcomes.length > 0) {
      lines.push(``);
      lines.push(`**Observed interaction outcomes** (what changes when you click these):`);
      for (const outcome of snap.interactionOutcomes) {
        const beforeStr = Object.entries(outcome.before)
          .map(([k, v]) => `${k}="${v}"`)
          .join(", ");
        const afterStr = Object.entries(outcome.after)
          .map(([k, v]) => `${k}="${v}"`)
          .join(", ");
        lines.push(`- Click \`getByRole("${outcome.trigger.role}", { name: "${outcome.trigger.name}" })\``);
        lines.push(`  Before: ${beforeStr || "(no tracked attrs)"}`);
        lines.push(`  After:  ${afterStr || "(no tracked attrs)"}`);
        if (outcome.nameAfter) {
          lines.push(`  ⚠️  Name changes to "${outcome.nameAfter}" — re-query after click:`);
          lines.push(`  \`page.getByRole("${outcome.trigger.role}", { name: "${outcome.nameAfter}" })\``);
        }
      }
    }

    if (snap.hiddenElements.length > 0) {
      lines.push(``);
      lines.push(`**Elements in DOM but NOT accessible** (do NOT use getByRole on these):`);
      for (const h of snap.hiddenElements) {
        lines.push(`- \`${h.selector}\` — ${h.reason}`);
      }
    }

    if (snap.consoleErrors.length > 0) {
      lines.push(``);
      lines.push(`**Console errors on load:** ${snap.consoleErrors.slice(0, 3).join(" | ")}`);
    }

    lines.push(``);
  }

  lines.push(
    `> Elements that appear only in one viewport snapshot require \`page.setViewportSize()\` BEFORE \`page.goto()\`.`,
  );

  return lines.join("\n");
};
