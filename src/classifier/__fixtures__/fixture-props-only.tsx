interface ButtonProps {
  label: string;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}

export const Button = ({ label, disabled, variant = 'primary' }: ButtonProps) => {
  return (
    <button disabled={disabled} className={variant}>
      {label}
    </button>
  );
};
