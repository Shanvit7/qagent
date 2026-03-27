import * as p from "@clack/prompts";
import color from "picocolors";
import { injectGitHook, removeGitHook, detectHuskyDir } from "@/git/hook";
import { detectPackageManager } from "@/utils/packageManager";

export const hookCommand = async (): Promise<void> => {
  const cwd = process.cwd();

  p.intro(color.cyan("qagent hook"));

  const huskyDir = detectHuskyDir(cwd);
  const scopeNote = huskyDir !== null
    ? "team-wide via Husky"
    : "local only via git hooks";

  const choice = await p.select({
    message: "Optional pre-commit gate:",
    options: [
      {
        value: "enable" as const,
        label: "Enable",
        hint: `hard gate — blocks commit until QA passes — ${scopeNote}`,
      },
      {
        value: "disable" as const,
        label: "Disable",
        hint: "remove gate — use `qagent watch` for stage-based background CI instead",
      },
    ],
  });

  if (p.isCancel(choice)) {
    p.cancel("Cancelled.");
    return;
  }

  if (choice === "enable") {
    const s = p.spinner();
    s.start("Installing pre-commit hook");
    try {
      const { runner } = detectPackageManager(cwd);
      const { hookPath, target } = injectGitHook(cwd, runner);
      s.stop(`Hook enabled via ${target === "husky" ? "Husky" : "git"} → ${hookPath}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      s.stop(color.red(`Could not install hook: ${message}`));
    }
  } else {
    const s = p.spinner();
    s.start("Removing pre-commit hook");
    try {
      removeGitHook(cwd);
      s.stop("Hook disabled — run `qagent run` manually on staged changes");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      s.stop(color.red(`Could not remove hook: ${message}`));
    }
  }

  p.outro("");
};
