import { motion, AnimatePresence } from "framer-motion";
import type { ReactNode } from "react";
import { OperationsIcon } from "../OperationsIcon";

type ModalSize = "sm" | "md" | "lg";

type ModalBaseProps = {
  open: boolean;
  title: string;
  eyebrow?: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  disableClose?: boolean;
  size?: ModalSize;
};

export function ModalBase({
  open,
  title,
  eyebrow = "Rakit operations",
  subtitle,
  children,
  onClose,
  disableClose = false,
  size = "md",
}: ModalBaseProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="ops-dialog-backdrop ops-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !disableClose) onClose();
          }}
        >
          <motion.div
            className={`ops-dialog ops-modal-dialog ops-modal-dialog--${size}`}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="ops-inspector-header">
              <div>
                <span className="ops-eyebrow">{eyebrow}</span>
                <h2>{title}</h2>
                {subtitle ? <p>{subtitle}</p> : null}
              </div>
              {!disableClose && (
                <button
                  type="button"
                  className="ops-icon-button"
                  onClick={onClose}
                  aria-label="Close dialog"
                >
                  <OperationsIcon name="close" />
                </button>
              )}
            </div>
            <div className="ops-modal-body">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
