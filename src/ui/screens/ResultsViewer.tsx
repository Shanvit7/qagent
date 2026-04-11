import React from 'react';
import { Box, Text } from 'ink';
import { TestResults } from '../components/TestResults';
import { RuleViolations } from '../components/RuleViolations';
import { PerformanceMetrics } from '../components/PerformanceMetrics';

interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  duration?: number;
  error?: string;
  metrics?: any;
}

interface RuleViolation {
  rule: string;
  severity: 'critical' | 'major' | 'minor';
  message: string;
  file?: string;
  line?: number;
}

interface ResultsViewerProps {
  results: TestResult[];
  violations?: RuleViolation[];
  onExit?: () => void;
}

export const ResultsViewer: React.FC<ResultsViewerProps> = ({
  results,
  violations = [],
  onExit
}) => {
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const total = results.length;

  const hasViolations = violations.length > 0;
  const hasFailures = failed > 0;

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>qagent Test Results</Text>
      <Text>================</Text>

      <Box marginY={1}>
        <Text color={hasFailures ? 'red' : 'green'}>
          {hasFailures ? '❌' : '✅'} {passed}/{total} tests passed
        </Text>
        {hasFailures && (
          <Text color="red"> ({failed} failed)</Text>
        )}
      </Box>

      <TestResults results={results} />

      {violations && <RuleViolations violations={violations} />}

      {results.some(r => r.metrics) && (
        <Box marginTop={1}>
          <Text bold>Performance Summary</Text>
          {results
            .filter(r => r.metrics)
            .map((result, index) => (
              <PerformanceMetrics
                key={index}
                metrics={result.metrics}
              />
            ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          {hasViolations || hasFailures
            ? 'Review the issues above and fix them before committing.'
            : 'All tests passed! Your changes look good.'
          }
        </Text>
      </Box>

      {onExit && (
        <Text dimColor>Press Ctrl+C to exit</Text>
      )}
    </Box>
  );
};