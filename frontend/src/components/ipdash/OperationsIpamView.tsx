import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Api } from '../../api';
import { useAppStore } from '../../store';
import { OperationsIcon } from '../OperationsIcon';

type Profile = { id: number; name: string; location?: string | null; host: string; mode: 'proxy' | 'direct' | 'local-offline' };
type Network = { _id: string; name?: string; ip_subnet?: string; scope_id?: number };
type Host = {
  _id?: string; name?: string; hostname?: string; fixed_ip?: string; ip?: string; last_ip?: string;
  last_known_ip?: string; primary_ip?: string; ipv4?: string; mac?: string; last_seen?: number;
  scope_id?: number; linked_device_id?: number | null; linked_device_label?: string;
};
type IpRecord = {
  ip: string; name: string; mac: string; source: 'local' | 'unifi' | 'discovered' | 'available';
  status: 'online' | 'reserved' | 'available' | 'conflict'; lastSeen?: number; hostId?: number;
  linkedDeviceId?: number | null; linkedDeviceLabel?: string;
};
type ParsedNetwork = { id: string; name: string; cidr: string; first: number; last: number; hostCount: number; scopeId?: number };

const PAGE_SIZE = 100;

export function OperationsIpamView() {
  const qc = useQueryClient();
  const activeProfileId = useAppStore((state) => state.ipDashActiveProfileId);
  const setActiveProfileId = useAppStore((state) => state.setIpDashActiveProfileId);
  const openProfiles = useAppStore((state) => state.openIpDashProfileModal);
  const refreshToken = useAppStore((state) => state.ipDashRefreshToken);
  const viewMode = useAppStore((state) => state.ipDashViewMode);
  const setViewMode = useAppStore((state) => state.setIpDashViewMode);
  const setConnectionStatus = useAppStore((state) => state.setIpDashConnectionStatus);
  const timeZone = useAppStore((state) => state.timeZone);
  const profilesQuery = useQuery({ queryKey: ['ipdash-profiles'], queryFn: Api.ipdash.profiles.list });
  const profiles = (profilesQuery.data?.profiles ?? []) as Profile[];
  const keyMismatch = Boolean(profilesQuery.data?.encryptionKeyMismatch);
  const keyConfigured = profilesQuery.data?.appEncKeyConfigured ?? true;
  const dataQuery = useQuery({
    queryKey: ['ipdash-data', activeProfileId ?? 'none', refreshToken],
    queryFn: () => Api.ipdash.data(activeProfileId),
    enabled: Boolean(activeProfileId && !keyMismatch && keyConfigured),
  });
  const devicesQuery = useQuery({ queryKey: ['all-devices'], queryFn: Api.devices.all });
  const data = dataQuery.data as any;
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? null;
  const offline = activeProfile?.mode === 'local-offline';
  const devices = (devicesQuery.data?.devices ?? []) as any[];
  const networks = useMemo(() => ((data?.networks ?? []) as Network[]).map(parseNetwork).filter(Boolean) as ParsedNetwork[], [data?.networks]);
  const [networkId, setNetworkId] = useState('');
  const activeNetwork = networks.find((network) => network.id === networkId) ?? networks[0] ?? null;
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [hideAvailable, setHideAvailable] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedIp, setSelectedIp] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'scope' | 'reservation' | null>(null);
  const [scopeForm, setScopeForm] = useState({ cidr: '', label: '' });
  const [hostForm, setHostForm] = useState({ ip: '', hostname: '', mac: '', linkedDeviceId: '' });
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemoveScopeId, setConfirmRemoveScopeId] = useState<number | null>(null);
  const [confirmReleaseHostId, setConfirmReleaseHostId] = useState<number | null>(null);

  useEffect(() => {
    if (!profiles.length) {
      if (activeProfileId !== null) setActiveProfileId(null);
      return;
    }
    if (!activeProfileId || !profiles.some((profile) => profile.id === activeProfileId)) setActiveProfileId(profiles[0].id);
  }, [profiles, activeProfileId, setActiveProfileId]);

  useEffect(() => {
    if (!networks.some((network) => network.id === networkId)) setNetworkId(networks[0]?.id ?? '');
  }, [networks, networkId]);

  useEffect(() => {
    const status = keyMismatch || !keyConfigured || data?.status === 'inactive'
      ? 'inactive'
      : dataQuery.isFetching ? 'pending' : offline ? 'local-offline' : data?.status === 'active' ? 'active' : 'idle';
    const detail = keyMismatch
      ? (profilesQuery.data?.encryptionMessage || 'Encryption key mismatch')
      : !keyConfigured ? 'APP_ENC_KEY is not configured' : activeProfile ? `${activeProfile.name}${activeProfile.location ? ` · ${activeProfile.location}` : ''}` : 'No profile selected';
    setConnectionStatus({ status, text: detail });
  }, [keyMismatch, keyConfigured, data?.status, dataQuery.isFetching, offline, activeProfile, profilesQuery.data, setConnectionStatus]);

  const records = useMemo(() => buildRecords(activeNetwork, data?.users ?? [], data?.online ?? [], offline), [activeNetwork, data?.users, data?.online, offline]);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return records.filter((record) => {
      if (hideAvailable && record.status === 'available') return false;
      if (statusFilter !== 'all' && record.status !== statusFilter) return false;
      if (sourceFilter !== 'all' && record.source !== sourceFilter) return false;
      return !term || [record.ip, record.name, record.mac, record.linkedDeviceLabel].some((value) => value?.toLowerCase().includes(term));
    });
  }, [records, query, hideAvailable, statusFilter, sourceFilter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const selected = records.find((record) => record.ip === selectedIp) ?? null;
  const counts = useMemo(() => records.reduce<Record<IpRecord['status'], number>>((acc, record) => ({ ...acc, [record.status]: acc[record.status] + 1 }), { online: 0, reserved: 0, available: 0, conflict: 0 }), [records]);

  useEffect(() => setPage(0), [activeNetwork?.id, query, statusFilter, sourceFilter, hideAvailable]);
  useEffect(() => {
    if (!selected) return;
    setHostForm({ ip: selected.ip, hostname: selected.name, mac: selected.mac, linkedDeviceId: selected.linkedDeviceId ? String(selected.linkedDeviceId) : '' });
  }, [selectedIp, selected?.name, selected?.mac, selected?.linkedDeviceId]);

  useEffect(() => {
    if (confirmRemoveScopeId == null && confirmReleaseHostId == null) return;
    const timeout = window.setTimeout(() => { setConfirmRemoveScopeId(null); setConfirmReleaseHostId(null); }, 5000);
    return () => window.clearTimeout(timeout);
  }, [confirmRemoveScopeId, confirmReleaseHostId]);

  const reload = async () => {
    await qc.invalidateQueries({ queryKey: ['ipdash-data', activeProfileId ?? 'none'] });
    await qc.invalidateQueries({ queryKey: ['wol-machines'] });
    await qc.invalidateQueries({ queryKey: ['wol-status'] });
    await qc.invalidateQueries({ queryKey: ['audit'] });
  };
  const run = async (operation: () => Promise<any>, success: string) => {
    setBusy(true); setNotice(null);
    try { await operation(); await reload(); setDialog(null); setNotice({ tone: 'success', text: success }); }
    catch (error) { setNotice({ tone: 'error', text: readError(error) }); }
    finally { setBusy(false); }
  };
  const openReservation = (record?: IpRecord) => {
    setHostForm({ ip: record?.ip ?? '', hostname: record?.name ?? '', mac: record?.mac ?? '', linkedDeviceId: record?.linkedDeviceId ? String(record.linkedDeviceId) : '' });
    setDialog('reservation');
  };

  if (keyMismatch || !keyConfigured) return <IpamSetupState title="IPAM locked" detail={profilesQuery.data?.encryptionMessage || 'Configure APP_ENC_KEY, then manage profiles.'} onAction={openProfiles} />;
  if (!profilesQuery.isLoading && !profiles.length) return <IpamSetupState title="No IPAM profile" detail="Add a UniFi controller or a local offline profile to start managing address space." onAction={openProfiles} />;

  return <div className={`ops-ipam-layout ${selected ? 'has-inspector' : ''}`}>
    <aside className="ops-ipam-networks ops-panel">
      <div className="ops-ipam-side-header"><div><span className="ops-eyebrow">Address space</span><h2>Networks</h2></div><button className="ops-icon-button" title="Manage profiles" onClick={openProfiles}><OperationsIcon name="settings" /></button></div>
      <div className="ops-ipam-profile"><span className={`ops-status-dot ${data?.status === 'inactive' ? 'is-danger' : ''}`} /><div><strong>{activeProfile?.name || 'Profile'}</strong><small>{offline ? 'Local offline' : activeProfile?.host}</small></div></div>
      <nav className="ops-network-list">
        {networks.map((network) => <button key={network.id} className={activeNetwork?.id === network.id ? 'is-active' : ''} onClick={() => { setNetworkId(network.id); setSelectedIp(null); }}><OperationsIcon name="network" /><span><strong>{network.name}</strong><small>{network.cidr} · {network.hostCount.toLocaleString()} hosts</small></span><OperationsIcon name="chevron" /></button>)}
      </nav>
      {!networks.length && !dataQuery.isLoading ? <div className="ops-inline-empty">No networks in this profile.</div> : null}
      {offline ? <div className="ops-ipam-side-actions"><button className="ops-button ops-button--secondary" onClick={() => { setScopeForm({ cidr: '', label: '' }); setDialog('scope'); }}><OperationsIcon name="plus" /> Add scope</button>{activeNetwork?.scopeId ? <button className={`ops-button ops-button--danger-subtle ${confirmRemoveScopeId === activeNetwork.scopeId ? 'is-confirming' : ''}`} onClick={() => { if (confirmRemoveScopeId === activeNetwork.scopeId) { setConfirmRemoveScopeId(null); run(() => Api.ipdash.offline.removeScope(activeNetwork.scopeId!), 'Scope removed.'); } else setConfirmRemoveScopeId(activeNetwork.scopeId); }}><OperationsIcon name="trash" /> {confirmRemoveScopeId === activeNetwork.scopeId ? 'Confirm removal' : 'Remove'}</button> : null}</div> : null}
    </aside>

    <section className="ops-panel ops-table-panel ops-ipam-table-panel">
      <div className="ops-ipam-summary"><div><span>Online</span><strong>{counts.online}</strong></div><div><span>Reserved</span><strong>{counts.reserved}</strong></div><div><span>Available</span><strong>{counts.available}</strong></div><div className={counts.conflict ? 'is-alert' : ''}><span>Conflicts</span><strong>{counts.conflict}</strong></div></div>
      <div className="ops-panel-toolbar ops-panel-toolbar--wrap">
        <div className="ops-filter-input"><OperationsIcon name="search" /><input data-module-search value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search IP, host, MAC or rack device…" /></div>
        <select className="ops-compact-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All states</option><option value="online">Online</option><option value="reserved">Reserved</option><option value="available">Available</option><option value="conflict">Conflicts</option></select>
        <select className="ops-compact-select" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="all">All sources</option><option value="local">Local</option><option value="unifi">UniFi</option><option value="discovered">Discovered</option><option value="available">Available</option></select>
        <label className="ops-toolbar-check"><input type="checkbox" checked={hideAvailable} onChange={(event) => setHideAvailable(event.target.checked)} /> Hide free</label>
        <div className="ops-toolbar-spacer" />
        <div className="ops-view-toggle"><button className={viewMode === 'table' ? 'is-active' : ''} onClick={() => setViewMode('table')}>Table</button><button className={viewMode === 'grid' ? 'is-active' : ''} onClick={() => setViewMode('grid')}>Grid</button></div>
        {offline && activeNetwork ? <button className="ops-button" onClick={() => openReservation()}><OperationsIcon name="plus" /> Reserve IP</button> : null}
      </div>
      {notice ? <div className={`ops-notice ops-notice--${notice.tone}`}>{notice.text}<button onClick={() => setNotice(null)}><OperationsIcon name="close" /></button></div> : null}
      {dataQuery.isLoading ? <div className="ops-loading-state">Loading IPAM data…</div> : viewMode === 'grid' ? <IpGrid records={visible} selectedIp={selectedIp} onSelect={setSelectedIp} /> : <IpTable records={visible} selectedIp={selectedIp} onSelect={setSelectedIp} timeZone={timeZone} />}
      <div className="ops-pagination"><span>{filtered.length ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, filtered.length)} of ${filtered.length}` : '0 addresses'}</span><div><button disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page + 1} / {pageCount}</span><button disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
    </section>

    {selected ? <aside className="ops-inspector">
      <div className="ops-inspector-header"><div><span className="ops-eyebrow">Address details</span><h2 className="ops-mono">{selected.ip}</h2><IpState record={selected} /></div><button className="ops-icon-button" onClick={() => setSelectedIp(null)}><OperationsIcon name="close" /></button></div>
      <div className="ops-inspector-body">
        <div className="ops-detail-list"><div><span>Source</span><strong>{sourceLabel(selected.source)}</strong></div><div><span>Last seen</span><strong>{formatDate(selected.lastSeen, timeZone)}</strong></div></div>
        {offline && selected.hostId ? <div className="ops-form-grid">
          <label className="ops-field ops-field--full"><span>Hostname</span><input value={hostForm.hostname} onChange={(event) => setHostForm({ ...hostForm, hostname: event.target.value })} /></label>
          <label className="ops-field ops-field--full"><span>MAC address</span><input className="ops-mono" value={hostForm.mac} onChange={(event) => setHostForm({ ...hostForm, mac: event.target.value })} /></label>
          <DeviceSelect value={hostForm.linkedDeviceId} devices={devices} onChange={(value) => setHostForm({ ...hostForm, linkedDeviceId: value })} />
        </div> : <div className="ops-detail-list"><div><span>Hostname</span><strong>{selected.name || '—'}</strong></div><div><span>MAC</span><strong className="ops-mono">{selected.mac || '—'}</strong></div><div><span>Rack device</span><strong>{selected.linkedDeviceLabel || 'Not linked'}</strong></div></div>}
      </div>
      <div className="ops-inspector-footer ops-inspector-footer--stack">
        {selected.mac ? <button className="ops-button ops-button--secondary" disabled={busy} onClick={() => run(() => Api.wol.machines.create({ name: selected.name || selected.ip, ipAddress: selected.ip, macAddress: selected.mac, broadcastAddress: '255.255.255.255', port: 9, linkedDeviceId: selected.linkedDeviceId ?? null }), 'WOL target created.')}><OperationsIcon name="power" /> Create WOL target</button> : null}
        {offline && selected.hostId ? <><button className="ops-button" disabled={busy} onClick={() => run(() => Api.ipdash.offline.updateIp(selected.hostId!, { hostname: hostForm.hostname, mac: hostForm.mac, linkedDeviceId: hostForm.linkedDeviceId ? Number(hostForm.linkedDeviceId) : null }), 'Reservation updated.')}>Save reservation</button><button className={`ops-button ops-button--danger ops-inline-confirm ${confirmReleaseHostId === selected.hostId ? 'is-confirming' : ''}`} disabled={busy} onClick={() => { if (confirmReleaseHostId === selected.hostId) { setConfirmReleaseHostId(null); run(() => Api.ipdash.offline.removeIp(selected.hostId!), 'Reservation released.'); } else setConfirmReleaseHostId(selected.hostId!); }}><OperationsIcon name="trash" /> {confirmReleaseHostId === selected.hostId ? 'Confirm release' : 'Release address'}</button></> : offline && selected.status === 'available' ? <button className="ops-button" onClick={() => openReservation(selected)}><OperationsIcon name="plus" /> Reserve this IP</button> : null}
      </div>
    </aside> : null}

    {dialog ? <div className="ops-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}><div className="ops-dialog">
      <div className="ops-inspector-header"><div><span className="ops-eyebrow">IP Addressing</span><h2>{dialog === 'scope' ? 'Add network scope' : 'Reserve address'}</h2></div><button className="ops-icon-button" onClick={() => setDialog(null)}><OperationsIcon name="close" /></button></div>
      <div className="ops-form-grid">
        {dialog === 'scope' ? <><label className="ops-field ops-field--full"><span>CIDR</span><input className="ops-mono" value={scopeForm.cidr} onChange={(event) => setScopeForm({ ...scopeForm, cidr: event.target.value })} placeholder="10.20.30.0/24" /></label><label className="ops-field ops-field--full"><span>Label</span><input value={scopeForm.label} onChange={(event) => setScopeForm({ ...scopeForm, label: event.target.value })} placeholder="Management VLAN" /></label></> : <><label className="ops-field"><span>IP address</span><input className="ops-mono" value={hostForm.ip} onChange={(event) => setHostForm({ ...hostForm, ip: event.target.value })} /></label><label className="ops-field"><span>Hostname</span><input value={hostForm.hostname} onChange={(event) => setHostForm({ ...hostForm, hostname: event.target.value })} /></label><label className="ops-field ops-field--full"><span>MAC address</span><input className="ops-mono" value={hostForm.mac} onChange={(event) => setHostForm({ ...hostForm, mac: event.target.value })} /></label><DeviceSelect value={hostForm.linkedDeviceId} devices={devices} onChange={(value) => setHostForm({ ...hostForm, linkedDeviceId: value })} /></>}
      </div>
      <div className="ops-inspector-footer"><button className="ops-button ops-button--secondary" onClick={() => setDialog(null)}>Cancel</button><button className="ops-button" disabled={busy || (dialog === 'scope' ? !scopeForm.cidr.trim() : !hostForm.ip.trim())} onClick={() => dialog === 'scope' ? run(() => Api.ipdash.offline.addScope({ profileId: activeProfileId, ...scopeForm }), 'Scope created.') : run(() => Api.ipdash.offline.addIp({ profileId: activeProfileId, scopeId: activeNetwork?.scopeId, ip: hostForm.ip, hostname: hostForm.hostname, mac: hostForm.mac, linkedDeviceId: hostForm.linkedDeviceId ? Number(hostForm.linkedDeviceId) : null }), 'Address reserved.')}>{busy ? 'Saving…' : 'Save'}</button></div>
    </div></div> : null}
  </div>;
}

function IpTable({ records, selectedIp, onSelect, timeZone }: { records: IpRecord[]; selectedIp: string | null; onSelect: (ip: string) => void; timeZone: string }) {
  return <div className="ops-table-wrap"><table className="ops-table ops-ipam-table"><thead><tr><th>IP address</th><th>Hostname</th><th>MAC address</th><th>Source</th><th>Status</th><th>Rack device</th><th>Last seen</th></tr></thead><tbody>{records.map((record) => <tr key={record.ip} className={record.ip === selectedIp ? 'is-selected' : ''} onClick={() => onSelect(record.ip)}><td className="ops-mono" data-label="IP address"><strong>{record.ip}</strong></td><td data-label="Hostname">{record.name || <span className="ops-muted">Unassigned</span>}</td><td className="ops-mono" data-label="MAC address">{record.mac || '—'}</td><td data-label="Source"><span className={`ops-source ops-source--${record.source}`}>{sourceLabel(record.source)}</span></td><td data-label="Status"><IpState record={record} /></td><td data-label="Rack device">{record.linkedDeviceLabel || <span className="ops-muted">—</span>}</td><td className="ops-muted" data-label="Last seen">{formatDate(record.lastSeen, timeZone)}</td></tr>)}</tbody></table>{!records.length ? <div className="ops-inline-empty">No addresses match the active filters.</div> : null}</div>;
}

function IpGrid({ records, selectedIp, onSelect }: { records: IpRecord[]; selectedIp: string | null; onSelect: (ip: string) => void }) {
  return <div className="ops-ip-grid">{records.map((record) => <button key={record.ip} className={`${record.ip === selectedIp ? 'is-selected' : ''} is-${record.status}`} onClick={() => onSelect(record.ip)}><span className="ops-mono">{record.ip}</span><strong>{record.name || 'Available'}</strong><IpState record={record} /></button>)}</div>;
}

function IpState({ record }: { record: IpRecord }) {
  const tone = record.status === 'online' ? 'ok' : record.status === 'conflict' ? 'danger' : record.status === 'reserved' ? 'info' : 'neutral';
  return <span className={`ops-state ops-state--${tone}`}><span className="ops-status-dot" />{record.status}</span>;
}

function DeviceSelect({ value, devices, onChange }: { value: string; devices: any[]; onChange: (value: string) => void }) {
  return <label className="ops-field ops-field--full"><span>Linked rack device</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">No linked device</option>{devices.map((device) => <option value={device.id} key={device.id}>{device.cabinetName} · U{device.position} · {device.type}{device.model ? ` · ${device.model}` : ''}</option>)}</select></label>;
}

function IpamSetupState({ title, detail, onAction }: { title: string; detail: string; onAction: () => void }) {
  return <div className="ops-panel ops-empty-state ops-ipam-setup"><OperationsIcon name="network" /><h2>{title}</h2><p>{detail}</p><button className="ops-button" onClick={onAction}><OperationsIcon name="settings" /> Manage profiles</button></div>;
}

function parseNetwork(network: Network): ParsedNetwork | null {
  const cidr = network.ip_subnet?.trim();
  if (!cidr) return null;
  const [address, prefixText] = cidr.split('/');
  const base = ipToInt(address); const prefix = Number(prefixText);
  if (base == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const blockSize = 2 ** (32 - prefix);
  const networkAddress = Math.floor(base / blockSize) * blockSize;
  const first = prefix >= 31 ? networkAddress : networkAddress + 1;
  const last = prefix >= 31 ? networkAddress + blockSize - 1 : networkAddress + blockSize - 2;
  const cappedLast = Math.min(last, first + 65_533);
  return { id: network._id || cidr, name: network.name || cidr, cidr, first, last: cappedLast, hostCount: cappedLast - first + 1, scopeId: network.scope_id };
}

function buildRecords(network: ParsedNetwork | null, users: Host[], online: Host[], offline: boolean): IpRecord[] {
  if (!network) return [];
  const byIp = new Map<string, IpRecord>();
  const ipConflicts = new Set<string>();
  const add = (host: Host, source: IpRecord['source'], isOnline: boolean) => {
    const ip = getIp(host); const value = ip ? ipToInt(ip) : null;
    if (!ip || value == null || value < network.first || value > network.last) return;
    const prior = byIp.get(ip);
    const incomingMac = normalizeMac(host.mac || '');
    if (prior?.mac && incomingMac && prior.mac !== incomingMac) ipConflicts.add(ip);
    const idMatch = /^offline-host-(\d+)$/.exec(host._id || '');
    byIp.set(ip, {
      ip, name: host.name || host.hostname || prior?.name || '', mac: incomingMac || prior?.mac || '',
      source: prior?.source === 'local' || prior?.source === 'unifi' ? prior.source : source,
      status: isOnline ? 'online' : prior?.status || 'reserved', lastSeen: Math.max(host.last_seen || 0, prior?.lastSeen || 0) || undefined,
      hostId: idMatch ? Number(idMatch[1]) : prior?.hostId, linkedDeviceId: host.linked_device_id ?? prior?.linkedDeviceId,
      linkedDeviceLabel: host.linked_device_label || prior?.linkedDeviceLabel,
    });
  };
  users.forEach((host) => add(host, offline ? 'local' : 'unifi', false));
  online.forEach((host) => add(host, 'discovered', true));
  const macIps = new Map<string, Set<string>>();
  byIp.forEach((record) => { if (record.mac) { if (!macIps.has(record.mac)) macIps.set(record.mac, new Set()); macIps.get(record.mac)!.add(record.ip); } });
  byIp.forEach((record) => { if (ipConflicts.has(record.ip) || (record.mac && (macIps.get(record.mac)?.size || 0) > 1)) record.status = 'conflict'; });
  const result: IpRecord[] = [];
  for (let value = network.first; value <= network.last; value += 1) result.push(byIp.get(intToIp(value)) || { ip: intToIp(value), name: '', mac: '', source: 'available', status: 'available' });
  return result;
}

function getIp(host: Host) { return host.fixed_ip || host.ip || host.primary_ip || host.ipv4 || host.last_ip || host.last_known_ip || ''; }
function normalizeMac(value: string) { return value.trim().toUpperCase().replace(/-/g, ':'); }
function ipToInt(value: string): number | null { const parts = value.split('.').map(Number); return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) : null; }
function intToIp(value: number) { return [Math.floor(value / 16777216) % 256, Math.floor(value / 65536) % 256, Math.floor(value / 256) % 256, value % 256].join('.'); }
function sourceLabel(source: IpRecord['source']) { return source === 'unifi' ? 'UniFi' : source === 'local' ? 'Local' : source === 'discovered' ? 'Discovery' : 'Pool'; }
function formatDate(value?: number, timeZone?: string) { if (!value) return '—'; const date = new Date(value > 10_000_000_000 ? value : value * 1000); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(undefined, timeZone ? { timeZone } : undefined); }
function readError(error: unknown) { const message = error instanceof Error ? error.message : String(error); try { return JSON.parse(message).error || message; } catch { return message || 'Operation failed'; } }
