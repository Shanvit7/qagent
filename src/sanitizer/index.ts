/**
 * Post-generation test code sanitizer.
 *
 * Deterministic transforms applied to AI-generated Playwright test code
 * BEFORE running it. Catches known-bad patterns that the AI repeatedly
 * produces despite prompt instructions. No AI call needed — pure regex.
 *
 * Each transform returns the modified code and a boolean indicating if
 * it changed anything (for logging).
 */

export interface SanitizeResult {
  code: string;
  /** Human-readable list of transforms that fired. */
  applied: string[];
}

// ─── Individual transforms ────────────────────────────────────────────────────

/**
 * Tailwind slash-class sanitizer.
 *
 * AI often emits selectors like `span.text-muted-foreground/50` or
 * `div.bg-primary/20` — the `/` is a Tailwind opacity shorthand that is
 * INVALID in CSS selectors and crashes Playwright's query engine.
 *
 * Strategy: find `.locator('...')` / `.locator("...")` calls containing
 * a class selector with `/`, and replace the whole locator arg with a
 * broader parent-scoped selector that drops the offending class.
 */
const fixTailwindSlashClasses = (code: string): { code: string; fired: boolean } => {
  // Match locator calls whose argument contains a CSS class with /
  // e.g. page.locator('span.text-xs.text-muted-foreground/50')
  //      page.locator("div.bg-primary/20.rounded")
  const SLASH_CLASS_IN_LOCATOR =
    /(\.(locator|querySelector)\s*\(\s*(['"`]))([^'"`]*?\.[\w-]+\/[\w.[\]%-]+)(['"`]\s*\))/g;

  let fired = false;
  const result = code.replace(
    SLASH_CLASS_IN_LOCATOR,
    (match, prefix, _method, _q, selectorBody, suffix) => {
      fired = true;
      // Extract the tag name if present (e.g. "span" from "span.text-xs.text-muted-foreground/50")
      const tagMatch = selectorBody.match(/^([a-z][a-z0-9]*)/i);
      // Keep only classes that don't contain /
      const classes = selectorBody.match(/\.[\w-]+(?:\/[\w.[\]%-]+)?/g) ?? [];
      const safeClasses = classes.filter((c: string) => !c.includes('/')).join('');

      const tag = tagMatch ? tagMatch[1] : '*';
      const newSelector = safeClasses ? `${tag}${safeClasses}` : tag;
      return `${prefix}${newSelector}${suffix}`;
    },
  );

  return { code: result, fired };
};

/**
 * Strip `waitForTimeout()` calls — these are always flaky.
 * Replace with a comment explaining why.
 */
const fixWaitForTimeout = (code: string): { code: string; fired: boolean } => {
  const pattern = /await\s+page\.waitForTimeout\s*\(\s*\d+\s*\)\s*;?/g;
  let fired = false;
  const result = code.replace(pattern, () => {
    fired = true;
    return '// waitForTimeout removed — use waitForSelector or expect().toBeVisible() instead';
  });
  return { code: result, fired };
};

/**
 * Fix bare `page.locator('.some-class')` into `page.locator('.some-class').first()`
 * when used directly with `.click()` / `.fill()` etc — prevents strict mode violations
 * on non-unique selectors.
 *
 * Only applies to CSS-class selectors (starting with .) since those are most
 * likely to match multiple elements. Role/text selectors are usually unique.
 */
const fixStrictModeOnCssSelectors = (code: string): { code: string; fired: boolean } => {
  // page.locator('.foo').click() → page.locator('.foo').first().click()
  // but NOT page.locator('.foo').first().click() (already scoped)
  const pattern =
    /(page\.locator\s*\(\s*['"`]\.[^'"`]+['"`]\s*\))(?!\.first\(\))(\.(?:click|fill|check|uncheck|press|selectOption|tap|hover|focus|type|clear)\s*\()/g;
  let fired = false;
  const result = code.replace(pattern, (_match, locatorPart, actionPart) => {
    fired = true;
    return `${locatorPart}.first()${actionPart}`;
  });
  return { code: result, fired };
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Apply all deterministic sanitizers to generated test code.
 * Returns the cleaned code and a list of transforms that fired.
 */
export const sanitizeTestCode = (code: string): SanitizeResult => {
  const applied: string[] = [];
  let current = code;

  const tw = fixTailwindSlashClasses(current);
  if (tw.fired) {
    current = tw.code;
    applied.push('tailwind-slash-class');
  }

  const wt = fixWaitForTimeout(current);
  if (wt.fired) {
    current = wt.code;
    applied.push('waitForTimeout');
  }

  const sm = fixStrictModeOnCssSelectors(current);
  if (sm.fired) {
    current = sm.code;
    applied.push('strict-mode-css');
  }

  return { code: current, applied };
};
