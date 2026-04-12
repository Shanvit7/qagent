import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import { isOllamaRunning, listOllamaModels, listOpenAIModels, listAnthropicModels } from '@/providers/index';
import { writeProvider, writeModel } from '@/config/loader';
import { detectPlaywrightBrowsers, ensurePlaywrightBrowsers } from '@/runner/index';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface InitWizardProps {
  onComplete: () => void;
  version: string;
}

type Step =
  | 'welcome'
  | 'project-check'
  | 'provider'
  | 'loading-models'
  | 'model'
  | 'chromium-check'
  | 'chromium-installing'
  | 'done'
  | 'error';

export const InitWizard: React.FC<InitWizardProps> = ({ onComplete, version }) => {
  const { exit } = useApp();
  const [step, setStep] = useState<Step>('welcome');
  const [provider, setProvider] = useState('ollama');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [chromiumOk, setChromiumOk] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [cwd] = useState(() => process.cwd());

  // Check if project is Next.js
  useEffect(() => {
    if (step !== 'project-check') return;
    try {
      const pkgPath = resolve(cwd, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const hasNext = !!(pkg.dependencies?.next || pkg.devDependencies?.next);
      if (!hasNext) {
        setErrorMsg('qagent currently works with Next.js projects only. Please ensure Next.js is installed.');
        setStep('error');
      } else {
        setStep('provider');
      }
    } catch {
      setErrorMsg('Could not read package.json. Ensure you are in a valid Node.js project directory.');
      setStep('error');
    }
  }, [step, cwd]);

  // Fetch models for selected provider
  useEffect(() => {
    if (step !== 'loading-models') return;
    (async () => {
      if (provider === 'ollama') {
        const running = await isOllamaRunning();
        if (!running) {
          setErrorMsg('Ollama is not running. Start it with: ollama serve');
          setStep('error');
          return;
        }
        const installed = await listOllamaModels();
        if (installed.length === 0) {
          setErrorMsg('No Ollama models found. Pull one with: ollama pull qwen2.5-coder:7b');
          setStep('error');
          return;
        }
        const codeFirst = installed.filter((m) =>
          /coder|code|deepseek|qwen|mistral|llama/i.test(m)
        );
        setModels([...new Set([...codeFirst, ...installed])]);
      } else if (provider === 'openai') {
        const fetched = await listOpenAIModels();
        if (fetched.length === 0) {
          setErrorMsg('Could not fetch OpenAI models. Check your OPENAI_API_KEY is set in .env or shell.');
          setStep('error');
          return;
        }
        setModels(fetched);
      } else if (provider === 'anthropic') {
        const fetched = await listAnthropicModels();
        if (fetched.length === 0) {
          setErrorMsg('Could not fetch Anthropic models. Check your ANTHROPIC_API_KEY is set in .env or shell.');
          setStep('error');
          return;
        }
        setModels(fetched);
      }
      setStep('model');
    })();
  }, [step]);

  // Check Chromium once model is picked
  useEffect(() => {
    if (step !== 'chromium-check') return;
    (async () => {
      const ok = await detectPlaywrightBrowsers(cwd);
      if (ok) {
        setChromiumOk(true);
        setStep('done');
      }
      // else stay on chromium-check to show the prompt
    })();
  }, [step]);

  // Install Chromium
  useEffect(() => {
    if (step !== 'chromium-installing') return;
    (async () => {
      try {
        const ok = await ensurePlaywrightBrowsers(cwd);
        if (ok) {
          setChromiumOk(true);
          setStep('done');
        } else {
          setErrorMsg('Chromium install failed. Run manually: npx playwright install chromium');
          setStep('error');
        }
      } catch {
        setErrorMsg('Chromium install failed. Run manually: npx playwright install chromium');
        setStep('error');
      }
    })();
  }, [step]);

  // Write config when done
  useEffect(() => {
    if (step !== 'done') return;
    writeProvider(provider as 'ollama' | 'openai' | 'anthropic');
    writeModel(model);
  }, [step]);

  useInput((_input, key) => {
    if (key.return && (step === 'done' || step === 'error')) {
      onComplete();
      exit();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>

      {step === 'welcome' && (
        <Box flexDirection="column">
          <Text color="cyan">{"  ██████╗  █████╗  ██████╗ ███████╗███╗   ██╗████████╗"}</Text>
          <Text color="cyan">{"  ██╔═══██╗██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝"}</Text>
          <Text color="cyan">{"  ██║   ██║███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   "}</Text>
          <Text color="cyan">{"  ██║▄▄ ██║██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   "}</Text>
          <Text color="cyan">{"  ╚██████╔╝██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   "}</Text>
          <Text color="cyan">{"   ╚══▀▀═╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝  "}</Text>
          <Text color="cyan">{"  ◉ change-aware behavioral regression testing           "}</Text>
          <Text dimColor>{`   Real tests. Real browser. Zero maintenance.    v${version}  `}</Text>
          <Text> </Text>
          <Text bold>Welcome to qagent setup!</Text>
          <Text>QA runs automatically on every <Text color="cyan">git add</Text> via <Text color="cyan">qagent watch</Text>.</Text>
          <Text>Or use <Text color="cyan">qagent run</Text> to test staged changes manually.</Text>
          <Text> </Text>
          <Text>Proceed with setup?</Text>
          <SelectInput
            items={[
              { label: 'Yes, set it up', value: 'yes' },
              { label: 'No, cancel', value: 'no' },
            ]}
            onSelect={(item) => {
              if (item.value === 'yes') setStep('project-check');
              else process.exit(0);
            }}
          />
        </Box>
      )}

      {step === 'project-check' && (
        <Box flexDirection="column">
          <Text color="cyan">Checking project compatibility...</Text>
        </Box>
      )}

      {step === 'provider' && (
        <Box flexDirection="column">
          <Text bold>Select AI provider:</Text>
          <SelectInput
            items={[
              { label: 'Ollama  (local, free, private)', value: 'ollama' },
              { label: 'OpenAI  (requires OPENAI_API_KEY)', value: 'openai' },
              { label: 'Anthropic  (requires ANTHROPIC_API_KEY)', value: 'anthropic' },
            ]}
            onSelect={(item) => {
              setProvider(item.value);
              setStep('loading-models');
            }}
          />
        </Box>
      )}

      {step === 'loading-models' && (
        <Box>
          <Text color="cyan">Fetching models from {provider}...</Text>
        </Box>
      )}

      {step === 'model' && (
        <Box flexDirection="column">
          <Text bold>Select model:</Text>
          <SelectInput
            items={models.map((m) => ({ label: m, value: m }))}
            onSelect={(item) => {
              setModel(item.value);
              setStep('chromium-check');
            }}
          />
        </Box>
      )}

      {step === 'chromium-check' && !chromiumOk && (
        <Box flexDirection="column">
          <Text color="yellow">⚠  Playwright Chromium not found — required for browser tests.</Text>
          <Text> </Text>
          <Text>Install it now?</Text>
          <SelectInput
            items={[
              { label: 'Yes, install Chromium', value: 'yes' },
              { label: 'No, I\'ll do it manually later', value: 'no' },
            ]}
            onSelect={(item) => {
              if (item.value === 'yes') {
                setStep('chromium-installing');
              } else {
                setErrorMsg('Aborted. Run `npx playwright install chromium` then retry qagent init.');
                setStep('error');
              }
            }}
          />
        </Box>
      )}

      {step === 'chromium-installing' && (
        <Box flexDirection="column">
          <Text color="cyan">Installing Chromium via Playwright...</Text>
          <Text dimColor>This may take a minute.</Text>
        </Box>
      )}

      {step === 'done' && (
        <Box flexDirection="column">
          <Text color="green">✓ qagent is ready!</Text>
          <Text> </Text>
          <Text>Provider  : <Text color="cyan">{provider}</Text></Text>
          <Text>Model     : <Text color="cyan">{model}</Text></Text>
          <Text>Chromium  : <Text color="cyan">✓ ready</Text></Text>
          <Text> </Text>
          <Text dimColor>Run <Text color="cyan">qagent watch</Text> — QA triggers on every <Text color="cyan">git add</Text>.</Text>
          <Text dimColor>Or <Text color="cyan">qagent run</Text> to test staged changes manually.</Text>
          <Text> </Text>
          <Text dimColor>Press Enter to exit...</Text>
        </Box>
      )}

      {step === 'error' && (
        <Box flexDirection="column">
          <Text color="red">✗ {errorMsg}</Text>
          <Text> </Text>
          <Text dimColor>Press Enter to exit...</Text>
        </Box>
      )}

    </Box>
  );
};
