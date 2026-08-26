import { useEffect, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type InstallMode = 'native' | 'ios' | 'insecure' | null;

const DISMISS_KEY = 'rakit_pwa_prompt_dismissed_v2';
const DISMISS_FOR_MS = 30 * 24 * 60 * 60 * 1000;

const isStandaloneMode = () => {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    // @ts-expect-error - iOS Safari exposes the non-standard standalone property.
    window.navigator?.standalone === true
  );
};

const isIosDevice = () => {
  if (typeof navigator === 'undefined') return false;
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
};

const wasRecentlyDismissed = () => {
  try {
    const value = Number(window.localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(value) && value > 0 && Date.now() - value < DISMISS_FOR_MS;
  } catch {
    return false;
  }
};

export function PwaInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installMode, setInstallMode] = useState<InstallMode>(null);
  const [updateRegistration, setUpdateRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [applyingUpdate, setApplyingUpdate] = useState(false);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const handleUpdateReady = (event: Event) => {
      const registration = (event as CustomEvent<ServiceWorkerRegistration>).detail;
      if (registration?.waiting) setUpdateRegistration(registration);
    };
    window.addEventListener('rakit:pwa-update-ready', handleUpdateReady);
    return () => window.removeEventListener('rakit:pwa-update-ready', handleUpdateReady);
  }, []);

  useEffect(() => {
    if (isStandaloneMode() || wasRecentlyDismissed()) return;

    if (!window.isSecureContext) {
      setInstallMode('insecure');
      return;
    }

    if (isIosDevice()) setInstallMode('ios');

    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
      setInstallMode('native');
    };

    const handleInstalled = () => dismissInstallPrompt();

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  // Installability is evaluated once for the current browser session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismissInstallPrompt = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Ignore write errors in private browsing modes.
    }
    setPromptEvent(null);
    setInstallMode(null);
  };

  const onInstall = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === 'accepted') dismissInstallPrompt();
  };

  const onApplyUpdate = () => {
    if (applyingUpdate) return;
    const worker = updateRegistration?.waiting;
    if (!worker) {
      setUpdateRegistration(null);
      return;
    }
    setApplyingUpdate(true);
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => window.location.reload(),
      { once: true }
    );
    worker.postMessage({ type: 'SKIP_WAITING' });
  };

  if (!online) {
    return (
      <div className="pwa-install-banner pwa-install-banner--status" role="status" aria-live="polite">
        <span className="pwa-install-banner__status-dot" aria-hidden="true" />
        <div className="pwa-install-banner__content">
          <p className="pwa-install-banner__title">Rakit is offline</p>
          <p className="pwa-install-banner__message">
            The app shell remains available, but server data, PIN sessions and actions require a connection.
          </p>
        </div>
      </div>
    );
  }

  if (updateRegistration) {
    return (
      <div className="pwa-install-banner" role="dialog" aria-live="polite" aria-label="Rakit update available">
        <div className="pwa-install-banner__logo">
          <img src="/icon-128x128.png" alt="" />
        </div>
        <div className="pwa-install-banner__content">
          <p className="pwa-install-banner__title">Rakit update is ready</p>
          <p className="pwa-install-banner__message">Reload when convenient to use the newest interface.</p>
        </div>
        <div className="pwa-install-banner__actions">
          <button
            className="pwa-install-banner__action pwa-install-banner__action--ghost"
            onClick={() => setUpdateRegistration(null)}
            type="button"
            disabled={applyingUpdate}
          >
            Later
          </button>
          <button
            className="pwa-install-banner__action pwa-install-banner__action--primary"
            onClick={onApplyUpdate}
            type="button"
            disabled={applyingUpdate}
          >
            {applyingUpdate ? 'Updating…' : 'Reload'}
          </button>
        </div>
      </div>
    );
  }

  if (!installMode) return null;

  const content = installMode === 'insecure'
    ? {
        title: 'HTTPS is required to install Rakit',
        message: 'Open Rakit through an HTTPS address. A plain HTTP address on your LAN cannot register a PWA.',
      }
    : installMode === 'ios'
      ? {
          title: 'Add Rakit to your Home Screen',
          message: 'In Safari, open Share and choose “Add to Home Screen”.',
        }
      : {
          title: 'Install Rakit',
          message: 'Open the Operations Console in its own window with faster access from your device.',
        };

  return (
    <div className="pwa-install-banner" role="dialog" aria-live="polite" aria-label="Install Rakit app">
      <div className="pwa-install-banner__logo">
        <img src="/icon-128x128.png" alt="" />
      </div>
      <div className="pwa-install-banner__content">
        <p className="pwa-install-banner__title">{content.title}</p>
        <p className="pwa-install-banner__message">{content.message}</p>
      </div>
      <div className="pwa-install-banner__actions">
        <button
          className="pwa-install-banner__action pwa-install-banner__action--ghost"
          onClick={dismissInstallPrompt}
          type="button"
        >
          {installMode === 'native' ? 'Later' : 'Dismiss'}
        </button>
        {installMode === 'native' ? (
          <button
            className="pwa-install-banner__action pwa-install-banner__action--primary"
            onClick={onInstall}
            type="button"
          >
            Install
          </button>
        ) : null}
      </div>
    </div>
  );
}
