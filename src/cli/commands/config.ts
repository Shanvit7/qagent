import * as p from "@clack/prompts";
import color from "picocolors";
import {
  readIterations,
  writeIterations,
  MIN_ITERATIONS,
  MAX_ITERATIONS,
  DEFAULT_ITERATIONS,
} from "@/config/loader";

// ─── Sub-command: iterations ──────────────────────────────────────────────────

const configIterations = async (value?: string): Promise<void> => {
  const current = readIterations();

  // No value — interactive picker
  if (!value) {
    p.intro(color.cyan("qagent config · iterations"));
    p.log.info(
      `Current: ${color.bold(String(current))}  ` +
      color.dim(`(min ${MIN_ITERATIONS} · max ${MAX_ITERATIONS} · recommended ${DEFAULT_ITERATIONS})`),
    );

    const options = Array.from(
      { length: MAX_ITERATIONS - MIN_ITERATIONS + 1 },
      (_, i) => {
        const n = MIN_ITERATIONS + i;
        const hint =
          n === DEFAULT_ITERATIONS ? "recommended" :
          n <= 4                   ? "fast" :
          n <= 6                   ? "thorough" :
                                     "exhaustive — high token cost";
        return { value: String(n), label: String(n), hint };
      },
    );

    const picked = await p.select({
      message: "Max refinement iterations per file:",
      options,
      initialValue: String(current),
    });

    if (p.isCancel(picked)) { p.cancel("Cancelled."); return; }

    const n = parseInt(picked as string, 10);
    writeIterations(n);
    p.outro(
      color.green(`Iterations set to ${n}`) +
      (n === DEFAULT_ITERATIONS ? color.dim("  (recommended)") : ""),
    );
    return;
  }

  // Value passed directly as argument
  const n = parseInt(value, 10);

  if (isNaN(n)) {
    p.log.error(`"${value}" is not a number.`);
    process.exit(1);
  }

  if (n < MIN_ITERATIONS) {
    p.log.error(`Minimum is ${MIN_ITERATIONS}. Fewer iterations produce unreliable results.`);
    process.exit(1);
  }

  if (n > MAX_ITERATIONS) {
    p.log.error(`Maximum is ${MAX_ITERATIONS}. Beyond that, token cost outweighs quality gain.`);
    process.exit(1);
  }

  writeIterations(n);
  p.log.success(
    `Iterations set to ${color.bold(String(n))}` +
    (n === DEFAULT_ITERATIONS ? color.dim("  (recommended)") : ""),
  );
};

// ─── Main command ─────────────────────────────────────────────────────────────

interface ConfigOptions {
  subcommand?: string | undefined;
  value?: string | undefined;
}

export const configCommand = async (options: ConfigOptions): Promise<void> => {
  const { subcommand, value } = options;

  if (!subcommand) {
    // No subcommand — show current config summary
    p.intro(color.cyan("qagent config"));
    p.log.info(`iterations  ${color.bold(String(readIterations()))}  ${color.dim(`(min ${MIN_ITERATIONS} · max ${MAX_ITERATIONS})`)}`);
    p.log.info(color.dim("Usage: qagent config iterations [n]"));
    p.outro("");
    return;
  }

  switch (subcommand) {
    case "iterations":
      await configIterations(value);
      break;
    default:
      p.log.error(`Unknown config key "${subcommand}". Available: iterations`);
      process.exit(1);
  }
};
