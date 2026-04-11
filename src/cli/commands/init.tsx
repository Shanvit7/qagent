import React from "react";
import { render } from "ink";
import { InitWizard } from "../../ui/screens/InitWizard";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { detectPackageManager, runPm } from "@/utils/packageManager";
import { ensureQAgentIgnored } from "@/reporter/index";
import { SKILL_TEMPLATE } from "@/skill/template";
import { detectPlaywrightBrowsers, ensurePlaywrightBrowsers } from "@/runner/index";

const SKILL_FILE = "qagent-skill.md";

interface Config {
  aiProvider: string;
  model: string;
  enableGitHook: boolean;
}

export const initCommand = async (): Promise<void> => {
  if (!process.stdin.isTTY) {
    console.log("qagent init requires an interactive terminal (TTY). Please run in a proper terminal.");
    return;
  }

  const cwd = process.cwd();

  await new Promise<void>((resolvePromise) => {
    render(
      <InitWizard
        onComplete={async (config: Config) => {
          // Do the setup logic here
          const pm = detectPackageManager(cwd);

          // Install if not already
          const pkgPath = join(cwd, "package.json");
          let isInstalled = false;
          if (existsSync(pkgPath)) {
            try {
              const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
                dependencies?: Record<string, string>;
                devDependencies?: Record<string, string>;
              };
              isInstalled = "qagent" in (pkg.dependencies ?? {}) || "qagent" in (pkg.devDependencies ?? {});
            } catch {}
          }

          if (!isInstalled) {
            // Install qagent
            await runPm(pm.name, pm.addDevArgs("qagent"), cwd);
          }

          // Setup provider based on config
          // For simplicity, assume ollama
          // setupProvider() but adapted

          // Playwright browsers
          if (!await detectPlaywrightBrowsers(cwd)) {
            await ensurePlaywrightBrowsers(cwd);
          }

          // gitignore
          ensureQAgentIgnored(cwd);

          // skill file
          const skillPath = resolve(cwd, SKILL_FILE);
          if (!existsSync(skillPath)) {
            writeFileSync(skillPath, SKILL_TEMPLATE, "utf8");
          }

          resolvePromise();
        }}
      />
    );
  });
};