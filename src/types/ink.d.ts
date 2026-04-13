declare module 'ink-progress-bar' {
  import { FC } from 'react';

  interface ProgressBarProps {
    percent: number;
    width?: number;
    characters?: [string, string];
    left?: number;
    right?: number;
  }

  const ProgressBar: FC<ProgressBarProps>;
  export default ProgressBar;
}

declare module 'ink-confirm-input' {
  import { FC } from 'react';

  interface ConfirmInputProps {
    onConfirm: (value: boolean) => void;
    defaultValue?: boolean;
  }

  const ConfirmInput: FC<ConfirmInputProps>;
  export default ConfirmInput;
}
