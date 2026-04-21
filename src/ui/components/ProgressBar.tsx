import React from 'react';
import { Box, Text } from 'ink';
import ProgressBar from 'ink-progress-bar';

interface ProgressBarComponentProps {
  progress: number; // 0-1
  label?: string;
  width?: number;
}

export const ProgressBarComponent: React.FC<ProgressBarComponentProps> = ({
  progress,
  label,
  width = 40,
}) => {
  return (
    <Box flexDirection="column">
      {label && <Text>{label}</Text>}
      <ProgressBar percent={progress * 100} width={width} />
      <Text dimColor>{Math.round(progress * 100)}%</Text>
    </Box>
  );
};
