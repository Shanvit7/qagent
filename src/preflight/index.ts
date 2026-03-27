/**
 * Preflight checks — run before `qagent run` and `qagent watch`.
 *
 * Validates that the environment is ready:
 *   1. AI model configured (provider + model in .qagentrc)
 *   2. API key present (for cloud providers)
 *   3. Ollama reachable (if using Ollama)
 *   4. Playwright Chromium browser installed
 *
 * If any check fails, prompts the user to fix it interactively.
 * Returns false if the user cancels or a required fix can't be applied.
 */

import * as p from "@clack/prompts";
import color from "picocolors";
import { readProvider, readModel } from "@/config/loader";
import { hasApiKey, envVarName, isOllamaRunning, listOllamaModels } from "@/providers/index";
import { setupProvider } from "@/setup/providers";
import { detectPlaywrightBrowsers, ensurePlaywrightBrowsers } from "@/runner/index";

export interface PreflightResult {
  ok: boolean;
  /** Short reason if not ok — for hook mode where we skip interactive prompts */
  reason?: string;
}

/**
 * Run all preflight checks. In interactive mode, prompts the user to fix issues.
 * In hook mode (non-interactive), just reports pass/fail.
 */
export const runPreflight = async (
  cwd: string,
  options: { interactive?: boolean } = {},
): Promise<PreflightResult> => {
  const interactive = options.interactive !== false;

  // ── 1. Model configured? ──────────────────────────────────────────────────

  const provider = readProvider();
  const model = readModel();

  if (!provider || !model) {
    if (!interactive) {
      return { ok: false, reason: "No AI model configured. Run `qagent init` to set up." };
    }

    p.log.warn("No AI model configured yet.");

    const configured = await setupProvider();
    if (!configured) {
      p.log.error(
        `Model is required. Run ${color.cyan("qagent init")} or ${color.cyan("qagent models")} to configure.`,
      );
      return { ok: false, reason: "Model not configured" };
    }
  }

  // Re-read after potential setup
  const finalProvider = readProvider()!;
  const finalModel = readModel()!;

  // ── 2. API key present? (cloud providers only) ────────────────────────────

  if (finalProvider !== "ollama" && !hasApiKey(finalProvider)) {
    if (!interactive) {
      return {
        ok: false,
        reason: `${envVarName(finalProvider)} not set. Add it to .env or export in shell.`,
      };
    }

    const envVar = envVarName(finalProvider);
    p.log.warn(`${color.bold(envVar)} not found.`);
    p.note(
      [
        `Add your API key to ${color.bold(".env")} in your project root:`,
        "",
        color.cyan(`  ${envVar}=sk-...`),
        "",
        color.dim("qagent reads from .env, .env.local, and shell environment."),
        "",
        `Then re-run ${color.cyan("qagent run")}.`,
      ].join("\n"),
      "API Key Required",
    );
    return { ok: false, reason: `${envVar} not set` };
  }

  // ── 3. Ollama reachable? (if using Ollama) ────────────────────────────────

  if (finalProvider === "ollama") {
    const running = await isOllamaRunning();
    if (!running) {
      if (!interactive) {
        return { ok: false, reason: "Ollama is not running. Start it with `ollama serve`." };
      }

      p.log.warn("Ollama is not running.");
      p.note(
        [
          `Start Ollama:  ${color.cyan("ollama serve")}`,
          `Then re-run:   ${color.cyan("qagent run")}`,
        ].join("\n"),
        "Ollama Required",
      );
      return { ok: false, reason: "Ollama not running" };
    }

    // Check if the configured model is actually pulled
    const models = await listOllamaModels();
    if (!models.some((m) => m === finalModel || m.startsWith(finalModel.split(":")[0]!))) {
      if (!interactive) {
        return { ok: false, reason: `Model ${finalModel} not found in Ollama. Pull it with \`ollama pull ${finalModel}\`.` };
      }

      p.log.warn(`Model ${color.bold(finalModel)} is not pulled in Ollama.`);

      const shouldPull = await p.confirm({
        message: `Pull ${color.cyan(finalModel)} now?`,
        initialValue: true,
      });

      if (p.isCancel(shouldPull) || !shouldPull) {
        p.log.info(`Run ${color.cyan(`ollama pull ${finalModel}`)} manually, then retry.`);
        return { ok: false, reason: `Model ${finalModel} not available` };
      }

      const s = p.spinner();
      s.start(`Pulling ${finalModel}…`);
      try {
        const { Ollama } = await import("ollama");
        const ollama = new Ollama();
        await ollama.pull({ model: finalModel });
        s.stop(`${finalModel} pulled ✓`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        s.stop(color.red("Pull failed"));
        p.log.error(msg.slice(0, 300));
        return { ok: false, reason: `Failed to pull ${finalModel}` };
      }
    }
  }

  // ── 4. Playwright browsers installed? ─────────────────────────────────────

  const browsersOk = await detectPlaywrightBrowsers(cwd);

  if (!browsersOk) {
    if (!interactive) {
      return { ok: false, reason: "Playwright Chromium not installed. Run `npx playwright install chromium`." };
    }

    p.log.warn("Playwright Chromium browser not installed.");

    const shouldInstall = await p.confirm({
      message: `Install Chromium now? ${color.dim("(required for browser tests)")}`,
      initialValue: true,
    });

    if (p.isCancel(shouldInstall) || !shouldInstall) {
      p.log.info(
        `Run ${color.cyan("npx playwright install chromium")} manually, then retry.`,
      );
      return { ok: false, reason: "Playwright Chromium not installed" };
    }

    const s = p.spinner();
    s.start("Installing Chromium via Playwright…");
    try {
      await ensurePlaywrightBrowsers(cwd);
      s.stop("Chromium installed ✓");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      s.stop(color.red("Install failed"));
      p.log.error(msg.slice(0, 400));
      return { ok: false, reason: "Playwright install failed" };
    }
  }

  // ── All checks passed ─────────────────────────────────────────────────────

  p.log.step(
    `${color.green("✓")} Ready — ${color.bold(finalModel)} ${color.dim(`(${finalProvider})`)} + Chromium`,
  );

  return { ok: true };
};
