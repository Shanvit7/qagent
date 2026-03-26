/**
 * Route mapper — reverse import graph from components to routes.
 *
 * Walks all page.tsx / layout.tsx files in a Next.js app/ directory,
 * builds a reverse import graph, and maps any component file to the
 * routes that render it.
 *
 * Heuristics:
 *   - Closest route wins (sorted by import depth)
 *   - Capped at maxRoutes (default 3)
 *   - Layout components → "/" only (not every route in the app)
 *   - Pages router fallback for projects using pages/
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname, extname } from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RouteEntry {
  /** URL route path, e.g. "/", "/pricing", "/blog/[slug]" */
  route: string;
  /** Absolute path to the page.tsx or layout.tsx file */
  filePath: string;
  /** "page" or "layout" */
  kind: "page" | "layout";
}

export interface RouteMatch {
  route: string;
  /** How many import hops from the component to this page */
  depth: number;
}

/** Map from absolute file path → set of absolute file paths that import it */
export type ReverseGraph = Map<string, Set<string>>;

/** Map from absolute file path → RouteEntry (only for page/layout files) */
export type RouteIndex = Map<string, RouteEntry>;

export interface RouteMap {
  reverseGraph: ReverseGraph;
  routeIndex: RouteIndex;
}

// ─── tsconfig alias resolution (reused from context module) ───────────────────

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
  return resolveAlias(specifier, cwd);
};

// ─── Import extraction (lightweight — no ts-morph) ────────────────────────────

const extractLocalImports = (filePath: string, cwd: string): string[] => {
  try {
    const source = readFileSync(filePath, "utf8");
    const imports: string[] = [];
    const importRegex = /import\s+(?:type\s+)?(?:.+?)\s+from\s+['"]([^'"]+)['"]/g;

    for (const match of source.matchAll(importRegex)) {
      const spec = match[1] ?? "";
      // Skip node_modules / bare specifiers (unless aliased)
      if (!spec.startsWith(".") && !spec.startsWith("@/") && !spec.startsWith("~/")) continue;

      const resolved = resolveSpecifier(spec, filePath, cwd);
      if (resolved) imports.push(resolved);
    }

    return imports;
  } catch {
    return [];
  }
};

// ─── Route discovery ──────────────────────────────────────────────────────────

const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const IGNORE_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", ".qagent", "api"]);

const walkDir = (dir: string, maxDepth = 6, depth = 0): string[] => {
  if (depth > maxDepth || !existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (entry.isDirectory()) {
        return IGNORE_DIRS.has(entry.name) ? [] : walkDir(join(dir, entry.name), maxDepth, depth + 1);
      }
      return CODE_EXTS.has(extname(entry.name)) ? [join(dir, entry.name)] : [];
    });
  } catch {
    return [];
  }
};

/** Convert app/ file path to URL route */
const filePathToRoute = (filePath: string, appDir: string): string => {
  const rel = relative(appDir, dirname(filePath));
  if (!rel || rel === ".") return "/";

  // Remove route groups: (marketing)/pricing → pricing
  // Remove parallel route slots: @header, @sidebar → not navigable on their own
  const segments = rel.split("/").filter((s) => !s.startsWith("(") && !s.startsWith("@"));
  return "/" + segments.join("/");
};

const findAppRouterEntries = (cwd: string): RouteEntry[] => {
  const appDir = existsSync(join(cwd, "src", "app")) ? join(cwd, "src", "app") : join(cwd, "app");
  if (!existsSync(appDir)) return [];

  const entries: RouteEntry[] = [];
  const files = walkDir(appDir);

  for (const f of files) {
    const base = f.split("/").pop() ?? "";
    if (/^page\.(tsx?|jsx?)$/.test(base)) {
      entries.push({ route: filePathToRoute(f, appDir), filePath: f, kind: "page" });
    } else if (/^layout\.(tsx?|jsx?)$/.test(base)) {
      entries.push({ route: filePathToRoute(f, appDir), filePath: f, kind: "layout" });
    }
  }

  return entries;
};

const findPagesRouterEntries = (cwd: string): RouteEntry[] => {
  const pagesDir = existsSync(join(cwd, "src", "pages")) ? join(cwd, "src", "pages") : join(cwd, "pages");
  if (!existsSync(pagesDir)) return [];

  const entries: RouteEntry[] = [];
  const files = walkDir(pagesDir);

  for (const f of files) {
    const base = f.split("/").pop() ?? "";
    if (base.startsWith("_")) continue; // _app, _document, _error
    if (!/\.(tsx?|jsx?)$/.test(base)) continue;

    const rel = relative(pagesDir, f).replace(/\.(tsx?|jsx?)$/, "");
    const route = rel === "index" ? "/" : `/${rel.replace(/\/index$/, "")}`;
    entries.push({ route, filePath: f, kind: "page" });
  }

  return entries;
};

// ─── Build reverse graph ──────────────────────────────────────────────────────

const buildForwardGraph = (entryFiles: string[], cwd: string, maxDepth = 5): Map<string, Set<string>> => {
  /** forward: file → files it imports */
  const forward = new Map<string, Set<string>>();
  const visited = new Set<string>();
  const queue: Array<{ file: string; depth: number }> = entryFiles.map((f) => ({ file: f, depth: 0 }));

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (visited.has(item.file) || item.depth > maxDepth) continue;
    visited.add(item.file);

    const imports = extractLocalImports(item.file, cwd);
    forward.set(item.file, new Set(imports));

    for (const imp of imports) {
      if (!visited.has(imp)) {
        queue.push({ file: imp, depth: item.depth + 1 });
      }
    }
  }

  return forward;
};

const invertGraph = (forward: Map<string, Set<string>>): ReverseGraph => {
  const reverse: ReverseGraph = new Map();

  for (const [file, imports] of forward) {
    for (const imp of imports) {
      if (!reverse.has(imp)) reverse.set(imp, new Set());
      reverse.get(imp)!.add(file);
    }
  }

  return reverse;
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a route map for the project. Walks all page/layout files,
 * follows their imports forward (up to 5 levels), then inverts to
 * create a reverse graph (component → files that import it).
 */
export const buildRouteMap = (cwd: string): RouteMap => {
  // Reset tsconfig paths cache per build
  _tsconfigPaths = null;

  const entries = [
    ...findAppRouterEntries(cwd),
    ...findPagesRouterEntries(cwd),
  ];

  const routeIndex: RouteIndex = new Map();
  for (const entry of entries) {
    routeIndex.set(entry.filePath, entry);
  }

  const entryFiles = entries.map((e) => e.filePath);
  const forward = buildForwardGraph(entryFiles, cwd);
  const reverseGraph = invertGraph(forward);

  return { reverseGraph, routeIndex };
};

/**
 * Find routes that render a given component file.
 * BFS upward through the reverse graph until hitting page/layout files.
 * Returns routes sorted by depth (closest first), capped at maxRoutes.
 */
export const findRoutesForFile = (
  filePath: string,
  routeMap: RouteMap,
  maxRoutes = 3,
): RouteMatch[] => {
  const absPath = resolve(filePath);
  const { reverseGraph, routeIndex } = routeMap;

  // If the file IS a page/layout, return its own route
  const directEntry = routeIndex.get(absPath);
  if (directEntry) {
    return [{ route: directEntry.route, depth: 0 }];
  }

  // BFS upward through reverse graph
  const matches: RouteMatch[] = [];
  const visited = new Set<string>();
  const queue: Array<{ file: string; depth: number }> = [{ file: absPath, depth: 0 }];

  while (queue.length > 0 && matches.length < maxRoutes * 2) {
    const item = queue.shift()!;
    if (visited.has(item.file)) continue;
    visited.add(item.file);

    const importers = reverseGraph.get(item.file);
    if (!importers) continue;

    for (const importer of importers) {
      if (visited.has(importer)) continue;

      const entry = routeIndex.get(importer);
      if (entry) {
        // Layout components → only "/" to avoid testing every page
        if (entry.kind === "layout") {
          if (!matches.some((m) => m.route === "/")) {
            matches.push({ route: "/", depth: item.depth + 1 });
          }
        } else {
          matches.push({ route: entry.route, depth: item.depth + 1 });
        }
      } else {
        queue.push({ file: importer, depth: item.depth + 1 });
      }
    }
  }

  // Sort by depth (closest first), deduplicate, cap
  const seen = new Set<string>();
  return matches
    .sort((a, b) => a.depth - b.depth)
    .filter((m) => {
      if (seen.has(m.route)) return false;
      seen.add(m.route);
      return true;
    })
    .slice(0, maxRoutes);
};

/**
 * Incrementally update the route map when a file changes.
 * Re-walks only the changed file's imports and updates edges.
 */
export const updateRouteMap = (
  routeMap: RouteMap,
  changedFile: string,
  cwd: string,
): void => {
  const absPath = resolve(changedFile);
  const { reverseGraph } = routeMap;

  // Remove old forward edges for this file (from reverse graph)
  for (const [, importers] of reverseGraph) {
    importers.delete(absPath);
  }

  // Re-walk this file's imports and add new edges
  const imports = extractLocalImports(absPath, cwd);
  for (const imp of imports) {
    if (!reverseGraph.has(imp)) reverseGraph.set(imp, new Set());
    reverseGraph.get(imp)!.add(absPath);
  }
};
