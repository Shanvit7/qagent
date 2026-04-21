import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import {
  isOllamaRunning,
  listOllamaModels,
  listOpenAIModels,
  listAnthropicModels,
} from '@/providers/index';
import { writeProvider, writeModel } from '@/config/loader';
import { detectPlaywrightBrowsers, ensurePlaywrightBrowsers } from '@/runner/index';
import { detectPackageManager } from '@/utils/packageManager';
import { resolve } from 'node:path';
import { writeFileSync, existsSync } from 'node:fs';
import { SKILL_TEMPLATE } from '@/skill/template';

interface InitWizardProps {
  onComplete: () => void;
  version: string;
}

type Step =
  | 'welcome'
  | 'project-check'
  | 'dependencies-check'
  | 'playwright-installing'
  | 'provider'
  | 'loading-models'
  | 'model'
  | 'skill-creating'
  | 'done'
  | 'error';

export const InitWizard: React.FC<InitWizardProps> = ({ onComplete, version }) => {
  const { exit } = useApp();
  const [step, setStep] = useState<Step>('welcome');
  const [provider, setProvider] = useState('ollama');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [needsChromiumInstall, setNeedsChromiumInstall] = useState(false);
  const [needsPlaywrightInstall, setNeedsPlaywrightInstall] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [skillCreated, setSkillCreated] = useState(false);
  const [cwd] = useState(() => process.cwd());

  // Check if project is Next.js
  useEffect(() => {
    if (step !== 'project-check') return;
    (async () => {
      try {
        const pkgPath = resolve(cwd, 'package.json');
        const { readFile } = await import('node:fs/promises');
        const pkgContent = await readFile(pkgPath, 'utf8');
        const pkg = JSON.parse(pkgContent);
        const hasNext = !!(pkg.dependencies?.next || pkg.devDependencies?.next);
        if (!hasNext) {
          setErrorMsg(
            'qagent currently works with Next.js projects only. Please ensure Next.js is installed.',
          );
          setStep('error');
        } else {
          setStep('dependencies-check');
        }
      } catch {
        setErrorMsg(
          'Could not read package.json. Ensure you are in a valid Node.js project directory.',
        );
        setStep('error');
      }
    })();
  }, [step, cwd]);

  // Check dependencies (Playwright + Chromium)
  useEffect(() => {
    if (step !== 'dependencies-check') return;
    (async () => {
      try {
        const pkgPath = resolve(cwd, 'package.json');
        const { readFile } = await import('node:fs/promises');
        const pkgContent = await readFile(pkgPath, 'utf8');
        const pkg = JSON.parse(pkgContent);
        const hasPlaywright = !!(
          pkg.dependencies?.['@playwright/test'] || pkg.devDependencies?.['@playwright/test']
        );

        let needsInstall = false;
        if (!hasPlaywright) {
          needsInstall = true;
        } else {
          const chromiumOk = await detectPlaywrightBrowsers(cwd);
          if (!chromiumOk) {
            needsInstall = true;
          }
        }

        if (needsInstall) {
          setNeedsPlaywrightInstall(!hasPlaywright);
          setNeedsChromiumInstall(true);
        } else {
          setStep('provider');
        }
      } catch {
        setErrorMsg('Could not check dependencies. Ensure @playwright/test is installed.');
        setStep('error');
      }
    })();
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
          /coder|code|deepseek|qwen|mistral|llama/i.test(m),
        );
        setModels([...new Set([...codeFirst, ...installed])]);
      } else if (provider === 'openai') {
        const fetched = await listOpenAIModels();
        if (fetched.length === 0) {
          setErrorMsg(
            'Could not fetch OpenAI models. Check your OPENAI_API_KEY is set in .env or shell.',
          );
          setStep('error');
          return;
        }
        setModels(fetched);
      } else if (provider === 'anthropic') {
        const fetched = await listAnthropicModels();
        if (fetched.length === 0) {
          setErrorMsg(
            'Could not fetch Anthropic models. Check your ANTHROPIC_API_KEY is set in .env or shell.',
          );
          setStep('error');
          return;
        }
        setModels(fetched);
      }
      setStep('model');
    })();
  }, [step]);



  // Install Playwright and Chromium
  useEffect(() => {
    if (step !== 'playwright-installing') return;
    (async () => {
      try {
        if (needsPlaywrightInstall) {
          const pm = detectPackageManager(cwd);
          const command = pm.addDevArgs('@playwright/test');
          const { spawn } = await import('node:child_process');
          const child = spawn(pm.name, command, {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          const stderr: string[] = [];
          child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk.toString()));
          await new Promise<void>((resolve, reject) => {
            child.on('exit', (code) => {
              if (code === 0) {
                resolve();
              } else {
                reject(new Error(`Package manager install failed: ${stderr.join('')}`));
              }
            });
            child.on('error', reject);
          });
        }

        // Install Chromium
        const ok = await ensurePlaywrightBrowsers(cwd);
        if (!ok) {
          setErrorMsg('Chromium install failed. Run manually: npx playwright install chromium');
          setStep('error');
          return;
        }

        setNeedsPlaywrightInstall(false);
        setNeedsChromiumInstall(false);
        setStep('provider');
      } catch (err) {
        setErrorMsg(
          `Install failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        setStep('error');
      }
    })();
  }, [step, cwd, needsPlaywrightInstall]);

  // Write config when done
  useEffect(() => {
    if (step !== 'done') return;
    writeProvider(provider as 'ollama' | 'openai' | 'anthropic');
    writeModel(model);
  }, [step]);

  // Auto-create skill file after model is selected
  useEffect(() => {
    if (step !== 'skill-creating') return;
    const skillPath = resolve(cwd, 'qagent-skill.md');
    const alreadyExists = existsSync(skillPath);
    if (!alreadyExists) {
      try {
        writeFileSync(skillPath, SKILL_TEMPLATE, 'utf8');
        setSkillCreated(true);
      } catch {
        // Non-fatal — skill file creation failure shouldn't block setup
      }
    }
    writeProvider(provider as 'ollama' | 'openai' | 'anthropic');
    writeModel(model);
    setStep('done');
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
          <Text color="cyan">{'  ██████╗  █████╗  ██████╗ ███████╗███╗   ██╗████████╗'}</Text>
          <Text color="cyan">{'  ██╔═══██╗██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝'}</Text>
          <Text color="cyan">{'  ██║   ██║███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   '}</Text>
          <Text color="cyan">{'  ██║▄▄ ██║██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   '}</Text>
          <Text color="cyan">{'  ╚██████╔╝██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   '}</Text>
          <Text color="cyan">{'   ╚══▀▀═╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝  '}</Text>
          <Text color="cyan">{'  ◉ change-aware behavioral regression testing           '}</Text>
          <Text dimColor>{`   Real tests. Real browser. Zero maintenance.    v${version}  `}</Text>
          <Text> </Text>
          <Text bold>Welcome to qagent setup!</Text>
          <Text>
            QA runs automatically on every <Text color="cyan">git add</Text> via{' '}
            <Text color="cyan">qagent watch</Text>.
          </Text>
          <Text>
            Or use <Text color="cyan">qagent run</Text> to test staged changes manually.
          </Text>
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
              setStep('skill-creating');
            }}
          />
        </Box>
      )}

      {step === 'dependencies-check' && (needsPlaywrightInstall || needsChromiumInstall) && (
        <Box flexDirection="column">
          <Text color="yellow">⚠ Required dependencies missing:</Text>
          {needsPlaywrightInstall && <Text>  • @playwright/test</Text>}
          {needsChromiumInstall && <Text>  • Chromium browser</Text>}
          <Text> </Text>
          <Text>Install them now?</Text>
          <SelectInput
            items={[
              { label: 'Yes, install required dependencies', value: 'yes' },
              { label: "No, I'll do it manually later", value: 'no' },
            ]}
            onSelect={(item) => {
              if (item.value === 'yes') {
                setStep('playwright-installing');
              } else {
                setErrorMsg(
                  'Aborted. Install manually: npm install --save-dev @playwright/test && npx playwright install chromium',
                );
                setStep('error');
              }
            }}
          />
        </Box>
      )}



      {step === 'playwright-installing' && (
        <Box flexDirection="column">
          <Text color="cyan">Installing @playwright/test and Chromium...</Text>
          <Text dimColor>This may take a few minutes.</Text>
        </Box>
      )}

      {step === 'skill-creating' && (
        <Box flexDirection="column">
          <Text color="cyan">Creating skill file...</Text>
        </Box>
      )}

      {step === 'done' && (
        <Box flexDirection="column">
          <Text color="green">✓ qagent is ready!</Text>
          <Text> </Text>
          <Text>
            Provider : <Text color="cyan">{provider}</Text>
          </Text>
          <Text>
            Model : <Text color="cyan">{model}</Text>
          </Text>
          <Text>
            Chromium : <Text color="cyan">✓ ready</Text>
          </Text>
          {skillCreated && (
            <>
              <Text>
                Skill file : <Text color="cyan">✓ qagent-skill.md created</Text>
              </Text>
              <Text> </Text>
              <Text color="yellow">
                📝 Fill in <Text color="cyan">qagent-skill.md</Text> to improve test generation
                accuracy.
              </Text>
              <Text dimColor>
                {' '}
                Open it in your IDE agent / AI Agent Harness (Cursor, Claude Code, Windsurf) and let
                it
              </Text>
              <Text dimColor>
                {' '}
                explore your codebase to fill in routes, auth, hooks, and domain patterns.
              </Text>
            </>
          )}
          <Text> </Text>
          <Text dimColor>
            Run <Text color="cyan">qagent watch</Text> — QA triggers on every{' '}
            <Text color="cyan">git add</Text>.
          </Text>
          <Text dimColor>
            Or <Text color="cyan">qagent run</Text> to test staged changes manually.
          </Text>
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
