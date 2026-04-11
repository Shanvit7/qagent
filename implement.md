# Implementation Roadmap — qagent Competitive Features

> **Reference:** [`differ.md`](./differ.md) — Complete competitive analysis vs Expect CLI

## Focus Areas (Prioritized)

### 1. 🔴 Rich Rule Library (Next.js-Specific)

**Why:** Expect has 11 domains of curated rules. You have basic HARD_RULES only. This is where framework focus wins.

#### Implementation Plan

**Directory Structure:**
```
src/rules/
├── index.ts              # Rule registry + injection
├── types.ts              # Rule interface definitions
├── nextjs/               # Next.js specific rules
│   ├── rsc-patterns.ts   # Server vs Client component patterns
│   ├── metadata.ts       # generateMetadata() validation
│   ├── middleware.ts     # Edge runtime security
│   ├── images.ts         # Next.js Image optimization
│   ├── fonts.ts          # Font loading optimization
│   └── server-actions.ts # Form action validation
├── react/                # React best practices
├── performance/          # Web vitals, bundle analysis
├── security/             # XSS, CSRF, auth patterns
├── seo/                  # Meta tags, structured data
└── accessibility/        # WCAG compliance
```

**Rule Interface:**
```typescript
interface Rule {
  name: string;
  domain: 'nextjs' | 'react' | 'performance' | 'security' | 'seo' | 'accessibility';
  severity: 'critical' | 'major' | 'minor';
  description: string;
  check: (context: RuleContext) => RuleViolation[];
  fix?: (violation: RuleViolation) => string; // Auto-fix suggestion
}

interface RuleContext {
  filePath: string;
  ast: ts.SourceFile;
  imports: ImportDeclaration[];
  exports: ExportDeclaration[];
  route?: string; // For page-level rules
}
```

**Injection Points:**
- **Generator prompts** — Include relevant rules in test generation
- **Evaluator feedback** — Flag rule violations during test execution
- **Reporter output** — Show rule compliance alongside test results

**Example Next.js Rule:**
```typescript
export const rscPatterns: Rule = {
  name: 'rsc-client-boundary',
  domain: 'nextjs',
  severity: 'major',
  description: 'Server components should not use client-side APIs',
  check: (ctx) => {
    // Check for useState, useEffect in server components
    // Flag window, document usage
  }
};
```

### 2. 🔴 Next.js Performance Features

**Why:** Performance tracing is your #1 differentiator. Make it Next.js-aware.

#### Web Vitals Integration

**Runtime Injection:**
```typescript
// src/probe/performance-injection.ts
export const injectWebVitals = async (page: Page) => {
  await page.addScriptTag({
    content: `
      import { getCLS, getFCP, getFID, getLCP, getTTFB } from 'web-vitals';

      window.__QAGENT_VITALS__ = {};
      getCLS(({ value, rating }) => window.__QAGENT_VITALS__.cls = { value, rating });
      getFCP(({ value, rating }) => window.__QAGENT_VITALS__.fcp = { value, rating });
      getLCP(({ value, rating }) => window.__QAGENT_VITALS__.lcp = { value, rating });
      getTTFB(({ value, rating }) => window.__QAGENT_VITALS__.ttfb = { value, rating });
    `
  });
};
```

**Next.js-Specific Metrics:**
- **RSC Payload Size** — Measure server component output size
- **Streaming Chunks** — Track partial hydration timing
- **PPR Metrics** — Partial pre-rendering effectiveness
- **Middleware Overhead** — Edge function timing

**Route-Level Regression Detection:**
```typescript
interface PerformanceBaseline {
  route: string;
  lcp: { value: number; rating: string };
  cls: { value: number; rating: string };
  inp: { value: number; rating: string };
  timestamp: Date;
}

export const detectRegressions = (
  current: PerformanceMetrics,
  baseline: PerformanceBaseline
) => {
  const regressions = [];

  if (current.lcp.value > baseline.lcp.value * 1.2) { // 20% regression
    regressions.push({
      metric: 'LCP',
      from: baseline.lcp.value,
      to: current.lcp.value,
      impact: 'major'
    });
  }

  return regressions;
};
```

**Reporter Integration:**
```
Performance Report for /products
├── LCP: 2.1s (good) | Baseline: 1.8s → ⚠️ +17% regression
├── CLS: 0.05 (good) | Baseline: 0.03 → ✅ stable
└── RSC Payload: 234KB (good) | Recommended: <200KB
```

### 3. 🟡 Latest Model Auto-Pulling (OpenAI/Anthropic)

**Why:** You're hardcoded to specific models. Expect dynamically pulls latest. Keep up with model improvements.

#### Model Registry System
```typescript
// src/providers/model-registry.ts
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

export const MODEL_REGISTRY: ModelInfo[] = [
  // OpenAI
  {
    provider: 'openai',
    id: 'gpt-4o',
    displayName: 'GPT-4o',
    contextWindow: 128000,
    supportsTools: true,
    released: new Date('2024-05-13'),
    recommended: true
  },
  {
    provider: 'openai',
    id: 'gpt-4o-mini',
    displayName: 'GPT-4o Mini',
    contextWindow: 128000,
    supportsTools: true,
    released: new Date('2024-07-18'),
    recommended: false // Cost-effective alternative
  },
  // Anthropic
  {
    provider: 'anthropic',
    id: 'claude-3-5-sonnet-20241022',
    displayName: 'Claude 3.5 Sonnet (Latest)',
    contextWindow: 200000,
    supportsTools: true,
    released: new Date('2024-10-22'),
    recommended: true
  },
  {
    provider: 'anthropic',
    id: 'claude-3-5-haiku-20241022',
    displayName: 'Claude 3.5 Haiku (Latest)',
    contextWindow: 200000,
    supportsTools: true,
    released: new Date('2024-10-22'),
    recommended: false
  }
];

export const getLatestModels = (provider?: string) => {
  const models = provider
    ? MODEL_REGISTRY.filter(m => m.provider === provider)
    : MODEL_REGISTRY;

  return models
    .filter(m => !m.deprecated)
    .sort((a, b) => b.released.getTime() - a.released.getTime());
};

export const getRecommendedModel = (provider: string) => {
  return MODEL_REGISTRY.find(m =>
    m.provider === provider &&
    m.recommended &&
    !m.deprecated
  );
};
```

#### Dynamic Model Selection UI
```tsx
// src/ui/components/ModelSelector.tsx
import React from 'react';
import { Box, Text } from 'ink';
import MultiSelect from 'ink-multi-select';
import { getLatestModels, getRecommendedModel } from '../../providers/model-registry';

interface ModelSelectorProps {
  provider: 'openai' | 'anthropic' | 'ollama';
  onSelect: (modelId: string) => void;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({ provider, onSelect }) => {
  const models = getLatestModels(provider);
  const recommended = getRecommendedModel(provider);

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

      <MultiSelect
        items={items}
        onSelect={(item) => onSelect(item.value)}
        defaultValue={recommended?.id}
      />

      <Text dimColor>
        Models are sorted by release date. Latest models may have better performance.
      </Text>
    </Box>
  );
};
```

#### Auto-Update Mechanism
```typescript
// src/providers/model-updater.ts
export const checkForModelUpdates = async () => {
  // Check OpenAI API for new models
  const openaiModels = await fetchOpenAIModels();

  // Check Anthropic API for new models
  const anthropicModels = await fetchAnthropicModels();

  // Update registry with new models
  const newModels = [...openaiModels, ...anthropicModels]
    .filter(model => !MODEL_REGISTRY.some(existing => existing.id === model.id));

  if (newModels.length > 0) {
    MODEL_REGISTRY.push(...newModels);
    console.log(`Added ${newModels.length} new models`);
  }
};
```

## Implementation Order

1. **Rich Rule Library** (Foundation) — 2-3 weeks
2. **Next.js Performance Tracing** (Competitive Edge) — 2-3 weeks
3. **Latest Model Auto-Pulling** (AI Quality) — 1 week

## Testing Strategy

- **Rule Library**: Unit tests for each rule's `check()` function
- **Performance**: Integration tests with real Next.js apps
- **Model Registry**: Mock API responses for model update testing

## Success Metrics

- **Rule Library**: 80% of Next.js-specific issues caught by rules
- **Performance**: Route-level regression detection accuracy >95%
- **Models**: Automatic adoption of new models within 1 week of release</content>
<parameter name="path">implement.md