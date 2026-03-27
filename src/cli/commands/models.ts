import * as p from "@clack/prompts";
import color from "picocolors";
import {
  readProvider,
  readModel,
  writeProvider,
  writeModel,
} from "@/config/loader";
import {
  CLOUD_MODELS,
  listOllamaModels,
  isOllamaRunning,
  hasApiKey,
  envVarName,
} from "@/providers/index";
import type { ProviderName } from "@/providers/index";

export const modelsCommand = async (): Promise<void> => {
  p.intro(color.cyan("qagent models"));

  const currentProvider = readProvider();
  const currentModel    = readModel();

  if (currentProvider && currentModel) {
    p.log.info(`Active: ${color.bold(currentModel)} ${color.dim(`(${currentProvider})`)}`);
  } else {
    p.log.warn("No model configured yet.");
  }

  // Step 1: Pick provider
  const providerChoice = await p.select({
    message: "Select a provider:",
    options: [
      { value: "openai" as const,    label: "OpenAI",    hint: hasApiKey("openai") ? "API key found" : "requires OPENAI_API_KEY" },
      { value: "anthropic" as const, label: "Anthropic", hint: hasApiKey("anthropic") ? "API key found" : "requires ANTHROPIC_API_KEY" },
      { value: "ollama" as const,    label: "Ollama",    hint: "local, free, no API key" },
    ],
  });

  if (p.isCancel(providerChoice)) {
    p.cancel("Cancelled.");
    return;
  }

  const provider = providerChoice as ProviderName;

  // Step 2: Check API key for cloud providers
  if (provider !== "ollama" && !hasApiKey(provider)) {
    p.log.warn(`${envVarName(provider)} not found.`);
    p.note(
      [
        `Add your API key to ${color.bold(".env")} in your project root:`,
        "",
        color.cyan(`  ${envVarName(provider)}=sk-...`),
        "",
        "Or export in your shell profile (~/.zshrc / ~/.bashrc).",
        "",
        color.dim("qagent reads from .env, .env.local, and shell environment."),
      ].join("\n"),
      "API Key Required",
    );

    const proceed = await p.confirm({
      message: "Continue anyway? (you can set the key later)",
      initialValue: false,
    });

    if (p.isCancel(proceed) || !proceed) {
      p.cancel("Set your API key and try again.");
      return;
    }
  }

  // Step 3: Pick model
  type ModelChoice = { value: string; label: string; hint?: string };
  let options: ModelChoice[] = [];

  if (provider === "ollama") {
    const running = await isOllamaRunning();
    if (!running) {
      p.log.warn("Ollama isn't running. Start it with: " + color.cyan("ollama serve"));
    }

    const installed = running ? await listOllamaModels() : [];
    const codeModels = installed.filter((m) =>
      /coder|code|deepseek|qwen|mistral|llama/i.test(m)
    );
    const sorted = [...new Set([...codeModels, ...installed])];

    if (sorted.length === 0) {
      p.log.error("No Ollama models available.");
      p.note(
        [
          "Pull a model first:",
          "",
          color.cyan("  ollama pull qwen2.5-coder:7b"),
          color.cyan("  ollama pull deepseek-coder:6.7b"),
          color.cyan("  ollama pull llama3.1:8b"),
        ].join("\n"),
        "Ollama Setup",
      );
      p.outro("");
      return;
    }

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

  if (p.isCancel(selected)) {
    p.cancel("Cancelled.");
    return;
  }

  const model = selected as string;

  // Step 4: Save
  writeProvider(provider);
  writeModel(model);

  p.log.success(`Provider set to ${color.bold(provider)}, model set to ${color.bold(model)}`);
  p.log.info("Stored in ~/.qagentrc");

  if (provider !== "ollama") {
    p.note(
      [
        "You can also set these via environment variables:",
        "",
        color.cyan(`  export QAGENT_PROVIDER=${provider}`),
        color.cyan(`  export QAGENT_MODEL=${model}`),
      ].join("\n"),
      "Tip",
    );
  }

  p.outro("");
};
