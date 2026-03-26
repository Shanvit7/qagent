import * as p from "@clack/prompts";
import color from "picocolors";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SKILL_TEMPLATE, IDE_PROMPT } from "../../skill/template.js";

const SKILL_FILE = "qagent-skill.md";

/** Check if the skill file has been filled in (not just the bare template). */
const isFilledIn = (skillPath: string): boolean => {
  try {
    const content = readFileSync(skillPath, "utf8");
    // If it has code blocks with actual content, it's been filled in
    return /```\w*\n(?!\/\/)(?!\n```).+/s.test(content);
  } catch {
    return false;
  }
};

export const skillCommand = async (): Promise<void> => {
  const cwd       = process.cwd();
  const skillPath = resolve(cwd, SKILL_FILE);

  p.intro(color.cyan("qagent skill"));

  if (existsSync(skillPath) && isFilledIn(skillPath)) {
    const overwrite = await p.confirm({
      message: `${SKILL_FILE} already has content. Reset to empty template?`,
      initialValue: false,
    });

    if (p.isCancel(overwrite) || !overwrite) {
      p.log.info("Kept existing skill file.");
      p.outro("");
      return;
    }
  }

  writeFileSync(skillPath, SKILL_TEMPLATE, "utf8");

  p.log.success(`${color.bold(SKILL_FILE)} created.`);

  p.note(
    [
      `${color.bold("This must be done before generating any tests.")}`,
      ``,
      `qagent has zero project-wide context on its own — this file is the only`,
      `way it knows your stores, auth, providers, mocks, and domain patterns.`,
      ``,
      color.bold("Next step:"),
      ``,
      `  ${color.cyan("1.")} Open your agentic IDE (Cursor, Claude Code, Windsurf, etc.)`,
      `  ${color.cyan("2.")} Paste the prompt below — it will explore your codebase`,
      `     and edit ${SKILL_FILE} directly, filling in every section`,
      `  ${color.cyan("3.")} Review the result, then run ${color.cyan("qagent run")}`,
    ].join("\n"),
    "Fill in your skill file",
  );

  // Raw stdout — no clack decoration — so the user can copy-paste the prompt cleanly
  const hr = color.cyan("─".repeat(70));
  process.stdout.write(`\n${hr}\n${color.cyan(color.bold(" PASTE THIS INTO YOUR IDE AGENT"))}\n${hr}\n\n`);
  process.stdout.write(IDE_PROMPT + "\n");
  process.stdout.write(`\n${hr}\n`);

  p.outro(`Once your IDE agent fills in ${color.bold(SKILL_FILE)}, you're ready to generate tests.`);
};
