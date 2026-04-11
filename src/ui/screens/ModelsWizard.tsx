import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import {
  readProvider,
  readModel,
  writeProvider,
  writeModel,
} from '@/config/loader';
import {
  listOllamaModels,
  isOllamaRunning,
} from '@/providers/index';

interface ModelsWizardProps {
  onComplete: () => void;
}

export const ModelsWizard: React.FC<ModelsWizardProps> = ({ onComplete }) => {
  const [step, setStep] = useState(0);
  const [model, setModel] = useState<string>('');
  const [models, setModels] = useState<string[]>([]);
  const [ollamaRunning, setOllamaRunning] = useState<boolean | null>(null);

  const currentProvider = readProvider();
  const currentModel = readModel();

  const renderStep = () => {
    switch (step) {
      case 0: // Intro and current config
        return (
          <Box flexDirection="column">
            <Text color="cyan">qagent models</Text>
            <Text>{''}</Text>
            {currentProvider && currentModel && (
              <Text>Active: <Text bold>{currentModel}</Text> <Text dimColor>({currentProvider})</Text></Text>
            )}
            {!currentProvider && !currentModel && (
              <Text color="yellow">No model configured yet.</Text>
            )}
            <Text>{''}</Text>
            <Text>Using Ollama (local, free, no API key)</Text>
            <Text>Press Enter to continue...</Text>
          </Box>
        );

      case 1: // Model selection for Ollama
        // Check Ollama
        React.useEffect(() => {
          const checkOllama = async () => {
            const running = await isOllamaRunning();
            setOllamaRunning(running);
            if (running) {
              const availableModels = await listOllamaModels();
              const codeModels = availableModels.filter((m) =>
                /coder|code|deepseek|qwen|mistral|llama/i.test(m)
              );
              const sorted = [...new Set([...codeModels, ...availableModels])];
              setModels(sorted);
            }
          };
          checkOllama();
        }, []);

        if (ollamaRunning === false) {
          return (
            <Box flexDirection="column">
              <Text color="yellow">Ollama isn't running. Start it with:</Text>
              <Text color="cyan">ollama serve</Text>
              <Text>{''}</Text>
              <Text>Press Enter to continue...</Text>
            </Box>
          );
        }

        if (models.length === 0) {
          return (
            <Box flexDirection="column">
              <Text color="red">No Ollama models available.</Text>
              <Text>{''}</Text>
              <Text>Pull a model first:</Text>
              <Text color="cyan">  ollama pull qwen2.5-coder:7b</Text>
              <Text color="cyan">  ollama pull deepseek-coder:6.7b</Text>
              <Text color="cyan">  ollama pull llama3.1:8b</Text>
              <Text>{''}</Text>
              <Text>Press Enter to continue...</Text>
            </Box>
          );
        }

        return (
          <Box flexDirection="column">
            <Text>Pick an Ollama model:</Text>
            <SelectInput
              items={models.map((m) => ({ label: m, value: m }))}
              onSelect={(item) => {
                setModel(item.value);
                setStep(2);
              }}
              initialIndex={0}
            />
          </Box>
        );

      case 2: // Save
        return (
          <Box flexDirection="column">
            <Text color="green">Model: <Text bold>{model}</Text> <Text dimColor>(ollama)</Text></Text>
            <Text>Stored in ~/.qagentrc</Text>
            <Text>{''}</Text>
            <Text>Press Enter to continue...</Text>
          </Box>
        );

      default:
        return null;
    }
  };

  useInput((input, key) => {
    if (key.return) {
      if (step === 0) {
        setStep(1);
      } else if (step === 2) {
        writeProvider('ollama');
        writeModel(model);
        onComplete();
      } else if (step === 1 && ollamaRunning === false) {
        onComplete();
      } else if (step === 1 && models.length === 0) {
        onComplete();
      }
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      {renderStep()}
    </Box>
  );
};