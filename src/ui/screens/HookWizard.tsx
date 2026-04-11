import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { injectGitHook, removeGitHook, detectHuskyDir } from '@/git/hook';
import { detectPackageManager } from '@/utils/packageManager';
import color from 'picocolors';

interface HookWizardProps {
  onComplete: () => void;
}

export const HookWizard: React.FC<HookWizardProps> = ({ onComplete }) => {
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<string>('');

  const cwd = process.cwd();

  const huskyDir = detectHuskyDir(cwd);
  const scopeNote = huskyDir !== null
    ? "team-wide via Husky"
    : "local only via git hooks";

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <Box flexDirection="column">
            <Text color="cyan">qagent hook</Text>
            <Text>{""}</Text>
            <Text>Optional pre-commit gate:</Text>
            <SelectInput
              items={[
                {
                  label: `Enable (hard gate — blocks commit until QA passes — ${scopeNote})`,
                  value: 'enable',
                },
                {
                  label: `Disable (remove gate — use \`qagent watch\` for stage-based background CI instead)`,
                  value: 'disable',
                },
              ]}
              onSelect={async (item) => {
                if (item.value === 'enable') {
                  setStep(1);
                  setStatus('Installing pre-commit hook...');
                  try {
                    const { runner } = detectPackageManager(cwd);
                    const { hookPath, target } = injectGitHook(cwd, runner);
                    setStatus(`Hook enabled via ${target === "husky" ? "Husky" : "git"} → ${hookPath}`);
                  } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    setStatus(color.red(`Could not install hook: ${message}`));
                  }
                } else {
                  setStep(1);
                  setStatus('Removing pre-commit hook...');
                  try {
                    removeGitHook(cwd);
                    setStatus('Hook disabled — run `qagent run` manually on staged changes');
                  } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    setStatus(color.red(`Could not remove hook: ${message}`));
                  }
                }
              }}
            />
          </Box>
        );

      case 1:
        return (
          <Box flexDirection="column">
            <Text>{status}</Text>
            <Text dimColor>Press Enter to continue...</Text>
          </Box>
        );

      default:
        return null;
    }
  };

  useInput((input, key) => {
    if (key.return && step === 1) {
      onComplete();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      {renderStep()}
    </Box>
  );
};