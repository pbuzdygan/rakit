import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Api, ApiError } from "../api";
import { useAppStore } from "../store";
import { SoftButton } from "./SoftButton";

export function PinGuard() {
  const pinOk = useAppStore((s) => s.pinSession);
  const setPinOk = useAppStore((s) => s.setPinSession);

  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const expiryTimerRef = useRef<number | null>(null);

  const isNetworkFailure = (reason: unknown) =>
    !navigator.onLine || reason instanceof TypeError;

  const scheduleSessionExpiry = (session: { expiresAt?: string; expiresInMs?: number }) => {
    if (expiryTimerRef.current != null) window.clearTimeout(expiryTimerRef.current);
    const serverDuration = Number(session?.expiresInMs);
    const expiresAt = Date.parse(session?.expiresAt || '');
    const delay = Number.isFinite(serverDuration) && serverDuration > 0
      ? serverDuration
      : expiresAt - Date.now();
    if (!Number.isFinite(delay) || delay <= 0) {
      setPinOk(false);
      return;
    }
    expiryTimerRef.current = window.setTimeout(() => setPinOk(false), delay);
  };

  useEffect(() => {
    let cancelled = false;
    Api.session.status()
      .then((session) => {
        if (!cancelled) {
          scheduleSessionExpiry(session);
          setPinOk(true);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setPinOk(false);
          if (isNetworkFailure(reason)) {
            setError('Rakit server is unavailable. Reconnect before unlocking the console.');
          }
        }
      });
    const handleUnauthorized = () => setPinOk(false);
    window.addEventListener('rakit:unauthorized', handleUnauthorized);
    return () => {
      cancelled = true;
      if (expiryTimerRef.current != null) window.clearTimeout(expiryTimerRef.current);
      window.removeEventListener('rakit:unauthorized', handleUnauthorized);
    };
    // Session bootstrap runs once; the expiry timer is refreshed after every successful login.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setPinOk]);

  useEffect(() => {
    if (!pinOk && expiryTimerRef.current != null) {
      window.clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
  }, [pinOk]);

  useEffect(() => {
    if (!pinOk) {
      const raf = requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [pinOk]);

  function handlePinFailure(message = "Wrong PIN. Try again.", visibleForMs = 1800) {
    setPin("");
    setError(message);
    requestAnimationFrame(() => inputRef.current?.focus());
    setTimeout(() => setError(null), visibleForMs);
  }

  async function submit() {
    if (pin.length < 4 || pin.length > 8) return;

    try {
      const res = await Api.verifyPin(pin);

      if (res.ok) {
        scheduleSessionExpiry(res);
        setPinOk(true);
        setPin("");
      } else {
        handlePinFailure();
      }
    } catch (reason) {
      if (isNetworkFailure(reason)) {
        handlePinFailure('Rakit server is unavailable. Reconnect and try again.', 4000);
      } else if (reason instanceof ApiError && reason.status === 429) {
        handlePinFailure(reason.message, 4000);
      } else if (reason instanceof ApiError && reason.status !== 401) {
        handlePinFailure('Unable to unlock Rakit. Try again.', 3000);
      } else {
        handlePinFailure();
      }
    }
  }

  return (
    <AnimatePresence>
      {!pinOk && (
        <motion.div
          className="rakit-pin-backdrop fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.form
            className={`rakit-pin-card layer-card compact w-full max-w-sm stack ${pin.length ? 'has-pin-value' : ''}`}
            initial={{ scale: 0.94, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 8 }}
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
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
                enterKeyHint="go"
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
              />
            </div>

            {error && <div className="feedback-badge err">{error}</div>}

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
                type="submit"
                className="btn px-6"
                disabled={pin.length < 4}
              >
                Enter
              </button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
