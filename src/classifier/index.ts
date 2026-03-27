/**
 * AST-based change classifier.
 *
 * Determines QA depth per staged file by mapping git diff line numbers to
 * structural regions in the source AST via ts-morph. No regex guessing —
 * we know exactly whether a changed line is inside a Props interface, a
 * function body, a JSX event handler, an async expression, a conditional
 * render, a hook call, or an import.
 *
 * Improvements over v1:
 *   - Single AST pass (was 4 separate walks)
 *   - Sub-regions inside function-body: event-handler, async-logic, conditional-render
 *   - Custom hook dep detection (any use* call with dep array, not just builtins)
 *   - New-file smart classification (utility / hook vs component)
 *   - Prop-forwarding detection via AST, not regex
 */

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import {
  Project,
  SyntaxKind,
  type SourceFile,
  type Node,
} from "ts-morph";
import type { StagedFile } from "@/git/staged";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChangeAction = "SKIP" | "LIGHTWEIGHT" | "FULL_QA";

export type ChangeRegion =
  | "imports"
  | "props"
  | "types"
  | "jsx-styling"
  | "jsx-cosmetic"
  | "jsx-markup"
  | "event-handler"       // on* JSX attribute callback body — interaction signal
  | "conditional-render"  // ternary / && / || in JSX return — render+state signal
  | "async-logic"         // await expressions inside logic — state signal
  | "function-body"       // general function body (fallback)
  | "hook-deps"           // useEffect/useMemo/useCallback dep arrays
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

const extractChangedLineNumbers = (diff: string): Set<number> => {
  const lines = diff.split("\n");
  const changed = new Set<number>();
  let currentLine = 0;

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) { currentLine = parseInt(hunkMatch[1]!, 10); continue; }
    if (line.startsWith("+") && !line.startsWith("+++")) { changed.add(currentLine); currentLine++; }
    else if (line.startsWith("-") && !line.startsWith("---")) { /* removed — don't advance */ }
    else if (currentLine > 0) { currentLine++; }
  }
  return changed;
};

// ─── Region specificity ───────────────────────────────────────────────────────
// Higher = wins when multiple regions cover the same line.

const REGION_SPECIFICITY: Record<ChangeRegion, number> = {
  "event-handler":      12, // most specific — we know the exact interaction surface
  "jsx-styling":        11,
  "jsx-cosmetic":       10,
  "conditional-render":  9, // inside JSX, more specific than jsx-markup
  "hook-deps":           8,
  "jsx-markup":          7,
  "async-logic":         6, // inside function body, more specific than function-body
  "server-action":       5,
  "function-body":       4,
  "props":               3,
  "types":               2,
  "exports":             1,
  "imports":             0,
};

// ─── Attribute classification ─────────────────────────────────────────────────

const STYLING_ATTRIBUTES = new Set([
  "className", "class", "style", "sx", "css", "tw", "cs",
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

const STYLING_TAGS = new Set(["css", "tw", "injectGlobal", "createGlobalStyle", "keyframes"]);



// ─── AST helpers ─────────────────────────────────────────────────────────────

const addRange = (ranges: LineRange[], node: Node, region: ChangeRegion, name?: string): void => {
  ranges.push({ start: node.getStartLineNumber(), end: node.getEndLineNumber(), region, name });
};

/** Walk parent chain to check if node is inside a JSX expression container. */
const isInsideJsxExpression = (node: Node): boolean => {
  let cur = node.getParent();
  while (cur) {
    const k = cur.getKind();
    if (k === SyntaxKind.JsxExpression) return true;
    // Stop at function boundaries — don't leak across component boundaries
    if (
      k === SyntaxKind.ArrowFunction ||
      k === SyntaxKind.FunctionDeclaration ||
      k === SyntaxKind.FunctionExpression
    ) return false;
    cur = cur.getParent();
  }
  return false;
};

/** Extract a function's name from its declaration or parent variable declaration. */
const getFunctionName = (node: Node): string | undefined => {
  if (node.getKind() === SyntaxKind.FunctionDeclaration) {
    return node.asKindOrThrow(SyntaxKind.FunctionDeclaration).getName();
  }
  const parent = node.getParent();
  if (parent?.getKind() === SyntaxKind.VariableDeclaration) {
    return parent.asKindOrThrow(SyntaxKind.VariableDeclaration).getName();
  }
  return undefined;
};

/** True when a JSX attribute name is an event handler (on + PascalCase). */
const isEventHandlerAttr = (name: string): boolean => /^on[A-Z]/.test(name);

// ─── Single-pass AST region mapper ───────────────────────────────────────────

const buildLineRegionMap = (filePath: string): LineRange[] => {
  if (!existsSync(filePath)) return [];

  const sourceText = readFileSync(filePath, "utf8");
  const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
  const sf: SourceFile = project.addSourceFileAtPath(filePath);
  const ranges: LineRange[] = [];

  const isServerActionFile =
    sourceText.trimStart().startsWith('"use server"') ||
    sourceText.trimStart().startsWith("'use server'");

  const walk = (node: Node): void => {
    switch (node.getKind()) {

      // ── Structural ──────────────────────────────────────────────────────
      case SyntaxKind.ImportDeclaration:
        addRange(ranges, node, "imports");
        break;

      case SyntaxKind.InterfaceDeclaration: {
        const name = node.asKindOrThrow(SyntaxKind.InterfaceDeclaration).getName();
        addRange(ranges, node, name.endsWith("Props") ? "props" : "types", name);
        break;
      }

      case SyntaxKind.TypeAliasDeclaration: {
        const name = node.asKindOrThrow(SyntaxKind.TypeAliasDeclaration).getName();
        addRange(ranges, node, name.endsWith("Props") ? "props" : "types", name);
        break;
      }

      case SyntaxKind.ExportDeclaration:
      case SyntaxKind.ExportAssignment:
        addRange(ranges, node, "exports");
        break;

      // ── Functions ───────────────────────────────────────────────────────
      case SyntaxKind.FunctionDeclaration:
      case SyntaxKind.ArrowFunction:
      case SyntaxKind.FunctionExpression:
      case SyntaxKind.MethodDeclaration: {
        const hasInlineUseServer =
          node.getText().includes('"use server"') ||
          node.getText().includes("'use server'");
        const region: ChangeRegion =
          isServerActionFile || hasInlineUseServer ? "server-action" : "function-body";
        addRange(ranges, node, region, getFunctionName(node));
        break;
      }

      // ── JSX ─────────────────────────────────────────────────────────────
      case SyntaxKind.JsxElement:
      case SyntaxKind.JsxSelfClosingElement:
        addRange(ranges, node, "jsx-markup");
        break;

      case SyntaxKind.JsxAttribute: {
        const attr = node.asKindOrThrow(SyntaxKind.JsxAttribute);
        const attrName = attr.getNameNode().getText();

        if (STYLING_ATTRIBUTES.has(attrName)) {
          addRange(ranges, node, "jsx-styling");
        } else if (isCosmeticAttribute(attrName)) {
          addRange(ranges, node, "jsx-cosmetic");
        } else if (isEventHandlerAttr(attrName)) {
          // Mark the VALUE of on* attributes as event-handler so changed
          // handler bodies register as interaction changes, not generic logic.
          const value = attr.getInitializer();
          if (value) addRange(ranges, value, "event-handler", attrName);
          else        addRange(ranges, node, "event-handler", attrName);
        }
        break;
      }

      // ── CSS-in-JS tagged templates ───────────────────────────────────────
      case SyntaxKind.TaggedTemplateExpression: {
        const tagged = node.asKindOrThrow(SyntaxKind.TaggedTemplateExpression);
        const tag = tagged.getTag().getText();
        if (STYLING_TAGS.has(tag) || tag.startsWith("styled.") || tag.startsWith("styled(")) {
          addRange(ranges, node, "jsx-styling", tag);
        }
        break;
      }

      // ── Hook calls ───────────────────────────────────────────────────────
      // Detect structurally: any use* call whose last argument is an array
      // literal has a dependency array — no hardcoded names needed.
      case SyntaxKind.CallExpression: {
        const call = node.asKindOrThrow(SyntaxKind.CallExpression);
        const callee = call.getExpression().getText();
        if (/^use[A-Z]/.test(callee)) {
          const args = call.getArguments();
          const last = args[args.length - 1];
          if (last?.getKind() === SyntaxKind.ArrayLiteralExpression) {
            addRange(ranges, node, "hook-deps", callee);
          }
        }
        break;
      }

      // ── Async logic ──────────────────────────────────────────────────────
      // AwaitExpression = data fetching, async state updates, side effects.
      // More specific than function-body; drives state lens.
      case SyntaxKind.AwaitExpression:
        addRange(ranges, node, "async-logic");
        break;

      // ── Conditional rendering ────────────────────────────────────────────
      // Ternary or && / || used as JSX conditional — drives render+state lenses.
      case SyntaxKind.ConditionalExpression: {
        if (isInsideJsxExpression(node)) {
          addRange(ranges, node, "conditional-render");
        }
        break;
      }

      case SyntaxKind.BinaryExpression: {
        const bin = node.asKindOrThrow(SyntaxKind.BinaryExpression);
        const op  = bin.getOperatorToken().getKind();
        if (
          (op === SyntaxKind.AmpersandAmpersandToken || op === SyntaxKind.BarBarToken) &&
          isInsideJsxExpression(node)
        ) {
          addRange(ranges, node, "conditional-render");
        }
        break;
      }
    }

    node.forEachChild(walk);
  };

  sf.forEachChild(walk);
  return ranges;
};

// ─── Line-to-region mapping ───────────────────────────────────────────────────

const mapLinesToRegions = (changedLines: Set<number>, ranges: LineRange[]): Set<ChangeRegion> => {
  const regions = new Set<ChangeRegion>();

  for (const lineNum of changedLines) {
    let best: ChangeRegion | null = null;
    let bestSpec = -1;

    for (const range of ranges) {
      if (lineNum >= range.start && lineNum <= range.end) {
        const spec = REGION_SPECIFICITY[range.region];
        if (spec > bestSpec) { bestSpec = spec; best = range.region; }
      }
    }

    if (best) regions.add(best);
  }

  return regions;
};

// ─── Styling impact analysis ──────────────────────────────────────────────────

type StylingImpact = "cosmetic" | "layout" | "visibility";

const analyzeStylingImpact = (diff: string): StylingImpact => {
  const added = diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .join(" ");

  // Layout — checked FIRST (overflow-hidden must beat \bhidden\b)
  if (/\boverflow-(?:x-|y-)?hidden\b/.test(added))              return "layout";
  if (/\bpointer-events-none\b/.test(added))                    return "layout";
  if (/\b-?translate-[xy]-/.test(added))                        return "layout";
  if (/\b(?:fixed|absolute|sticky)\b/.test(added))              return "layout";
  if (/\bz-(?:\d+|auto)\b/.test(added))                         return "layout";

  // Visibility (Tailwind)
  if (/\bhidden\b/.test(added))                                  return "visibility";
  if (/\binvisible\b/.test(added))                               return "visibility";
  if (/\bopacity-0\b/.test(added))                               return "visibility";
  if (/\b[wh]-0\b/.test(added))                                  return "visibility";
  if (/\bscale-0\b/.test(added))                                 return "visibility";
  if (/\bsr-only\b/.test(added))                                 return "visibility";

  // Visibility (CSS / inline style)
  if (/display\s*:\s*["']?none["']?/.test(added))                return "visibility";
  if (/visibility\s*:\s*["']?hidden["']?/.test(added))           return "visibility";
  if (/opacity\s*:\s*["']?0(?:[^.]|["']|$)/.test(added))        return "visibility";
  if (/(?:width|height)\s*:\s*["']?0(?:px)?["']?[,;\s}]/.test(added)) return "visibility";

  // Layout (CSS / inline style)
  if (/overflow\s*:/.test(added))                                return "layout";
  if (/pointer-?[Ee]vents\s*:/.test(added))                      return "layout";
  if (/transform\s*:|translateX|translateY|translate3d/.test(added)) return "layout";
  if (/position\s*:\s*["']?(?:absolute|fixed|sticky)/.test(added)) return "layout";
  if (/z-index\s*:/.test(added))                                 return "layout";

  return "cosmetic";
};

// ─── Prop-forwarding detection (AST-based) ───────────────────────────────────
// Returns true when every changed line in a function-body+jsx-styling mix
// is purely about forwarding a styling prop (className/style etc.) through.
// Uses the AST ranges to verify — more precise than the old regex approach.

const isStylingPropForwarding = (
  changedLines: Set<number>,
  ranges: LineRange[],
): boolean => {
  for (const line of changedLines) {
    // Find the most specific region for this line
    let best: ChangeRegion | null = null;
    let bestSpec = -1;
    for (const r of ranges) {
      if (line >= r.start && line <= r.end) {
        const s = REGION_SPECIFICITY[r.region];
        if (s > bestSpec) { bestSpec = s; best = r.region; }
      }
    }
    // Any line that isn't styling/props/types/imports is non-trivial
    if (best && !["jsx-styling", "props", "types", "imports", "exports"].includes(best)) {
      return false;
    }
  }
  return true;
};

// ─── New file classification ──────────────────────────────────────────────────
// New files don't have a diff to classify by region — we infer from shape.

const classifyNewFile = (filePath: string, sourceText: string): ClassificationResult => {
  const name = basename(filePath).replace(/\.[jt]sx?$/, "");

  // Custom hook — file named useXxx or exports a useXxx function
  if (/^use[A-Z]/.test(name) || /export\s+(?:const|function)\s+use[A-Z]/.test(sourceText)) {
    return {
      action: "LIGHTWEIGHT",
      reason: "New custom hook — verify behaviour through the pages that use it",
    };
  }

  // Pure utility — no JSX, no default export of a component
  const hasJsx = /<[A-Z][A-Za-z]*[\s/>]|<>|<\/[A-Za-z]/.test(sourceText);
  const hasDefaultExport = /export\s+default/.test(sourceText);
  if (!hasJsx && !hasDefaultExport) {
    return {
      action: "LIGHTWEIGHT",
      reason: "New utility — verify its output is correct through pages that use it",
    };
  }

  return { action: "FULL_QA", reason: "New component — run full browser coverage" };
};

// ─── Region-based classification ──────────────────────────────────────────────

const classifyByRegions = (
  regions: Set<ChangeRegion>,
  diff: string,
  changedLines: Set<number>,
  ranges: LineRange[],
): { action: ChangeAction; reason: string } => {
  if (regions.size === 0) {
    return { action: "FULL_QA", reason: "Changed lines outside recognized structures" };
  }

  const all = [...regions];

  // ── Pure skip cases ────────────────────────────────────────────────────────

  if (all.every((r) => r === "imports")) {
    return { action: "SKIP", reason: "Import-only change — no browser-visible behaviour affected" };
  }

  if (all.every((r) => r === "jsx-cosmetic" || r === "imports")) {
    return { action: "SKIP", reason: "Cosmetic attribute change — no behaviour to test" };
  }

  // ── Styling-only ───────────────────────────────────────────────────────────

  const isStylingOnly = all.every(
    (r) => r === "jsx-styling" || r === "jsx-cosmetic" || r === "imports",
  );
  if (isStylingOnly) {
    const impact = analyzeStylingImpact(diff);
    if (impact === "visibility") return { action: "LIGHTWEIGHT", reason: "Styling change affects element visibility — verify elements still render" };
    if (impact === "layout")     return { action: "LIGHTWEIGHT", reason: "Styling change affects layout or interaction — verify elements are reachable" };
    return { action: "SKIP", reason: "Cosmetic styling change — no browser behaviour to test" };
  }

  // ── Types / props only ─────────────────────────────────────────────────────

  if (all.every((r) => ["props", "types", "imports", "exports"].includes(r))) {
    if (regions.has("props")) return { action: "LIGHTWEIGHT", reason: "Prop interface changed — verify rendered output" };
    return { action: "LIGHTWEIGHT", reason: "Type definition changed — verify rendered output" };
  }

  // ── Styling prop forwarding (className/style added as pass-through prop) ───

  if (
    regions.has("function-body") &&
    all.every((r) => ["function-body", "jsx-styling", "props", "types", "imports"].includes(r)) &&
    isStylingPropForwarding(changedLines, ranges)
  ) {
    return {
      action: "LIGHTWEIGHT",
      reason: "Styling prop forwarded (className/style pass-through) — verify component still renders",
    };
  }

  // ── JSX markup only (no logic, no events) ─────────────────────────────────

  if (all.every((r) => ["jsx-markup", "jsx-styling", "jsx-cosmetic", "imports"].includes(r))) {
    const impact = analyzeStylingImpact(diff);
    if (impact === "visibility") return { action: "LIGHTWEIGHT", reason: "JSX change affects visibility — verify elements still render" };
    if (impact === "layout")     return { action: "LIGHTWEIGHT", reason: "JSX change affects layout — verify elements are reachable" };
    return { action: "LIGHTWEIGHT", reason: "JSX structure changed — verify elements render correctly" };
  }

  // ── Sub-region specifics (new in v2) ───────────────────────────────────────

  // Event handlers only — pure interaction change, no render/state impact
  if (all.every((r) => ["event-handler", "imports", "jsx-cosmetic"].includes(r))) {
    return { action: "FULL_QA", reason: "Event handler logic changed — test user interactions and outcomes" };
  }

  // Async logic only — data fetching / async state, no structural change
  if (all.every((r) => ["async-logic", "imports"].includes(r))) {
    return { action: "FULL_QA", reason: "Async logic changed — test loading, error, and data states" };
  }

  // Conditional render only — what shows/hides changed, not how interactions work
  if (all.every((r) => ["conditional-render", "jsx-markup", "jsx-styling", "imports"].includes(r))) {
    return { action: "LIGHTWEIGHT", reason: "Conditional render changed — verify correct state is shown" };
  }

  // Event handler + conditional render mix (e.g. handler sets state that toggles render)
  if (
    regions.has("event-handler") &&
    !regions.has("async-logic") &&
    !regions.has("function-body") &&
    !regions.has("server-action")
  ) {
    return { action: "FULL_QA", reason: "Event handler and render logic changed — test interactions and state" };
  }

  // ── Hook deps ──────────────────────────────────────────────────────────────

  if (regions.has("server-action")) {
    return { action: "FULL_QA", reason: "Server action changed — test form submission, redirects, and auth" };
  }

  if (regions.has("hook-deps") && !regions.has("function-body")) {
    return { action: "FULL_QA", reason: "Hook dependency changed — test side-effects and state transitions" };
  }

  // ── General function body ─────────────────────────────────────────────────

  if (regions.has("function-body")) {
    return { action: "FULL_QA", reason: "Component logic changed — test affected behaviour" };
  }

  return { action: "FULL_QA", reason: "Mixed structural change — run browser regression" };
};

// ─── Public API ───────────────────────────────────────────────────────────────

export const classifyFile = (file: StagedFile): ClassificationResult => {
  const ext = getExtension(file.path);

  if (file.status === "D") return { action: "SKIP", reason: "File deleted — no browser behaviour to test" };
  if (TRIVIAL_EXTENSIONS.has(ext)) return { action: "SKIP", reason: `Asset file (${ext}) — no behaviour to test` };
  if (file.status === "R" && !file.diff.trim()) return { action: "SKIP", reason: "Pure rename — no content changed" };
  if (DATA_EXTENSIONS.has(ext)) return { action: "SKIP", reason: `Config/data file (${ext}) — no browser behaviour` };
  if (!CODE_EXTENSIONS.has(ext)) return { action: "SKIP", reason: `Non-JS/TS file (${ext}) — skipping` };

  if (file.status === "A") {
    const sourceText = existsSync(file.path) ? readFileSync(file.path, "utf8") : "";
    return classifyNewFile(file.path, sourceText);
  }

  const changedLines = extractChangedLineNumbers(file.diff);
  if (changedLines.size === 0) return { action: "SKIP", reason: "No content changed" };

  try {
    const ranges  = buildLineRegionMap(file.path);
    const regions = mapLinesToRegions(changedLines, ranges);
    const result  = classifyByRegions(regions, file.diff, changedLines, ranges);
    return { ...result, changedRegions: [...regions] };
  } catch {
    return { action: "FULL_QA", reason: "Logic or component change detected" };
  }
};

export const classifyStagedFiles = (
  files: StagedFile[],
  skipTrivial = true,
): ClassifiedFile[] =>
  files
    .map((file) => ({ file, classification: classifyFile(file) }))
    .filter(({ classification }) => !skipTrivial || classification.action !== "SKIP");
