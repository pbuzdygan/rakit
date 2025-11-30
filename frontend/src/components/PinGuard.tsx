import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Api } from "../api";
import { useAppStore } from "../store";
import { SoftButton } from "./SoftButton";

export function PinGuard() {
  const pinOk = useAppStore((s) => s.pinSession);
  const setPinOk = useAppStore((s) => s.setPinSession);

  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // restore session
  useEffect(() => {
    const cached = sessionStorage.getItem("pin-ok") === "1";
    if (cached) setPinOk(true);
  }, []);

  useEffect(() => {
    if (!pinOk) {
      const raf = requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [pinOk]);

  function handlePinFailure() {
    setPin("");
    setError("Wrong PIN");
    requestAnimationFrame(() => inputRef.current?.focus());
    setTimeout(() => setError(null), 1500);
  }

  async function submit() {
    if (pin.length < 4 || pin.length > 8) return;

    try {
      const res = await Api.verifyPin(pin);

      if (res.ok) {
        sessionStorage.setItem("pin-ok", "1");
        setPinOk(true);
        setPin("");
      } else {
        handlePinFailure();
      }
    } catch {
      handlePinFailure();
    }
  }

  return (
    <AnimatePresence>
      {!pinOk && (
        <motion.div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="layer-card compact w-full max-w-sm stack"
            initial={{ scale: 0.94, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 8 }}
          >
            <div className="flex justify-center">
              <img
                src="/rakit_banner_512x512.png"
                alt="Rakit"
                className="pin-banner"
              />
            </div>
            <div className="stack-sm">
              <h2 className="type-title-xl text-center">Enter PIN</h2>
              <p className="type-body-sm text-textSec text-center">
                Unlock your data with a 4–8 digit PIN.
              </p>
            </div>

            <div className="stack-sm">
              <label className="field-label" htmlFor="pin-guard-input">
                PIN
              </label>
              <input
                id="pin-guard-input"
                ref={inputRef}
                type="password"
                inputMode="numeric"
                maxLength={8}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                name="rakit-pin"
                className={`input w-full ${error ? "input-error" : ""}`}
                value={pin}
                onChange={(e) =>
                  setPin(e.target.value.replace(/[^0-9]/g, ""))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
              />
            </div>

            {error && <div className="feedback-badge err">Wrong PIN. Try again.</div>}

            <div className="cluster justify-end">
              <SoftButton
                type="button"
                variant="ghost"
                onClick={() => setPin("")}
                disabled={!pin.length}
              >
                Clear
              </SoftButton>
              <button
                className="btn px-6"
                disabled={pin.length < 4}
                onClick={submit}
              >
                Enter
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
