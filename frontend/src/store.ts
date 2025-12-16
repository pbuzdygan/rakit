import { create } from 'zustand';

const DEFAULT_CHANNEL = (() => {
  const envChannel = (import.meta as any)?.env?.VITE_APP_CHANNEL;
  if (typeof envChannel === 'string' && envChannel.trim()) {
    return envChannel.trim();
  }
  return 'main';
})();
function load<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(k: string, v: any) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
}

type View = 'cabinet' | 'ipdash' | 'porthub';
type IpDashViewMode = 'table' | 'grid';
type ConnectionStatus = {
  text: string;
  status: 'idle' | 'pending' | 'active' | 'inactive' | 'local-offline';
};

const storedView = (() => {
  const value = load<string>('view', 'cabinet');
  if (value === 'ipdash' || value === 'scopes') return 'ipdash';
  if (value === 'porthub') return 'porthub';
  return 'cabinet';
})() as View;

type EditingDevice = {
  id: number;
  cabinetId: number;
  type: string;
  model?: string | null;
  heightU: number;
  portAware: boolean;
  numberOfPorts: number | null;
};

type State = {
  view: View;
  theme: 'light' | 'dark';
  pinSession: boolean;
  ipDashViewMode: IpDashViewMode;
  ipDashRefreshToken: number;
  ipDashProfileModalOpen: boolean;
  ipDashConnectionStatus: ConnectionStatus;
  ipDashActiveProfileId: number | null;
  appVersion: string | null;
  latestVersion: string | null;
  releaseChannel: string | null;
  updateAvailable: boolean;
  modals: {
    export: boolean;
    settings: boolean;
    addCabinet: boolean;
    addDevice: boolean;
    comment: { open: boolean; deviceId: number | null; cabinetId: number | null; value: string };
  };
  selectedCabinetId: number | null;
  editingDevice: EditingDevice | null;
  editingCabinetId: number | null;
  setView: (view: View) => void;
  setTheme: (m: 'light' | 'dark') => void;
  setPinSession: (ok: boolean) => void;
  setIpDashViewMode: (mode: IpDashViewMode) => void;
  triggerIpDashRefresh: () => void;
  openIpDashProfileModal: () => void;
  closeIpDashProfileModal: () => void;
  setIpDashActiveProfileId: (id: number | null) => void;
  setIpDashConnectionStatus: (status: ConnectionStatus) => void;
  setSelectedCabinetId: (id: number | null) => void;
  setEditingCabinetId: (id: number | null) => void;
  setEditingDevice: (device: EditingDevice | null) => void;
  openModal: (k: keyof State['modals']) => void;
  closeModal: (k: keyof State['modals']) => void;
  openCommentModal: (deviceId: number, cabinetId: number, value: string) => void;
  closeCommentModal: () => void;
  setAppVersion: (version: string | null) => void;
  setLatestVersion: (version: string | null) => void;
  setReleaseChannel: (channel: string | null) => void;
};

export const useAppStore = create<State>((set, get) => ({
  view: storedView,
  theme: load<'light' | 'dark'>('theme', 'light'),
  pinSession: false,
  ipDashViewMode: load<IpDashViewMode>('ipdash-view-mode', 'table'),
  ipDashRefreshToken: 0,
  ipDashProfileModalOpen: false,
  ipDashConnectionStatus: { text: '', status: 'idle' },
  ipDashActiveProfileId: load<number | null>('ipdash-profile', null),
  appVersion: null,
  latestVersion: null,
  releaseChannel: DEFAULT_CHANNEL,
  updateAvailable: false,
  modals: {
    export: false,
    settings: false,
    addCabinet: false,
    addDevice: false,
    comment: { open: false, deviceId: null, cabinetId: null, value: '' },
  },
  selectedCabinetId: load<number | null>('cabinet', null),
  editingDevice: null,
  editingCabinetId: null,

  setView: (view) => {
    save('view', view);
    set({ view });
  },

  setTheme: (theme) => {
    save('theme', theme);
    set({ theme });
  },

  setPinSession: (pinSession) => set({ pinSession }),

  setIpDashViewMode: (mode) => {
    save('ipdash-view-mode', mode);
    set({ ipDashViewMode: mode });
  },

  triggerIpDashRefresh: () =>
    set({
      ipDashRefreshToken: get().ipDashRefreshToken + 1,
    }),

  openIpDashProfileModal: () => set({ ipDashProfileModalOpen: true }),
  closeIpDashProfileModal: () => set({ ipDashProfileModalOpen: false }),

  setIpDashActiveProfileId: (id) => {
    save('ipdash-profile', id);
    set({ ipDashActiveProfileId: id });
  },

  setIpDashConnectionStatus: (status) => set({ ipDashConnectionStatus: status }),

  setSelectedCabinetId: (selectedCabinetId) => {
    save('cabinet', selectedCabinetId);
    set({ selectedCabinetId });
  },

  setEditingCabinetId: (editingCabinetId) => set({ editingCabinetId }),

  setEditingDevice: (editingDevice) => set({ editingDevice }),

  openModal: (k) =>
    set({
      modals: {
        ...get().modals,
        [k]: true,
      },
    }),

  closeModal: (k) =>
    set({
      modals: {
        ...get().modals,
        [k]: false,
      },
    }),

  openCommentModal: (deviceId, cabinetId, value) =>
    set({
      modals: { ...get().modals, comment: { open: true, deviceId, cabinetId, value } },
    }),

  closeCommentModal: () =>
    set({
      modals: { ...get().modals, comment: { open: false, deviceId: null, cabinetId: null, value: '' } },
    }),
  setAppVersion: (version) =>
    set((state) => ({
      appVersion: version,
      updateAvailable: compareVersions(version, state.latestVersion) < 0,
    })),
  setLatestVersion: (version) =>
    set((state) => ({
      latestVersion: version,
      updateAvailable: compareVersions(state.appVersion, version) < 0,
    })),
  setReleaseChannel: (channel) =>
    set((state) => {
      const normalized = channel ?? 'main';
      if (state.releaseChannel === normalized) return {};
      return { releaseChannel: normalized, latestVersion: null, updateAvailable: false };
    }),
}));

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
