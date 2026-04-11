import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { ProgressBarComponent } from '../components/ProgressBar';
import { TestResults } from '../components/TestResults';
import { PerformanceMetrics } from '../components/PerformanceMetrics';

interface TestCase {
  name: string;
  route?: string;
}

interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  duration?: number;
  error?: string;
  metrics?: any;
}

interface TestRunnerProps {
  tests: TestCase[];
  onComplete: (results: TestResult[]) => void;
}

export const TestRunner: React.FC<TestRunnerProps> = ({ tests, onComplete }) => {
  const [currentTest, setCurrentTest] = useState(0);
  const [results, setResults] = useState<TestResult[]>([]);
  const [isRunning, setIsRunning] = useState(true);

  // Mock test runner - in real implementation, this would call the actual test execution
  useEffect(() => {
    if (currentTest >= tests.length) {
      setIsRunning(false);
      onComplete(results);
      return;
    }

    const test = tests[currentTest];
    if (!test) return;

    const runTest = async (test: TestCase): Promise<TestResult> => {
      // Simulate test execution
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

      const result: TestResult = {
        name: test.name,
        status: status as 'pass' | 'fail',
        duration: Math.floor(Math.random() * 5000) + 500,
        metrics: {
          lcp: { value: 1200 + Math.random() * 800, rating: 'good' },
          cls: { value: 0.02 + Math.random() * 0.1, rating: 'good' }
        }
      };

      if (status === 'fail') {
        result.error = 'Mock test failure';
      }

      return result;
    };

    runTest(test).then(result => {
      setResults(prev => [...prev, result]);
      setCurrentTest(prev => prev + 1);
    });
  }, [currentTest, tests, results, onComplete]);

  const progress = tests.length > 0 ? (currentTest) / tests.length : 0;

  if (!isRunning && currentTest >= tests.length) {
    return (
      <Box flexDirection="column">
        <Text bold color="green">All tests completed!</Text>
        <TestResults results={results} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box>
        <Spinner type="dots" />
        <Text> Running tests... ({currentTest}/{tests.length})</Text>
      </Box>

      <ProgressBarComponent progress={progress} />

      <TestResults results={results} />

      {results.length > 0 && (() => {
        const lastResult = results[results.length - 1];
        return lastResult && lastResult.metrics ? (
          <PerformanceMetrics metrics={lastResult.metrics} />
        ) : null;
      })()}
    </Box>
  );
};