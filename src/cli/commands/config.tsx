import React from "react";
import { render } from "ink";
import { ConfigScreen } from "../../ui/screens/ConfigScreen";

interface ConfigOptions {
  subcommand?: string | undefined;
  value?: string | undefined;
}

export const configCommand = async (options: ConfigOptions): Promise<void> => {
  if (!process.stdin.isTTY) {
    console.log("qagent config requires an interactive terminal (TTY). Please run in a proper terminal.");
    return;
  }

  await new Promise<void>((resolvePromise) => {
    render(
      <ConfigScreen
        subcommand={options.subcommand}
        value={options.value}
        onComplete={() => {
          resolvePromise();
        }}
      />
    );
  });
};
