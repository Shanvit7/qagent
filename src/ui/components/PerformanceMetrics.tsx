import React from 'react';
import { Box, Text } from 'ink';

interface PerformanceMetricsProps {
  metrics: {
    lcp?: { value: number; rating: string };
    cls?: { value: number; rating: string };
    fid?: { value: number; rating: string };
    ttfb?: { value: number; rating: string };
    [key: string]: { value: number; rating: string } | undefined;
  };
  baseline?: {
    lcp?: { value: number; rating: string };
    cls?: { value: number; rating: string };
    fid?: { value: number; rating: string };
    ttfb?: { value: number; rating: string };
  };
}

const getRatingColor = (rating: string) => {
  switch (rating) {
    case 'good':
      return 'green';
    case 'needs-improvement':
      return 'yellow';
    case 'poor':
      return 'red';
    default:
      return 'white';
  }
};

const formatMetric = (value: number, unit: string) => {
  if (unit === 'ms') return `${value.toFixed(0)}ms`;
  if (unit === 's') return `${(value / 1000).toFixed(2)}s`;
  return value.toString();
};

export const PerformanceMetrics: React.FC<PerformanceMetricsProps> = ({ metrics, baseline }) => {
  const renderMetric = (
    label: string,
    current: { value: number; rating: string } | undefined,
    baselineValue?: { value: number; rating: string },
    unit = 'ms',
  ) => {
    const currentValue = current?.value || 0;
    const currentRating = current?.rating || 'unknown';
    const baselineVal = baselineValue?.value;

    let change = '';
    if (baselineVal !== undefined) {
      const diff = currentValue - baselineVal;
      const percent = Math.abs((diff / baselineVal) * 100);
      change = diff > 0 ? ` (+${percent.toFixed(1)}%)` : ` (-${percent.toFixed(1)}%)`;
    }

    return (
      <Text key={label}>
        {label}:{' '}
        <Text color={getRatingColor(currentRating)}>{formatMetric(currentValue, unit)}</Text>
        {baselineVal && (
          <Text dimColor>
            {' '}
            vs {formatMetric(baselineVal, unit)}
            {change}
          </Text>
        )}
      </Text>
    );
  };

  return (
    <Box flexDirection="column">
      <Text bold>Performance Metrics</Text>

      {renderMetric('LCP', metrics.lcp, baseline?.lcp, 'ms')}
      {renderMetric('CLS', metrics.cls, baseline?.cls)}
      {renderMetric('FID', metrics.fid, baseline?.fid, 'ms')}
      {renderMetric('TTFB', metrics.ttfb, baseline?.ttfb, 'ms')}
    </Box>
  );
};
