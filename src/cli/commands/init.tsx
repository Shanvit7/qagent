import { render } from "ink";
import { InitWizard } from "../../ui/screens/InitWizard";
export const initCommand = async (): Promise<void> => {
  if (!process.stdin.isTTY) {
    process.stderr.write("qagent init requires an interactive terminal (TTY). Please run in a proper terminal.\n");
    process.exit(1);
  }

  await new Promise<void>((resolvePromise) => {
    render(
      <InitWizard
        onComplete={async () => {
          resolvePromise();
        }}
      />
    );
  });
};