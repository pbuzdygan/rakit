export type View = 'overview' | 'cabinet' | 'servers' | 'ipdash' | 'porthub' | 'wol' | 'audit';
export type OptionalModule = Exclude<View, 'overview' | 'audit'>;
export type ModuleVisibility = Record<OptionalModule, boolean>;

export const MODULES = [
  { id: 'cabinet', label: 'Racks', icon: 'rack' },
  { id: 'servers', label: 'Servers', icon: 'server' },
  { id: 'ipdash', label: 'IP Addressing', icon: 'network' },
  { id: 'porthub', label: 'Port Map', icon: 'ports' },
  { id: 'wol', label: 'Wake on LAN', icon: 'power' },
] as const;

export function normalizeModuleVisibility(value: unknown): ModuleVisibility {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(MODULES.map(({ id }) => [id, typeof input[id] === 'boolean' ? input[id] : true])) as ModuleVisibility;
}

export function isViewVisible(view: View, visibility: ModuleVisibility): boolean {
  return view === 'overview' || view === 'audit' || visibility[view] === true;
}

export function resolveVisibleView(view: View, visibility: ModuleVisibility): View {
  return isViewVisible(view, visibility) ? view : 'overview';
}
