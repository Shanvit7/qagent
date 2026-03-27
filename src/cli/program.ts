import { Command } from "commander";
import { createRequire } from "node:module";
import { initCommand } from "./commands/init";
import { runCommand } from "./commands/run";
import { watchCommand } from "./commands/watch";
import { explainCommand } from "./commands/explain";
import { statusCommand } from "./commands/status";
import { modelsCommand } from "./commands/models";
import { lensCommand } from "./commands/lens";
import { hookCommand } from "./commands/hook";
import { skillCommand } from "./commands/skill";
import { configCommand } from "./commands/config";

const esmRequire = createRequire(import.meta.url);
const PKG_VERSION: string = (esmRequire("../../package.json") as { version: string }).version;

export const program = new Command();

program
  .name("qagent")
  .description("Local QA agent — tests your app in a real browser")
  .version(PKG_VERSION);

program
  .command("init")
  .description("Setup wizard — install qagent, inject git hook, create config")
  .action(initCommand);

program
  .command("run")
  .description("Run QA on staged files (starts dev server per-run)")
  .option("--hook", "Running from git pre-commit hook")
  .option("--iterations <n>", "Max refinement iterations for this run (min 3, max 8)")
  .action(runCommand);

program
  .command("watch")
  .description("Background CI — watch for staged changes and test in real browser")
  .action(watchCommand);

program
  .command("explain")
  .description("AI explains why the last test failed")
  .action(explainCommand);

program
  .command("status")
  .description("Check Ollama connection and config summary")
  .action(statusCommand);

program
  .command("models")
  .description("Switch the AI model used for test generation")
  .action(modelsCommand);

program
  .command("lens")
  .description("Select which QA lenses run on every commit")
  .action(lensCommand);

program
  .command("hook")
  .description("Enable or disable the pre-commit hook")
  .action(hookCommand);

program
  .command("skill")
  .description("Create or reset qagent-skill.md with template and IDE prompt")
  .action(skillCommand);

program
  .command("config [subcommand] [value]")
  .description("View or update qagent settings  (e.g. qagent config iterations 5)")
  .action((subcommand?: string, value?: string) => configCommand({ subcommand, value }));
