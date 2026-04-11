import React from 'react';
import { Box, Text } from 'ink';

interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  duration?: number;
  error?: string;
  metrics?: any;
}

interface TestResultsProps {
  results: TestResult[];
}

export const TestResults: React.FC<TestResultsProps> = ({ results }) => {
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const skipped = results.filter(r => r.status === 'skip').length;

  return (
    <Box flexDirection="column">
      <Text bold>Test Results</Text>
      <Text>Passed: {passed} | Failed: {failed} | Skipped: {skipped}</Text>

      {results.map((result, index) => (
        <Box key={index} marginLeft={2}>
          <Text color={result.status === 'pass' ? 'green' : result.status === 'fail' ? 'red' : 'yellow'}>
            {result.status === 'pass' ? '✓' : result.status === 'fail' ? '✗' : '○'} {result.name}
          </Text>
          {result.duration && (
            <Text dimColor> ({result.duration}ms)</Text>
          )}
          {result.error && (
            <Text color="red" dimColor>
              {'\n'}  Error: {result.error}
            </Text>
          )}
        </Box>
      ))}
    </Box>
  );
};