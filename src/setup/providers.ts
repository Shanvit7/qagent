import {
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
 * Returns success and messages.
 */
export const setupProvider = async (): Promise<{ success: boolean; messages: string[] }> => {
  const messages: string[] = [];

  // If already configured, ask if they want to change
  const existing = readProvider();
  const existingModel = readModel();
  if (existing && existingModel) {
    messages.push(`Current model: ${existingModel} (${existing})`);
    const change = await askYesNo("Change model?", false);
    if (!change) return { success: true, messages };
  }

  // Only Ollama for now, as cloud providers are deprecated
  const providers = ['ollama'];
  const providerChoiceIndex = await askChoice("Select an AI provider:", providers.map(p => `${p.charAt(0).toUpperCase() + p.slice(1)} (local, free, no API key)`));
  const provider = providers[providerChoiceIndex] as ProviderName;

  // Model selection
  let options: string[] = [];

  if (provider === "ollama") {
    const running = await isOllamaRunning();
    if (!running) {
      messages.push("Ollama isn't running.");
      messages.push("Start it: ollama serve");
      messages.push("Pull a model: ollama pull qwen2.5-coder:7b");
      return { success: false, messages };
    }

    const installed = await listOllamaModels();
    if (installed.length === 0) {
      messages.push("No Ollama models pulled yet.");
      messages.push("Pull one: ollama pull qwen2.5-coder:7b");
      return { success: false, messages };
    }

    const codeModels = installed.filter((m) => /coder|code|deepseek|qwen|mistral|llama/i.test(m));
    const sorted = [...new Set([...codeModels, ...installed])];
    options = sorted;
  }

  const selectedIndex = await askChoice("Pick a model:", options);
  const model = options[selectedIndex]!;

  writeProvider(provider);
  writeModel(model);

  messages.push(`Model: ${model} (${provider})`);
  return { success: true, messages };
};
