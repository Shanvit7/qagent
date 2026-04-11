import React from "react";
import { render } from "ink";
import { ExplainScreen } from "../../ui/screens/ExplainScreen";

export const explainCommand = async (): Promise<void> => {
  if (!process.stdin.isTTY) {
    console.log("qagent explain requires an interactive terminal (TTY). Please run in a proper terminal.");
    return;
  }

  await new Promise<void>((resolvePromise) => {
    render(
      <ExplainScreen
        onComplete={() => {
          resolvePromise();
        }}
      />
    );
  });
};
