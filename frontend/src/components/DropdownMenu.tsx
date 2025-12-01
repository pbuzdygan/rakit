import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
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
  const [mobileStyle, setMobileStyle] = useState<CSSProperties | null>(null);
  const [mobileActive, setMobileActive] = useState(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent | TouchEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('touchstart', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('touchstart', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    setPortalTarget(document.body);
  }, []);

  useEffect(() => {
    if (!open) {
      setMobileStyle(null);
      setMobileActive(false);
      return;
    }
    if (typeof window === 'undefined') return;
    const updatePosition = () => {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const isMobile = viewportWidth <= 640;
      if (!isMobile) {
        setMobileStyle(null);
        setMobileActive(false);
        return;
      }
      const horizontalPadding = 24;
      const width = Math.min(360, viewportWidth - horizontalPadding);
      const left = (viewportWidth - width) / 2;
      const top = rect.bottom + 8;
      setMobileStyle({
        position: 'fixed',
        left,
        right: 'auto',
        width,
        maxWidth: width,
        top,
        zIndex: 500,
      });
      setMobileActive(true);
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('touchmove', updatePosition, { passive: true });
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('touchmove', updatePosition);
    };
  }, [open]);

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

      {open
        ? mobileActive && portalTarget
          ? createPortal(
              <div
                ref={panelRef}
                className={`dropdown-panel animate-dropdown min-w-[12rem] ${
                  align === 'right' ? 'right-0 dropdown-right' : 'left-0 dropdown-left'
                }`}
                style={mobileStyle ?? undefined}
              >
                {children({ close })}
              </div>,
              portalTarget,
            )
          : (
            <div
              ref={panelRef}
              className={`dropdown-panel animate-dropdown absolute mt-2 min-w-[12rem] ${
                align === 'right' ? 'right-0 dropdown-right' : 'left-0 dropdown-left'
              }`}
              style={
                mobileStyle ?? {
                  top: 'calc(100% + 0.5rem)',
                }
              }
            >
              {children({ close })}
            </div>
          )
        : null}
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
