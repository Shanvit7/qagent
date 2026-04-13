import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import ConfirmInput from '@/ui/components/Confirm';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SKILL_TEMPLATE, IDE_PROMPT } from '@/skill/template';

const SKILL_FILE = 'qagent-skill.md';

/** Check if the skill file has been filled in (not just the bare template). */
const isFilledIn = (skillPath: string): boolean => {
  try {
    const content = readFileSync(skillPath, 'utf8');
    // If it has code blocks with actual content, it's been filled in
    return /```\w*\n(?!\/\/)(?!\n```).+/s.test(content);
  } catch {
    return false;
  }
};

interface SkillScreenProps {
  onComplete: () => void;
}

export const SkillScreen: React.FC<SkillScreenProps> = ({ onComplete }) => {
  const [step, setStep] = useState(0);
  const [overwrite, setOverwrite] = useState<boolean | null>(null);

  const cwd = process.cwd();
  const skillPath = resolve(cwd, SKILL_FILE);

  const existingAndFilled = existsSync(skillPath) && isFilledIn(skillPath);

  const renderStep = () => {
    switch (step) {
      case 0:
        if (existingAndFilled) {
          return (
            <Box flexDirection="column">
              <Text>{SKILL_FILE} already has content. Reset to empty template?</Text>
              <ConfirmInput
                onConfirm={(val) => {
                  if (val) {
                    writeFileSync(skillPath, SKILL_TEMPLATE, 'utf8');
                    setStep(1);
                  } else {
                    setStep(2);
                  }
                }}
              />
            </Box>
          );
        } else {
          writeFileSync(skillPath, SKILL_TEMPLATE, 'utf8');
          setStep(1);
          return null;
        }

      case 1:
        return (
          <Box flexDirection="column">
            <Text color="green">{SKILL_FILE} created.</Text>
            <Text>{''}</Text>
            <Box borderStyle="round" padding={1}>
              <Text>
                This must be done before generating any tests.
                qagent has zero project-wide context on its own — this file is the only
                way it knows your stores, auth, providers, mocks, and domain patterns.
                Next step:
                1. Open your agentic IDE (Cursor, Claude Code, Windsurf, etc.)
                2. Paste the prompt below — it will explore your codebase
                   and edit {SKILL_FILE} directly, filling in every section
                3. Review the result, then run qagent run
              </Text>
            </Box>
            <Text>{''}</Text>
            <Text color="cyan">PASTE THIS INTO YOUR IDE AGENT</Text>
            <Text>{'─'.repeat(70)}</Text>
            <Text>{IDE_PROMPT}</Text>
            <Text>{'─'.repeat(70)}</Text>
            <Text>{''}</Text>
            <Text>Once your IDE agent / AI Agent Harness  fills in {SKILL_FILE}, you're ready to generate tests.</Text>
          </Box>
        );

      case 2:
        return (
          <Box flexDirection="column">
            <Text>Kept existing skill file.</Text>
          </Box>
        );

      default:
        return null;
    }
  };

  useInput((input, key) => {
    if (key.return && (step === 1 || step === 2)) {
      onComplete();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan">qagent skill</Text>
      <Text>{''}</Text>
      {renderStep()}
      {(step === 1 || step === 2) && <Text>{''}</Text>}
      {(step === 1 || step === 2) && <Text dimColor>Press Enter to continue...</Text>}
    </Box>
  );
};