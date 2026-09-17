import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Api } from '../../api';
import { formatDateTime, formatRelativeTime } from '../../utils/dateTime';
import { useAppStore } from '../../store';
import { OperationsIcon } from '../OperationsIcon';
import { ModalBase } from '../modals/ModalBase';

type ServerGroup = { id: number; name: string; ansibleName: string; description: string; color: string; serverCount: number };
type SemaphoreProfile = {
  id: number; name: string; apiUrl: string; uiUrl: string; projectId: number; inventoryId: number;
  checkTemplateId: number | null; updateTemplateId: number | null; rebootTemplateId: number | null;
  healthTemplateId: number | null; allowSelfSigned: boolean; hasToken: boolean;
  inventorySyncState: 'uninitialized' | 'synced' | 'pending' | 'conflict' | 'failed';
  inventorySyncError: string; inventoryLastSyncedAt: string | null;
};
type Server = {
  id: number; name: string; ansibleAlias: string; hostname: string; primaryIp: string; sshPort: number;
  osFamily: string; osName: string; osVersion: string; environment: string; role: string; location: string;
  cockpitUrl: string; notes: string; linkedDeviceId: number | null; linkedDeviceLabel: string;
  ansibleEnabled: boolean; inventorySyncState: 'disabled' | 'synced' | 'pending'; status: string; groups: ServerGroup[]; updates: number | null;
  securityUpdates: number | null; rebootRequired: boolean | null; kernel: string; uptimeSeconds: number | null;
  lastCheckedAt: string | null; checkResult: string; lastUpdateAt: string | null; lastUpdateResult: string;
};
type ServerAction = { id: number; action: string; status: string; semaphoreTaskId: number | null; requestedAt: string; resultSummary: string; errorMessage: string; source: 'rakit' | 'schedule' };

const emptyServerForm = {
  name: '', ansibleAlias: '', primaryIp: '', hostname: '', sshPort: '22', osName: 'Ubuntu Server', osVersion: '',
  environment: '', role: '', location: '', cockpitUrl: '', notes: '', linkedDeviceId: '', groupIds: [] as number[],
  ansibleEnabled: true, status: 'unknown',
};

const emptyProfileForm = {
  name: 'BUZLAB Semaphore', apiUrl: '', uiUrl: '', apiToken: '', projectId: '', inventoryId: '',
  checkTemplateId: '', updateTemplateId: '', rebootTemplateId: '', healthTemplateId: '', allowSelfSigned: false,
};

export function ServersView() {
  const qc = useQueryClient();
  const timeZone = useAppStore((state) => state.timeZone);
  const serversQuery = useQuery({ queryKey: ['servers'], queryFn: Api.servers.list, refetchInterval: 30_000 });
  const devicesQuery = useQuery({ queryKey: ['porthub-devices'], queryFn: Api.portHub.devices });
  const [filter, setFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [updateFilter, setUpdateFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [serverModal, setServerModal] = useState<{ open: boolean; server: Server | null }>({ open: false, server: null });
  const [profileOpen, setProfileOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'update' | 'reboot' | 'remove' | null>(null);
  const [activeActionId, setActiveActionId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const data = serversQuery.data ?? {};
  const servers = (data.servers ?? []) as Server[];
  const groups = (data.groups ?? []) as ServerGroup[];
  const profile = (data.inventory ?? null) as SemaphoreProfile | null;
  const devices = (devicesQuery.data?.devices ?? []) as any[];
  const selected = servers.find((server) => server.id === selectedId) ?? null;
  const detailQuery = useQuery({ queryKey: ['server', selectedId], queryFn: () => Api.servers.get(selectedId!), enabled: Boolean(selectedId), refetchInterval: activeActionId ? 5000 : false });
  const actions = (detailQuery.data?.actions ?? []) as ServerAction[];

  useEffect(() => {
    if (activeActionId) return;
    const unfinished = actions.find((action) => ['submitting', 'queued', 'running', 'unknown'].includes(action.status));
    if (unfinished) setActiveActionId(unfinished.id);
  }, [activeActionId, actions]);

  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return servers.filter((server) => {
      const matchesText = !query || [server.name, server.ansibleAlias, server.primaryIp, server.hostname, server.environment, server.role, ...server.groups.map((group) => group.name)].some((value) => value.toLowerCase().includes(query));
      const matchesGroup = groupFilter === 'all' || server.groups.some((group) => String(group.id) === groupFilter);
      const matchesUpdates = updateFilter === 'all'
        || (updateFilter === 'pending' && Number(server.updates) > 0)
        || (updateFilter === 'security' && Number(server.securityUpdates) > 0)
        || (updateFilter === 'reboot' && server.rebootRequired === true)
        || (updateFilter === 'clean' && server.updates === 0);
      return matchesText && matchesGroup && matchesUpdates;
    });
  }, [servers, filter, groupFilter, updateFilter]);

  const refreshAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['servers'] }),
      qc.invalidateQueries({ queryKey: ['server', selectedId] }),
      qc.invalidateQueries({ queryKey: ['overview'] }),
      qc.invalidateQueries({ queryKey: ['audit'] }),
    ]);
  };

  const syncMutation = useMutation({
    mutationFn: () => Api.semaphore.syncInventory(profile!.id),
    onSuccess: () => { setError(''); void refreshAll(); },
    onError: (reason: Error) => { setError(readApiError(reason)); void refreshAll(); },
  });
  const actionMutation = useMutation({
    mutationFn: ({ server, action, confirmation }: { server: Server; action: 'check' | 'health' | 'update' | 'reboot'; confirmation?: string }) => {
      if (action === 'check') return Api.servers.checkUpdates(server.id);
      if (action === 'health') return Api.servers.checkHealth(server.id);
      if (action === 'update') return Api.servers.updatePackages(server.id, confirmation || '');
      return Api.servers.reboot(server.id, confirmation || '');
    },
    onSuccess: (result) => {
      setActiveActionId(result.action.id);
      setConfirmAction(null);
      setError('');
      void refreshAll();
    },
    onError: (reason: Error) => setError(readApiError(reason)),
  });

  useEffect(() => {
    if (!activeActionId) return;
    let stopped = false;
    const refreshAction = async () => {
      try {
        const result = await Api.serverActions.refresh(activeActionId);
        if (stopped) return;
        await refreshAll();
        if (['success', 'failed', 'stopped'].includes(result.action.status)) setActiveActionId(null);
      } catch (reason) {
        if (!stopped) setError(readApiError(reason as Error));
      }
    };
    void refreshAction();
    const timer = window.setInterval(refreshAction, 3500);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [activeActionId]);

  return (
    <div className={`ops-master-detail ops-servers-workspace ${selected ? 'has-inspector' : ''}`}>
      <section className="ops-panel ops-table-panel">
        <div className="ops-servers-summary">
          <div className="ops-servers-summary-main">
            <span className="ops-servers-logo"><OperationsIcon name="server" /></span>
            <div><span className="ops-eyebrow">Ansible inventory</span><h2>{servers.length} managed servers</h2><p>{profile ? `${profile.name} · project ${profile.projectId}` : 'Local inventory ready · connect Semaphore whenever you want'}</p></div>
          </div>
          <InventoryState profile={profile} />
          <div className="ops-servers-summary-actions">
            <button className="ops-button ops-button--secondary" onClick={() => setGroupsOpen(true)}>Groups</button>
            <button className="ops-button ops-button--secondary" onClick={() => setProfileOpen(true)}><OperationsIcon name="settings" /> Semaphore</button>
            {profile ? <button className="ops-button ops-button--secondary" disabled={syncMutation.isPending} onClick={() => profile.inventorySyncState === 'uninitialized' || profile.inventorySyncState === 'conflict' ? setInventoryOpen(true) : syncMutation.mutate()}><OperationsIcon name="refresh" /> {syncMutation.isPending ? 'Syncing…' : 'Sync inventory'}</button> : null}
            <button className="ops-button" onClick={() => setServerModal({ open: true, server: null })}><OperationsIcon name="plus" /> Add server</button>
          </div>
        </div>

        <div className="ops-panel-toolbar ops-servers-toolbar">
          <div className="ops-filter-input"><OperationsIcon name="search" /><input data-module-search value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter servers, IPs or roles…" /></div>
          <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}><option value="all">All groups</option>{groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select>
          <select value={updateFilter} onChange={(event) => setUpdateFilter(event.target.value)}><option value="all">All update states</option><option value="pending">Updates available</option><option value="security">Security updates</option><option value="reboot">Reboot required</option><option value="clean">Up to date</option></select>
        </div>

        {error ? <div className="ops-error-banner">{error}<button onClick={() => setError('')}><OperationsIcon name="close" /></button></div> : null}
        <div className="ops-table-wrap">
          <table className="ops-table ops-servers-table">
            <thead><tr><th>Server</th><th className="ops-server-sync-heading" title="Semaphore inventory status">Sync</th><th>Status</th><th>Groups</th><th>Updates</th><th>Security</th><th>Reboot</th><th>Last update</th><th>Last check</th><th /></tr></thead>
            <tbody>{visible.map((server) => (
              <tr key={server.id} className={selectedId === server.id ? 'is-selected' : ''} onClick={() => setSelectedId(server.id)}>
                <td><div className="ops-cell-device"><span><OperationsIcon name="server" /></span><div><strong>{server.name}</strong><small><span className="ops-mono">{server.primaryIp}</span>{server.role ? ` · ${server.role}` : ''}</small></div></div></td>
                <td><ServerInventoryState server={server} /></td>
                <td><ServerState server={server} /></td>
                <td><div className="ops-server-tags">{server.groups.slice(0, 2).map((group) => <span key={group.id}>{group.name}</span>)}{server.groups.length > 2 ? <small>+{server.groups.length - 2}</small> : null}</div></td>
                <td><UpdateCount value={server.updates} tone={server.updates ? 'warning' : 'ok'} /></td>
                <td><UpdateCount value={server.securityUpdates} tone={server.securityUpdates ? 'danger' : 'neutral'} /></td>
                <td>{server.rebootRequired == null ? <span className="ops-muted">—</span> : <span className={`ops-state ops-state--${server.rebootRequired ? 'warning' : 'neutral'}`}>{server.rebootRequired ? 'Required' : 'No'}</span>}</td>
                <td><LastUpdate server={server} timeZone={timeZone} /></td>
                <td className="ops-muted">{server.lastCheckedAt ? formatRelativeTime(server.lastCheckedAt) : 'Never'}</td>
                <td><OperationsIcon name="chevron" /></td>
              </tr>
            ))}</tbody>
          </table>
          {!serversQuery.isLoading && !visible.length ? <div className="ops-empty-state"><OperationsIcon name="server" /><h3>{servers.length ? 'No matching servers' : 'No servers yet'}</h3><p>{servers.length ? 'Change the active filters.' : 'Add the first server to build the Rakit-managed inventory.'}</p>{!servers.length ? <button className="ops-button" onClick={() => setServerModal({ open: true, server: null })}><OperationsIcon name="plus" /> Add server</button> : null}</div> : null}
        </div>
      </section>

      {selected ? <ServerInspector server={selected} profile={profile} actions={actions} busy={actionMutation.isPending || Boolean(activeActionId)} timeZone={timeZone} onClose={() => setSelectedId(null)} onEdit={() => setServerModal({ open: true, server: selected })} onCheck={() => actionMutation.mutate({ server: selected, action: 'check' })} onHealth={() => actionMutation.mutate({ server: selected, action: 'health' })} onConfirm={setConfirmAction} /> : null}

      <ServerModal open={serverModal.open} server={serverModal.server} groups={groups} devices={devices} onClose={() => setServerModal({ open: false, server: null })} onSaved={async (id) => { setServerModal({ open: false, server: null }); setSelectedId(id); await refreshAll(); }} onError={setError} />
      <SemaphoreModal open={profileOpen} profile={profile} onClose={() => setProfileOpen(false)} onSaved={async () => { setProfileOpen(false); await refreshAll(); }} onError={setError} />
      <GroupsModal open={groupsOpen} groups={groups} onClose={() => setGroupsOpen(false)} onChanged={refreshAll} onError={setError} />
      <InventoryModal open={inventoryOpen} profile={profile} onClose={() => setInventoryOpen(false)} onPublished={async () => { setInventoryOpen(false); await refreshAll(); }} />
      <ConfirmServerAction open={Boolean(confirmAction && selected)} action={confirmAction} server={selected} busy={actionMutation.isPending} onClose={() => setConfirmAction(null)} onConfirm={(confirmation) => {
        if (!selected || !confirmAction) return;
        if (confirmAction === 'remove') return;
        actionMutation.mutate({ server: selected, action: confirmAction, confirmation });
      }} onRemoved={async () => { setConfirmAction(null); setSelectedId(null); await refreshAll(); }} onError={setError} />
    </div>
  );
}

function InventoryState({ profile }: { profile: SemaphoreProfile | null }) {
  if (!profile) return <span className="ops-inventory-state is-neutral"><span />Not configured</span>;
  const labels = { synced: 'Synced', pending: 'Pending', failed: 'Sync failed', conflict: 'Conflict', uninitialized: 'Not published' };
  return <span className={`ops-inventory-state is-${profile.inventorySyncState}`} title={profile.inventorySyncError || undefined}><span />{labels[profile.inventorySyncState]}</span>;
}

function ServerState({ server }: { server: Server }) {
  const tone = server.status === 'online' ? 'ok' : server.status === 'offline' || server.status === 'error' ? 'danger' : server.status === 'maintenance' ? 'warning' : 'neutral';
  return <span className={`ops-state ops-state--${tone}`}><span className="ops-status-dot" />{server.status}</span>;
}

function ServerInventoryState({ server }: { server: Server }) {
  if (!server.ansibleEnabled) return null;
  const synced = server.inventorySyncState === 'synced';
  const title = synced
    ? 'Published in the Semaphore managed inventory'
    : 'Selected for Semaphore, but not synchronized or changed since the last successful sync';
  return <span className={`ops-server-sync ${synced ? 'is-synced' : 'is-pending'}`} title={title} aria-label={title}><OperationsIcon name="refresh" /></span>;
}

function LastUpdate({ server, timeZone }: { server: Server; timeZone: string }) {
  if (!server.lastUpdateAt) return <span className="ops-muted">Never</span>;
  const successful = server.lastUpdateResult === 'success';
  return <span className={`ops-last-update ${successful ? 'is-success' : 'is-failed'}`} title={`${successful ? 'Successful' : 'Failed'} · ${formatDateTime(server.lastUpdateAt, timeZone)}`}><OperationsIcon name={successful ? 'check' : 'close'} /><span>{formatRelativeTime(server.lastUpdateAt)}</span></span>;
}

function UpdateCount({ value, tone }: { value: number | null; tone: string }) {
  if (value == null) return <span className="ops-muted">—</span>;
  return <span className={`ops-update-count is-${tone}`}>{value}</span>;
}

function ServerInspector({ server, profile, actions, busy, timeZone, onClose, onEdit, onCheck, onHealth, onConfirm }: { server: Server; profile: SemaphoreProfile | null; actions: ServerAction[]; busy: boolean; timeZone: string; onClose: () => void; onEdit: () => void; onCheck: () => void; onHealth: () => void; onConfirm: (action: 'update' | 'reboot' | 'remove') => void }) {
  const latestAction = actions[0];
  return <aside className="ops-inspector ops-server-inspector">
    <div className="ops-inspector-header"><div><span className="ops-eyebrow">Server details</span><h2>{server.name}</h2><p className="ops-mono">{server.ansibleAlias} · {server.primaryIp}:{server.sshPort}</p></div><button className="ops-icon-button" onClick={onClose}><OperationsIcon name="close" /></button></div>
    <div className="ops-inspector-body">
      <div className="ops-server-hero"><ServerState server={server} /><span>{server.osName || server.osFamily}{server.osVersion ? ` ${server.osVersion}` : ''}</span></div>
      <section className="ops-server-update-card"><div><span className="ops-eyebrow">Updates</span><strong>{server.updates == null ? 'Not checked' : `${server.updates} available`}</strong><p>{server.securityUpdates == null ? 'Run a check to collect package status.' : `${server.securityUpdates} security · ${server.rebootRequired ? 'reboot required' : 'no reboot required'}`}</p></div><button className="ops-button ops-button--secondary" disabled={busy || !profile || profile.inventorySyncState !== 'synced'} onClick={onCheck}><OperationsIcon name="refresh" /> {busy ? 'Working…' : 'Check now'}</button></section>
      {latestAction ? <section className="ops-server-section"><span className="ops-eyebrow">Latest automation</span><div className="ops-server-action-row"><span className={`ops-state ops-state--${latestAction.status === 'success' ? 'ok' : latestAction.status === 'failed' ? 'danger' : 'info'}`}>{latestAction.status}</span><div><strong>{humanAction(latestAction.action)}{latestAction.source === 'schedule' ? ' · schedule' : ''}</strong><small>{latestAction.resultSummary || latestAction.errorMessage || formatDateTime(latestAction.requestedAt, timeZone)}</small></div></div></section> : null}
      <section className="ops-server-section"><span className="ops-eyebrow">Management</span><div className="ops-server-link-grid"><button className="ops-button ops-button--secondary" disabled={busy || !profile?.healthTemplateId || profile.inventorySyncState !== 'synced'} onClick={onHealth}><OperationsIcon name="activity" /> Health</button>{server.cockpitUrl ? <a className="ops-button ops-button--secondary" href={server.cockpitUrl} target="_blank" rel="noreferrer">Cockpit <OperationsIcon name="link" /></a> : null}{profile ? <a className="ops-button ops-button--secondary" href={profile.uiUrl} target="_blank" rel="noreferrer">Semaphore <OperationsIcon name="link" /></a> : null}<a className="ops-button ops-button--secondary" href={`ssh://${server.primaryIp}:${server.sshPort}`}>SSH <OperationsIcon name="link" /></a></div></section>
      <section className="ops-server-section ops-server-facts"><span className="ops-eyebrow">Details</span><dl><div><dt>Environment</dt><dd>{server.environment || '—'}</dd></div><div><dt>Role</dt><dd>{server.role || '—'}</dd></div><div><dt>Location</dt><dd>{server.location || '—'}</dd></div><div><dt>Rack device</dt><dd>{server.linkedDeviceLabel || 'Not linked'}</dd></div><div><dt>Last package update</dt><dd>{server.lastUpdateAt ? `${server.lastUpdateResult} · ${formatDateTime(server.lastUpdateAt, timeZone)}` : 'Never'}</dd></div><div><dt>Last check</dt><dd>{formatDateTime(server.lastCheckedAt, timeZone, 'Never')}</dd></div><div><dt>Kernel</dt><dd className="ops-mono">{server.kernel || '—'}</dd></div></dl></section>
      {server.notes ? <section className="ops-server-section"><span className="ops-eyebrow">Notes</span><p>{server.notes}</p></section> : null}
    </div>
    <div className="ops-inspector-footer ops-server-footer"><button className="ops-icon-button ops-danger-icon" title="Remove server" onClick={() => onConfirm('remove')}><OperationsIcon name="trash" /></button><button className="ops-button ops-button--secondary" onClick={onEdit}><OperationsIcon name="edit" /> Edit</button><button className="ops-button ops-button--secondary" disabled={busy || !profile?.updateTemplateId || profile.inventorySyncState !== 'synced'} onClick={() => onConfirm('update')}>Update</button><button className="ops-button" disabled={busy || !profile?.rebootTemplateId || profile.inventorySyncState !== 'synced'} onClick={() => onConfirm('reboot')}><OperationsIcon name="power" /> Reboot</button></div>
  </aside>;
}

function ServerModal({ open, server, groups, devices, onClose, onSaved, onError }: { open: boolean; server: Server | null; groups: ServerGroup[]; devices: any[]; onClose: () => void; onSaved: (id: number) => void; onError: (message: string) => void }) {
  const [form, setForm] = useState(emptyServerForm);
  useEffect(() => { if (open) setForm(server ? serverToForm(server) : emptyServerForm); }, [open, server?.id]);
  const mutation = useMutation({
    mutationFn: () => {
      const payload: any = { ...form, sshPort: Number(form.sshPort), linkedDeviceId: form.linkedDeviceId ? Number(form.linkedDeviceId) : null };
      if (server && form.ansibleAlias !== server.ansibleAlias) payload.confirmAliasChange = server.ansibleAlias;
      return server ? Api.servers.update(server.id, payload) : Api.servers.create(payload);
    },
    onSuccess: (result) => onSaved(result.server.id),
    onError: (reason: Error) => onError(readApiError(reason)),
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  return <ModalBase open={open} onClose={onClose} title={server ? `Edit ${server.name}` : 'Add server'} eyebrow="Infrastructure inventory" subtitle="Rakit is the source of truth for this host." size="lg">
    <div className="ops-form-grid ops-server-form">
      <label className="ops-field"><span>Display name</span><input value={form.name} onChange={(event) => set('name', event.target.value)} placeholder="BUZHULK" /></label>
      <label className="ops-field"><span>Ansible alias</span><input className="ops-mono" value={form.ansibleAlias} onChange={(event) => set('ansibleAlias', event.target.value.toLowerCase())} placeholder="buzhulk" /><small>Stable technical identifier used by --limit.</small></label>
      <label className="ops-field"><span>Management IP / DNS</span><input className="ops-mono" value={form.primaryIp} onChange={(event) => set('primaryIp', event.target.value)} /></label>
      <label className="ops-field"><span>SSH port</span><input type="number" min="1" max="65535" value={form.sshPort} onChange={(event) => set('sshPort', event.target.value)} /></label>
      <label className="ops-field"><span>Hostname</span><input value={form.hostname} onChange={(event) => set('hostname', event.target.value)} /></label>
      <label className="ops-field"><span>Cockpit URL</span><input value={form.cockpitUrl} onChange={(event) => set('cockpitUrl', event.target.value)} placeholder="https://server.example:9090" /></label>
      <label className="ops-field"><span>Operating system</span><input value={form.osName} onChange={(event) => set('osName', event.target.value)} /></label>
      <label className="ops-field"><span>OS version</span><input value={form.osVersion} onChange={(event) => set('osVersion', event.target.value)} /></label>
      <label className="ops-field"><span>Environment</span><input value={form.environment} onChange={(event) => set('environment', event.target.value)} placeholder="Production" /></label>
      <label className="ops-field"><span>Role</span><input value={form.role} onChange={(event) => set('role', event.target.value)} placeholder="Docker Host" /></label>
      <label className="ops-field"><span>Location</span><input value={form.location} onChange={(event) => set('location', event.target.value)} /></label>
      <label className="ops-field"><span>Linked rack device</span><select value={form.linkedDeviceId} onChange={(event) => set('linkedDeviceId', event.target.value)}><option value="">No linked device</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.cabinetName} · {device.type}{device.model ? ` · ${device.model}` : ''}</option>)}</select></label>
      <fieldset className="ops-field ops-field--full ops-server-groups-field"><legend>Inventory groups</legend><div>{groups.map((group) => <label key={group.id}><input type="checkbox" checked={form.groupIds.includes(group.id)} onChange={(event) => set('groupIds', event.target.checked ? [...form.groupIds, group.id] : form.groupIds.filter((id) => id !== group.id))} /><span>{group.name}</span></label>)}{!groups.length ? <small>Create a group from the Servers toolbar first.</small> : null}</div></fieldset>
      <label className="ops-field ops-field--full"><span>Notes</span><textarea value={form.notes} onChange={(event) => set('notes', event.target.value)} rows={3} /></label>
      <label className="ops-toggle ops-field--full"><input type="checkbox" checked={form.ansibleEnabled} onChange={(event) => set('ansibleEnabled', event.target.checked)} /><span>Include this server in the managed inventory (published after Semaphore is connected)</span></label>
    </div>
    <div className="ops-modal-actions"><button className="ops-button ops-button--secondary" onClick={onClose}>Cancel</button><button className="ops-button" disabled={mutation.isPending || !form.name.trim() || !form.ansibleAlias.trim() || !form.primaryIp.trim()} onClick={() => mutation.mutate()}>{mutation.isPending ? 'Saving…' : server ? 'Save changes' : 'Add server'}</button></div>
  </ModalBase>;
}

function SemaphoreModal({ open, profile, onClose, onSaved, onError }: { open: boolean; profile: SemaphoreProfile | null; onClose: () => void; onSaved: () => void; onError: (message: string) => void }) {
  const [form, setForm] = useState(emptyProfileForm);
  const [discovered, setDiscovered] = useState<{ projects: any[]; inventories: any[]; templates: any[] }>({ projects: [], inventories: [], templates: [] });
  const [testMessage, setTestMessage] = useState('');
  useEffect(() => { if (open) { setForm(profile ? profileToForm(profile) : emptyProfileForm); setTestMessage(''); } }, [open, profile?.id]);
  const testMutation = useMutation({
    mutationFn: () => Api.semaphore.test({ ...form, projectId: form.projectId ? Number(form.projectId) : null }),
    onSuccess: (result) => {
      setDiscovered({ projects: result.projects ?? [], inventories: result.inventories ?? [], templates: result.templates ?? [] });
      const firstProject = result.projects?.[0];
      setForm((current) => ({ ...current, projectId: current.projectId || (firstProject?.id ? String(firstProject.id) : '') }));
      setTestMessage('Connected. Select the managed inventory and templates.');
    },
    onError: (reason: Error) => { setTestMessage(''); onError(readApiError(reason)); },
  });
  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = numericProfilePayload(form);
      return profile ? Api.semaphore.update(profile.id, payload) : Api.semaphore.create(payload);
    },
    onSuccess: onSaved,
    onError: (reason: Error) => onError(readApiError(reason)),
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  return <ModalBase open={open} onClose={onClose} title="Semaphore integration" eyebrow="Automation controller" subtitle="Credentials stay in Semaphore; Rakit stores only its encrypted API token." size="lg">
    <div className="ops-semaphore-callout"><span><OperationsIcon name="activity" /></span><div><strong>Simple control plane</strong><p>Map one dedicated static inventory and only the templates Rakit is allowed to run.</p></div></div>
    <div className="ops-form-grid">
      <label className="ops-field"><span>Profile name</span><input value={form.name} onChange={(event) => set('name', event.target.value)} /></label>
      <label className="ops-field"><span>API URL</span><input value={form.apiUrl} onChange={(event) => set('apiUrl', event.target.value)} placeholder="https://semaphore.example" /></label>
      <label className="ops-field"><span>UI URL</span><input value={form.uiUrl} onChange={(event) => set('uiUrl', event.target.value)} placeholder="https://semaphore.example" /></label>
      <label className="ops-field"><span>API token</span><input type="password" autoComplete="new-password" value={form.apiToken} onChange={(event) => set('apiToken', event.target.value)} placeholder={profile?.hasToken ? 'Stored — leave blank to keep' : 'Required'} /></label>
      <label className="ops-field"><span>Project</span>{discovered.projects.length ? <select value={form.projectId} onChange={(event) => set('projectId', event.target.value)}><option value="">Select project</option>{discovered.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : <input type="number" min="1" value={form.projectId} onChange={(event) => set('projectId', event.target.value)} />}</label>
      <label className="ops-field"><span>Managed inventory</span>{discovered.inventories.length ? <select value={form.inventoryId} onChange={(event) => set('inventoryId', event.target.value)}><option value="">Select inventory</option>{discovered.inventories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : <input type="number" min="1" value={form.inventoryId} onChange={(event) => set('inventoryId', event.target.value)} />}</label>
      <TemplateSelect label="Check updates template" value={form.checkTemplateId} templates={discovered.templates} onChange={(value) => set('checkTemplateId', value)} />
      <TemplateSelect label="Update packages template" value={form.updateTemplateId} templates={discovered.templates} onChange={(value) => set('updateTemplateId', value)} />
      <TemplateSelect label="Reboot template" value={form.rebootTemplateId} templates={discovered.templates} onChange={(value) => set('rebootTemplateId', value)} />
      <TemplateSelect label="Health template" value={form.healthTemplateId} templates={discovered.templates} onChange={(value) => set('healthTemplateId', value)} />
      <label className="ops-toggle ops-field--full"><input type="checkbox" checked={form.allowSelfSigned} onChange={(event) => set('allowSelfSigned', event.target.checked)} /><span>Allow a self-signed Semaphore certificate for this profile</span></label>
    </div>
    {testMessage ? <div className="ops-success-banner"><OperationsIcon name="check" />{testMessage}</div> : null}
    <div className="ops-modal-actions ops-modal-actions--split"><button className="ops-button ops-button--secondary" disabled={testMutation.isPending || !form.apiUrl || (!profile && !form.apiToken)} onClick={() => testMutation.mutate()}><OperationsIcon name="activity" /> {testMutation.isPending ? 'Testing…' : 'Test & discover'}</button><div><button className="ops-button ops-button--secondary" onClick={onClose}>Cancel</button><button className="ops-button" disabled={saveMutation.isPending || !form.name || !form.apiUrl || !form.uiUrl || !form.projectId || !form.inventoryId || (!profile && !form.apiToken)} onClick={() => saveMutation.mutate()}>{saveMutation.isPending ? 'Saving…' : 'Save integration'}</button></div></div>
  </ModalBase>;
}

function TemplateSelect({ label, value, templates, onChange }: { label: string; value: string; templates: any[]; onChange: (value: string) => void }) {
  return <label className="ops-field"><span>{label}</span>{templates.length ? <select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Not configured</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : <input type="number" min="1" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Optional" />}</label>;
}

function GroupsModal({ open, groups, onClose, onChanged, onError }: { open: boolean; groups: ServerGroup[]; onClose: () => void; onChanged: () => void; onError: (message: string) => void }) {
  const [name, setName] = useState('');
  const [ansibleName, setAnsibleName] = useState('');
  const mutation = useMutation({ mutationFn: () => Api.serverGroups.create({ name, ansibleName }), onSuccess: async () => { setName(''); setAnsibleName(''); await onChanged(); }, onError: (reason: Error) => onError(readApiError(reason)) });
  const remove = useMutation({ mutationFn: (id: number) => Api.serverGroups.remove(id), onSuccess: onChanged, onError: (reason: Error) => onError(readApiError(reason)) });
  return <ModalBase open={open} onClose={onClose} title="Server groups" eyebrow="Ansible inventory" subtitle="Groups are published as native inventory groups.">
    <div className="ops-server-group-list">{groups.map((group) => <div key={group.id}><span><strong>{group.name}</strong><small className="ops-mono">[{group.ansibleName}] · {group.serverCount} servers</small></span><button className="ops-icon-button" disabled={remove.isPending} title="Remove group" onClick={() => remove.mutate(group.id)}><OperationsIcon name="trash" /></button></div>)}{!groups.length ? <div className="ops-empty-inline">No groups configured.</div> : null}</div>
    <div className="ops-server-group-create"><label className="ops-field"><span>Display name</span><input value={name} onChange={(event) => { setName(event.target.value); if (!ansibleName) setAnsibleName(slugify(event.target.value)); }} /></label><label className="ops-field"><span>Ansible name</span><input className="ops-mono" value={ansibleName} onChange={(event) => setAnsibleName(event.target.value.toLowerCase())} /></label><button className="ops-button" disabled={!name.trim() || !ansibleName.trim() || mutation.isPending} onClick={() => mutation.mutate()}><OperationsIcon name="plus" /> Add group</button></div>
  </ModalBase>;
}

function InventoryModal({ open, profile, onClose, onPublished }: { open: boolean; profile: SemaphoreProfile | null; onClose: () => void; onPublished: () => void }) {
  const diff = useQuery({ queryKey: ['semaphore-inventory-diff', profile?.id], queryFn: () => Api.semaphore.inventoryDiff(profile!.id), enabled: open && Boolean(profile) });
  const publish = useMutation({ mutationFn: () => Api.semaphore.adoptInventory(profile!.id), onSuccess: onPublished });
  return <ModalBase open={open} onClose={onClose} title="Publish managed inventory" eyebrow="Review before replace" subtitle="The selected Semaphore inventory will become a generated projection of Rakit." size="lg">
    <div className="ops-inventory-compare"><div><span>Current Semaphore inventory</span><pre>{diff.isLoading ? 'Loading…' : diff.data?.remote || '(empty)'}</pre></div><div><span>Inventory generated by Rakit</span><pre>{diff.isLoading ? 'Loading…' : diff.data?.desired || '(empty)'}</pre></div></div>
    {publish.error ? <div className="ops-error-banner">{readApiError(publish.error as Error)}</div> : null}
    <div className="ops-modal-actions"><button className="ops-button ops-button--secondary" onClick={onClose}>Cancel</button><button className="ops-button ops-button--danger" disabled={diff.isLoading || publish.isPending} onClick={() => publish.mutate()}>{publish.isPending ? 'Publishing…' : 'Replace with Rakit inventory'}</button></div>
  </ModalBase>;
}

function ConfirmServerAction({ open, action, server, busy, onClose, onConfirm, onRemoved, onError }: { open: boolean; action: 'update' | 'reboot' | 'remove' | null; server: Server | null; busy: boolean; onClose: () => void; onConfirm: (confirmation: string) => void; onRemoved: () => void; onError: (message: string) => void }) {
  const [value, setValue] = useState('');
  useEffect(() => { if (open) setValue(''); }, [open, action, server?.id]);
  const remove = useMutation({ mutationFn: () => Api.servers.remove(server!.id, value), onSuccess: onRemoved, onError: (reason: Error) => onError(readApiError(reason)) });
  if (!server || !action) return null;
  const title = action === 'remove' ? 'Remove server' : action === 'reboot' ? 'Reboot server' : 'Update packages';
  return <ModalBase open={open} onClose={onClose} title={title} eyebrow="Confirmation required" subtitle={`This operation targets only ${server.ansibleAlias}.`} size="sm">
    <div className="ops-confirm-copy"><p>Type <strong className="ops-mono">{server.ansibleAlias}</strong> to confirm.</p><label className="ops-field"><span>Ansible alias</span><input className="ops-mono" autoFocus value={value} onChange={(event) => setValue(event.target.value)} /></label></div>
    <div className="ops-modal-actions"><button className="ops-button ops-button--secondary" onClick={onClose}>Cancel</button><button className={`ops-button ${action === 'update' ? '' : 'ops-button--danger'}`} disabled={busy || remove.isPending || value !== server.ansibleAlias} onClick={() => action === 'remove' ? remove.mutate() : onConfirm(value)}>{busy || remove.isPending ? 'Working…' : title}</button></div>
  </ModalBase>;
}

function serverToForm(server: Server) {
  return { name: server.name, ansibleAlias: server.ansibleAlias, primaryIp: server.primaryIp, hostname: server.hostname, sshPort: String(server.sshPort), osName: server.osName, osVersion: server.osVersion, environment: server.environment, role: server.role, location: server.location, cockpitUrl: server.cockpitUrl, notes: server.notes, linkedDeviceId: server.linkedDeviceId ? String(server.linkedDeviceId) : '', groupIds: server.groups.map((group) => group.id), ansibleEnabled: server.ansibleEnabled, status: server.status };
}

function profileToForm(profile: SemaphoreProfile) {
  return { name: profile.name, apiUrl: profile.apiUrl, uiUrl: profile.uiUrl, apiToken: '', projectId: String(profile.projectId), inventoryId: String(profile.inventoryId), checkTemplateId: profile.checkTemplateId ? String(profile.checkTemplateId) : '', updateTemplateId: profile.updateTemplateId ? String(profile.updateTemplateId) : '', rebootTemplateId: profile.rebootTemplateId ? String(profile.rebootTemplateId) : '', healthTemplateId: profile.healthTemplateId ? String(profile.healthTemplateId) : '', allowSelfSigned: profile.allowSelfSigned };
}

function numericProfilePayload(form: typeof emptyProfileForm) {
  return { ...form, projectId: Number(form.projectId), inventoryId: Number(form.inventoryId), checkTemplateId: form.checkTemplateId ? Number(form.checkTemplateId) : null, updateTemplateId: form.updateTemplateId ? Number(form.updateTemplateId) : null, rebootTemplateId: form.rebootTemplateId ? Number(form.rebootTemplateId) : null, healthTemplateId: form.healthTemplateId ? Number(form.healthTemplateId) : null };
}

function slugify(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 63); }
function humanAction(value: string) { return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase()); }
function readApiError(error: Error) { try { return JSON.parse(error.message).error || error.message; } catch { return error.message || 'Operation failed'; } }
