import React from 'react';
import { Box, Text } from 'ink';

interface RuleViolation {
  rule: string;
  severity: 'critical' | 'major' | 'minor';
  message: string;
  file?: string;
  line?: number;
}

interface RuleViolationsProps {
  violations: RuleViolation[];
}

export const RuleViolations: React.FC<RuleViolationsProps> = ({ violations }) => {
  if (violations.length === 0) {
    return (
      <Box>
        <Text color="green">✓ No rule violations found</Text>
      </Box>
    );
  }

  const critical = violations.filter(v => v.severity === 'critical').length;
  const major = violations.filter(v => v.severity === 'major').length;
  const minor = violations.filter(v => v.severity === 'minor').length;

  return (
    <Box flexDirection="column">
      <Text bold color="red">Rule Violations</Text>
      <Text>
        Critical: {critical} | Major: {major} | Minor: {minor}
      </Text>

      {violations.map((violation, index) => (
        <Box key={index} marginLeft={2} flexDirection="column">
          <Text color={
            violation.severity === 'critical' ? 'red' :
            violation.severity === 'major' ? 'yellow' : 'blue'
          }>
            {violation.severity.toUpperCase()}: {violation.rule}
          </Text>
          <Text>{violation.message}</Text>
          {violation.file && (
            <Text dimColor>
              {violation.file}{violation.line ? `:${violation.line}` : ''}
            </Text>
          )}
        </Box>
      ))}
    </Box>
  );
};