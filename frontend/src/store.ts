import { create } from 'zustand';
import { compareVersions } from './versionInfo.ts';
export { compareVersions } from './versionInfo.ts';
import { normalizeModuleVisibility, resolveVisibleView, type View, type OptionalModule, type ModuleVisibility } from './modules.ts';
export type { View } from './modules.ts';

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

const storedModuleVisibility = normalizeModuleVisibility(load<unknown>('ops-module-visibility', null));
type IpDashViewMode = 'table' | 'grid';
type ConnectionStatus = {
  text: string;
  status: 'idle' | 'pending' | 'active' | 'inactive' | 'local-offline';
};

const storedView = (() => {
  const value = load<string>('view', 'cabinet');
  if (value === 'ipdash' || value === 'scopes') return 'ipdash';
  if (value === 'overview' || value === 'servers' || value === 'porthub' || value === 'wol' || value === 'audit') return value;
  return 'cabinet';
})() as View;

type EditingDevice = {
  id: number;
  cabinetId: number;
  type: string;
  model?: string | null;
  heightU: number;
  position: number;
  portAware: boolean;
  numberOfPorts: number | null;
  portsPerRow?: number | null;
  managementIp?: string | null;
  assetTag?: string | null;
  status?: string | null;
  face?: string | null;
  rackLane?: string | null;
};

type State = {
  view: View;
  moduleVisibility: ModuleVisibility;
  setModuleVisible: (module: OptionalModule, visible: boolean) => void;
  resetModuleVisibility: () => void;
  repoSlug: string;
  releaseCheckStatus: 'idle' | 'checking' | 'success' | 'unavailable' | 'no-release' | 'development';
  releaseCheckedAt: string | null;
  metaStatus: 'loading' | 'ready' | 'unavailable';
  theme: 'light' | 'dark';
  sidebarCollapsed: boolean;
  pinSession: boolean;
  ipDashViewMode: IpDashViewMode;
  ipDashRefreshToken: number;
  ipDashProfileModalOpen: boolean;
  ipDashConnectionStatus: ConnectionStatus;
  ipDashActiveProfileId: number | null;
  appVersion: string | null;
  latestVersion: string | null;
  releaseChannel: string | null;
  timeZone: string;
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
  toggleSidebar: () => void;
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
  setTimeZone: (timeZone: string) => void;
};

export const useAppStore = create<State>((set, get) => ({
  view: resolveVisibleView(storedView, storedModuleVisibility),
  moduleVisibility: storedModuleVisibility,
  repoSlug: (import.meta as any)?.env?.VITE_GITHUB_REPO || 'buzuser/rakit_dev',
  releaseCheckStatus: 'idle',
  releaseCheckedAt: null,
  metaStatus: 'loading',
  setModuleVisible: (module, visible) => {
    const moduleVisibility = { ...get().moduleVisibility, [module]: visible };
    const view = resolveVisibleView(get().view, moduleVisibility);
    save('ops-module-visibility', moduleVisibility);
    save('view', view);
    set({ moduleVisibility, view });
  },
  resetModuleVisibility: () => {
    const moduleVisibility = normalizeModuleVisibility(null);
    save('ops-module-visibility', moduleVisibility);
    set({ moduleVisibility });
  },
  theme: load<'light' | 'dark'>('theme', 'dark'),
  sidebarCollapsed: load<boolean>('ops-sidebar-collapsed', false),
  pinSession: false,
  ipDashViewMode: load<IpDashViewMode>('ipdash-view-mode', 'table'),
  ipDashRefreshToken: 0,
  ipDashProfileModalOpen: false,
  ipDashConnectionStatus: { text: '', status: 'idle' },
  ipDashActiveProfileId: load<number | null>('ipdash-profile', null),
  appVersion: null,
  latestVersion: null,
  releaseChannel: DEFAULT_CHANNEL,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
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
    const nextView = resolveVisibleView(view, get().moduleVisibility);
    save('view', nextView);
    set({ view: nextView });
  },

  setTheme: (theme) => {
    save('theme', theme);
    set({ theme });
  },

  toggleSidebar: () =>
    set((state) => {
      const sidebarCollapsed = !state.sidebarCollapsed;
      save('ops-sidebar-collapsed', sidebarCollapsed);
      return { sidebarCollapsed };
    }),

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
  setTimeZone: (timeZone) => set({ timeZone: timeZone || 'UTC' }),
}));
