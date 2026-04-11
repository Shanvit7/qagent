import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';

interface ModelInfo {
  provider: 'openai' | 'anthropic';
  id: string;
  displayName: string;
  contextWindow: number;
  supportsTools: boolean;
  released: Date;
  deprecated?: Date;
  recommended?: boolean;
}

interface ModelSelectorProps {
  provider: 'openai' | 'anthropic' | 'ollama';
  models: ModelInfo[];
  onSelect: (modelId: string) => void;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  provider,
  models,
  onSelect
}) => {
  const recommended = models.find(m => m.recommended);

  const items = models.map(model => ({
    label: `${model.displayName} ${model.recommended ? '(Recommended)' : ''}`,
    value: model.id,
    hint: `${model.contextWindow / 1000}K context`
  }));

  return (
    <Box flexDirection="column">
      <Text bold>Available {provider.toUpperCase()} models:</Text>
      {recommended && (
        <Text color="green">
          💡 Recommended: {recommended.displayName}
        </Text>
      )}

      <SelectInput
        items={items}
        onSelect={(item) => onSelect(item.value)}
        initialIndex={recommended ? items.findIndex(i => i.value === recommended.id) : 0}
      />

      <Text dimColor>
        Models are sorted by release date. Latest models may have better performance.
      </Text>
    </Box>
  );
};