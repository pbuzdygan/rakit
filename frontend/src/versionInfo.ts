export function compareVersions(a?: string | null, b?: string | null) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  const partsA = normalizeVersion(a);
  const partsB = normalizeVersion(b);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i += 1) {
    const rawA = partsA[i] ?? '0';
    const rawB = partsB[i] ?? '0';
    const numA = Number(rawA);
    const numB = Number(rawB);
    const isNumA = Number.isFinite(numA);
    const isNumB = Number.isFinite(numB);
    if (isNumA && isNumB) {
      if (numA > numB) return 1;
      if (numA < numB) return -1;
      continue;
    }
    if (isNumA && !isNumB) return 1;
    if (!isNumA && isNumB) return -1;
    const cmp = rawA.localeCompare(rawB, undefined, { sensitivity: 'base' });
    if (cmp !== 0) return cmp > 0 ? 1 : -1;
  }
  return 0;
}

function normalizeVersion(value: string) {
  return value
    .trim()
    .replace(/^v/i, '')
    .split(/[^0-9A-Za-z]+/)
    .filter(Boolean);
}

export type GitHubRelease = {
  tag_name?: string | null;
  name?: string | null;
  target_commitish?: string | null;
  draft?: boolean;
  prerelease?: boolean;
};

export function selectReleaseForChannel(releases: GitHubRelease[], channel: string) {
  const dev = channel.toLowerCase() === 'dev';
  const candidates = releases.filter((release) => {
    if (!release || release.draft || !release.tag_name) return false;
    const isDev = /^dev/i.test(release.tag_name) || /^dev/i.test(release.name ?? '') || release.target_commitish?.toLowerCase() === 'dev';
    return dev ? isDev : !isDev && !release.prerelease;
  });
  candidates.sort((a, b) => compareVersions(b.tag_name, a.tag_name));
  return candidates[0] ?? null;
}
