import React from "react";
import { render } from "ink";
import { HookWizard } from "../../ui/screens/HookWizard";
export const hookCommand = async (): Promise<void> => {
  if (!process.stdin.isTTY) {
    process.stderr.write("qagent hook requires an interactive terminal (TTY). Please run in a proper terminal.\n");
    process.exit(1);
  }

  await new Promise<void>((resolvePromise) => {
    render(
      <HookWizard
        onComplete={() => {
          resolvePromise();
        }}
      />
    );
  });
};