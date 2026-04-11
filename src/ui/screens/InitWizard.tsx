import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';

interface InitWizardProps {
  onComplete: (config: Config) => Promise<void>;
}

interface Config {
  aiProvider: string;
  model: string;
  enableGitHook: boolean;
}

export const InitWizard: React.FC<InitWizardProps> = ({ onComplete }) => {
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState({
    aiProvider: 'ollama',
    model: 'qwen2.5-coder:7b',
    enableGitHook: false
  });

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <Box flexDirection="column">
            <Text color="cyan">
              {"   ██████╗  █████╗  ██████╗ ███████╗███╗   ██╗████████╗"}
            </Text>
            <Text color="cyan">
              {"  ██╔═══██╗██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝"}
            </Text>
            <Text color="cyan">
              {"  ██║   ██║███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   "}
            </Text>
            <Text color="cyan">
              {"  ██║▄▄ ██║██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   "}
            </Text>
            <Text color="cyan">
              {"  ╚██████╔╝██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   "}
            </Text>
            <Text color="cyan">
              {"   ╚══▀▀═╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   "}
            </Text>
            <Text color="cyan">
              {"  ◉ change-aware behavioral regression testing for Next.js "}
            </Text>
            <Text dimColor>
              {"   Real tests. Real browser. Zero maintenance.              v0.1.2"}
            </Text>
            <Text>{""}</Text>
            <Text bold>Welcome to qagent setup!</Text>
            <Text>Let's configure your Next.js project for behavioral regression testing.</Text>
            <Text>Default settings: Ollama with qwen2.5-coder:7b, no git hook.</Text>
            <Text>Proceed with setup?</Text>
            <SelectInput
              items={[
                { label: 'Yes, proceed', value: true },
                { label: 'No, cancel', value: false }
              ]}
              onSelect={(item) => {
                if (item.value) {
                  setStep(1);
                } else {
                  process.exit(0);
                }
              }}
            />
          </Box>
        );

      case 1:
        return (
          <Box flexDirection="column">
            <Text bold>Configuration Complete!</Text>
            <Text>AI Provider: {config.aiProvider}</Text>
            <Text>Model: {config.model}</Text>
            <Text>Git Hook: {config.enableGitHook ? 'Enabled' : 'Disabled'}</Text>
            <Text>Press Enter to finish setup...</Text>
          </Box>
        );

      default:
        return null;
    }
  };

  useInput((input, key) => {
    if (key.return) {
      if (step === 1) {
        onComplete(config).catch(console.error);
      }
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      {renderStep()}
    </Box>
  );
};