import { render } from "ink";
import { InitWizard } from "../../ui/screens/InitWizard";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8"));
const PKG_VERSION = pkg.version;

export const initCommand = async (): Promise<void> => {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      "qagent init requires an interactive terminal (TTY). Please run in a proper terminal.\n"
    );
    process.exit(1);
  }

  await new Promise<void>((resolve) => {
    const { unmount } = render(
      <InitWizard
        version={PKG_VERSION}
        onComplete={() => {
          unmount();
          resolve();
        }}
      />
    );
  });

  process.exit(0);
};
