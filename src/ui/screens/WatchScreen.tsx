import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

interface WatchScreenProps {
  options: { iterations?: string | undefined };
  onComplete: () => void;
}

export const WatchScreen: React.FC<WatchScreenProps> = ({ options: _options, onComplete }) => {
  const [status, setStatus] = useState<string>(
    'Watch mode is not yet fully converted to Ink. Use `qagent run` instead.',
  );
  const [error, setError] = useState<string | null>(null);
  void setStatus;
  void setError;

  useEffect(() => {
    // Placeholder
    setTimeout(onComplete, 2000);
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan">qagent watch</Text>
      <Text>{''}</Text>
      <Text>{status}</Text>
      {error && <Text color="red">{error}</Text>}
    </Box>
  );
};
