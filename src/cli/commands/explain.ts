import * as p from "@clack/prompts";
import color from "picocolors";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../config/loader.js";
import { generate } from "../../providers/index.js";

const LAST_FAILURE_PATH = join(process.cwd(), ".qagent", "last-failure.txt");

const buildExplainPrompt = (output: string): string => `
You are a senior QA engineer. Automated tests failed during a git commit.

Explain concisely:
1. What went wrong
2. Which part of the component is likely broken
3. How to fix it

Test output:
\`\`\`
${output.slice(0, 3000)}
\`\`\`

Be direct and actionable. No jargon. Plain English only.
`.trim();

export const explainCommand = async (): Promise<void> => {
  p.intro(color.cyan("qagent explain"));

  if (!existsSync(LAST_FAILURE_PATH)) {
    p.log.warn("No recorded failure found.");
    p.log.info("Run " + color.cyan("`qagent run`") + " first to capture test output.");
    p.outro("");
    return;
  }

  const failureOutput = readFileSync(LAST_FAILURE_PATH, "utf8");

  let config;
  try {
    config = loadConfig();
  } catch {
    p.log.error("No model configured. Run " + color.cyan("qagent models") + " first.");
    p.outro("");
    return;
  }

  const s = p.spinner();
  s.start("Asking AI to explain the failure");

  try {
    const response = await generate(config.ai, buildExplainPrompt(failureOutput), { temperature: 0.3 });
    s.stop("Explanation ready");
    p.note(response.trim(), "Failure Analysis");
  } catch (err) {
    s.stop(color.red(`Could not reach provider: ${err instanceof Error ? err.message : String(err)}`));
    p.log.message(color.dim("Raw failure output:\n\n") + failureOutput);
  }

  p.outro("");
};
