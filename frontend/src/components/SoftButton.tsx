import type { ButtonHTMLAttributes } from 'react';

type Variant = 'solid' | 'ghost' | 'danger' | 'warning';

type SoftButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  block?: boolean;
  justify?: 'center' | 'between';
};

export function SoftButton({
  variant = 'solid',
  block = false,
  justify = 'center',
  className,
  ...props
}: SoftButtonProps) {
  const variantClass =
    variant === 'ghost'
      ? 'ghost'
      : variant === 'danger'
      ? 'danger'
      : variant === 'warning'
      ? 'warning'
      : '';

  const classes = [
    'soft-button',
    variantClass,
    block ? 'w-full' : '',
    justify === 'between' ? 'justify-between' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return (
    <button
      {...props}
      className={classes}
    />
  );
}
