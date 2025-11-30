import { useEffect, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const DISMISS_KEY = 'rakit_pwa_prompt_dismissed_v1';

const isStandaloneMode = () => {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    // @ts-expect-error - iOS Safari exposes standalone property
    window.navigator?.standalone === true
  );
};

export function PwaInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const dismissed = window.localStorage.getItem(DISMISS_KEY) === '1';
    if (dismissed || isStandaloneMode()) return;

    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
      setVisible(true);
    };

    const handleInstalled = () => {
      try {
        window.localStorage.setItem(DISMISS_KEY, '1');
      } catch {
        // ignore write errors (private mode, etc.)
      }
      setPromptEvent(null);
      setVisible(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const hidePrompt = (persist: boolean) => {
    if (persist && typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(DISMISS_KEY, '1');
      } catch {
        // ignore write errors
      }
    }
    setVisible(false);
    setPromptEvent(null);
  };

  const onInstall = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === 'accepted') {
      hidePrompt(true);
    } else {
      hidePrompt(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="pwa-install-banner" role="dialog" aria-live="polite" aria-label="Instalacja aplikacji Rakit">
      <div className="pwa-install-banner__content">
        <p className="pwa-install-banner__title">Zainstaluj aplikację Rakit</p>
        <p className="pwa-install-banner__message">
          Dodaj konsolę do ekranu głównego, aby startowała szybciej i działała nawet przy gorszej sieci.
        </p>
      </div>
      <div className="pwa-install-banner__actions">
        <button
          className="pwa-install-banner__action pwa-install-banner__action--primary"
          onClick={onInstall}
          type="button"
        >
          Zainstaluj
        </button>
        <button
          className="pwa-install-banner__action pwa-install-banner__action--ghost"
          onClick={() => hidePrompt(true)}
          type="button"
        >
          Nie teraz
        </button>
      </div>
    </div>
  );
}
