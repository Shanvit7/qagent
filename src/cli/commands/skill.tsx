import React from 'react';
import { render } from 'ink';
import { SkillScreen } from '../../ui/screens/SkillScreen';
export const skillCommand = async (): Promise<void> => {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      'qagent skill requires an interactive terminal (TTY). Please run in a proper terminal.\n',
    );
    process.exit(1);
  }

  await new Promise<void>((resolvePromise) => {
    render(
      <SkillScreen
        onComplete={() => {
          resolvePromise();
        }}
      />,
    );
  });
};
