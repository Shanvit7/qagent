/**
 * Analyzer — lightweight text scan → FileAnalysis
 *
 * Derives component type, props, and lightweight security findings from
 * a TypeScript/TSX source file. Selector and visibility truth comes from
 * the runtime probe (src/probe/), not static AST heuristics.
 */

import { readFileSync } from "node:fs";
import { resolve, basename } from "node:path";


// ─── Public types ─────────────────────────────────────────────────────────────

export type ComponentType =
  | "client-component"
  | "server-component"
  | "api-route"
  | "server-action"
  | "hook"
  | "utility"
  | "unknown";

export interface SecurityFinding {
  type: "dangerouslySetInnerHTML" | "eval" | "unsafeHref" | "sqlInjection" | "envLeak" | "open-redirect";
  detail: string;
}

export interface FileAnalysis {
  filePath: string;
  sourceText: string;
  /**
   * Playwright test strategy to use for this file.
   * - client-component → interact via clicks/fills
   * - server-component → assert rendered content only
   * - api-route        → test through the UI page that consumes this API (fullstack, real server)
   * - server-action    → test via form submission
   * - hook             → test via the page that uses it
   * - utility          → test via observable page behavior
   * - unknown          → navigate to most relevant route
   */
  componentType: ComponentType;
  componentName: string | undefined;
  /** Props interface members — injected into prompt to help AI derive selectors. */
  props: string[];
  /**
   * Static security findings — used by the security lens to generate
   * browser tests (e.g. assert injected script is escaped, auth gates hold).
   * Superseded by the security agent result when tool-calling is available.
   */
  securityFindings: SecurityFinding[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** True when the file path matches a Next.js App Router API route convention. */
const isApiRoute = (filePath: string): boolean => {
  const name = basename(filePath);
  // app/*/route.ts  or  pages/api/**
  return /\broute\.[jt]sx?$/.test(name) || /[/\\]api[/\\]/.test(filePath);
};

/** True when the file path looks like a Next.js Server Action file. */
const isServerActionFile = (text: string): boolean =>
  /^\s*["']use server["']/m.test(text);

/** True when the file uses the "use client" directive. */
const isClientDirective = (text: string): boolean =>
  /^\s*["']use client["']/m.test(text);

/** Derive component type from file path + source text. */
const deriveComponentType = (filePath: string, text: string): ComponentType => {
  if (isApiRoute(filePath))        return "api-route";
  if (isServerActionFile(text))    return "server-action";
  if (isClientDirective(text))     return "client-component";

  // Custom hook convention: file name starts with "use" (useXxx.ts/tsx)
  const name = basename(filePath).replace(/\.[jt]sx?$/, "");
  if (/^use[A-Z]/.test(name))      return "hook";

  // Utility: no JSX, no default React component export
  const hasJsx = /<[A-Z][A-Za-z]*[\s/>]|<>|<\/[A-Za-z]/.test(text);
  if (!hasJsx && !/export\s+default/.test(text)) return "utility";

  // Default: server component (Next.js App Router default)
  return "server-component";
};

// ─── Security scanner (text-level, no AST needed for speed) ──────────────────

const scanSecurity = (text: string, filePath: string): SecurityFinding[] => {
  const findings: SecurityFinding[] = [];

  if (/dangerouslySetInnerHTML/.test(text))
    findings.push({ type: "dangerouslySetInnerHTML", detail: "Direct HTML injection via dangerouslySetInnerHTML" });

  if (/\beval\s*\(/.test(text))
    findings.push({ type: "eval", detail: "eval() call detected — potential code injection" });

  if (/href\s*=\s*\{/.test(text) && /user|param|query|input|request/i.test(text))
    findings.push({ type: "unsafeHref", detail: "Dynamic href attribute may allow open redirect or XSS" });

  if (/process\.env\.[A-Z_]+/.test(text) && !/NEXT_PUBLIC_/.test(text) && isClientDirective(text))
    findings.push({ type: "envLeak", detail: "Non-public env variable referenced in a client component" });

  if (/`SELECT|INSERT|UPDATE|DELETE|DROP/.test(text) && /\$\{/.test(text))
    findings.push({ type: "sqlInjection", detail: "Template-literal SQL with interpolation — potential injection" });

  if (/redirect\s*\(/.test(text) && /user|param|query|request/i.test(text))
    findings.push({ type: "open-redirect", detail: "Redirect target may be influenced by user input" });

  return findings;
};

// ─── AST helpers ─────────────────────────────────────────────────────────────

/**
 * Extract prop names from the first TypeScript interface/type alias whose
 * name ends with "Props", or from destructured function parameters.
 */
const extractProps = (text: string): string[] => {
  // Fast path: look for interface XxxProps { propA: ...; propB: ... }
  const interfaceMatch = text.match(/interface\s+\w*Props\s*\{([^}]+)\}/);
  if (interfaceMatch) {
    return [...(interfaceMatch[1] ?? "").matchAll(/^\s*(\w+)\??:/gm)]
      .map((m) => m[1] as string)
      .filter((s): s is string => Boolean(s));
  }

  // type XxxProps = { propA: ...; propB: ... }
  const typeMatch = text.match(/type\s+\w*Props\s*=\s*\{([^}]+)\}/);
  if (typeMatch) {
    return [...(typeMatch[1] ?? "").matchAll(/^\s*(\w+)\??:/gm)]
      .map((m) => m[1] as string)
      .filter((s): s is string => Boolean(s));
  }

  return [];
};

/**
 * Heuristically derive the primary component / function name from
 * `export default function Foo` or `const Foo = ...` patterns.
 */
const extractComponentName = (text: string, filePath: string): string | undefined => {
  const defaultFn = text.match(/export\s+default\s+(?:async\s+)?function\s+(\w+)/);
  if (defaultFn) return defaultFn[1];

  const defaultConst = text.match(/export\s+default\s+(\w+)/);
  if (defaultConst && defaultConst[1] !== "function") return defaultConst[1];

  // Fall back to PascalCase file name
  const name = basename(filePath).replace(/\.[jt]sx?$/, "");
  return /^[A-Z]/.test(name) ? name : undefined;
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Analyze a TypeScript / TSX source file and return a `FileAnalysis`
 * suitable for Playwright test generation.
 *
 * Uses a fast text + regex strategy. Selector derivation is handled by the
 * runtime probe (src/probe/) which captures the live accessibility tree —
 * the analyzer focuses on component type, props, and security findings.
 *
 * @throws if the file cannot be read.
 */
export const analyzeFile = (filePath: string): FileAnalysis => {
  const absolutePath = resolve(filePath);
  const sourceText   = readFileSync(absolutePath, "utf8");

  const componentType    = deriveComponentType(absolutePath, sourceText);
  const componentName    = extractComponentName(sourceText, absolutePath);
  const props            = extractProps(sourceText);
  const securityFindings = scanSecurity(sourceText, absolutePath);

  return {
    filePath: absolutePath,
    sourceText,
    componentType,
    componentName,
    props,
    securityFindings,
  };
};
