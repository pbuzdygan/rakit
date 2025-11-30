import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SoftButton } from './SoftButton';

type DropdownMenuProps = {
  label: ReactNode;
  align?: 'left' | 'right';
  variant?: 'solid' | 'ghost';
  block?: boolean;
  buttonClassName?: string;
  children: (helpers: { close: () => void }) => ReactNode;
};

export function DropdownMenu({
  label,
  align = 'left',
  variant = 'solid',
  block = false,
  buttonClassName,
  children,
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const close = () => setOpen(false);

  return (
    <div ref={ref} className="relative inline-flex dropdown-root">
      <SoftButton
        variant={variant}
        block={block}
        justify="between"
        className={buttonClassName}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
        <span className="opacity-60 text-xs">{open ? '▲' : '▼'}</span>
      </SoftButton>

      {open && (
        <div
          className={`dropdown-panel animate-dropdown absolute mt-2 min-w-[12rem] ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {children({ close })}
        </div>
      )}
    </div>
  );
}

type DropdownItemProps = {
  children: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
};

export function DropdownItem({ children, onSelect, danger = false }: DropdownItemProps) {
  return (
    <button
      type="button"
      className={`dropdown-item ${danger ? 'danger' : ''}`}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}
