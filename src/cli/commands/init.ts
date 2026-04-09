import * as p from "@clack/prompts";
import color from "picocolors";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { detectPackageManager, runPm } from "@/utils/packageManager";
import { setupProvider } from "@/setup/providers";
import { ensureQAgentIgnored } from "@/reporter/index";
import { SKILL_TEMPLATE } from "@/skill/template";
import { detectPlaywrightBrowsers, ensurePlaywrightBrowsers } from "@/runner/index";

const SKILL_FILE = "qagent-skill.md";

const LOGO = `
${color.cyan("   ██████╗  █████╗  ██████╗ ███████╗███╗   ██╗████████╗")}
${color.cyan("  ██╔═══██╗██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝")}
${color.cyan("  ██║   ██║███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ")}
${color.cyan("  ██║▄▄ ██║██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ")}
${color.cyan("  ╚██████╔╝██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ")}
${color.cyan("   ╚══▀▀═╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ")}
${color.cyan("  ◉ change-aware E2E testing for Next.js ")}
${color.dim("   Real tests. Real browser. Zero maintenance.              v0.1.2")}
`;

const isAlreadyInstalled = (cwd: string): boolean => {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return "qagent" in (pkg.dependencies ?? {}) || "qagent" in (pkg.devDependencies ?? {});
  } catch {
    return false;
  }
};

export const initCommand = async (): Promise<void> => {
  const cwd = process.cwd();

  // Raw console.log is correct here — the logo must print before clack's
  // intro so clack doesn't prepend its own header line above the banner.
  console.log(LOGO);
  p.intro(color.cyan(color.bold("qagent") + " — setup wizard"));

  const pm = detectPackageManager(cwd);
  p.log.info(`Detected package manager: ${color.bold(pm.name)}`);

  // -- Step 1: install --
  if (isAlreadyInstalled(cwd)) {
    p.log.step("qagent already in package.json — skipping install");
  } else {
    const shouldInstall = await p.confirm({
      message: `Install ${color.cyan("qagent")} as a dev dependency via ${color.bold(pm.name)}?`,
      initialValue: true,
    });

    if (p.isCancel(shouldInstall) || !shouldInstall) {
      p.cancel("Aborted. Run " + color.cyan("npx qagent@latest") + " anytime to set up.");
      return;
    }

    const s = p.spinner();
    s.start(`Installing via ${pm.name}`);
    const exitCode = await runPm(pm.name, pm.addDevArgs("qagent"), cwd);

    if (exitCode !== 0) {
      s.stop(color.red("Installation failed"));
      p.log.error(`Try manually: ${pm.name} ${pm.addDevArgs("qagent").join(" ")}`);
      return;
    }

    s.stop("qagent installed");
  }

  // -- Step 2: Provider + model selection --
  const configured = await setupProvider();
  if (!configured) {
    p.log.warn("No model configured — run " + color.cyan("qagent models") + " later to set one up.");
  }

  // -- Step 3: Playwright browser check --
  const browsersInstalled = await detectPlaywrightBrowsers(cwd);

  if (browsersInstalled) {
    p.log.step("Playwright Chromium browser — already installed ✓");
  } else {
    p.log.warn("Playwright Chromium browser not found.");

    const shouldInstallBrowser = await p.confirm({
      message: `Install Playwright's Chromium browser now? (required for browser tests)`,
      initialValue: true,
    });

    if (p.isCancel(shouldInstallBrowser)) {
      p.cancel("Cancelled.");
      return;
    }

    if (shouldInstallBrowser) {
      const bs = p.spinner();
      bs.start("Installing Chromium via Playwright…");
      try {
        await ensurePlaywrightBrowsers(cwd);
        bs.stop("Chromium installed ✓");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        bs.stop(color.red("Install failed"));
        p.log.error(msg.slice(0, 400));
        p.log.warn(
          `Run ${color.cyan("npx playwright install chromium")} manually before using qagent.`,
        );
      }
    } else {
      p.log.warn(
        `Skipped. Run ${color.cyan("npx playwright install chromium")} before running tests.`,
      );
    }
  }

  // -- Step 4: gitignore --
  ensureQAgentIgnored(cwd);

  // -- Step 5: skill file --
  const skillPath = resolve(cwd, SKILL_FILE);

  if (existsSync(skillPath)) {
    p.log.step(`${SKILL_FILE} already exists — keeping it.`);
  } else {
    writeFileSync(skillPath, SKILL_TEMPLATE, "utf8");
    p.log.step(`${SKILL_FILE} created — fill it in to improve test generation.`);
    p.log.info(
      `Run ${color.cyan("qagent skill")} to see the IDE prompt you can paste into Cursor / Claude Code.`,
    );
  }

  // -- Done --
  const nextSteps =
    "Stage files and run " + color.cyan("qagent watch") + " for auto QA, or " +
    color.cyan("qagent run") + " on demand.";

  p.note(
    [
      nextSteps,
      "",
      `${color.cyan("qagent models")}  — switch AI provider or model`,
      `${color.cyan("qagent skill")}   — fill in your project skill file`,
      `${color.cyan("qagent status")}  — check your setup`,
    ].join("\n"),
    "qagent is ready!",
  );

  p.outro("Happy testing!");
};
