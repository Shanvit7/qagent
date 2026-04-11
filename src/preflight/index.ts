import color from "picocolors";
import { readProvider, readModel } from "@/config/loader";
import { hasApiKey, envVarName, isOllamaRunning, listOllamaModels } from "@/providers/index";
import { setupProvider } from "@/setup/providers";
import { detectPlaywrightBrowsers, ensurePlaywrightBrowsers } from "@/runner/index";
import { askYesNo } from "@/utils/prompt";

export interface PreflightResult {
  ok: boolean;
  /** Short reason if not ok */
  reason?: string;
}

/**
 * Run all preflight checks. In interactive mode, prompts the user to fix issues.
 * In non-interactive mode (e.g. watch), just reports pass/fail.
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

    console.log(color.yellow("No AI model configured yet."));

    const configured = await setupProvider();
    if (!configured) {
      console.log(color.red(`Model is required. Run ${color.cyan("qagent init")} or ${color.cyan("qagent models")} to configure.`));
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
    console.log(color.yellow(`${color.bold(envVar)} not found.`));
    console.log(`Add your API key to ${color.bold(".env")} in your project root:`);
    console.log(color.cyan(`  ${envVar}=sk-...`));
    console.log(color.dim("qagent reads from .env, .env.local, and shell environment."));
    console.log(color.cyan(`Then re-run ${color.cyan("qagent run")}.`));
    return { ok: false, reason: `${envVar} not set` };
  }

  // ── 3. Ollama reachable? (if using Ollama) ────────────────────────────────

  if (finalProvider === "ollama") {
    const running = await isOllamaRunning();
    if (!running) {
      if (!interactive) {
        return { ok: false, reason: "Ollama is not running. Start it with `ollama serve`." };
      }

      console.log(color.yellow("Ollama is not running."));
      console.log(`Start Ollama:  ${color.cyan("ollama serve")}`);
      console.log(`Then re-run:   ${color.cyan("qagent run")}`);
      return { ok: false, reason: "Ollama not running" };
    }

    // Check if the configured model is actually pulled
    const models = await listOllamaModels();
    if (!models.some((m) => m === finalModel || m.startsWith(finalModel.split(":")[0]!))) {
      if (!interactive) {
        return { ok: false, reason: `Model ${finalModel} not found in Ollama. Pull it with \`ollama pull ${finalModel}\`.` };
      }

      console.log(color.yellow(`Model ${color.bold(finalModel)} is not pulled in Ollama.`));

      const shouldPull = await askYesNo(`Pull ${color.cyan(finalModel)} now?`, true);

      if (!shouldPull) {
        console.log(`Run ${color.cyan(`ollama pull ${finalModel}`)} manually, then retry.`);
        return { ok: false, reason: `Model ${finalModel} not available` };
      }

      console.log(`Pulling ${finalModel}…`);
      try {
        const { Ollama } = await import("ollama");
        const ollama = new Ollama();
        await ollama.pull({ model: finalModel });
        console.log(`${finalModel} pulled ✓`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(color.red("Pull failed"));
        console.log(msg.slice(0, 300));
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

    console.log(color.yellow("Playwright Chromium browser not installed."));

    const shouldInstall = await askYesNo(`Install Chromium now? ${color.dim("(required for browser tests)")}`, true);

    if (!shouldInstall) {
      console.log(`Run ${color.cyan("npx playwright install chromium")} manually, then retry.`);
      return { ok: false, reason: "Playwright Chromium not installed" };
    }

    console.log("Installing Chromium via Playwright…");
    try {
      await ensurePlaywrightBrowsers(cwd);
      console.log("Chromium installed ✓");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(color.red("Install failed"));
      console.log(msg.slice(0, 400));
      return { ok: false, reason: "Playwright install failed" };
    }
  }

  // ── All checks passed ─────────────────────────────────────────────────────

  console.log(`${color.green("✓")} Ready — ${color.bold(finalModel)} ${color.dim(`(${finalProvider})`)} + Chromium`);

  return { ok: true };
};
