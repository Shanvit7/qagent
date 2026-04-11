import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';

interface InitWizardProps {
  onComplete: (config: Config) => Promise<void>;
}

interface Config {
  aiProvider: string;
  model: string;
}

export const InitWizard: React.FC<InitWizardProps> = ({ onComplete }) => {
  const [step, setStep] = useState(0);
  const [config] = useState({
    aiProvider: 'ollama',
    model: 'qwen2.5-coder:7b',
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
            <Text>Default settings: Ollama with qwen2.5-coder:7b.</Text>
            <Text>Run <Text color="cyan">qagent watch</Text> after setup — QA runs automatically on every <Text color="cyan">git add</Text>.</Text>
            <Text>Or run <Text color="cyan">qagent run</Text> manually to test your currently staged changes.</Text>
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
            <Text>{""}</Text>
            <Text dimColor>Run <Text color="cyan">qagent watch</Text> to start — QA triggers on every <Text color="cyan">git add</Text>.</Text>
            <Text dimColor>Or use <Text color="cyan">qagent run</Text> to manually test your currently staged changes.</Text>
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
