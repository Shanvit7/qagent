import React from "react";
import { render } from "ink";
import { StatusScreen } from "../../ui/screens/StatusScreen";

export const statusCommand = async (): Promise<void> => {
  if (!process.stdin.isTTY) {
    console.log("qagent status requires an interactive terminal (TTY). Please run in a proper terminal.");
    return;
  }

  await new Promise<void>((resolvePromise) => {
    render(
      <StatusScreen
        onComplete={() => {
          resolvePromise();
        }}
      />
    );
  });
};
