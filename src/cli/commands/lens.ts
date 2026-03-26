import * as p from "@clack/prompts";
import color from "picocolors";
import { loadConfig, writePersistedConfig } from "../../config/loader.js";
import type { QaLens } from "../../config/types.js";

export const lensCommand = async (): Promise<void> => {
  const cwd    = process.cwd();
  const config = loadConfig(cwd);

  p.intro(color.cyan("qagent lens"));

  p.log.info("Current lenses: " + color.bold(config.playwright.lenses.join(", ")));

  const selected = await p.multiselect({
    message: "Select lenses to run on every commit:",
    options: [
      { value: "render" as QaLens,      label: "render",      hint: "mounts without crash, null/missing props" },
      { value: "interaction" as QaLens,  label: "interaction", hint: "clicks, inputs, keyboard events, form submission" },
      { value: "state" as QaLens,        label: "state",       hint: "loading, empty, error, populated data" },
      { value: "edge-cases" as QaLens,   label: "edge-cases",  hint: "boundary values, race conditions, optional data" },
      { value: "security" as QaLens,     label: "security",    hint: "auth enforcement, input validation, data exposure" },
    ],
    initialValues: config.playwright.lenses as QaLens[],
    required: false,
  } as Parameters<typeof p.multiselect>[0]);

  if (p.isCancel(selected)) {
    p.cancel("Cancelled.");
    return;
  }

  const lenses = selected as QaLens[];

  if (lenses.length === 0) {
    p.log.warn("No lenses selected — keeping current config unchanged.");
    p.outro("");
    return;
  }

  writePersistedConfig(cwd, { lenses });

  p.log.success("Lenses updated — " + lenses.join(", "));
  p.outro("Takes effect on the next commit or " + color.cyan("qagent run") + ".");
};
