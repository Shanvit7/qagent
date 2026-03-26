import * as p from "@clack/prompts";

export { p };

/** No-op — clack manages its own stdin lifecycle */
export const closePrompt = (): void => {};

/**
 * Confirm prompt with y/n keyboard or arrow keys.
 * Returns true by default on Enter.
 */
export const askYesNo = async (q: string, defaultYes = true): Promise<boolean> => {
  const result = await p.confirm({ message: q, initialValue: defaultYes });
  if (p.isCancel(result)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  return result as boolean;
};

/**
 * Single-select with arrow keys + Enter. Returns zero-based index.
 */
export const askChoice = async (
  prompt: string,
  choices: string[],
  defaultIndex = 0,
): Promise<number> => {
  const options = choices.map((label, i) => ({ value: i, label }));
  const result = await p.select({
    message: prompt,
    options,
    initialValue: defaultIndex,
  });
  if (p.isCancel(result)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  return result as number;
};

/**
 * Multi-select with Space to toggle, Enter to confirm.
 */
export const askMultiSelect = async <T extends string>(
  prompt: string,
  options: { label: string; value: T; description?: string; default?: boolean }[],
): Promise<T[]> => {
  const clackOptions = options.map((o) => ({
    value: o.value,
    label: o.label,
    ...(o.description ? { hint: o.description } : {}),
  }));

  const initialValues = options
    .filter((o) => o.default !== false)
    .map((o) => o.value);

  const result = await p.multiselect({
    message: prompt,
    options: clackOptions as Parameters<typeof p.multiselect>[0]["options"],
    initialValues,
    required: false,
  });

  if (p.isCancel(result)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  return result as unknown as T[];
};

/** Ask for a secret/API key (masked input). */
export const askSecret = async (q: string): Promise<string> => {
  const result = await p.password({ message: q });
  if (p.isCancel(result)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  return result as string;
};
