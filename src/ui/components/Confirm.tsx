import React from 'react';
import { Text, useInput } from 'ink';

interface ConfirmProps {
  onConfirm: (value: boolean) => void;
}

/** Drop-in replacement for ink-confirm-input using only core Ink. */
const Confirm: React.FC<ConfirmProps> = ({ onConfirm }) => {
  useInput((input) => {
    const key = input.toLowerCase();
    if (key === 'y') onConfirm(true);
    if (key === 'n') onConfirm(false);
  });

  return <Text dimColor> (y/n) </Text>;
};

export default Confirm;
