import { Command } from "commander";
import { initCommand } from "@/cli/commands/init";
import { runCommand } from "@/cli/commands/run";
import { watchCommand } from "@/cli/commands/watch";
import { explainCommand } from "@/cli/commands/explain";
import { statusCommand } from "@/cli/commands/status";
import { modelsCommand } from "@/cli/commands/models";
import { skillCommand } from "@/cli/commands/skill";
import { configCommand } from "@/cli/commands/config";
import { render } from "ink";
import { HelpScreen } from "@/ui/screens/HelpScreen";
import { InitWizard } from "@/ui/screens/InitWizard";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RC_FILE = resolve(process.cwd(), ".qagentrc");

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8"));
const PKG_VERSION = pkg.version;

export const program = new Command();

program
  .name("qagent")
  .description("change-aware behavioral regression testing for Next.js ")
  .version(PKG_VERSION);

program
  .command("init")
  .description("Setup wizard — install qagent, configure AI, create config")
  .action(initCommand);

program
  .command("run")
  .description("Run QA on staged files (starts dev server per-run)")
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
  .command("skill")
  .description("Create or reset qagent-skill.md with template and IDE prompt")
  .action(skillCommand);

program
  .command("config [subcommand] [value]")
  .description("View or update qagent settings  (e.g. qagent config iterations 5)")
  .action((subcommand?: string, value?: string) => configCommand({ subcommand, value }));

program.action(async () => {
  if (!process.stdin.isTTY) {
    program.help();
    return;
  }

  if (existsSync(RC_FILE)) {
    await new Promise<void>((resolve) => {
      const { unmount } = render(
        <HelpScreen
          version={PKG_VERSION}
          onComplete={() => {
            unmount();
            resolve();
          }}
        />
      );
    });
  } else {
    await new Promise<void>((resolve) => {
      const { unmount } = render(
        <InitWizard
          version={PKG_VERSION}
          onComplete={() => {
            unmount();
            resolve();
          }}
        />
      );
    });
  }

  process.exit(0);
});
