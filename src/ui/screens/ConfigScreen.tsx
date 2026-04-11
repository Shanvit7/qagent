import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import color from 'picocolors';
import {
  readIterations,
  writeIterations,
  MIN_ITERATIONS,
  MAX_ITERATIONS,
  DEFAULT_ITERATIONS,
} from '@/config/loader';

interface ConfigScreenProps {
  subcommand?: string;
  value?: string;
  onComplete: () => void;
}

export const ConfigScreen: React.FC<ConfigScreenProps> = ({ subcommand, value, onComplete }) => {
  const [state, setState] = useState<'show' | 'set' | 'error'>('show');
  const [message, setMessage] = useState<string>('');

  React.useEffect(() => {
    if (!subcommand) {
      // Show current config
      setMessage(`iterations  ${color.bold(String(readIterations()))}  ${color.dim(`(min ${MIN_ITERATIONS} · max ${MAX_ITERATIONS})`)}`);
      setState('show');
    } else if (subcommand === 'iterations') {
      if (!value) {
        // Interactive
        setState('set');
      } else {
        // Direct value
        const n = parseInt(value, 10);
        if (isNaN(n)) {
          setState('error');
          setMessage(`"${value}" is not a number.`);
        } else if (n < MIN_ITERATIONS) {
          setState('error');
          setMessage(`Minimum is ${MIN_ITERATIONS}. Fewer iterations produce unreliable results.`);
        } else if (n > MAX_ITERATIONS) {
          setState('error');
          setMessage(`Maximum is ${MAX_ITERATIONS}. Beyond that, token cost outweighs quality gain.`);
        } else {
          writeIterations(n);
          setMessage(`Iterations set to ${color.bold(String(n))}${n === DEFAULT_ITERATIONS ? color.dim('  (recommended)') : ''}`);
          setState('show');
        }
      }
    } else {
      setState('error');
      setMessage(`Unknown config key "${subcommand}". Available: iterations`);
    }
  }, [subcommand, value]);

  const current = readIterations();

  const options = Array.from(
    { length: MAX_ITERATIONS - MIN_ITERATIONS + 1 },
    (_, i) => {
      const n = MIN_ITERATIONS + i;
      const hint =
        n === DEFAULT_ITERATIONS ? 'recommended' :
        n <= 4                   ? 'fast' :
        n <= 6                   ? 'thorough' :
                                   'exhaustive — high token cost';
      return { label: `${n} (${hint})`, value: n };
    },
  );

  useInput((input, key) => {
    if (key.return && (state === 'show' || state === 'error')) {
      onComplete();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan">qagent config{subcommand ? ` · ${subcommand}` : ''}</Text>
      <Text>{''}</Text>

      {state === 'show' && (
        <>
          <Text>{message}</Text>
          {!subcommand && <Text dimColor>Usage: qagent config iterations [n]</Text>}
        </>
      )}

      {state === 'set' && (
        <>
          <Text>Current: <Text bold>{current}</Text> <Text dimColor>(min {MIN_ITERATIONS} · max {MAX_ITERATIONS} · recommended {DEFAULT_ITERATIONS})</Text></Text>
          <Text>{''}</Text>
          <Text>Max refinement iterations per file:</Text>
          <SelectInput
            items={options}
            initialIndex={current - MIN_ITERATIONS}
            onSelect={(item) => {
              writeIterations(item.value);
              setMessage(`Iterations set to ${item.value}${item.value === DEFAULT_ITERATIONS ? ' (recommended)' : ''}`);
              setState('show');
            }}
          />
        </>
      )}

      {state === 'error' && (
        <Text color="red">{message}</Text>
      )}

      <Text>{''}</Text>
      <Text dimColor>Press Enter to continue...</Text>
    </Box>
  );
};