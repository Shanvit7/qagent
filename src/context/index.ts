/**
 * Dynamic context builder — import graph analysis.
 *
 * For each file being tested, follows its actual import graph (2 levels deep),
 * reads what's really there, and returns structured context for the AI prompt.
 *
 * No hardcoded library names. No pre-classification of modules into categories.
 * Every local module's source excerpt is passed directly — the AI reads the
 * real code and understands context without us labelling anything.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { Project, type SourceFile } from "ts-morph";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ResolvedImport {
  /** The import specifier as written: "@/lib/auth", "./hooks/useUser" */
  specifier: string;
  /** Resolved absolute path — null if node_modules or unresolvable */
  resolvedPath: string | null;
  /** Is this a local project file (not node_modules)? */
  isLocal: boolean;
  /** Package name if node_modules */
  packageName: string | null;
  /** Key exports from this module (if local) */
  exportedNames: string[];
  /** Does this module use server actions? */
  hasUseServer: boolean;
  /** Source excerpt (first 40 lines) — present for all resolved local modules */
  sourceExcerpt: string | null;
  /** Named imports used by the consuming file: e.g. ["motion", "useScroll"] */
  importedNames: string[];
  /** Whether the import includes a default import binding */
  hasDefaultImport: boolean;
}

export interface FileContext {
  /** The file being tested */
  filePath: string;
  /** Direct imports resolved and analysed */
  imports: ResolvedImport[];
  /** Second-level imports from local deps (their imports) */
  transitivePackages: string[];
  /** Narrative summary for the AI prompt */
  summary: string;
}

// ─── tsconfig paths resolution ────────────────────────────────────────────────

const loadTsconfigPaths = (cwd: string): Record<string, string[]> => {
  const candidates = ["tsconfig.json", "tsconfig.app.json", "tsconfig.base.json"];
  for (const name of candidates) {
    const p = join(cwd, name);
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, "utf8").replace(/\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1");
      const cfg = JSON.parse(raw) as { compilerOptions?: { paths?: Record<string, string[]> } };
      return cfg.compilerOptions?.paths ?? {};
    } catch { /* malformed tsconfig — skip */ }
  }
  return {};
};

let _tsconfigPaths: Record<string, string[]> | null = null;

// Shared ts-morph Project — avoids creating a new Project per import.
// addSourceFileAtPath is idempotent within the same Project (returns cached).
let _sharedProject: Project | null = null;

const getSharedProject = (): Project => {
  if (!_sharedProject) {
    _sharedProject = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
  }
  return _sharedProject;
};

const getOrAddSourceFile = (filePath: string): SourceFile => {
  const project = getSharedProject();
  return project.getSourceFile(filePath) ?? project.addSourceFileAtPath(filePath);
};

const isFile = (p: string): boolean => {
  try { return statSync(p).isFile(); } catch { return false; }
};

const resolveAlias = (specifier: string, cwd: string): string | null => {
  if (!_tsconfigPaths) _tsconfigPaths = loadTsconfigPaths(cwd);

  for (const [alias, targets] of Object.entries(_tsconfigPaths)) {
    const prefix = alias.replace(/\*$/, "");
    if (!specifier.startsWith(prefix)) continue;
    const suffix = specifier.slice(prefix.length);
    for (const target of targets) {
      const base = target.replace(/\*$/, "");
      const resolved = resolve(cwd, base + suffix);
      for (const ext of ["", ".ts", ".tsx", ".js", "/index.ts", "/index.tsx"]) {
        if (existsSync(resolved + ext) && isFile(resolved + ext)) return resolved + ext;
      }
    }
  }

  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2);
    for (const root of ["src", "app", "."]) {
      for (const ext of ["", ".ts", ".tsx", ".js", "/index.ts", "/index.tsx"]) {
        const candidate = join(cwd, root, rel + ext);
        if (existsSync(candidate) && isFile(candidate)) return candidate;
      }
    }
  }

  return null;
};

const resolveRelative = (specifier: string, fromFile: string): string | null => {
  const base = resolve(dirname(fromFile), specifier);
  for (const ext of ["", ".ts", ".tsx", ".js", "/index.ts", "/index.tsx"]) {
    if (existsSync(base + ext) && isFile(base + ext)) return base + ext;
  }
  return null;
};

const resolveSpecifier = (specifier: string, fromFile: string, cwd: string): string | null => {
  if (specifier.startsWith(".")) return resolveRelative(specifier, fromFile);
  if (specifier.startsWith("@/")) return resolveAlias(specifier, cwd);
  return null;
};

const isNodeModules = (specifier: string): boolean =>
  !specifier.startsWith(".") && !specifier.startsWith("@/");

const extractPackageName = (specifier: string): string => {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0] ?? specifier;
};



// ─── Local module analysis ────────────────────────────────────────────────────

const analyseLocalModule = (
  filePath: string,
): Pick<ResolvedImport, "exportedNames" | "hasUseServer" | "sourceExcerpt"> => {
  if (!isFile(filePath)) return { exportedNames: [], hasUseServer: false, sourceExcerpt: null };
  const source = readFileSync(filePath, "utf8");
  const sf = getOrAddSourceFile(filePath);

  const exportedNames = sf.getExportSymbols().map((s) => s.getName()).filter(Boolean);
  const hasUseServer  = /^['"]use server['"]/.test(source.trim()) || /^\s*['"]use server['"]/.test(source);

  const sourceExcerpt = source
    .split("\n")
    .slice(0, 40)
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();

  return { exportedNames, hasUseServer, sourceExcerpt };
};

// ─── Import extraction ────────────────────────────────────────────────────────

const extractImports = (filePath: string, cwd: string): ResolvedImport[] => {
  const source = readFileSync(filePath, "utf8");

  // Capture full import statement: named bindings + specifier
  // Handles: import { a, b } from 'pkg', import X from 'pkg', import X, { a } from 'pkg', import * as X from 'pkg'
  const importRegex = /import\s+(?:type\s+)?(.+?)\s+from\s+['"]([^'"]+)['"]/g;
  const parsed: Array<{ specifier: string; importedNames: string[]; hasDefaultImport: boolean }> = [];
  const seen = new Set<string>();

  for (const match of source.matchAll(importRegex)) {
    const clause = match[1] ?? "";
    const spec   = match[2] ?? "";
    if (!spec || seen.has(spec)) continue;
    seen.add(spec);

    const importedNames: string[] = [];
    let hasDefaultImport = false;

    // Extract named imports from braces: { a, b as c, type d }
    const braceMatch = clause.match(/\{([^}]+)\}/);
    if (braceMatch) {
      for (const part of braceMatch[1]!.split(",")) {
        const trimmed = part.trim();
        if (!trimmed || trimmed.startsWith("type ")) continue;
        // "a as b" → use the original name "a" (what the module exports)
        const name = trimmed.split(/\s+as\s+/)[0]!.trim();
        if (name) importedNames.push(name);
      }
    }

    // Check for default import (identifier before the braces or standalone)
    const beforeBrace = clause.replace(/\{[^}]*\}/, "").replace(/,/g, "").trim();
    if (beforeBrace && !beforeBrace.startsWith("*")) {
      hasDefaultImport = true;
    }

    // Namespace import: import * as X from 'pkg'
    if (clause.includes("*")) {
      hasDefaultImport = false; // not really default, but namespace
    }

    parsed.push({ specifier: spec, importedNames, hasDefaultImport });
  }

  return parsed.map(({ specifier: spec, importedNames, hasDefaultImport }): ResolvedImport => {
    if (isNodeModules(spec)) {
      return {
        specifier: spec,
        resolvedPath: null,
        isLocal: false,
        packageName: extractPackageName(spec),
        exportedNames: [],
        hasUseServer: false,
        sourceExcerpt: null,
        importedNames,
        hasDefaultImport,
      };
    }

    const resolved = resolveSpecifier(spec, filePath, cwd);
    if (!resolved) {
      return {
        specifier: spec,
        resolvedPath: null,
        isLocal: true,
        packageName: null,
        exportedNames: [],
        hasUseServer: false,
        sourceExcerpt: null,
        importedNames,
        hasDefaultImport,
      };
    }

    return {
      specifier: spec,
      resolvedPath: resolved,
      isLocal: true,
      packageName: null,
      ...analyseLocalModule(resolved),
      importedNames,
      hasDefaultImport,
    };
  });
};

// ─── Narrative builder ────────────────────────────────────────────────────────

const buildSummary = (ctx: Omit<FileContext, "summary">): string => {
  const lines: string[] = ["## Dynamic codebase context (from import analysis)\n"];

  // All external packages this file actually imports — AI knows what they are
  const externalPkgs = ctx.imports.filter((i) => !i.isLocal && i.packageName);
  if (externalPkgs.length > 0) {
    lines.push(`**External packages:** ${externalPkgs.map((i) => i.packageName).join(", ")}`);
  }

  // Server action dependencies
  const serverActionImports = ctx.imports.filter((i) => i.hasUseServer);
  if (serverActionImports.length > 0) {
    lines.push(`**Server action dependency:** ${serverActionImports.map((i) => i.specifier).join(", ")} — test via form submission or page interaction`);
  }

  // Transitive packages from local deps
  if (ctx.transitivePackages.length > 0) {
    lines.push(`**Transitively depends on:** ${[...new Set(ctx.transitivePackages)].slice(0, 8).join(", ")}`);
  }

  // Source excerpts for every resolved local import — no pre-classification,
  // the AI reads the actual code and understands what each module does
  const localWithSource = ctx.imports.filter((i) => i.isLocal && i.sourceExcerpt);
  for (const imp of localWithSource) {
    lines.push(`\n**Local import \`${imp.specifier}\`** (exports: ${imp.exportedNames.slice(0, 6).join(", ") || "none detected"}):\n\`\`\`ts\n${imp.sourceExcerpt}\n\`\`\``);
  }

  return lines.join("\n");
};

// ─── Public API ───────────────────────────────────────────────────────────────

export const buildFileContext = (filePath: string, cwd: string): FileContext => {
  const imports = extractImports(filePath, cwd);

  // Level 2: transitive external package names from local deps
  const transitivePackages: string[] = [];
  for (const imp of imports.filter((i) => i.isLocal && i.resolvedPath)) {
    try {
      const level2 = extractImports(imp.resolvedPath!, cwd);
      transitivePackages.push(
        ...level2.filter((i) => !i.isLocal && i.packageName).map((i) => i.packageName!)
      );
    } catch { /* unresolvable — skip */ }
  }

  const partial: Omit<FileContext, "summary"> = {
    filePath,
    imports,
    transitivePackages,
  };

  return { ...partial, summary: buildSummary(partial) };
};

/**
 * Lightweight version — only package names, no source reading.
 * Used for the project-level scan (not per-file).
 */
export const listImportedPackages = (filePath: string, cwd: string): string[] => {
  try {
    const imports = extractImports(filePath, cwd);
    return imports.filter((i) => !i.isLocal && i.packageName).map((i) => i.packageName!);
  } catch {
    return [];
  }
};
