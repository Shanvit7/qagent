import React from 'react';
import { Box, Text, useInput } from 'ink';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '@/config/loader';
import { generate, getSessionUsage, resetSessionUsage, formatTokenSummary } from '@/providers/index';

const LAST_FAILURE_PATH = join(process.cwd(), '.qagent', 'last-failure.txt');

const buildExplainPrompt = (failureRecord: string): string => {
  const hasDiff = failureRecord.includes('Code changes (git diff --staged):');

  const focus = hasDiff
    ? `Your job is to connect the CODE CHANGES to the test failures.
Read the diff carefully — the answer is almost always in there.
Ask: what did the developer change that would cause these specific tests to break?`
    : `No diff is available. Explain why the tests failed based on the error messages alone.`;

  return `You are a senior engineer doing a post-mortem on a failed QA run.

${focus}

Respond in this exact structure (plain English, no jargon, be specific):

**What changed:** (one sentence — what did the developer actually modify?)
**Why tests broke:** (one sentence — the direct connection between the change and the failure)
**Fix:** (one or two concrete actions — either fix the code or update the tests)

Do NOT explain what Playwright errors mean in general.
Do NOT say "the selector didn't match" without saying WHY it doesn't match given the diff.
Reference specific line changes, renamed props, removed elements, or changed text from the diff.

---
${failureRecord}
`.trim();
};

interface ExplainScreenProps {
  onComplete: () => void;
}

export const ExplainScreen: React.FC<ExplainScreenProps> = ({ onComplete }) => {
  const [state, setState] = React.useState<'loading' | 'success' | 'error' | 'no-failure'>('loading');
  const [message, setMessage] = React.useState<string>('');
  const [explanation, setExplanation] = React.useState<string>('');

  React.useEffect(() => {
    const runExplain = async () => {
      if (!existsSync(LAST_FAILURE_PATH)) {
        setState('no-failure');
        setMessage('No recorded failure found. Run `qagent run` first to capture test output.');
        return;
      }

      const failureOutput = readFileSync(LAST_FAILURE_PATH, 'utf8');

      let config;
      try {
        config = loadConfig();
      } catch {
        setState('error');
        setMessage('No model configured. Run `qagent models` first.');
        return;
      }

      resetSessionUsage();

      setMessage('Asking AI to explain the failure...');

      try {
        const response = await generate(config.ai, buildExplainPrompt(failureOutput), { temperature: 0.2 });
        setState('success');
        setExplanation(response.trim());
        const tokenSummary = formatTokenSummary(getSessionUsage());
        if (tokenSummary) setMessage(tokenSummary);
      } catch (err) {
        setState('error');
        setMessage(`Could not reach provider: ${err instanceof Error ? err.message : String(err)}`);
        setExplanation(failureOutput);
      }
    };

    runExplain();
  }, []);

  useInput((input, key) => {
    if (key.return) {
      onComplete();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan">qagent explain</Text>
      <Text>{''}</Text>

      {state === 'no-failure' && (
        <>
          <Text color="yellow">{message}</Text>
        </>
      )}

      {state === 'loading' && (
        <Text>{message}</Text>
      )}

      {state === 'error' && (
        <>
          <Text color="red">{message}</Text>
          <Text>{''}</Text>
          <Text dimColor>Raw failure output:</Text>
          <Text>{''}</Text>
          <Text>{explanation}</Text>
        </>
      )}

      {state === 'success' && (
        <>
          <Text color="green">Explanation ready</Text>
          <Text>{''}</Text>
          <Box borderStyle="round" padding={1}>
            <Text>{explanation}</Text>
          </Box>
          {message && (
            <>
              <Text>{''}</Text>
              <Text dimColor>{message}</Text>
            </>
          )}
        </>
      )}

      <Text>{''}</Text>
      <Text dimColor>Press Enter to continue...</Text>
    </Box>
  );
};