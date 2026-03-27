import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildRouteMap, findRoutesForFile } from "./index";

const TMP = join(process.cwd(), ".test-routes-tmp");

const writeFile = (relPath: string, content: string): void => {
  const full = join(TMP, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
};

describe("route mapper", () => {
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true });
    // Minimal package.json
    writeFile("package.json", "{}");
    writeFile("tsconfig.json", JSON.stringify({
      compilerOptions: { paths: { "@/*": ["./src/*"] } },
    }));
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it("discovers app router pages", () => {
    writeFile("src/app/page.tsx", 'export default function Home() { return <div />; }');
    writeFile("src/app/pricing/page.tsx", 'export default function Pricing() { return <div />; }');

    const map = buildRouteMap(TMP);
    const routes = [...map.routeIndex.values()].map((e) => e.route).sort();

    expect(routes).toContain("/");
    expect(routes).toContain("/pricing");
  });

  it("maps component to route via imports", () => {
    writeFile("src/components/hero.tsx", 'export const Hero = () => <div>Hero</div>;');
    writeFile("src/app/page.tsx", 'import { Hero } from "@/components/hero";\nexport default function Home() { return <Hero />; }');

    const map = buildRouteMap(TMP);
    const matches = findRoutesForFile(join(TMP, "src/components/hero.tsx"), map);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]!.route).toBe("/");
  });

  it("returns page's own route for page files", () => {
    writeFile("src/app/about/page.tsx", 'export default function About() { return <div />; }');

    const map = buildRouteMap(TMP);
    const matches = findRoutesForFile(join(TMP, "src/app/about/page.tsx"), map);

    expect(matches).toEqual([{ route: "/about", depth: 0 }]);
  });

  it("caps routes at maxRoutes", () => {
    writeFile("src/components/shared.tsx", 'export const Shared = () => <div />;');
    writeFile("src/app/page.tsx", 'import { Shared } from "@/components/shared";\nexport default function A() { return <Shared />; }');
    writeFile("src/app/a/page.tsx", 'import { Shared } from "@/components/shared";\nexport default function B() { return <Shared />; }');
    writeFile("src/app/b/page.tsx", 'import { Shared } from "@/components/shared";\nexport default function C() { return <Shared />; }');
    writeFile("src/app/c/page.tsx", 'import { Shared } from "@/components/shared";\nexport default function D() { return <Shared />; }');

    const map = buildRouteMap(TMP);
    const matches = findRoutesForFile(join(TMP, "src/components/shared.tsx"), map, 2);

    expect(matches.length).toBeLessThanOrEqual(2);
  });

  it("returns empty for unresolvable files", () => {
    writeFile("src/app/page.tsx", 'export default function Home() { return <div />; }');

    const map = buildRouteMap(TMP);
    const matches = findRoutesForFile(join(TMP, "src/some/random/file.tsx"), map);

    expect(matches).toEqual([]);
  });

  it("handles route groups by stripping parentheses", () => {
    writeFile("src/app/(marketing)/pricing/page.tsx", 'export default function P() { return <div />; }');

    const map = buildRouteMap(TMP);
    const routes = [...map.routeIndex.values()].map((e) => e.route);

    expect(routes).toContain("/pricing");
    expect(routes).not.toContain("/(marketing)/pricing");
  });
});
