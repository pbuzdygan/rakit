import { useEffect } from 'react';
import { Api } from '../api';
import { useAppStore } from '../store';
import { selectReleaseForChannel } from '../versionInfo';

const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000;

// The application owns this lifecycle; opening Settings never starts another poller.
export function useVersionInfo(authenticated: boolean) {
  const version = useAppStore((s) => s.appVersion);
  const channel = useAppStore((s) => s.releaseChannel);
  const repo = useAppStore((s) => s.repoSlug);
  const metaStatus = useAppStore((s) => s.metaStatus);

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    useAppStore.setState({ metaStatus: 'loading' });
    void Api.meta().then((meta) => {
      if (cancelled) return;
      const state = useAppStore.getState();
      const version = meta?.version ?? null;
      state.setAppVersion(version);
      state.setReleaseChannel(meta?.channel || (/^dev/i.test(version ?? '') ? 'dev' : state.releaseChannel));
      if (meta?.timeZone) state.setTimeZone(meta.timeZone);
      useAppStore.setState({
        metaStatus: 'ready',
        ...(typeof meta?.repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(meta.repo) ? { repoSlug: meta.repo } : {}),
      });
    }).catch(() => {
      if (!cancelled) useAppStore.setState({ metaStatus: 'unavailable', releaseCheckStatus: 'unavailable' });
    });
    return () => { cancelled = true; };
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated || metaStatus !== 'ready') return;
    if (!version || version.toLowerCase() === 'dev') {
      useAppStore.setState({ releaseCheckStatus: 'development', latestVersion: null, updateAvailable: false });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const fetchLatest = async () => {
      useAppStore.setState({ releaseCheckStatus: 'checking' });
      try {
        const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=30`, {
          headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal,
        });
        if (!response.ok) throw new Error('Release check unavailable');
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error('Invalid release response');
        const release = selectReleaseForChannel(data, channel ?? 'main');
        if (cancelled) return;
        useAppStore.getState().setLatestVersion(release?.tag_name ?? null);
        useAppStore.setState({ releaseCheckStatus: release ? 'success' : 'no-release', releaseCheckedAt: new Date().toISOString() });
      } catch {
        if (!cancelled) useAppStore.setState({ releaseCheckStatus: 'unavailable' });
      }
    };
    void fetchLatest();
    const interval = window.setInterval(fetchLatest, POLL_INTERVAL_MS);
    return () => { cancelled = true; controller.abort(); window.clearInterval(interval); };
  }, [authenticated, metaStatus, version, channel, repo]);
}
