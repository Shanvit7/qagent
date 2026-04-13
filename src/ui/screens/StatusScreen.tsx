import React from 'react';
import { Box, Text, useInput } from 'ink';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readProvider, readModel, readIterations, DEFAULT_ITERATIONS } from '@/config/loader';
import { isOllamaRunning, listOllamaModels, hasApiKey, envVarName } from '@/providers/index';
import type { ProviderName } from '@/providers/index';

type CheckStatus = 'pass' | 'warn' | 'fail';

interface CheckItem {
  label: string;
  status: CheckStatus;
  detail?: string;
  fix?: string;
}

const checkSkillFile = (cwd: string): CheckItem => {
  if (existsSync(resolve(cwd, 'qagent-skill.md')))
    return { label: 'qagent-skill.md found', status: 'pass' };
  return {
    label: 'qagent-skill.md missing',
    status: 'warn',
    detail: 'qagent will use defaults — no project context',
    fix: 'npx qagent skill',
  };
};

const checkModel = async (
  provider: ProviderName | undefined,
  model: string | undefined,
): Promise<CheckItem> => {
  if (!provider || !model) {
    return {
      label: 'No model configured',
      status: 'fail',
      detail: 'Run the model selection wizard',
      fix: 'qagent models',
    };
  }

  if (provider === 'ollama') {
    const running = await isOllamaRunning();
    if (!running) {
      return {
        label: 'Ollama not reachable',
        status: 'fail',
        detail: 'Start Ollama to enable test generation',
        fix: `ollama serve  →  ollama pull ${model}`,
      };
    }
    const models = await listOllamaModels();
    const slug = model.split(':')[0] ?? model;
    const found = models.find((m) => m === model || m.startsWith(slug));
    if (found) return { label: `${found} ready`, status: 'pass', detail: 'Ollama is running' };
    return {
      label: `${model} not pulled yet`,
      status: 'fail',
      detail: 'Ollama is running but the model is missing',
      fix: `ollama pull ${model}`,
    };
  }

  // Cloud provider
  if (!hasApiKey(provider)) {
    return {
      label: `${envVarName(provider)} not set`,
      status: 'fail',
      detail: `Required for ${provider} provider`,
      fix: `export ${envVarName(provider)}=sk-...`,
    };
  }

  return { label: `${model} (${provider})`, status: 'pass', detail: 'API key found' };
};

const renderCheck = (item: CheckItem): React.ReactNode => {
  const getSymbol = (status: CheckStatus) => {
    switch (status) {
      case 'pass':
        return '✓';
      case 'warn':
        return '⚠';
      case 'fail':
        return '✗';
    }
  };

  const getColor = (status: CheckStatus) => {
    switch (status) {
      case 'pass':
        return 'green';
      case 'warn':
        return 'yellow';
      case 'fail':
        return 'red';
    }
  };

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={getColor(item.status)}>
        {getSymbol(item.status)} {item.label}
        {item.detail && <Text dimColor> — {item.detail}</Text>}
      </Text>
      {item.fix && <Text color="cyan"> {item.fix}</Text>}
    </Box>
  );
};

interface StatusScreenProps {
  onComplete: () => void;
}

export const StatusScreen: React.FC<StatusScreenProps> = ({ onComplete }) => {
  const [checks, setChecks] = React.useState<CheckItem[]>([]);
  const [summary, setSummary] = React.useState<string>('');

  React.useEffect(() => {
    const runChecks = async () => {
      const cwd = process.cwd();
      const provider = readProvider();
      const model = readModel();

      const checkItems: CheckItem[] = [checkSkillFile(cwd), await checkModel(provider, model)];

      setChecks(checkItems);

      const failing = checkItems.filter((c) => c.status === 'fail');
      const warnings = checkItems.filter((c) => c.status === 'warn');

      if (failing.length === 0 && warnings.length === 0) {
        setSummary('Everything looks good — qagent is ready.');
      } else if (failing.length > 0) {
        setSummary(
          `${failing.length} issue${failing.length > 1 ? 's' : ''} to fix before qagent can run.`,
        );
      } else {
        setSummary(
          `Almost ready — ${warnings.length} optional step${warnings.length > 1 ? 's' : ''} above.`,
        );
      }
    };

    runChecks();
  }, []);

  useInput((input, key) => {
    if (key.return) {
      onComplete();
    }
  });

  const provider = readProvider();
  const model = readModel();
  const iterations = readIterations();

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan">qagent status</Text>
      <Text>{''}</Text>

      {provider && model && (
        <Text>
          Model: <Text bold>{model}</Text>{' '}
          <Text dimColor>
            ({provider}, {process.env['QAGENT_MODEL'] ? 'env var' : '~/.qagentrc'})
          </Text>
        </Text>
      )}
      {!provider && !model && <Text color="yellow">No model configured — run `qagent models`</Text>}

      <Text>
        Iterations: <Text bold>{iterations}</Text>
        <Text dimColor>
          {iterations === DEFAULT_ITERATIONS ? ' (recommended)' : ''} qagent config iterations
        </Text>
      </Text>

      <Text>{''}</Text>

      {checks.map((check, i) => (
        <React.Fragment key={i}>{renderCheck(check)}</React.Fragment>
      ))}

      <Text>{''}</Text>
      <Text>{summary}</Text>
      <Text dimColor>Press Enter to continue...</Text>
    </Box>
  );
};
