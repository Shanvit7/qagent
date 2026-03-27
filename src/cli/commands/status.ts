import * as p from "@clack/prompts";
import color from "picocolors";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { readProvider, readModel, readIterations, DEFAULT_ITERATIONS } from "@/config/loader";
import { isOllamaRunning, listOllamaModels, hasApiKey, envVarName } from "@/providers/index";
import type { ProviderName } from "@/providers/index";

type CheckStatus = "pass" | "warn" | "fail";

interface CheckItem {
  label: string;
  status: CheckStatus;
  detail?: string;
  fix?: string;
}


const checkSkillFile = (cwd: string): CheckItem => {
  if (existsSync(resolve(cwd, "qagent-skill.md")))
    return { label: "qagent-skill.md found", status: "pass" };
  return {
    label: "qagent-skill.md missing",
    status: "warn",
    detail: "qagent will use defaults — no project context",
    fix: "npx qagent skill",
  };
};

const checkModel = async (provider: ProviderName | undefined, model: string | undefined): Promise<CheckItem> => {
  if (!provider || !model) {
    return {
      label: "No model configured",
      status: "fail",
      detail: "Run the model selection wizard",
      fix: "qagent models",
    };
  }

  if (provider === "ollama") {
    const running = await isOllamaRunning();
    if (!running) {
      return {
        label: "Ollama not reachable",
        status: "fail",
        detail: "Start Ollama to enable test generation",
        fix: `ollama serve  →  ollama pull ${model}`,
      };
    }
    const models = await listOllamaModels();
    const slug = model.split(":")[0] ?? model;
    const found = models.find((m) => m === model || m.startsWith(slug));
    if (found) return { label: `${found} ready`, status: "pass", detail: "Ollama is running" };
    return {
      label: `${model} not pulled yet`,
      status: "fail",
      detail: "Ollama is running but the model is missing",
      fix: `ollama pull ${model}`,
    };
  }

  // Cloud provider
  if (!hasApiKey(provider)) {
    return {
      label: `${envVarName(provider)} not set`,
      status: "fail",
      detail: `Required for ${provider} provider`,
      fix: `export ${envVarName(provider)}=sk-...`,
    };
  }

  return { label: `${model} (${provider})`, status: "pass", detail: "API key found" };
};

const renderCheck = (item: CheckItem): void => {
  if (item.status === "pass") {
    p.log.success(item.label + (item.detail ? color.dim(` — ${item.detail}`) : ""));
  } else if (item.status === "warn") {
    p.log.warn(item.label + (item.detail ? color.dim(` — ${item.detail}`) : ""));
    if (item.fix) p.log.message(color.cyan(`  ${item.fix}`));
  } else {
    p.log.error(item.label + (item.detail ? color.dim(` — ${item.detail}`) : ""));
    if (item.fix) p.log.message(color.cyan(`  ${item.fix}`));
  }
};

export const statusCommand = async (): Promise<void> => {
  const cwd      = process.cwd();
  const provider = readProvider();
  const model    = readModel();

  p.intro(color.cyan("qagent status"));

  if (provider && model) {
    const source = process.env["QAGENT_MODEL"] ? "env var" : "~/.qagentrc";
    p.log.info(`Model:      ${color.bold(model)} ${color.dim(`(${provider}, ${source})`)}`);
  } else {
    p.log.warn("No model configured — run " + color.cyan("qagent models"));
  }

  const iterations = readIterations();
  p.log.info(
    `Iterations: ${color.bold(String(iterations))}` +
    color.dim(iterations === DEFAULT_ITERATIONS ? "  (recommended)  qagent config iterations" : "  qagent config iterations"),
  );

  const checks: CheckItem[] = [
    checkSkillFile(cwd),
    await checkModel(provider, model),
  ];

  for (const check of checks) {
    renderCheck(check);
  }

  const failing  = checks.filter((c) => c.status === "fail");
  const warnings = checks.filter((c) => c.status === "warn");

  if (failing.length === 0 && warnings.length === 0) {
    p.outro(color.green("Everything looks good — qagent is ready."));
  } else if (failing.length > 0) {
    p.outro(color.red(`${failing.length} issue${failing.length > 1 ? "s" : ""} to fix before qagent can run.`));
  } else {
    p.outro(color.yellow(`Almost ready — ${warnings.length} optional step${warnings.length > 1 ? "s" : ""} above.`));
  }
};
