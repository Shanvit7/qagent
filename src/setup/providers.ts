import * as p from "@clack/prompts";
import color from "picocolors";
import {
  CLOUD_MODELS,
  listOllamaModels,
  isOllamaRunning,
  hasApiKey,
  envVarName,
} from "../providers/index.js";
import type { ProviderName } from "../providers/index.js";
import { writeProvider, writeModel, readProvider, readModel } from "../config/loader.js";

/**
 * Interactive provider + model selection for the init wizard.
 * Returns true if a model was successfully configured.
 */
export const setupProvider = async (): Promise<boolean> => {
  // If already configured, ask if they want to change
  const existing = readProvider();
  const existingModel = readModel();
  if (existing && existingModel) {
    p.log.info(`Current model: ${color.bold(existingModel)} ${color.dim(`(${existing})`)}`);
    const change = await p.confirm({
      message: "Change model?",
      initialValue: false,
    });
    if (p.isCancel(change) || !change) return true;
  }

  const providerChoice = await p.select({
    message: "Select an AI provider:",
    options: [
      { value: "openai" as const,    label: "OpenAI",    hint: hasApiKey("openai") ? "API key found" : "requires OPENAI_API_KEY" },
      { value: "anthropic" as const, label: "Anthropic", hint: hasApiKey("anthropic") ? "API key found" : "requires ANTHROPIC_API_KEY" },
      { value: "ollama" as const,    label: "Ollama",    hint: "local, free, no API key" },
    ],
  });

  if (p.isCancel(providerChoice)) return false;
  const provider = providerChoice as ProviderName;

  // API key check for cloud
  if (provider !== "ollama" && !hasApiKey(provider)) {
    p.log.warn(`${envVarName(provider)} not found.`);
    p.note(
      [
        `Add your API key to ${color.bold(".env")} in your project root:`,
        "",
        color.cyan(`  ${envVarName(provider)}=sk-...`),
        "",
        color.dim("qagent reads from .env, .env.local, and shell environment."),
      ].join("\n"),
      "API Key Required",
    );
  }

  // Model selection
  type ModelChoice = { value: string; label: string; hint?: string };
  let options: ModelChoice[] = [];

  if (provider === "ollama") {
    const running = await isOllamaRunning();
    if (!running) {
      p.log.warn("Ollama isn't running.");
      p.note(
        [
          `Start it: ${color.cyan("ollama serve")}`,
          `Pull a model: ${color.cyan("ollama pull qwen2.5-coder:7b")}`,
          "",
          "Then run " + color.cyan("qagent models") + " to configure.",
        ].join("\n"),
        "Ollama Setup",
      );
      return false;
    }

    const installed = await listOllamaModels();
    if (installed.length === 0) {
      p.log.warn("No Ollama models pulled yet.");
      p.note(`Pull one: ${color.cyan("ollama pull qwen2.5-coder:7b")}`, "Ollama Setup");
      return false;
    }

    const codeModels = installed.filter((m) => /coder|code|deepseek|qwen|mistral|llama/i.test(m));
    const sorted = [...new Set([...codeModels, ...installed])];
    options = sorted.map((m) => ({ value: m, label: m }));
  } else {
    const providerModels = CLOUD_MODELS.filter((m) => m.provider === provider);
    options = providerModels.map((m) => ({
      value: m.id,
      label: m.id,
      hint: m.label,
    }));
  }

  const selected = await p.select({
    message: "Pick a model:",
    options,
    initialValue: options[0]?.value,
  });

  if (p.isCancel(selected)) return false;

  const model = selected as string;
  writeProvider(provider);
  writeModel(model);

  p.log.success(`Model: ${color.bold(model)} ${color.dim(`(${provider})`)}`);
  return true;
};
