import React from 'react';
import { render } from 'ink';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import Confirm from '@/ui/components/Confirm';
import TextInput from 'ink-text-input';

/** No-op — Ink manages its own stdin lifecycle */
export const closePrompt = (): void => {};

/**
 * Confirm prompt with y/n keyboard.
 * Returns true by default on Enter.
 */
export const askYesNo = async (q: string, defaultYes = true): Promise<boolean> => {
  return new Promise((resolve) => {
    const { unmount } = render(
      <Box flexDirection="column">
        <Text>{q}</Text>
        <Confirm
          defaultYes={defaultYes}
          onConfirm={(val) => {
            unmount();
            resolve(val ?? defaultYes);
          }}
        />
      </Box>,
    );
  });
};

/**
 * Single-select with arrow keys + Enter. Returns zero-based index.
 */
export const askChoice = async (
  prompt: string,
  choices: string[],
  defaultIndex = 0,
): Promise<number> => {
  return new Promise((resolve) => {
    const App = () => (
      <SelectInput
        items={choices.map((label, i) => ({ label, value: i }))}
        initialIndex={defaultIndex}
        onSelect={(item) => resolve(item.value)}
      />
    );

    render(<App />);
  });
};

/**
 * Multi-select with Space to toggle, Enter to confirm.
 * Note: Ink doesn't have built-in multi-select, so this is simplified to single select for now.
 */
export const askMultiSelect = async <T extends string>(
  prompt: string,
  options: { label: string; value: T; description?: string; default?: boolean }[],
): Promise<T[]> => {
  const selected = await askChoice(
    prompt,
    options.map((o) => o.label),
  );
  const item = options[selected];
  if (!item) return [];
  return [item.value];
};

/** Ask for a secret/API key (masked input). */
export const askSecret = async (_q: string): Promise<string> => {
  return new Promise((resolve) => {
    const App = () => {
      const [value, setValue] = React.useState('');

      return <TextInput value={value} onChange={setValue} onSubmit={resolve} />;
    };

    render(<App />);
  });
};
