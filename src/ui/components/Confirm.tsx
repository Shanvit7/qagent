import React from 'react';
import { Text, useInput } from 'ink';

interface ConfirmProps {
  onConfirm: (value: boolean) => void;
  defaultYes?: boolean;
}

/** Drop-in replacement for ink-confirm-input using only core Ink. */
const Confirm: React.FC<ConfirmProps> = ({ onConfirm, defaultYes = true }) => {
  useInput((input, key) => {
    const lower = input.toLowerCase();
    if (lower === 'y') onConfirm(true);
    if (lower === 'n') onConfirm(false);
    if (key.return) onConfirm(defaultYes);
  });

  return <Text dimColor> (y/n) </Text>;
};

export default Confirm;
