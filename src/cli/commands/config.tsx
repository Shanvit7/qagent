import React from "react";
import { render } from "ink";
import { ConfigScreen } from "../../ui/screens/ConfigScreen";

interface ConfigOptions {
  subcommand: string | undefined;
  value: string | undefined;
}
export const configCommand = async (options: ConfigOptions): Promise<void> => {
  if (!process.stdin.isTTY) {
    process.stderr.write("qagent config requires an interactive terminal (TTY). Please run in a proper terminal.\n");
    process.exit(1);
  }

  await new Promise<void>((resolvePromise) => {
    render(
      <ConfigScreen
        {...(options.subcommand && { subcommand: options.subcommand })}
        {...(options.value && { value: options.value })}
        onComplete={() => {
          resolvePromise();
        }}
      />
    );
  });
};