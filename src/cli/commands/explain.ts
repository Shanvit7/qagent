import * as p from "@clack/prompts";
import color from "picocolors";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "@/config/loader";
import { generate, getSessionUsage, resetSessionUsage, formatTokenSummary } from "@/providers/index";

const LAST_FAILURE_PATH = join(process.cwd(), ".qagent", "last-failure.txt");

const buildExplainPrompt = (failureRecord: string): string => {
  const hasDiff = failureRecord.includes("Code changes (git diff --staged):");

  const focus = hasDiff
    ? `Your job is to connect the CODE CHANGES to the test failures.
Read the diff carefully — the answer is almost always in there.
Ask: what did the developer change that would cause these specific tests to break?`
    : `No diff is available. Explain why the tests failed based on the error messages alone.`;

  return `You are a senior engineer doing a post-mortem on a failed QA run.

${focus}

Respond in this exact structure (plain English, no jargon, be specific):

**What changed:** (one sentence — what did the developer actually modify?)
**Why tests broke:** (one sentence — the direct connection between the change and the failure)
**Fix:** (one or two concrete actions — either fix the code or update the tests)

Do NOT explain what Playwright errors mean in general.
Do NOT say "the selector didn't match" without saying WHY it doesn't match given the diff.
Reference specific line changes, renamed props, removed elements, or changed text from the diff.

---
${failureRecord}
`.trim();
};

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

  resetSessionUsage();

  const s = p.spinner();
  s.start("Asking AI to explain the failure");

  try {
    const response = await generate(config.ai, buildExplainPrompt(failureOutput), { temperature: 0.2 });
    s.stop("Explanation ready");
    p.note(response.trim(), "Failure Analysis");

    const tokenSummary = formatTokenSummary(getSessionUsage());
    if (tokenSummary) p.log.info(color.dim(tokenSummary));
  } catch (err) {
    s.stop(color.red(`Could not reach provider: ${err instanceof Error ? err.message : String(err)}`));
    p.log.message(color.dim("Raw failure output:\n\n") + failureOutput);
  }

  p.outro("");
};
