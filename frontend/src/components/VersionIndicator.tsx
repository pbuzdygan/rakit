import { useAppStore } from '../store';

// Legacy header presentation. Metadata and polling are owned by App.
export function VersionIndicator({ compact = false }: { compact?: boolean }) {
  const { appVersion, latestVersion, updateAvailable, repoSlug } = useAppStore();
  return <a className={`version-indicator ${compact ? 'compact' : ''} ${updateAvailable ? 'update' : ''}`} href={`https://github.com/${repoSlug}/releases`} target="_blank" rel="noreferrer">
    {updateAvailable ? `Update available · ${latestVersion}` : appVersion ? `Build ${appVersion}` : 'Version unavailable'}
  </a>;
}
