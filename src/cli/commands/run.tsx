import React from "react";
import { render } from "ink";
import { RunScreen } from "../../ui/screens/RunScreen";

interface RunOptions {
  iterations?: string | undefined;
}
export const runCommand = async (options: RunOptions): Promise<void> => {
  if (!process.stdin.isTTY) {
    process.stderr.write("qagent run requires an interactive terminal (TTY). Please run in a proper terminal.\n");
    process.exit(1);
  }

  await new Promise<void>((resolvePromise) => {
    render(
      <RunScreen
        options={{ iterations: options.iterations }}
        onComplete={() => {
          resolvePromise();
        }}
      />
    );
  });
};