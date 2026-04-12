import React from 'react';
import { Box, Text, useInput } from 'ink';

interface HelpScreenProps {
  version: string;
  onComplete: () => void;
}

export const HelpScreen: React.FC<HelpScreenProps> = ({ version, onComplete }) => {
  useInput((input, key) => {
    if (key.return) {
      onComplete();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>
        qagent v{version}
      </Text>
      <Text dimColor>
        change-aware behavioral regression testing for Next.js
      </Text>
      <Text>{''}</Text>

      <Text color="green" bold>
        Commands:
      </Text>
      <Text>{''}</Text>

      <Box flexDirection="column" marginLeft={2}>
        <Box>
          <Text color="yellow" bold>init</Text>
          <Text> — Setup wizard — install qagent, configure AI, create config</Text>
        </Box>
        <Text>{''}</Text>

        <Box>
          <Text color="yellow" bold>run</Text>
          <Text> — Run QA on staged files (starts dev server per-run)</Text>
        </Box>
        <Box marginLeft={4}>
          <Text dimColor>--iterations &lt;n&gt;</Text>
          <Text dimColor> — Max refinement iterations for this run (min 3, max 8)</Text>
        </Box>
        <Text>{''}</Text>

        <Box>
          <Text color="yellow" bold>watch</Text>
          <Text> — Background CI — watch for staged changes and test in real browser</Text>
        </Box>
        <Text>{''}</Text>

        <Box>
          <Text color="yellow" bold>explain</Text>
          <Text> — AI explains why the last test failed</Text>
        </Box>
        <Text>{''}</Text>

        <Box>
          <Text color="yellow" bold>status</Text>
          <Text> — Check Ollama connection and config summary</Text>
        </Box>
        <Text>{''}</Text>

        <Box>
          <Text color="yellow" bold>models</Text>
          <Text> — Switch the AI model used for test generation</Text>
        </Box>
        <Text>{''}</Text>

        <Box>
          <Text color="yellow" bold>skill</Text>
          <Text> — Create or reset qagent-skill.md with template and IDE prompt</Text>
        </Box>
        <Text>{''}</Text>

        <Box>
          <Text color="yellow" bold>config [subcommand] [value]</Text>
          <Text> — View or update qagent settings (e.g. qagent config iterations 5)</Text>
        </Box>
      </Box>

      <Text>{''}</Text>
      <Text dimColor>
        For help on a specific command, run: qagent &lt;command&gt; --help
      </Text>
      <Text dimColor>
        Press Enter to exit...
      </Text>
    </Box>
  );
};