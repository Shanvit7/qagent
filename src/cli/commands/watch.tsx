import React from 'react';
import { render } from 'ink';
import { WatchScreen } from '../../ui/screens/WatchScreen';

interface WatchOptions {
  iterations?: string | undefined;
}
export const watchCommand = async (options: WatchOptions): Promise<void> => {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      'qagent watch requires an interactive terminal (TTY). Please run in a proper terminal.\n',
    );
    process.exit(1);
  }

  await new Promise<void>((resolvePromise) => {
    render(
      <WatchScreen
        options={{ iterations: options.iterations }}
        onComplete={() => {
          resolvePromise();
        }}
      />,
    );
  });
};
