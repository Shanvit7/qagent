import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import ConfirmInput from 'ink-confirm-input';
import {
  readProvider,
  readModel,
  writeProvider,
  writeModel,
} from '@/config/loader';
import {
  CLOUD_MODELS,
  listOllamaModels,
  isOllamaRunning,
  hasApiKey,
  envVarName,
} from '@/providers/index';
import type { ProviderName } from '@/providers/index';

interface ModelsWizardProps {
  onComplete: () => void;
}

export const ModelsWizard: React.FC<ModelsWizardProps> = ({ onComplete }) => {
  const [step, setStep] = useState(0);
  const [provider, setProvider] = useState<ProviderName | null>(null);
  const [model, setModel] = useState<string>('');
  const [apiKey, setApiKey] = useState<string>('');
  const [proceedWithoutKey, setProceedWithoutKey] = useState<boolean | null>(null);
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
            <Text>Select an AI provider:</Text>
            <SelectInput
              items={[
                { label: `OpenAI ${hasApiKey('openai') ? '(API key found)' : '(requires OPENAI_API_KEY)'}`, value: 'openai' },
                { label: `Anthropic ${hasApiKey('anthropic') ? '(API key found)' : '(requires ANTHROPIC_API_KEY)'}`, value: 'anthropic' },
                { label: 'Ollama (local, free, no API key)', value: 'ollama' },
              ]}
              onSelect={(item) => {
                setProvider(item.value as ProviderName);
                setStep(1);
              }}
            />
          </Box>
        );

      case 1: // API key check for cloud
        if (provider === 'ollama') {
          setStep(2);
          return null;
        }
        if (!hasApiKey(provider!)) {
          return (
            <Box flexDirection="column">
              <Text color="yellow">{envVarName(provider!)} not found.</Text>
              <Text>{''}</Text>
              <Text>Add your API key to .env in your project root:</Text>
              <Text>{''}</Text>
              <Text color="cyan">  {envVarName(provider!)}=sk-...</Text>
              <Text>{''}</Text>
              <Text dimColor>qagent reads from .env, .env.local, and shell environment.</Text>
              <Text>{''}</Text>
              <Text>Continue anyway? (you can set the key later)</Text>
              <ConfirmInput
                value={proceedWithoutKey}
                onChange={setProceedWithoutKey}
                onSubmit={(value) => {
                  if (value) {
                    setStep(2);
                  } else {
                    setStep(0);
                  }
                }}
              />
            </Box>
          );
        }
        setStep(2);
        return null;

      case 2: // Model selection
        if (provider === 'ollama') {
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
                  setStep(3);
                }}
                initialIndex={0}
              />
            </Box>
          );
        } else {
          // Cloud models
          const providerModels = CLOUD_MODELS.filter((m) => m.provider === provider);
          return (
            <Box flexDirection="column">
              <Text>Pick a {provider} model:</Text>
              <SelectInput
                items={providerModels.map((m) => ({
                  label: `${m.id} (${m.label})`,
                  value: m.id,
                }))}
                onSelect={(item) => {
                  setModel(item.value);
                  setStep(3);
                }}
                initialIndex={0}
              />
            </Box>
          );
        }

      case 3: // Save
        return (
          <Box flexDirection="column">
            <Text color="green">Model: <Text bold>{model}</Text> <Text dimColor>({provider})</Text></Text>
            <Text>Stored in ~/.qagentrc</Text>
            {provider !== 'ollama' && (
              <>
                <Text>{''}</Text>
                <Text>You can also set these via environment variables:</Text>
                <Text>{''}</Text>
                <Text color="cyan">  export QAGENT_PROVIDER={provider}</Text>
                <Text color="cyan">  export QAGENT_MODEL={model}</Text>
              </>
            )}
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
      if (step === 3) {
        writeProvider(provider!);
        writeModel(model);
        onComplete();
      } else if (step === 2 && provider === 'ollama' && ollamaRunning === false) {
        onComplete();
      } else if (step === 2 && provider === 'ollama' && models.length === 0) {
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