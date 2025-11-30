import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Api } from '../../api';
import { useAppStore } from '../../store';
import { SoftButton } from '../SoftButton';
import { Surface } from '../Surface';
import { ModalBase } from '../modals/ModalBase';
import {
  DEFAULT_IPDASH_FILTERS as DEFAULT_FILTERS,
  IPDASH_FILTER_STORAGE_KEY as FILTER_STORAGE_KEY,
  IPDASH_GROUP_OPTIONS as GROUP_OPTIONS,
  IPDASH_GROUP_STORAGE_KEY as GROUP_STORAGE_KEY,
  IPDASH_NETWORK_INDEX_STORAGE_KEY as NETWORK_INDEX_STORAGE_KEY,
  IPDASH_TAG_STORAGE_KEY as TAG_STORAGE_KEY,
} from '../../constants/ipdash';

type Profile = {
  id: number;
  name: string;
  location?: string | null;
  host: string;
  mode: 'proxy' | 'direct' | 'local-offline';
  siteId?: string | null;
};

type UnifiNetwork = {
  _id: string;
  name?: string;
  ip_subnet?: string;
  scope_id?: number;
};

type UnifiClient = {
  _id?: string;
  name?: string;
  hostname?: string;
  fixed_ip?: string;
  ip?: string;
  last_ip?: string;
  last_known_ip?: string;
  noted_ip?: string;
  primary_ip?: string;
  ipv4?: string;
  remote_ip?: string;
  tunnel_ip?: string;
  mac?: string;
  last_seen?: number;
  scope_id?: number;
  config_networks?: Record<string, { ip?: string | null; ipaddr?: string | null } | null> | null;
  network_table?: Array<{ ip?: string | null }>;
};

type OnlineDevice = {
  mac?: string;
  ip?: string;
  ipv4?: string;
  primary_ip?: string;
  tunnel_ip?: string;
  remote_ip?: string;
  last_ip?: string;
  last_known_ip?: string;
  noted_ip?: string;
  name?: string;
  hostname?: string;
  last_seen?: number;
  networks?: Array<{ ip?: string | null }>;
  uplink?: { remote_ip?: string | null } | null;
  config_networks?: Record<string, { ip?: string | null; ipaddr?: string | null } | null> | null;
  clientType?: string | null;
  _integration?: boolean;
};

type DashboardResponse = {
  status: 'active' | 'inactive' | 'missing-profile' | 'local-offline';
  profile: Profile | null;
  users: UnifiClient[];
  online: OnlineDevice[];
  networks: UnifiNetwork[];
  error?: string;
  offlineScopes?: OfflineScope[];
  controllerIp?: string | null;
};

type OfflineScope = {
  id: number;
  profileId: number;
  cidr: string;
  label?: string | null;
};

type OfflineHost = {
  id: number;
  scope_id: number;
  ip: string;
  name?: string | null;
  hostname?: string | null;
  mac?: string | null;
};

type ParsedNetwork = {
  id: string;
  name: string;
  ipSubnet: string;
  cidr: number;
  firstHostInt: number;
  lastHostInt: number;
  hostCount: number;
  scopeId?: number | null;
};

type HostEntry = {
  ip: string;
  device: UnifiClient | null;
  hostId?: number | null;
};

type GroupEntry = {
  key: string;
  label: string | null;
  tagKey: string;
  order: number;
  hosts: HostEntry[];
};

type Filters = typeof DEFAULT_FILTERS;

function usePersistentState<T>(key: string, defaultValue: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const update = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  return [value, update];
}

export function IpDashView() {
  const refreshToken = useAppStore((s) => s.ipDashRefreshToken);
  const activeProfileId = useAppStore((s) => s.ipDashActiveProfileId);
  const setActiveProfileId = useAppStore((s) => s.setIpDashActiveProfileId);
  const ipDashViewMode = useAppStore((s) => s.ipDashViewMode);
  const setConnectionStatus = useAppStore((s) => s.setIpDashConnectionStatus);
  const openProfileModal = useAppStore((s) => s.openIpDashProfileModal);
  const triggerIpDashRefresh = useAppStore((s) => s.triggerIpDashRefresh);

  const [filters, setFilters] = usePersistentState<Filters>(FILTER_STORAGE_KEY, DEFAULT_FILTERS);
  const [groupBy, setGroupBy] = usePersistentState<string>(GROUP_STORAGE_KEY, 'none');
  const [groupTags, setGroupTags] = usePersistentState<Record<string, string>>(TAG_STORAGE_KEY, {});
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const groupMenuRef = useRef<HTMLDivElement | null>(null);
  const [activeNetworkIndex, setActiveNetworkIndex] = usePersistentState<number>(NETWORK_INDEX_STORAGE_KEY, 0);
  const [tagEditor, setTagEditor] = useState<{ key: string; rangeLabel: string } | null>(null);
  const [hostDetails, setHostDetails] = useState<HostEntry | null>(null);
  const [addScopeOpen, setAddScopeOpen] = useState(false);
  const [addIpOpen, setAddIpOpen] = useState(false);
  const [scopeRemovalMode, setScopeRemovalMode] = useState(false);
  const [selectedScopeIds, setSelectedScopeIds] = useState<number[]>([]);
  const [actionStatus, setActionStatus] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [removingScopes, setRemovingScopes] = useState(false);
  const [hostRemovalMode, setHostRemovalMode] = useState(false);
  const [selectedHostIds, setSelectedHostIds] = useState<number[]>([]);
  const [removingHosts, setRemovingHosts] = useState(false);

  useEffect(() => {
    if (!actionStatus) return;
    const timer = setTimeout(() => setActionStatus(null), 3000);
    return () => clearTimeout(timer);
  }, [actionStatus]);

  useEffect(() => {
    if (hostRemovalMode) {
      setSelectedHostIds([]);
    }
  }, [activeNetworkIndex, hostRemovalMode]);

  const profilesQuery = useQuery({ queryKey: ['ipdash-profiles'], queryFn: Api.ipdash.profiles.list });
  const profiles = (profilesQuery.data?.profiles ?? []) as Profile[];

  useEffect(() => {
    if (!profiles.length) return;
    if (!activeProfileId || !profiles.some((profile) => profile.id === activeProfileId)) {
      setActiveProfileId(profiles[0].id);
    }
  }, [profiles, activeProfileId, setActiveProfileId]);

  const queryClient = useQueryClient();
  const dataQuery = useQuery({
    queryKey: ['ipdash-data', activeProfileId ?? 'none', refreshToken],
    queryFn: () => Api.ipdash.data(activeProfileId ?? undefined),
    enabled: Boolean(activeProfileId),
    refetchOnWindowFocus: false,
  });
  const offlineDataKey = ['ipdash-data', activeProfileId ?? 'none', refreshToken];

  const patchOfflineSnapshot = (updater: (snapshot: DashboardResponse) => DashboardResponse) => {
    queryClient.setQueryData(offlineDataKey, (prev: DashboardResponse | undefined) => {
      if (!prev || prev.profile?.mode !== 'local-offline') return prev;
      return updater(prev);
    });
  };

  const mapScopeToNetwork = (scope: OfflineScope) => ({
    _id: `offline-scope-${scope.id}`,
    name: scope.label || scope.cidr,
    ip_subnet: scope.cidr,
    scope_id: scope.id,
  });

  const mapHostToUser = (host: OfflineHost) => ({
    _id: `offline-host-${host.id}`,
    name: host.name || host.hostname || '',
    hostname: host.hostname || '',
    mac: host.mac || '',
    fixed_ip: host.ip,
    scope_id: host.scope_id,
  });

  const dashboard = (dataQuery.data ?? null) as DashboardResponse | null;
  const offlineMode = dashboard?.profile?.mode === 'local-offline';
  const offlineScopes = dashboard?.offlineScopes ?? [];
  const controllerIp = dashboard?.controllerIp ?? null;
  const controllerName = dashboard?.profile?.name ?? null;
  const controllerHost = dashboard?.profile?.host ?? null;

  useEffect(() => {
    const profile = profiles.find((p) => p.id === activeProfileId) || null;
    if (!profile) {
      setConnectionStatus({
        text: profiles.length ? 'Select a profile to connect.' : 'No profiles configured.',
        status: 'idle',
      });
      return;
    }
    const locationText = profile.location ? ` (${profile.location})` : '';
    if (profile.mode === 'local-offline') {
      setConnectionStatus({
        text: `Connected: ${profile.name}${locationText}`,
        status: 'local-offline',
      });
      return;
    }
    let status: 'idle' | 'pending' | 'active' | 'inactive' | 'local-offline' = 'pending';
    if (dashboard?.status === 'active') status = 'active';
    else if (dashboard?.status === 'inactive') status = 'inactive';
    else if (!dashboard && dataQuery.isFetching) status = 'pending';
    else if (!dataQuery.isFetching) status = 'inactive';
    const message = dashboard?.error ? ` – ${dashboard.error}` : '';
    setConnectionStatus({
      text: `Connected: ${profile.name}${locationText}${message}`,
      status,
    });
  }, [profiles, activeProfileId, dashboard, dataQuery.isFetching, setConnectionStatus]);

  useEffect(() => {
    if (!groupMenuOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (groupMenuRef.current && !groupMenuRef.current.contains(event.target as Node)) {
        setGroupMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [groupMenuOpen]);

  const networks = useMemo(() => parseNetworks(dashboard?.networks ?? []), [dashboard?.networks]);
  useEffect(() => {
    if (activeNetworkIndex >= networks.length) setActiveNetworkIndex(0);
  }, [networks, activeNetworkIndex]);
  const activeNetwork = networks[activeNetworkIndex] ?? null;
  useEffect(() => {
    if (!offlineMode || offlineScopes.length === 0) {
      setScopeRemovalMode(false);
      setSelectedScopeIds([]);
      if (!offlineMode) setActionStatus(null);
    }
    if (!offlineMode) {
      setHostRemovalMode(false);
      setSelectedHostIds([]);
    }
  }, [offlineMode, offlineScopes.length]);

  useEffect(() => {
    setActionStatus(null);
    setScopeRemovalMode(false);
    setSelectedScopeIds([]);
  }, [activeProfileId]);

  useEffect(() => {
    if (offlineMode && filters.showOnline) {
      setFilters({ ...filters, showOnline: false });
    }
  }, [offlineMode, filters.showOnline, setFilters]);

  const reservationUsers = dashboard?.users ?? [];
  const onlineDevices = dashboard?.online ?? [];
  const usersByIp = useMemo(() => {
    const map = indexUsersByIp(reservationUsers);
    mergeOnlineDevices(map, onlineDevices);
    if (controllerIp && !map.has(controllerIp)) {
      map.set(controllerIp, {
        _id: 'controller-host',
        name: controllerName ? `${controllerName} controller` : 'Controller host',
        hostname: controllerHost || 'Controller host',
        ip: controllerIp,
        fixed_ip: controllerIp,
        last_seen: Math.floor(Date.now() / 1000),
      });
    }
    return map;
  }, [reservationUsers, onlineDevices, controllerIp, controllerName, controllerHost]);

  const onlineSet = useMemo(() => buildOnlineMacSet(onlineDevices), [onlineDevices]);

  const hostEntries = useMemo(() => {
    if (!activeNetwork) return [];
    return getHostsForRendering(activeNetwork, usersByIp, filters, onlineSet, offlineMode);
  }, [activeNetwork, usersByIp, filters, onlineSet, offlineMode]);

  const groupedEntries = useMemo(() => getGroupedEntries(hostEntries, groupBy, groupTags), [hostEntries, groupBy, groupTags]);

  const summary = useMemo(() => {
    if (!activeNetwork) {
      return null;
    }
    return buildSummaryStats(activeNetwork, reservationUsers, usersByIp, onlineSet);
  }, [activeNetwork, reservationUsers, usersByIp, onlineSet]);

  const manualProfileId = offlineMode ? activeProfileId : null;
  const canManageOffline = Boolean(offlineMode && manualProfileId);
  const canAddIp = canManageOffline && offlineScopes.length > 0;
  const removalButtonLabel =
    !scopeRemovalMode ? 'Remove IP Scope' : selectedScopeIds.length > 0 ? 'Confirm' : 'Remove IP Scope';
  const hostRemovalButtonLabel =
    !hostRemovalMode ? 'Remove IP' : selectedHostIds.length > 0 ? 'Confirm' : 'Remove IP';
  type InlineNotice = { tone: 'success' | 'error' | 'warning'; text: string };
  const inlineNotice: InlineNotice | null =
    scopeRemovalMode && offlineMode
      ? { tone: 'warning', text: 'Select scopes above, then confirm to remove them.' }
      : hostRemovalMode && offlineMode
      ? { tone: 'warning', text: 'Select IPs above, then confirm to remove them.' }
      : actionStatus;

  const toggleScopeSelection = (scopeId: number) => {
    setSelectedScopeIds((prev) => (prev.includes(scopeId) ? prev.filter((id) => id !== scopeId) : [...prev, scopeId]));
  };

  const toggleHostSelection = (hostId: number) => {
    setSelectedHostIds((prev) => (prev.includes(hostId) ? prev.filter((id) => id !== hostId) : [...prev, hostId]));
  };

  const handleRemoveScopeClick = async () => {
    if (!scopeRemovalMode) {
      setScopeRemovalMode(true);
      setSelectedScopeIds([]);
      setHostRemovalMode(false);
      setSelectedHostIds([]);
      setActionStatus(null);
      return;
    }
    if (!selectedScopeIds.length || !offlineScopes.length) {
      setScopeRemovalMode(false);
      setSelectedScopeIds([]);
      return;
    }
    setRemovingScopes(true);
    try {
      await Promise.all(selectedScopeIds.map((scopeId) => Api.ipdash.offline.removeScope(scopeId)));
      setActionStatus({ tone: 'success', text: 'IP scopes removed successfully.' });
      patchOfflineSnapshot((prev) => {
        const removals = new Set(selectedScopeIds);
        const nextScopes = (prev.offlineScopes || []).filter((scope) => !removals.has(scope.id));
        const nextNetworks = (prev.networks || []).filter((network) => !network.scope_id || !removals.has(network.scope_id));
        const nextUsers = (prev.users || []).filter((user) => !user.scope_id || !removals.has(user.scope_id));
        return { ...prev, offlineScopes: nextScopes, networks: nextNetworks, users: nextUsers };
      });
      triggerIpDashRefresh();
      await queryClient.invalidateQueries({ queryKey: ['ipdash-data'], exact: false });
    } catch (err: any) {
      setActionStatus({ tone: 'error', text: err?.message || 'Failed to remove scopes.' });
    } finally {
      setRemovingScopes(false);
      setScopeRemovalMode(false);
      setSelectedScopeIds([]);
    }
  };

  const handleRemoveHostsClick = async () => {
    if (!hostRemovalMode) {
      setHostRemovalMode(true);
      setSelectedHostIds([]);
      setScopeRemovalMode(false);
      setSelectedScopeIds([]);
      setActionStatus(null);
      return;
    }
    if (!selectedHostIds.length) {
      setHostRemovalMode(false);
      setSelectedHostIds([]);
      return;
    }
    setRemovingHosts(true);
    const ids = [...selectedHostIds];
    try {
      await Promise.all(ids.map((hostId) => Api.ipdash.offline.removeIp(hostId)));
      setActionStatus({ tone: 'success', text: 'IPs removed successfully.' });
      patchOfflineSnapshot((prev) => {
        const removals = new Set(ids.map((id) => `offline-host-${id}`));
        const nextUsers = (prev.users || []).filter((user) => !removals.has(user._id || ''));
        return { ...prev, users: nextUsers };
      });
      triggerIpDashRefresh();
      await queryClient.invalidateQueries({ queryKey: ['ipdash-data'], exact: false });
    } catch (err: any) {
      setActionStatus({ tone: 'error', text: err?.message || 'Failed to remove IPs.' });
    } finally {
      setRemovingHosts(false);
      setHostRemovalMode(false);
      setSelectedHostIds([]);
    }
  };

  const handleScopeAdded = ({ message, scope }: { message: string; scope: OfflineScope }) => {
    setAddScopeOpen(false);
    setActionStatus({ tone: 'success', text: message });
    patchOfflineSnapshot((prev) => {
      const nextScopes = [...(prev.offlineScopes || []), scope];
      const filteredNetworks = (prev.networks || []).filter((network) => network.scope_id !== scope.id);
      return {
        ...prev,
        offlineScopes: nextScopes,
        networks: [...filteredNetworks, mapScopeToNetwork(scope)],
      };
    });
    triggerIpDashRefresh();
    queryClient.invalidateQueries({ queryKey: ['ipdash-data'], exact: false });
  };

  const handleIpAdded = ({ message, host }: { message: string; host: OfflineHost }) => {
    setAddIpOpen(false);
    setActionStatus({ tone: 'success', text: message });
    patchOfflineSnapshot((prev) => {
      const nextUsers = [...(prev.users || []), mapHostToUser(host)];
      return { ...prev, users: nextUsers };
    });
    triggerIpDashRefresh();
    queryClient.invalidateQueries({ queryKey: ['ipdash-data'], exact: false });
  };

  const handleOfflineHostRemoved = (hostId: number) => {
    setActionStatus({ tone: 'success', text: 'IP removed successfully.' });
    setSelectedHostIds((prev) => prev.filter((id) => id !== hostId));
    patchOfflineSnapshot((prev) => {
      const nextUsers = (prev.users || []).filter((user) => user._id !== `offline-host-${hostId}`);
      return { ...prev, users: nextUsers };
    });
    triggerIpDashRefresh();
    queryClient.invalidateQueries({ queryKey: ['ipdash-data'], exact: false });
  };

  const statusMessage =
    dashboard?.status === 'inactive' && dashboard?.error ? dashboard.error : dataQuery.isError ? String(dataQuery.error) : '';

  if (!profiles.length) {
    return (
      <Surface className="stack gap-3">
        <h3 className="type-title-lg">Configure IP Dash</h3>
        <p className="type-body-sm text-textSec">
          Add at least one profile with the controller host and API key to start pulling reservations.
        </p>
        <SoftButton onClick={openProfileModal}>Add profile</SoftButton>
      </Surface>
    );
  }

  return (
    <div className="ipdash-view-root stack gap-4">
      <Surface variant="panel" className="ipdash-control-card stack gap-4">
        <div className="ipdash-switcher">
          {networks.length === 0 && (
            <span className="type-body-sm text-textSec">
              {dataQuery.isFetching ? 'Loading networks…' : 'No networks detected on the controller.'}
            </span>
          )}
          {networks.map((network, index) => (
            <button
              key={network.id}
              type="button"
              className={`ipdash-switcher-btn ${index === activeNetworkIndex ? 'active' : ''} ${
                offlineMode && scopeRemovalMode && network.scopeId ? 'scope-removal-target' : ''
              } ${
                offlineMode && scopeRemovalMode && network.scopeId && selectedScopeIds.includes(network.scopeId)
                  ? 'scope-selected'
                  : ''
              }`}
              onClick={() => {
                if (offlineMode && scopeRemovalMode && network.scopeId) {
                  toggleScopeSelection(network.scopeId);
                  return;
                }
                setActiveNetworkIndex(index);
              }}
            >
              {network.name} ({network.ipSubnet})
            </button>
          ))}
        </div>

        <div className="ipdash-filter-row">
          <div className="ipdash-filter-left">
            <div className="ipdash-filter-group">
              <SoftButton
                className="ipdash-compact-btn"
                variant={filters.showOnline ? 'solid' : 'ghost'}
                onClick={() => toggleFilter('showOnline', filters, setFilters)}
                disabled={offlineMode}
                title={offlineMode ? 'Online detection unavailable in Local Offline mode' : undefined}
              >
                Online
              </SoftButton>
              <SoftButton
                className="ipdash-compact-btn"
                variant={filters.showReserved ? 'solid' : 'ghost'}
                onClick={() => toggleFilter('showReserved', filters, setFilters)}
              >
                Reserved
              </SoftButton>
              <SoftButton
                className="ipdash-compact-btn"
                variant={filters.hideEmpty ? 'solid' : 'ghost'}
                onClick={() => toggleFilter('hideEmpty', filters, setFilters)}
              >
                Hide empty
              </SoftButton>
              <div className="group-by-control" ref={groupMenuRef}>
                <button
                  type="button"
                  className="btn btn-toggle group-by-btn ipdash-compact-btn"
                  onClick={() => setGroupMenuOpen((open) => !open)}
                >
                  Group: {groupBy}
                </button>
                {groupMenuOpen && (
                  <div className="group-by-menu">
                    {GROUP_OPTIONS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={`btn group-by-option ${option === groupBy ? 'active' : ''}`}
                        onClick={() => {
                          setGroupBy(option);
                          setGroupMenuOpen(false);
                        }}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="ipdash-summary">
              {summary ? (
                <>
                  Rezerwacje: {summary.reservations} • Online: {summary.online} • Used: {summary.used} • Usable:{' '}
                  {summary.usable} • Usage: {summary.usagePercent}%
                </>
              ) : (
                'Select a network to view reservations.'
              )}
            </div>
          </div>
          <div className="ipdash-control-side">
            <div className="ipdash-inline-notice-region">
              {inlineNotice && (
                <div className={`ipdash-inline-alert ${inlineNotice.tone} ipdash-inline-alert-inline`}>
                  {inlineNotice.text}
                </div>
              )}
            </div>
            {offlineMode && (
              <div className="ipdash-offline-actions">
                <div className="ipdash-offline-row">
                  <SoftButton
                    className="ipdash-compact-btn"
                    variant="ghost"
                    disabled={!canManageOffline}
                    onClick={() => setAddScopeOpen(true)}
                  >
                    Add IP Scope
                  </SoftButton>
                  <SoftButton
                    className={`ipdash-compact-btn ${scopeRemovalMode ? 'danger' : ''}`}
                    variant="ghost"
                    disabled={!offlineScopes.length || removingScopes}
                    onClick={handleRemoveScopeClick}
                  >
                    {removalButtonLabel}
                  </SoftButton>
                </div>
                <div className="ipdash-offline-row">
                  <SoftButton
                    className="ipdash-compact-btn"
                    variant="ghost"
                    disabled={!canAddIp}
                    onClick={() => setAddIpOpen(true)}
                  >
                    Add IP
                  </SoftButton>
                  <SoftButton
                    className={`ipdash-compact-btn ${hostRemovalMode ? 'danger' : ''}`}
                    variant="ghost"
                    disabled={removingHosts}
                    onClick={handleRemoveHostsClick}
                  >
                    {hostRemovalButtonLabel}
                  </SoftButton>
                </div>
              </div>
            )}
          </div>
        </div>

        {statusMessage && (
          <div className="ipdash-status-alert">
            <strong>Status:</strong> {statusMessage}
          </div>
        )}
      </Surface>

      {(!activeNetwork || hostEntries.length === 0) && (
        <Surface variant="panel" className="text-center text-textSec">
          {dataQuery.isFetching ? 'Loading reservations…' : 'No addresses available for the selected filters.'}
        </Surface>
      )}

      {activeNetwork && hostEntries.length > 0 && (
        <div className="ipdash-content">
          {ipDashViewMode === 'table' ? (
            <TableView
              entries={groupedEntries}
              onSelect={setHostDetails}
              groupTags={groupTags}
              onEditTag={setTagEditor}
              onlineSet={onlineSet}
              offlineMode={offlineMode}
              hostRemovalMode={hostRemovalMode}
              selectedHostIds={selectedHostIds}
              toggleHostSelection={toggleHostSelection}
            />
          ) : (
            <GridView
              entries={groupedEntries}
              onSelect={setHostDetails}
              groupTags={groupTags}
              onEditTag={setTagEditor}
              onlineSet={onlineSet}
              offlineMode={offlineMode}
              hostRemovalMode={hostRemovalMode}
              selectedHostIds={selectedHostIds}
              toggleHostSelection={toggleHostSelection}
            />
          )}
        </div>
      )}

      <AddScopeModal
        open={Boolean(addScopeOpen && canManageOffline)}
        profileId={manualProfileId}
        onClose={() => setAddScopeOpen(false)}
        onSuccess={handleScopeAdded}
      />

      <AddManualIpModal
        open={Boolean(addIpOpen && canManageOffline)}
        profileId={manualProfileId}
        scopes={offlineScopes}
        onClose={() => setAddIpOpen(false)}
        onSuccess={handleIpAdded}
        defaultScopeId={activeNetwork?.scopeId ?? null}
      />

      <TagModal
        editor={tagEditor}
        value={tagEditor ? groupTags[tagEditor.key] || '' : ''}
        onClose={() => setTagEditor(null)}
        onSave={(value) => {
          const next = { ...groupTags };
          if (value) {
            next[tagEditor!.key] = value;
          } else {
            delete next[tagEditor!.key];
          }
          setGroupTags(next);
          setTagEditor(null);
        }}
        onClear={() => {
          const next = { ...groupTags };
          if (tagEditor) delete next[tagEditor.key];
          setGroupTags(next);
          setTagEditor(null);
        }}
      />

      <HostModal
        entry={hostDetails}
        onClose={() => setHostDetails(null)}
        onlineSet={onlineSet}
        offlineMode={offlineMode}
        onRemoved={handleOfflineHostRemoved}
      />
    </div>
  );
}

type ViewProps = {
  entries: GroupEntry[];
  onSelect: (entry: HostEntry | null) => void;
  groupTags: Record<string, string>;
  onEditTag: (payload: { key: string; rangeLabel: string } | null) => void;
  onlineSet: Set<string>;
  offlineMode: boolean;
  hostRemovalMode: boolean;
  selectedHostIds: number[];
  toggleHostSelection: (hostId: number) => void;
};

function TableView({
  entries,
  onSelect,
  groupTags,
  onEditTag,
  onlineSet,
  offlineMode,
  hostRemovalMode,
  selectedHostIds,
  toggleHostSelection,
}: ViewProps) {
  if (entries.length === 1 && !entries[0].label) {
    return (
      <SimpleTable
        hosts={entries[0].hosts}
        onSelect={onSelect}
        onlineSet={onlineSet}
        offlineMode={offlineMode}
        hostRemovalMode={hostRemovalMode}
        selectedHostIds={selectedHostIds}
        toggleHostSelection={toggleHostSelection}
      />
    );
  }
  return (
    <div className="grouped-table-wrap">
      {entries.map((group) => (
        <div key={group.key} className="grouped-column">
          <div className="grouped-header">
            <span>{group.label}</span>
            <button
              type="button"
              className="group-tag-btn"
              onClick={() => onEditTag({ key: group.tagKey, rangeLabel: group.label || group.key })}
            >
              {groupTags[group.tagKey] || 'Add tag'}
            </button>
          </div>
          <div className="grouped-table-scroll">
            <SimpleTable
              hosts={group.hosts}
              onSelect={onSelect}
              onlineSet={onlineSet}
              offlineMode={offlineMode}
              hostRemovalMode={hostRemovalMode}
              selectedHostIds={selectedHostIds}
              toggleHostSelection={toggleHostSelection}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function SimpleTable({
  hosts,
  onSelect,
  onlineSet,
  offlineMode,
  hostRemovalMode,
  selectedHostIds,
  toggleHostSelection,
}: {
  hosts: HostEntry[];
  onSelect: (entry: HostEntry) => void;
  onlineSet: Set<string>;
  offlineMode: boolean;
  hostRemovalMode: boolean;
  selectedHostIds: number[];
  toggleHostSelection: (hostId: number) => void;
}) {
  return (
    <table className="ipdash-table">
      <thead>
        <tr>
          <th>IP</th>
          <th>Name</th>
          <th>Hostname</th>
          <th>MAC</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {hosts.map((entry) => {
          const online = entry.device ? isOnline(entry.device, onlineSet) : false;
          const hostId = entry.hostId ?? null;
          const selectable = Boolean(offlineMode && hostRemovalMode && hostId);
          const selected = selectable && selectedHostIds.includes(hostId!);
          const rowClass = [
            entry.device ? (online ? 'state-online' : 'state-offline') : 'state-empty',
            selectable ? 'host-removal-target' : '',
            selected ? 'host-removal-selected' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <tr
              key={entry.ip}
              className={rowClass}
              onClick={() => {
                if (selectable && hostId) toggleHostSelection(hostId);
                else if (entry.device) onSelect(entry);
              }}
            >
              <td>{entry.ip}</td>
              {entry.device ? (
                <>
                  <td>{entry.device.name || '(no name)'}</td>
                  <td>{entry.device.hostname || '—'}</td>
                  <td>{entry.device.mac || '—'}</td>
                  <td>{offlineMode ? '—' : online ? 'online' : 'reserved'}</td>
                </>
              ) : (
                <td colSpan={4} className="empty-cell">
                  —
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function GridView({
  entries,
  onSelect,
  groupTags,
  onEditTag,
  onlineSet,
  offlineMode,
  hostRemovalMode,
  selectedHostIds,
  toggleHostSelection,
}: ViewProps) {
  if (entries.length === 1 && !entries[0].label) {
    return (
      <SimpleGrid
        hosts={entries[0].hosts}
        onSelect={onSelect}
        onlineSet={onlineSet}
        offlineMode={offlineMode}
        hostRemovalMode={hostRemovalMode}
        selectedHostIds={selectedHostIds}
        toggleHostSelection={toggleHostSelection}
      />
    );
  }
  return (
    <div className="grouped-grid-wrap">
      {entries.map((group) => (
        <div key={group.key} className="grouped-column">
          <div className="grouped-header">
            <span>{group.label}</span>
            <button
              type="button"
              className="group-tag-btn"
              onClick={() => onEditTag({ key: group.tagKey, rangeLabel: group.label || group.key })}
            >
              {groupTags[group.tagKey] || 'Add tag'}
            </button>
          </div>
          <SimpleGrid
            hosts={group.hosts}
            onSelect={onSelect}
            onlineSet={onlineSet}
            offlineMode={offlineMode}
            hostRemovalMode={hostRemovalMode}
            selectedHostIds={selectedHostIds}
            toggleHostSelection={toggleHostSelection}
          />
        </div>
      ))}
    </div>
  );
}

function SimpleGrid({
  hosts,
  onSelect,
  onlineSet,
  offlineMode,
  hostRemovalMode,
  selectedHostIds,
  toggleHostSelection,
}: {
  hosts: HostEntry[];
  onSelect: (entry: HostEntry) => void;
  onlineSet: Set<string>;
  offlineMode: boolean;
  hostRemovalMode: boolean;
  selectedHostIds: number[];
  toggleHostSelection: (hostId: number) => void;
}) {
  return (
    <div className="ipdash-grid">
      {hosts.map((entry) => {
        const online = entry.device ? isOnline(entry.device, onlineSet) : false;
        const hostId = entry.hostId ?? null;
        const selectable = Boolean(offlineMode && hostRemovalMode && hostId);
        const selected = selectable && selectedHostIds.includes(hostId!);
        const tileClasses = [
          `ipdash-tile ${entry.device ? (online ? 'tile-online' : 'tile-offline') : 'tile-empty'}`,
          selectable ? 'host-removal-target' : '',
          selected ? 'host-removal-selected' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <button
            key={entry.ip}
            type="button"
            className={tileClasses}
            onClick={() => {
              if (selectable && hostId) toggleHostSelection(hostId);
              else if (entry.device) onSelect(entry);
            }}
          >
            <div className="tile-ip">{entry.ip}</div>
            <div className="tile-name">
              {entry.device ? entry.device.name || entry.device.hostname || '(unnamed)' : 'Available'}
            </div>
          </button>
        );
      })}
    </div>
  );
}

type TagModalProps = {
  editor: { key: string; rangeLabel: string } | null;
  value: string;
  onSave: (value: string) => void;
  onClear: () => void;
  onClose: () => void;
};

function TagModal({ editor, value, onSave, onClear, onClose }: TagModalProps) {
  const [input, setInput] = useState(value);

  useEffect(() => {
    setInput(value);
  }, [value]);

  return (
    <ModalBase open={Boolean(editor)} title={`Tag ${editor?.rangeLabel ?? ''}`} onClose={onClose} size="sm">
      <div className="stack gap-3">
        <input
          type="text"
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Add label"
        />
        <div className="flex justify-end gap-2">
          <SoftButton variant="ghost" onClick={onClose}>
            Cancel
          </SoftButton>
          <SoftButton variant="ghost" onClick={onClear}>
            Clear
          </SoftButton>
          <SoftButton onClick={() => onSave(input.trim())}>Save</SoftButton>
        </div>
      </div>
    </ModalBase>
  );
}

type HostModalProps = {
  entry: HostEntry | null;
  onClose: () => void;
  onlineSet: Set<string>;
  offlineMode: boolean;
  onRemoved?: (hostId: number) => void;
};

function HostModal({ entry, onClose, onlineSet, offlineMode, onRemoved }: HostModalProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) {
      setConfirmRemove(false);
      setRemoving(false);
      setRemoveError(null);
    }
  }, [entry]);

  if (!entry) return null;
  const device = entry.device;
  const online = device ? isOnline(device, onlineSet) : false;
  const hostId = offlineMode ? getOfflineHostId(device) : null;

  const handleRemoveClick = async () => {
    if (!offlineMode || !hostId) return;
    if (!confirmRemove) {
      setConfirmRemove(true);
      setRemoveError(null);
      return;
    }
    setRemoving(true);
    setRemoveError(null);
    try {
      await Api.ipdash.offline.removeIp(hostId);
      onRemoved?.(hostId);
      onClose();
    } catch (err: any) {
      setRemoveError(err?.message || 'Failed to remove IP.');
      setRemoving(false);
    }
  };

  const cancelRemove = () => {
    setConfirmRemove(false);
    setRemoveError(null);
  };

  return (
    <ModalBase open title={`IP details – ${entry.ip}`} onClose={onClose}>
      <div className="grid gap-3 grid-cols-2 ipdash-modal-grid">
        <div>
          <p className="label">Name</p>
          <p>{device?.name || '(no name)'}</p>
        </div>
        <div>
          <p className="label">Hostname</p>
          <p>{device?.hostname || '—'}</p>
        </div>
        <div>
          <p className="label">MAC</p>
          <p>{device?.mac || '—'}</p>
        </div>
        {!offlineMode && (
          <div>
            <p className="label">Status</p>
            <p>{online ? 'Online' : 'Offline'}</p>
          </div>
        )}
        <div>
          <p className="label">Reserved IP</p>
          <p>{device?.fixed_ip || '—'}</p>
        </div>
        {!offlineMode && (
          <div>
            <p className="label">Last seen</p>
            <p>{device?.last_seen ? new Date(device.last_seen * 1000).toLocaleString() : '—'}</p>
          </div>
        )}
      </div>
      {offlineMode && hostId && (
        <div className="stack gap-2 mt-4">
          {removeError && <div className="alert alert-error">{removeError}</div>}
          <div className="flex justify-end gap-2">
            {confirmRemove && (
              <SoftButton variant="ghost" onClick={cancelRemove} disabled={removing}>
                Cancel
              </SoftButton>
            )}
            <SoftButton
              className={`ipdash-compact-btn ${confirmRemove ? 'danger' : ''}`}
              variant="ghost"
              onClick={handleRemoveClick}
              disabled={removing}
            >
              {removing ? 'Removing…' : confirmRemove ? 'Confirm' : 'Remove IP'}
            </SoftButton>
          </div>
        </div>
      )}
    </ModalBase>
  );
}

function getOfflineHostId(device: UnifiClient | OnlineDevice | null | undefined) {
  if (!device || !device._id) return null;
  const match = /^offline-host-(\d+)$/i.exec(device._id);
  return match ? Number(match[1]) : null;
}

type ScopeModalProps = {
  open: boolean;
  profileId: number | null;
  onClose: () => void;
  onSuccess: (payload: { message: string; scope: OfflineScope }) => void;
};

function AddScopeModal({ open, profileId, onClose, onSuccess }: ScopeModalProps) {
  const [cidr, setCidr] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCidr('');
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    if (!profileId) return;
    if (!cidr.trim()) {
      setError('CIDR is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await Api.ipdash.offline.addScope({ profileId, cidr: cidr.trim() });
      onSuccess({ message: 'Scope added.', scope: result.scope as OfflineScope });
      setCidr('');
    } catch (err: any) {
      setError(err?.message || 'Failed to add IP scope.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalBase open={open} onClose={onClose} title="Add IP Scope" size="sm">
      <div className="stack gap-3">
        <input
          type="text"
          className="input"
          value={cidr}
          onChange={(e) => {
            setCidr(e.target.value);
            if (error) setError(null);
          }}
          placeholder="e.g. 192.168.68.0/24"
          disabled={!profileId || saving}
        />
        {error && <div className="alert alert-error">{error}</div>}
        <div className="flex justify-end gap-2">
          <SoftButton variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </SoftButton>
          <SoftButton onClick={submit} disabled={!profileId || saving}>
            {saving ? 'Saving…' : 'Add scope'}
          </SoftButton>
        </div>
      </div>
    </ModalBase>
  );
}

type AddIpModalProps = {
  open: boolean;
  profileId: number | null;
  scopes: OfflineScope[];
  onClose: () => void;
  onSuccess: (payload: { message: string; host: OfflineHost }) => void;
  defaultScopeId?: number | null;
};

function AddManualIpModal({ open, profileId, scopes, onClose, onSuccess, defaultScopeId = null }: AddIpModalProps) {
  const [scopeId, setScopeId] = useState<string>('');
  const [hostname, setHostname] = useState('');
  const [mac, setMac] = useState('');
  const [ip, setIp] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const preferred =
        (defaultScopeId && scopes.some((scope) => scope.id === defaultScopeId) && defaultScopeId) || scopes[0]?.id;
      setScopeId(preferred ? preferred.toString() : '');
      setHostname('');
      setMac('');
      setIp('');
      setError(null);
    }
  }, [open, scopes, defaultScopeId]);

  const submit = async () => {
    if (!profileId) return;
    if (!scopeId) {
      setError('Select a scope.');
      return;
    }
    if (!hostname.trim()) {
      setError('Hostname is required.');
      return;
    }
    if (!ip.trim()) {
      setError('Reserved IP is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await Api.ipdash.offline.addIp({
        profileId,
        scopeId: Number(scopeId),
        hostname: hostname.trim(),
        mac: mac.trim(),
        ip: ip.trim(),
      });
      onSuccess({ message: 'IP added.', host: result.host as OfflineHost });
    } catch (err: any) {
      setError(err?.message || 'Failed to add IP.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalBase open={open} onClose={onClose} title="Add IP" size="sm">
      <div className="stack gap-3">
        <label className="stack-sm">
          <span className="label">Scope</span>
          <select
            className="input"
            value={scopeId}
            onChange={(e) => {
              setScopeId(e.target.value);
              if (error) setError(null);
            }}
            disabled={!scopes.length || saving}
          >
            {scopes.map((scope) => (
              <option key={scope.id} value={scope.id}>
                {scope.label || scope.cidr}
              </option>
            ))}
          </select>
        </label>
        <label className="stack-sm">
          <span className="label">Hostname</span>
          <input
            className="input"
            value={hostname}
            onChange={(e) => {
              setHostname(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Device hostname"
            disabled={saving}
          />
        </label>
        <label className="stack-sm">
          <span className="label">MAC (optional)</span>
          <input
            className="input"
            value={mac}
            onChange={(e) => setMac(e.target.value)}
            placeholder="aa:bb:cc:dd:ee:ff"
            disabled={saving}
          />
        </label>
        <label className="stack-sm">
          <span className="label">Reserved IP</span>
          <input
            className="input"
            value={ip}
            onChange={(e) => {
              setIp(e.target.value);
              if (error) setError(null);
            }}
            placeholder="192.168.68.10"
            disabled={saving}
          />
        </label>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="flex justify-end gap-2">
          <SoftButton variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </SoftButton>
          <SoftButton onClick={submit} disabled={!profileId || saving || !scopes.length}>
            {saving ? 'Saving…' : 'Add IP'}
          </SoftButton>
        </div>
      </div>
    </ModalBase>
  );
}

function toggleFilter(key: keyof Filters, filters: Filters, setFilters: (value: Filters) => void) {
  setFilters({ ...filters, [key]: !filters[key] });
}

function parseNetworks(raw: UnifiNetwork[]): ParsedNetwork[] {
  return raw
    .filter((record) => typeof record.ip_subnet === 'string')
    .map((record) => {
      const [ip, maskStr] = (record.ip_subnet ?? '').split('/');
      const cidr = Number(maskStr) || 24;
      const ipInt = ipToInt(ip);
      if (ipInt == null) return null;
      const mask = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
      const networkBase = (ipInt & mask) >>> 0;
      const totalHosts = 2 ** (32 - cidr);
      const firstHost = totalHosts <= 2 ? networkBase : (networkBase + 1) >>> 0;
      const lastHost = totalHosts <= 2 ? (networkBase + totalHosts - 1) >>> 0 : (networkBase + totalHosts - 2) >>> 0;
      return {
        id: record._id || record.ip_subnet!,
        name: record.name || record.ip_subnet!,
        ipSubnet: record.ip_subnet!,
        cidr,
        firstHostInt: firstHost,
        lastHostInt: lastHost,
        hostCount: Math.max(0, lastHost - firstHost + 1),
        scopeId: record.scope_id ?? null,
      };
    })
    .filter(Boolean) as ParsedNetwork[];
}

function ipToInt(ip?: string) {
  if (!ip) return null;
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function intToIp(value: number) {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

function getHostIpsForNetwork(network: ParsedNetwork) {
  const hosts: string[] = [];
  for (let current = network.firstHostInt; current <= network.lastHostInt; current++) {
    hosts.push(intToIp(current));
  }
  return hosts;
}

function indexUsersByIp(users: UnifiClient[]) {
  const map = new Map<string, UnifiClient>();
  users.forEach((user) => {
    const addIp = (ip?: string | null) => {
      if (!ip || typeof ip !== 'string') return;
      const trimmed = ip.trim();
      if (!trimmed || map.has(trimmed)) return;
      map.set(trimmed, { ...user, ip: trimmed });
    };
    addIp(user.fixed_ip);
    addIp(user.ip);
    addIp(user.last_ip);
    addIp(user.last_known_ip);
    addIp(user.noted_ip);
    addIp(user.primary_ip);
    addIp(user.ipv4);
    addIp(user.remote_ip);
    addIp(user.tunnel_ip);
    if (user.network_table) {
      user.network_table.forEach((entry) => addIp(entry?.ip));
    }
    if (user.config_networks && typeof user.config_networks === 'object') {
      Object.values(user.config_networks).forEach((cfg) => {
        addIp(cfg?.ip);
        addIp(cfg?.ipaddr);
      });
    }
  });
  return map;
}

function resolveOnlineIp(device: OnlineDevice | null | undefined) {
  if (!device) return null;
  const networkEntry = device.networks?.find((network) => network?.ip);
  let configIp: string | null = null;
  if (device.config_networks && typeof device.config_networks === 'object') {
    for (const value of Object.values(device.config_networks)) {
      if (!value) continue;
      if (value.ip) {
        configIp = value.ip;
        break;
      }
      if (value.ipaddr) {
        configIp = value.ipaddr;
        break;
      }
    }
  }
  return (
    device.ip ||
    device.ipv4 ||
    device.tunnel_ip ||
    device.remote_ip ||
    device.last_ip ||
    device.last_known_ip ||
    device.noted_ip ||
    device.primary_ip ||
    device.uplink?.remote_ip ||
    networkEntry?.ip ||
    configIp ||
    null
  );
}

function mergeOnlineDevices(map: Map<string, UnifiClient>, devices: OnlineDevice[]) {
  devices.forEach((dev) => {
    const ip = resolveOnlineIp(dev);
    if (!ip) return;
    const existing = map.get(ip);
    if (existing) {
      if (!existing.mac && dev.mac) existing.mac = dev.mac;
      if (!existing.hostname && dev.hostname) existing.hostname = dev.hostname;
      if (!existing.name && (dev.name || dev.hostname)) existing.name = dev.name || dev.hostname || existing.name;
      if (dev.last_seen) existing.last_seen = dev.last_seen;
    } else {
      map.set(ip, {
        name: dev.name || dev.hostname || '',
        hostname: dev.hostname || '',
        mac: dev.mac || '',
        last_seen: dev.last_seen,
        ip,
      });
    }
  });
}

function buildOnlineMacSet(devices: OnlineDevice[]) {
  const set = new Set<string>();
  devices.forEach((dev) => {
    if (dev.mac) set.add(dev.mac.toLowerCase());
  });
  return set;
}

function isOnline(device: UnifiClient | OnlineDevice | null, onlineSet: Set<string>) {
  if (!device) return false;
  const mac = device.mac?.toLowerCase();
  if (mac && onlineSet.has(mac)) return true;
  if (!device.last_seen) return false;
  return Date.now() / 1000 - Number(device.last_seen) < 600;
}

function resolveHostVisibility(device: UnifiClient | null, filters: Filters, onlineSet: Set<string>) {
  const { showOnline, showReserved, hideEmpty } = filters;

  // Always hide empty slots when the Hide Empty toggle is active.
  if (!device) {
    if (hideEmpty) return { include: false, device: null };
    // When Hide Empty is off, include empty tiles regardless of other filters.
    return { include: true, device: null };
  }

  if (showOnline && !isOnline(device, onlineSet)) {
    return { include: false, device: null };
  }

  if (showReserved && !device.fixed_ip) {
    return { include: false, device: null };
  }

  return { include: true, device };
}


function getHostsForRendering(
  network: ParsedNetwork,
  map: Map<string, UnifiClient>,
  filters: Filters,
  onlineSet: Set<string>,
  offlineMode: boolean
) {
  const appliedFilters = offlineMode ? { ...filters, showOnline: false } : filters;
  const hosts: HostEntry[] = [];
  getHostIpsForNetwork(network).forEach((ip) => {
    const device = map.get(ip) ?? null;
    const visibility = resolveHostVisibility(device, appliedFilters, onlineSet);
    if (visibility.include) {
      hosts.push({ ip, device: visibility.device, hostId: getOfflineHostId(visibility.device) });
    }
  });
  return hosts;
}

function getGroupSizeValue(groupBy: string) {
  if (groupBy === 'none') return null;
  const parsed = Number(groupBy);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function groupLabelForIp(ip: string, size: number) {
  const lastOctet = Number(ip.split('.').pop());
  if (!Number.isFinite(lastOctet)) return null;
  const bucket = Math.floor(lastOctet / size);
  let start = bucket === 0 ? 1 : bucket * size;
  let end = start + size - 1;
  if (start < 1) start = 1;
  if (end > 254) end = 254;
  return { key: `${start}-${end}`, label: `${start}-${end}`, tagKey: `${size}:${start}-${end}`, order: start };
}

function getGroupedEntries(hosts: HostEntry[], groupBy: string, groupTags: Record<string, string>): GroupEntry[] {
  const size = getGroupSizeValue(groupBy);
  if (!size) {
    return [
      {
        key: 'all',
        label: null,
        tagKey: 'all',
        hosts,
      },
    ];
  }
  const groups = new Map<string, GroupEntry>();
  hosts.forEach((entry) => {
    const info = groupLabelForIp(entry.ip, size);
    const key = info?.key || 'other';
    const order = info?.order ?? Number.MAX_SAFE_INTEGER;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: info?.label || key,
        tagKey: info?.tagKey || key,
        order,
        hosts: [],
      });
    }
    groups.get(key)!.hosts.push(entry);
  });
  return Array.from(groups.values()).sort((a, b) => {
    if (a.order === b.order) return a.key.localeCompare(b.key);
    return a.order - b.order;
  });
}

function buildSummaryStats(
  network: ParsedNetwork,
  users: UnifiClient[],
  map: Map<string, UnifiClient>,
  onlineSet: Set<string>
) {
  const inNetwork = users.filter((user) => user.fixed_ip && isIpInNetwork(user.fixed_ip, network));
  const online = inNetwork.filter((user) => isOnline(user, onlineSet)).length;
  const used = Array.from(map.keys()).filter((ip) => isIpInNetwork(ip, network)).length;
  const usable = getHostIpsForNetwork(network).length;
  const usagePercent = usable > 0 ? ((used / usable) * 100).toFixed(1) : '0';
  return {
    reservations: inNetwork.length,
    online,
    used,
    usable,
    usagePercent,
  };
}

function isIpInNetwork(ip: string, network: ParsedNetwork) {
  const int = ipToInt(ip);
  if (int == null) return false;
  return int >= network.firstHostInt && int <= network.lastHostInt;
}
