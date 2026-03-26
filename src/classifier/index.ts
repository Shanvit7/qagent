/**
 * AST-based change classifier.
 *
 * Determines QA depth per staged file by mapping git diff line numbers to
 * structural regions in the source AST via ts-morph. No regex guessing —
 * we know exactly whether a changed line is inside a Props interface, a
 * function body, a JSX className attribute, a hook call, or an import.
 *
 * Fast-path checks (deleted, assets, data files, renames) short-circuit
 * before any AST work. AST parsing (~5-15ms per file) only runs for
 * modified code files.
 */

import { existsSync, readFileSync } from "node:fs";
import { Project, SyntaxKind, type SourceFile, type Node } from "ts-morph";
import type { StagedFile } from "../git/staged.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChangeAction = "SKIP" | "LIGHTWEIGHT" | "FULL_QA";

export type ChangeRegion =
  | "imports"
  | "props"
  | "types"
  | "jsx-styling"
  | "jsx-cosmetic"
  | "jsx-markup"
  | "function-body"
  | "hook-deps"
  | "server-action"
  | "exports";

export interface ClassificationResult {
  action: ChangeAction;
  reason: string;
  changedRegions?: ChangeRegion[];
}

export interface ClassifiedFile {
  file: StagedFile;
  classification: ClassificationResult;
}

interface LineRange {
  start: number;
  end: number;
  region: ChangeRegion;
  name?: string | undefined;
}

// ─── Extension sets ───────────────────────────────────────────────────────────

const TRIVIAL_EXTENSIONS = new Set([
  ".css", ".scss", ".sass", ".less",
  ".svg", ".png", ".jpg", ".jpeg", ".gif", ".ico",
  ".woff", ".woff2", ".ttf", ".eot",
]);

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const DATA_EXTENSIONS = new Set([".json", ".yaml", ".yml", ".toml", ".env"]);

const getExtension = (filePath: string): string => {
  const idx = filePath.lastIndexOf(".");
  return idx >= 0 ? filePath.slice(idx).toLowerCase() : "";
};

// ─── Diff line number parser ──────────────────────────────────────────────────
// Walks unified diff hunks and extracts the new-file-side line numbers for
// every added (+) line. Removed lines don't exist in the new file so they
// don't increment the counter.

const extractChangedLineNumbers = (diff: string): Set<number> => {
  const lines = diff.split("\n");
  const changed = new Set<number>();
  let currentLine = 0;

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      currentLine = parseInt(hunkMatch[1]!, 10);
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      changed.add(currentLine);
      currentLine++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      // Removed line — doesn't exist in new file, don't advance
    } else if (currentLine > 0) {
      currentLine++;
    }
  }
  return changed;
};

// ─── AST region mapper ────────────────────────────────────────────────────────
// Parses the source file and builds an array of LineRange entries mapping
// line spans to structural regions. Regions can overlap; the classifier
// picks the most specific one per line.

const REGION_SPECIFICITY: Record<ChangeRegion, number> = {
  "jsx-styling":   10,
  "jsx-cosmetic":   9,
  "hook-deps":      8,
  "jsx-markup":     7,
  "server-action":  6,
  "function-body":  5,
  "props":          4,
  "types":          3,
  "exports":        2,
  "imports":        1,
};

const HOOK_NAMES = new Set(["useEffect", "useMemo", "useCallback", "useLayoutEffect"]);

// ─── Styling & cosmetic attribute detection ──────────────────────────────────
// Covers the full React/Next.js ecosystem: Tailwind, CSS Modules, CSS-in-JS,
// MUI/Chakra sx, styled-components, Twin Macro, inline styles, etc.

const STYLING_ATTRIBUTES = new Set([
  "className", "class",       // standard + JSX alias
  "style",                    // inline styles
  "sx",                       // MUI / Chakra UI / Theme UI
  "css",                      // Emotion css prop / Stitches
  "tw",                       // Twin Macro
  "cs",                       // Twin Macro secondary
]);

const COSMETIC_ATTRIBUTES = new Set([
  "id", "testID", "role", "placeholder", "title", "alt",
  "htmlFor", "tabIndex", "lang", "dir", "slot", "nonce",
  "autoFocus", "draggable", "hidden", "spellCheck",
]);

const isCosmeticAttribute = (name: string): boolean =>
  COSMETIC_ATTRIBUTES.has(name) ||
  name.startsWith("data-") ||
  name.startsWith("aria-");

// Tags for CSS-in-JS tagged template literals (css``, tw``, keyframes``, etc.)
const STYLING_TAGS = new Set(["css", "tw", "injectGlobal", "createGlobalStyle", "keyframes"]);

const addRange = (ranges: LineRange[], node: Node, region: ChangeRegion, name?: string): void => {
  ranges.push({
    start: node.getStartLineNumber(),
    end: node.getEndLineNumber(),
    region,
    name,
  });
};

const buildLineRegionMap = (filePath: string): LineRange[] => {
  if (!existsSync(filePath)) return [];

  const sourceText = readFileSync(filePath, "utf8");
  const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
  const sf: SourceFile = project.addSourceFileAtPath(filePath);
  const ranges: LineRange[] = [];

  const isServerActionFile =
    sourceText.trimStart().startsWith('"use server"') ||
    sourceText.trimStart().startsWith("'use server'");

  // Imports
  for (const node of sf.getImportDeclarations()) {
    addRange(ranges, node, "imports");
  }

  // Interfaces
  for (const node of sf.getInterfaces()) {
    const name = node.getName();
    addRange(ranges, node, name.endsWith("Props") ? "props" : "types", name);
  }

  // Type aliases
  for (const node of sf.getTypeAliases()) {
    const name = node.getName();
    addRange(ranges, node, name.endsWith("Props") ? "props" : "types", name);
  }

  // Export declarations (re-exports like `export { foo } from './bar'`)
  for (const node of sf.getExportDeclarations()) {
    addRange(ranges, node, "exports");
  }

  // Export assignments (`export default ...`)
  const exportAssignment = sf.getExportAssignment(() => true);
  if (exportAssignment) {
    addRange(ranges, exportAssignment, "exports");
  }

  // Functions (declarations and variable-declared arrow functions)
  const walkFunctions = (node: Node): void => {
    if (
      node.getKind() === SyntaxKind.FunctionDeclaration ||
      node.getKind() === SyntaxKind.ArrowFunction ||
      node.getKind() === SyntaxKind.FunctionExpression ||
      node.getKind() === SyntaxKind.MethodDeclaration
    ) {
      let funcName: string | undefined;

      if (node.getKind() === SyntaxKind.FunctionDeclaration) {
        funcName = node.asKindOrThrow(SyntaxKind.FunctionDeclaration).getName();
      } else {
        const parent = node.getParent();
        if (parent?.getKind() === SyntaxKind.VariableDeclaration) {
          funcName = parent.asKindOrThrow(SyntaxKind.VariableDeclaration).getName();
        }
      }

      const hasInlineUseServer = node.getText().includes('"use server"') || node.getText().includes("'use server'");
      const region: ChangeRegion = (isServerActionFile || hasInlineUseServer) ? "server-action" : "function-body";
      addRange(ranges, node, region, funcName);
    }

    node.forEachChild(walkFunctions);
  };

  // JSX elements, styling attributes, and cosmetic attributes
  const walkJsx = (node: Node): void => {
    if (
      node.getKind() === SyntaxKind.JsxElement ||
      node.getKind() === SyntaxKind.JsxSelfClosingElement
    ) {
      addRange(ranges, node, "jsx-markup");
    }

    if (node.getKind() === SyntaxKind.JsxAttribute) {
      const attr = node.asKindOrThrow(SyntaxKind.JsxAttribute);
      const attrName = attr.getNameNode().getText();
      if (STYLING_ATTRIBUTES.has(attrName)) {
        addRange(ranges, node, "jsx-styling");
      } else if (isCosmeticAttribute(attrName)) {
        addRange(ranges, node, "jsx-cosmetic");
      }
    }

    node.forEachChild(walkJsx);
  };

  // CSS-in-JS tagged templates: styled.div`...`, css`...`, tw`...`, keyframes`...`
  const walkStyledTemplates = (node: Node): void => {
    if (node.getKind() === SyntaxKind.TaggedTemplateExpression) {
      const tagged = node.asKindOrThrow(SyntaxKind.TaggedTemplateExpression);
      const tagText = tagged.getTag().getText();
      if (
        STYLING_TAGS.has(tagText) ||
        tagText.startsWith("styled.") ||
        tagText.startsWith("styled(")
      ) {
        addRange(ranges, node, "jsx-styling", tagText);
      }
    }
    node.forEachChild(walkStyledTemplates);
  };

  // Hook calls (useEffect, useMemo, useCallback, useLayoutEffect)
  const walkHooks = (node: Node): void => {
    if (node.getKind() === SyntaxKind.CallExpression) {
      const call = node.asKindOrThrow(SyntaxKind.CallExpression);
      const expr = call.getExpression();
      const callName = expr.getText();
      if (HOOK_NAMES.has(callName)) {
        addRange(ranges, node, "hook-deps", callName);
      }
    }
    node.forEachChild(walkHooks);
  };

  sf.forEachChild(walkFunctions);
  sf.forEachChild(walkJsx);
  sf.forEachChild(walkHooks);
  sf.forEachChild(walkStyledTemplates);

  return ranges;
};

// ─── Line-to-region mapping ───────────────────────────────────────────────────
// For each changed line number, find all overlapping regions and pick the
// most specific one.

const mapLinesToRegions = (changedLines: Set<number>, ranges: LineRange[]): Set<ChangeRegion> => {
  const regions = new Set<ChangeRegion>();

  for (const lineNum of changedLines) {
    let bestRegion: ChangeRegion | null = null;
    let bestSpecificity = -1;

    for (const range of ranges) {
      if (lineNum >= range.start && lineNum <= range.end) {
        const spec = REGION_SPECIFICITY[range.region];
        if (spec > bestSpecificity) {
          bestSpecificity = spec;
          bestRegion = range.region;
        }
      }
    }

    if (bestRegion) {
      regions.add(bestRegion);
    }
  }

  return regions;
};

// ─── Styling impact analysis ──────────────────────────────────────────────────
// Determines how much a styling change can affect what Playwright observes.
//
// Why this matters: not all CSS changes are cosmetic. Some affect whether
// elements are visible, reachable, or interactable in the browser:
//
//   VISIBILITY  — element may become hidden or unreachable entirely
//                 (display:none, visibility:hidden, opacity:0, w-0, h-0, hidden)
//                 → LIGHTWEIGHT: run render checks to verify elements still appear
//
//   LAYOUT      — element repositioned, clipped, or interaction-blocked
//                 (overflow:hidden, pointer-events:none, transform, position, z-index)
//                 → LIGHTWEIGHT: verify elements are still reachable/clickable
//
//   COSMETIC    — pure visual change (color, font, border-radius, padding, margin)
//                 Playwright assertions don't catch these; visual regression testing
//                 (screenshot diffs) is the right tool for this class of change.
//                 → SKIP

type StylingImpact = "cosmetic" | "layout" | "visibility";

/**
 * Scan the added lines of a diff for styling properties that can affect
 * element visibility or Playwright's ability to interact with them.
 */
const analyzeStylingImpact = (diff: string): StylingImpact => {
  // Collect only added/changed lines — removals don't create new problems
  const added = diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .join(" ");

  // ── Layout-affecting (Tailwind) — checked FIRST to avoid false matches ────────
  // overflow-hidden must be detected before the \bhidden\b visibility check because
  // `hidden` in `overflow-hidden` sits after a `-` (non-word char), so \bhidden\b
  // would wrongly match it and return "visibility" instead of "layout".
  if (/\boverflow-(?:x-|y-)?hidden\b/.test(added))       return "layout";
  if (/\bpointer-events-none\b/.test(added))             return "layout";
  // Framer-motion / Tailwind translate patterns: -translate-x-full, translate-y-8, etc.
  if (/\b-?translate-[xy]-/.test(added))                 return "layout";
  if (/\b(?:fixed|absolute|sticky)\b/.test(added))       return "layout"; // positioning
  if (/\bz-(?:\d+|auto)\b/.test(added))                  return "layout"; // stacking order

  // ── Visibility-breaking (Tailwind) ──────────────────────────────────────────
  // overflow-hidden is already handled above — remaining hidden/invisible classes are
  // pure visibility killers (display:none, visibility:hidden, etc.)
  if (/\bhidden\b/.test(added))      return "visibility"; // display: none
  if (/\binvisible\b/.test(added))   return "visibility"; // visibility: hidden
  if (/\bopacity-0\b/.test(added))   return "visibility"; // opacity: 0
  if (/\bw-0\b/.test(added))         return "visibility"; // width: 0
  if (/\bh-0\b/.test(added))         return "visibility"; // height: 0
  if (/\bscale-0\b/.test(added))     return "visibility"; // transform: scale(0)
  if (/\bsr-only\b/.test(added))     return "visibility"; // visually hidden (screen-reader only)

  // ── Visibility-breaking (CSS / inline style / sx) ──────────────────────────
  // JSX inline styles use JS string values: `display: "none"`, `visibility: "hidden"`, etc.
  // The regex allows for optional quotes around the value to handle both CSS and JSX syntax.
  if (/display\s*:\s*["']?none["']?/.test(added))                       return "visibility";
  if (/visibility\s*:\s*["']?hidden["']?/.test(added))                  return "visibility";
  if (/opacity\s*:\s*["']?0(?:[^.]|["']|$)/.test(added))               return "visibility"; // 0 but not 0.5
  if (/(?:width|height)\s*:\s*["']?0(?:px)?["']?[,;\s}]/.test(added)) return "visibility";

  // ── Layout-affecting (CSS / inline style / sx) ──────────────────────────────
  if (/overflow\s*:/.test(added))                        return "layout";
  if (/pointer-?[Ee]vents\s*:/.test(added))              return "layout"; // CSS: pointer-events / JSX: pointerEvents
  if (/transform\s*:|translateX|translateY|translate3d/.test(added)) return "layout";
  if (/position\s*:\s*["']?(?:absolute|fixed|sticky)/.test(added))    return "layout";
  if (/z-index\s*:/.test(added))                         return "layout";

  // Everything else: colors, fonts, border-radius, padding, margin, etc.
  return "cosmetic";
};

// ─── Region-based classification ──────────────────────────────────────────────

const classifyByRegions = (regions: Set<ChangeRegion>, diff: string): { action: ChangeAction; reason: string } => {
  if (regions.size === 0) {
    return { action: "FULL_QA", reason: "Changed lines outside recognized structures" };
  }

  const all = [...regions];

  // Import-only — no runtime behaviour changed, nothing for Playwright to catch
  if (all.every((r) => r === "imports")) {
    return { action: "SKIP", reason: "Import-only change — no browser-visible behaviour affected" };
  }

  // Styling-only (className, style, sx, css, tw, styled-components, etc.)
  // Impact determines depth: not all CSS changes are cosmetic.
  if (all.every((r) => r === "jsx-styling" || r === "imports")) {
    const impact = analyzeStylingImpact(diff);
    if (impact === "visibility") {
      return {
        action: "LIGHTWEIGHT",
        reason: "Styling change affects element visibility — verify elements still render and are reachable",
      };
    }
    if (impact === "layout") {
      return {
        action: "LIGHTWEIGHT",
        reason: "Styling change affects layout or interaction (overflow/transform/position) — verify elements are reachable",
      };
    }
    return { action: "SKIP", reason: "Cosmetic styling change (color/font/spacing) — no browser behaviour to test" };
  }

  // Cosmetic attributes only (data-*, aria-*, id, placeholder, etc.)
  if (all.every((r) => r === "jsx-cosmetic" || r === "imports")) {
    return { action: "SKIP", reason: "Cosmetic attribute change — no behaviour to regression-test" };
  }

  // Styling + cosmetic mix — run impact check on the styling side
  if (all.every((r) => r === "jsx-styling" || r === "jsx-cosmetic" || r === "imports")) {
    const impact = analyzeStylingImpact(diff);
    if (impact === "visibility") {
      return {
        action: "LIGHTWEIGHT",
        reason: "Styling change affects element visibility — verify elements still render and are reachable",
      };
    }
    if (impact === "layout") {
      return {
        action: "LIGHTWEIGHT",
        reason: "Styling change affects layout or interaction — verify elements are reachable",
      };
    }
    return { action: "SKIP", reason: "Styling/cosmetic change — no browser behaviour to test" };
  }

  // Types/props only — interface contract changed; verify rendered output still correct
  const isTypeOnly = all.every((r) => r === "props" || r === "types" || r === "imports" || r === "exports");
  if (isTypeOnly && regions.has("props")) {
    return { action: "LIGHTWEIGHT", reason: "Prop interface changed — check rendered output" };
  }
  if (isTypeOnly) {
    return { action: "LIGHTWEIGHT", reason: "Type definition changed — check rendered output" };
  }

  // JSX markup changed but no handler/hook logic.
  // Before returning the default "structure changed" reason, check if the diff
  // contains visibility or layout-affecting properties — a single-line element
  // like `<div style={{ display: "none" }}>` maps to jsx-markup (element wins),
  // but the content still affects what Playwright can observe.
  const isMarkupOnly = all.every((r) => r === "jsx-markup" || r === "jsx-styling" || r === "jsx-cosmetic" || r === "imports");
  if (isMarkupOnly) {
    const impact = analyzeStylingImpact(diff);
    if (impact === "visibility") {
      return {
        action: "LIGHTWEIGHT",
        reason: "JSX change affects element visibility — verify elements still render and are reachable",
      };
    }
    if (impact === "layout") {
      return {
        action: "LIGHTWEIGHT",
        reason: "JSX change affects layout or interaction (overflow/transform/position) — verify elements are reachable",
      };
    }
    return { action: "LIGHTWEIGHT", reason: "JSX structure changed — verify elements render and are reachable" };
  }

  // Server action body changed — test the full form submission flow + auth
  if (regions.has("server-action")) {
    return { action: "FULL_QA", reason: "Server action logic changed — test form submission, redirects, and auth" };
  }

  // Effect/memo/callback deps changed — re-run interaction + state tests
  if (regions.has("hook-deps")) {
    return { action: "FULL_QA", reason: "Hook dependency changed — re-run interaction and state browser tests" };
  }

  // General function body change — full browser regression
  if (regions.has("function-body")) {
    return { action: "FULL_QA", reason: "Component logic changed — run full browser regression" };
  }

  return { action: "FULL_QA", reason: "Mixed structural change — run full browser regression" };
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify a single staged file — determines QA depth needed.
 *
 * Fast-path checks (deleted, assets, data, renames, new files) use simple
 * extension/status checks. For modified code files, parses the source AST
 * to determine exactly which structural regions were changed.
 */
export const classifyFile = (file: StagedFile): ClassificationResult => {
  const ext = getExtension(file.path);

  // Fast-path: non-code files and special statuses
  if (file.status === "D") return { action: "SKIP", reason: "File deleted — no browser behaviour to test" };
  if (TRIVIAL_EXTENSIONS.has(ext)) return { action: "SKIP", reason: `Asset file (${ext}) — no behaviour to test` };
  if (file.status === "R" && !file.diff.trim()) return { action: "SKIP", reason: "Pure rename — no content changed" };
  if (DATA_EXTENSIONS.has(ext)) return { action: "SKIP", reason: `Config/data file (${ext}) — no browser behaviour` };
  if (!CODE_EXTENSIONS.has(ext)) return { action: "SKIP", reason: `Non-JS/TS file (${ext}) — skipping` };

  // New file — always full browser coverage
  if (file.status === "A") return { action: "FULL_QA", reason: "New file — run full browser coverage" };

  // Modified code file — AST-based classification
  const changedLines = extractChangedLineNumbers(file.diff);
  if (changedLines.size === 0) return { action: "SKIP", reason: "No content changed" };

  try {
    const regionMap = buildLineRegionMap(file.path);
    const regions = mapLinesToRegions(changedLines, regionMap);
    const result = classifyByRegions(regions, file.diff);
    return { ...result, changedRegions: [...regions] };
  } catch {
    return { action: "FULL_QA", reason: "Logic or component change detected" };
  }
};

/**
 * Classify all staged files and return only those requiring QA.
 */
export const classifyStagedFiles = (
  files: StagedFile[],
  skipTrivial = true
): ClassifiedFile[] =>
  files
    .map((file) => ({ file, classification: classifyFile(file) }))
    .filter(({ classification }) => !skipTrivial || classification.action !== "SKIP");
