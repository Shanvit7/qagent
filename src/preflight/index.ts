import { readProvider, readModel } from "@/config/loader";
import { hasApiKey, envVarName, isOllamaRunning, listOllamaModels } from "@/providers/index";
import { setupProvider } from "@/setup/providers";
import { detectPlaywrightBrowsers, ensurePlaywrightBrowsers } from "@/runner/index";
import { askYesNo } from "@/utils/prompt";

export interface PreflightResult {
  ok: boolean;
  /** Short reason if not ok */
  reason?: string;
  /** Messages to display */
  messages?: string[];
}
export const runPreflight = async (
  cwd: string,
  options: { interactive?: boolean } = {},
): Promise<PreflightResult> => {
  const interactive = options.interactive !== false;
  const messages: string[] = [];

  // ── 1. Model configured? ──────────────────────────────────────────────────

  const provider = readProvider();
  const model = readModel();

  if (!provider || !model) {
    if (!interactive) {
      return { ok: false, reason: "No AI model configured. Run `qagent init` to set up.", messages };
    }

    messages.push("No AI model configured yet.");

    const { success: configured, messages: setupMessages } = await setupProvider();
    messages.push(...setupMessages);
    if (!configured) {
      return { ok: false, reason: "Model not configured", messages };
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
        messages,
      };
    }

    const envVar = envVarName(finalProvider);
    messages.push(`${envVar} not found.`);
    messages.push("Add your API key to .env in your project root:");
    messages.push(`  ${envVar}=sk-...`);
    messages.push("qagent reads from .env, .env.local, and shell environment.");
    messages.push("Then re-run qagent run.");
    return { ok: false, reason: `${envVar} not set`, messages };
  }

  // ── 3. Ollama reachable? (if using Ollama) ────────────────────────────────

  if (finalProvider === "ollama") {
    const running = await isOllamaRunning();
    if (!running) {
      if (!interactive) {
        return { ok: false, reason: "Ollama is not running. Start it with `ollama serve`.", messages };
      }

      messages.push("Ollama is not running.");
      messages.push("Start Ollama:  ollama serve");
      messages.push("Then re-run:   qagent run");
      return { ok: false, reason: "Ollama not running", messages };
    }

    // Check if the configured model is actually pulled
    const models = await listOllamaModels();
    if (!models.some((m) => m === finalModel || m.startsWith(finalModel.split(":")[0]!))) {
      if (!interactive) {
        return { ok: false, reason: `Model ${finalModel} not found in Ollama. Pull it with \`ollama pull ${finalModel}\`.`, messages };
      }

      messages.push(`Model ${finalModel} is not pulled in Ollama.`);

      const shouldPull = await askYesNo(`Pull ${finalModel} now?`, true);

      if (!shouldPull) {
        messages.push(`Run ollama pull ${finalModel} manually, then retry.`);
        return { ok: false, reason: `Model ${finalModel} not available`, messages };
      }

      messages.push("Pulling ${finalModel}…");
      try {
        const { Ollama } = await import("ollama");
        const ollama = new Ollama();
        await ollama.pull({ model: finalModel });
        messages.push(`${finalModel} pulled ✓`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        messages.push("Pull failed");
        messages.push(msg.slice(0, 300));
        return { ok: false, reason: `Failed to pull ${finalModel}`, messages };
      }
    }
  }

  // ── 4. Playwright browsers installed? ─────────────────────────────────────

  const browsersOk = await detectPlaywrightBrowsers(cwd);

  if (!browsersOk) {
    if (!interactive) {
      return { ok: false, reason: "Playwright Chromium not installed. Run `npx playwright install chromium`.", messages };
    }

    messages.push("Playwright Chromium browser not installed.");

    const shouldInstall = await askYesNo("Install Chromium now? (required for browser tests)", true);

    if (!shouldInstall) {
      messages.push("Run npx playwright install chromium manually, then retry.");
      return { ok: false, reason: "Playwright Chromium not installed", messages };
    }

    messages.push("Installing Chromium via Playwright…");
    try {
      await ensurePlaywrightBrowsers(cwd);
      messages.push("Chromium installed ✓");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      messages.push("Install failed");
      messages.push(msg.slice(0, 400));
      return { ok: false, reason: "Playwright install failed", messages };
    }
  }

  // ── All checks passed ─────────────────────────────────────────────────────

  messages.push(`✓ Ready — ${finalModel} (${finalProvider}) + Chromium`);

  return { ok: true, messages };
};