import React from "react";
import { render } from "ink";
import { ModelsWizard } from "../../ui/screens/ModelsWizard";

export const modelsCommand = async (): Promise<void> => {
  if (!process.stdin.isTTY) {
    console.log("qagent models requires an interactive terminal (TTY). Please run in a proper terminal.");
    return;
  }

  await new Promise<void>((resolvePromise) => {
    render(
      <ModelsWizard
        onComplete={() => {
          resolvePromise();
        }}
      />
    );
  });
}
