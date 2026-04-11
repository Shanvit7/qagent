import color from "picocolors";
import {
  CLOUD_MODELS,
  listOllamaModels,
  isOllamaRunning,
  hasApiKey,
  envVarName,
} from "@/providers/index";
import type { ProviderName } from "@/providers/index";
import { writeProvider, writeModel, readProvider, readModel } from "@/config/loader";
import { askYesNo, askChoice } from "@/utils/prompt";

/**
 * Interactive provider + model selection for the init wizard.
 * Returns true if a model was successfully configured.
 */
export const setupProvider = async (): Promise<boolean> => {
  // If already configured, ask if they want to change
  const existing = readProvider();
  const existingModel = readModel();
  if (existing && existingModel) {
    console.log(`Current model: ${color.bold(existingModel)} ${color.dim(`(${existing})`)}`);
    const change = await askYesNo("Change model?", false);
    if (!change) return true;
  }

  const providers = ['openai', 'anthropic', 'ollama'];
  const providerChoiceIndex = await askChoice("Select an AI provider:", providers.map(p => `${p.charAt(0).toUpperCase() + p.slice(1)} ${hasApiKey(p as ProviderName) ? '(API key found)' : p === 'ollama' ? '(local, free, no API key)' : `(requires ${envVarName(p as ProviderName)})`}`));
  const provider = providers[providerChoiceIndex] as ProviderName;

  // API key check for cloud
  if (provider !== "ollama" && !hasApiKey(provider)) {
    console.log(color.yellow(`${envVarName(provider)} not found.`));
    console.log(`Add your API key to ${color.bold(".env")} in your project root:`);
    console.log(color.cyan(`  ${envVarName(provider)}=sk-...`));
    console.log(color.dim("qagent reads from .env, .env.local, and shell environment."));
  }

  // Model selection
  let options: string[] = [];

  if (provider === "ollama") {
    const running = await isOllamaRunning();
    if (!running) {
      console.log(color.yellow("Ollama isn't running."));
      console.log(`Start it: ${color.cyan("ollama serve")}`);
      console.log(`Pull a model: ${color.cyan("ollama pull qwen2.5-coder:7b")}`);
      return false;
    }

    const installed = await listOllamaModels();
    if (installed.length === 0) {
      console.log(color.yellow("No Ollama models pulled yet."));
      console.log(`Pull one: ${color.cyan("ollama pull qwen2.5-coder:7b")}`);
      return false;
    }

    const codeModels = installed.filter((m) => /coder|code|deepseek|qwen|mistral|llama/i.test(m));
    const sorted = [...new Set([...codeModels, ...installed])];
    options = sorted;
  } else {
    const providerModels = CLOUD_MODELS.filter((m) => m.provider === provider);
    options = providerModels.map((m) => m.id);
  }

  const selectedIndex = await askChoice("Pick a model:", options);
  const model = options[selectedIndex];

  writeProvider(provider);
  writeModel(model);

  console.log(color.green(`Model: ${color.bold(model)} ${color.dim(`(${provider})`)}`));
  return true;
};
