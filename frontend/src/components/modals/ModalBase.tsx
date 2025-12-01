import { motion, AnimatePresence } from "framer-motion";
import type { ReactNode } from "react";

type ModalSize = "sm" | "md" | "lg";

type ModalBaseProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  disableClose?: boolean;
  size?: ModalSize;
};

export function ModalBase({
  open,
  title,
  subtitle,
  icon,
  children,
  onClose,
  disableClose = false,
  size = "md",
}: ModalBaseProps) {
  const widthClass =
    size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-2xl" : "max-w-lg";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[900] bg-black/40 backdrop-blur-sm flex items-center justify-center modal-overlay-premium p-4 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={() => {
            if (!disableClose) onClose();
          }}
        >
          <motion.div
            className={`card modal-card-premium w-full ${widthClass}`}
            onMouseDown={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-4 modal-header-premium">
              <div className="flex items-start gap-3">
                {icon && (
                  <div className="shrink-0 h-9 w-9 rounded-2xl flex items-center justify-center modal-icon-premium">
                    {icon}
                  </div>
                )}
                <div className="stack-sm">
                  <h2 className="type-title-m leading-snug">
                    {title}
                  </h2>
                  {subtitle && (
                    <p className="type-body-sm text-textSec">{subtitle}</p>
                  )}
                </div>
              </div>

              {!disableClose && (
                <button
                  type="button"
                  className="btn btn-ghost-premium"
                  onClick={onClose}
                >
                  ✕
                </button>
              )}
            </div>

            {/* Body */}
            <div className="modal-body-premium">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
