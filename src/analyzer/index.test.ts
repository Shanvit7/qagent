import { describe, it, expect } from 'vitest';
import { analyzeFile } from './index.js';

const SITE_HEADER = '/Users/zosmaai/Desktop/zosma-ai-website/src/components/layout/site-header.tsx';

describe('analyzeFile', () => {
  it("identifies client components via 'use client' directive", () => {
    const result = analyzeFile(SITE_HEADER);
    expect(result.componentType).toBe('client-component');
  });

  it('extracts the default export component name', () => {
    const result = analyzeFile(SITE_HEADER);
    expect(result.componentName).toBe('SiteHeader');
  });

  it('returns source text for prompt injection', () => {
    const result = analyzeFile(SITE_HEADER);
    expect(result.sourceText).toContain('use client');
    expect(result.sourceText.length).toBeGreaterThan(100);
  });

  it('returns the absolute file path', () => {
    const result = analyzeFile(SITE_HEADER);
    expect(result.filePath.startsWith('/')).toBe(true);
    expect(result.filePath.endsWith('site-header.tsx')).toBe(true);
  });
});
