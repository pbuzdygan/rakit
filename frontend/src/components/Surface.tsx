import type { ElementType, ReactNode } from 'react';

type Variant = 'layer' | 'panel' | 'table';

type SurfaceProps<T extends ElementType = 'div'> = {
  as?: T;
  variant?: Variant;
  compact?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<React.ComponentPropsWithoutRef<T>, 'as' | 'children' | 'className'>;

export function Surface<T extends ElementType = 'div'>({
  as,
  variant = 'layer',
  compact = false,
  className,
  children,
  ...rest
}: SurfaceProps<T>) {
  const Component = (as ?? 'div') as ElementType;

  const variantClass =
    variant === 'panel'
      ? 'card'
      : variant === 'table'
      ? 'table-shell'
      : 'layer-card';

  const classes = [
    variantClass,
    compact ? 'compact' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
    .trim();

  return (
    <Component className={classes} {...rest}>
      {children}
    </Component>
  );
}
