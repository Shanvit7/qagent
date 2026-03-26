import * as p from "@clack/prompts";
import color from "picocolors";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { injectGitHook, detectHuskyDir } from "../../git/hook.js";
import { detectPackageManager, runPm } from "../../utils/packageManager.js";
import { setupProvider } from "../../setup/providers.js";
import { ensureQAgentIgnored } from "../../reporter/index.js";
import { writePersistedConfig, DEFAULT_LENSES } from "../../config/loader.js";
import type { QaLens } from "../../config/types.js";
import { SKILL_TEMPLATE } from "../../skill/template.js";
import { detectPlaywrightBrowsers, ensurePlaywrightBrowsers } from "../../runner/index.js";

const SKILL_FILE = "qagent-skill.md";

const LOGO = `
${color.cyan("   ██████╗  █████╗  ██████╗ ███████╗███╗   ██╗████████╗")}
${color.cyan("  ██╔═══██╗██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝")}
${color.cyan("  ██║   ██║███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ")}
${color.cyan("  ██║▄▄ ██║██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ")}
${color.cyan("  ╚██████╔╝██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ")}
${color.cyan("   ╚══▀▀═╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ")}
${color.dim("  AI-powered QA on every commit                    v0.1.0")}
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

  // -- Step 5: run mode --
  const huskyDir = detectHuskyDir(cwd);
  const hookScope = huskyDir !== null
    ? "team-wide via Husky"
    : "local only via git hooks";

  const runMode = await p.select({
    message: "How should qagent run?",
    options: [
      {
        value: "hook" as const,
        label: "On every commit",
        hint: `recommended — pre-commit hook, ${hookScope}`,
      },
      {
        value: "manual" as const,
        label: "On demand",
        hint: "run `qagent run` manually, no commit gating",
      },
    ],
  });

  if (p.isCancel(runMode)) {
    p.cancel("Cancelled.");
    return;
  }

  const useHook = runMode === "hook";

  if (useHook) {
    const s = p.spinner();
    s.start("Installing pre-commit hook");
    try {
      const { hookPath, target } = injectGitHook(cwd, pm.runner);
      s.stop(`Pre-commit hook installed via ${target === "husky" ? "Husky" : "git"} → ${hookPath}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      s.stop(color.red(`Could not install hook: ${message}`));
      p.log.warn("Run `npx qagent init` inside your git repo to retry.");
    }
  } else {
    p.log.info("Skipped hook — run " + color.cyan("qagent run") + " anytime to check staged changes.");
  }

  // -- Step 6: lens selection --
  const selectedLenses = await p.multiselect({
    message: "Which QA lenses should run on every commit?",
    options: [
      { value: "render" as QaLens,      label: "render",      hint: "mounts without crash, null/missing props" },
      { value: "interaction" as QaLens,  label: "interaction", hint: "clicks, inputs, keyboard events, form submission" },
      { value: "state" as QaLens,        label: "state",       hint: "loading, empty, error, populated data" },
      { value: "edge-cases" as QaLens,   label: "edge-cases",  hint: "boundary values, race conditions, optional data" },
      { value: "security" as QaLens,     label: "security",    hint: "auth enforcement, input validation, data exposure" },
    ],
    initialValues: DEFAULT_LENSES as QaLens[],
    required: false,
  } as Parameters<typeof p.multiselect>[0]);

  if (p.isCancel(selectedLenses)) {
    p.cancel("Cancelled.");
    return;
  }

  const lenses = (selectedLenses as QaLens[]).length > 0
    ? selectedLenses as QaLens[]
    : DEFAULT_LENSES;

  writePersistedConfig(cwd, { lenses });
  p.log.step(`Lenses: ${lenses.join(", ")}`);

  // -- Step 7: skill file --
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
  const nextSteps = useHook
    ? "Every commit will now trigger AI-powered QA automatically."
    : "Run " + color.cyan("qagent run") + " on staged changes whenever you want a report.";

  p.note(
    [
      nextSteps,
      "",
      `${color.cyan("qagent models")}  — switch AI provider or model`,
      `${color.cyan("qagent skill")}   — fill in your project skill file`,
      `${color.cyan("qagent lens")}    — choose which QA lenses run`,
      `${color.cyan("qagent status")}  — check your setup`,
    ].join("\n"),
    "qagent is ready!",
  );

  p.outro("Happy testing!");
};
