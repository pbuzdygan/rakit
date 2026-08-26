import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Api } from '../../api';
import { OperationsIcon } from '../OperationsIcon';
import { useAppStore } from '../../store';
import { formatDateOnly } from '../../utils/dateTime';

type DevicePort = { id: number; deviceId: number; portNumber: number; patchPanel: string; vlan: string; comment: string; ipAddress: string };
type PortAwareDevice = { id: number; cabinetId: number; cabinetName: string; type: string; model?: string; heightU?: number; position?: number; numberOfPorts: number; portsPerRow?: number | null; managementIp?: string; assetTag?: string; status?: string; face?: string; ports: DevicePort[] };
type Endpoint = { deviceId: number; deviceType: string; deviceModel: string; cabinetId: number; cabinetName: string; portNumber: number };
type PortConnection = { id: number; sourcePortId: number; destinationPortId: number; source: Endpoint; destination: Endpoint; tag: string; vlan: string; ipAddress: string; linkedAssetId: number | null; linkedAssetLabel: string; status: string; comment: string; updatedAt: string };
type ConnectionForm = { tag: string; vlan: string; ipAddress: string; linkedAssetId: string; status: string; comment: string };
type PortForm = { patchPanel: string; vlan: string; ipAddress: string; comment: string };
type InspectorMode = 'port' | 'connection';

export function PortHubView() {
  const qc = useQueryClient();
  const timeZone = useAppStore((state) => state.timeZone);
  const devicesQuery = useQuery({ queryKey: ['porthub-devices'], queryFn: Api.portHub.devices });
  const connectionsQuery = useQuery({ queryKey: ['port-connections'], queryFn: Api.portConnections.list });
  const devices = (devicesQuery.data?.devices ?? []) as PortAwareDevice[];
  const connections = (connectionsQuery.data?.connections ?? []) as PortConnection[];
  const [deviceFilter, setDeviceFilter] = useState('');
  const [connectionFilter, setConnectionFilter] = useState('');
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<number[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<number | null>(null);
  const [selectedPortId, setSelectedPortId] = useState<number | null>(null);
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>('port');
  const [linkMode, setLinkMode] = useState(false);
  const [linkStart, setLinkStart] = useState<DevicePort | null>(null);
  const [error, setError] = useState('');
  const selectionInitialized = useRef(false);

  useEffect(() => {
    setSelectedDeviceIds((current) => {
      const valid = current.filter((id) => devices.some((device) => device.id === id));
      if (!selectionInitialized.current && devices.length) {
        selectionInitialized.current = true;
        return valid.length ? valid : devices.slice(0, 2).map((device) => device.id);
      }
      return valid;
    });
  }, [devicesQuery.data]);

  const selectedDevices = selectedDeviceIds.map((id) => devices.find((device) => device.id === id)).filter(Boolean) as PortAwareDevice[];
  const selectedConnection = connections.find((connection) => connection.id === selectedConnectionId) ?? null;
  const selectedPort = devices.flatMap((device) => device.ports.map((port) => ({ ...port, device }))).find((port) => port.id === selectedPortId) ?? null;
  const pairedPortId = selectedConnection && selectedPortId
    ? selectedConnection.sourcePortId === selectedPortId
      ? selectedConnection.destinationPortId
      : selectedConnection.destinationPortId === selectedPortId
        ? selectedConnection.sourcePortId
        : null
    : null;

  const visibleDevices = useMemo(() => {
    const value = deviceFilter.trim().toLowerCase();
    return value ? devices.filter((device) => [device.type, device.model, device.cabinetName, device.managementIp].some((field) => String(field ?? '').toLowerCase().includes(value))) : devices;
  }, [devices, deviceFilter]);
  const visibleConnections = useMemo(() => {
    const selectedIds = new Set(selectedDeviceIds);
    const scoped = selectedIds.size
      ? connections.filter((connection) => selectedIds.has(connection.source.deviceId) || selectedIds.has(connection.destination.deviceId))
      : [];
    const value = connectionFilter.trim().toLowerCase();
    return value ? scoped.filter((connection) => [connection.tag, connection.vlan, connection.ipAddress, connection.comment, connection.source.deviceType, connection.destination.deviceType].some((field) => String(field ?? '').toLowerCase().includes(value))) : scoped;
  }, [connections, connectionFilter, selectedDeviceIds]);

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['port-connections'] }),
      qc.invalidateQueries({ queryKey: ['porthub-devices'] }),
      qc.invalidateQueries({ queryKey: ['overview'] }),
      qc.invalidateQueries({ queryKey: ['audit'] }),
    ]);
  };

  const createConnection = useMutation({
    mutationFn: ({ source, destination }: { source: DevicePort; destination: DevicePort }) => Api.portConnections.create({ sourcePortId: source.id, destinationPortId: destination.id, status: 'connected' }),
    onSuccess: async (result) => { await refresh(); setSelectedConnectionId(result.connection.id); setSelectedPortId(null); setInspectorMode('connection'); setLinkStart(null); setLinkMode(false); },
    onError: (reason: Error) => setError(readApiError(reason)),
  });

  const toggleDevice = (id: number) => {
    setSelectedDeviceIds((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      return [...current, id];
    });
    setSelectedConnectionId(null);
    setSelectedPortId(null);
    setLinkStart(null);
  };

  const onPortClick = (port: DevicePort) => {
    setError('');
    const existing = connections.find((connection) => connection.sourcePortId === port.id || connection.destinationPortId === port.id);
    if (existing) {
      setSelectedDeviceIds((current) => Array.from(new Set([...current, existing.source.deviceId, existing.destination.deviceId])));
      setSelectedConnectionId(existing.id); setSelectedPortId(port.id); setInspectorMode('port'); setLinkStart(null); return;
    }
    if (linkMode) {
      if (!linkStart) { setLinkStart(port); setSelectedPortId(port.id); return; }
      if (linkStart.deviceId === port.deviceId) { setError('Choose the second port on a different device.'); return; }
      createConnection.mutate({ source: linkStart, destination: port });
      return;
    }
    setSelectedPortId(port.id); setSelectedConnectionId(null); setInspectorMode('port');
  };

  return (
    <div className={`ops-port-layout ${selectedConnection || selectedPort ? 'has-inspector' : ''}`}>
      <aside className="ops-device-browser ops-panel">
        <div className="ops-device-browser-head"><span className="ops-eyebrow">Port-aware devices</span><strong>{devices.length}</strong></div>
        <div className="ops-filter-input ops-filter-input--compact"><OperationsIcon name="search" /><input data-module-search value={deviceFilter} onChange={(event) => setDeviceFilter(event.target.value)} placeholder="Filter devices…" />{deviceFilter ? <button type="button" className="ops-filter-clear" onClick={() => setDeviceFilter('')} aria-label="Clear device filter" title="Clear filter"><OperationsIcon name="close" /></button> : null}</div>
        <div className="ops-device-list">
          {visibleDevices.map((device) => {
            const active = selectedDeviceIds.includes(device.id);
            const used = device.ports.filter((port) => connections.some((connection) => connection.sourcePortId === port.id || connection.destinationPortId === port.id)).length;
            return <button key={device.id} className={active ? 'is-active' : ''} onClick={() => toggleDevice(device.id)}>
              <span className="ops-device-type-icon"><OperationsIcon name={device.type.toLowerCase().includes('patch') ? 'ports' : 'server'} /></span>
              <span><strong>{device.type}{device.model ? ` · ${device.model}` : ''}</strong><small>{device.cabinetName} · {device.numberOfPorts} ports</small><em>{used} mapped</em></span>
              <span className="ops-device-select-state">{active ? selectedDeviceIds.indexOf(device.id) + 1 : ''}</span>
            </button>;
          })}
        </div>
      </aside>

      <div className="ops-port-workspace">
        <section className="ops-panel ops-port-canvas-panel">
          <div className="ops-panel-toolbar">
            <div><span className="ops-eyebrow">Connection canvas</span><strong className="ops-toolbar-title">{selectionLabel(selectedDevices)}</strong></div>
            <div className="ops-toolbar-spacer" />
            <button className={`ops-button ${linkMode ? 'ops-button--active' : 'ops-button--secondary'}`} disabled={selectedDevices.length < 2} onClick={() => { setLinkMode((value) => !value); setLinkStart(null); }}><OperationsIcon name="link" /> {linkMode ? (linkStart ? 'Choose destination' : 'Choose source port') : 'Create link'}</button>
          </div>
          {error ? <div className="ops-error-banner">{error}<button onClick={() => setError('')}><OperationsIcon name="close" /></button></div> : null}
          {selectedDevices.length ? (
            <div className="ops-port-stage">
              {selectedDevices.map((device) => <PortDevice key={device.id} device={device} connections={connections} activeConnectionId={selectedConnectionId} selectedPortId={selectedPortId} pairedPortId={pairedPortId} linkStartId={linkStart?.id ?? null} onPortClick={onPortClick} />)}
            </div>
          ) : <div className="ops-empty-state"><OperationsIcon name="ports" /><h3>Select devices</h3><p>Choose one or more devices from the list to inspect their ports.</p></div>}
        </section>

        <section className="ops-panel ops-table-panel ops-connections-panel">
          <div className="ops-panel-toolbar"><div><span className="ops-eyebrow">Physical topology</span><strong className="ops-toolbar-title">Connections</strong></div><div className="ops-toolbar-spacer" /><div className="ops-filter-input ops-filter-input--compact"><OperationsIcon name="search" /><input value={connectionFilter} onChange={(event) => setConnectionFilter(event.target.value)} placeholder="Filter connections…" /></div></div>
          <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Source</th><th>Destination</th><th>Tag</th><th>VLAN</th><th>Status</th><th>Updated</th></tr></thead><tbody>
            {visibleConnections.map((connection) => <tr key={connection.id} className={selectedConnectionId === connection.id ? 'is-selected' : ''} onClick={() => { setSelectedConnectionId(connection.id); setSelectedPortId(null); setInspectorMode('connection'); }}><td><EndpointCell endpoint={connection.source} /></td><td><EndpointCell endpoint={connection.destination} /></td><td>{connection.tag || '—'}</td><td className="ops-mono">{connection.vlan || '—'}</td><td><span className={`ops-state ops-state--${connection.status === 'connected' ? 'ok' : connection.status === 'warning' ? 'danger' : 'neutral'}`}>{connection.status}</span></td><td className="ops-muted">{formatDateOnly(connection.updatedAt, timeZone)}</td></tr>)}
          </tbody></table>{!connectionsQuery.isLoading && !visibleConnections.length ? <div className="ops-empty-inline">{selectedDeviceIds.length ? 'No connections match the selected devices and filters.' : 'Select at least one device to list its connections.'}</div> : null}</div>
        </section>
      </div>

      {selectedPort && inspectorMode === 'port'
        ? <PortInspector item={selectedPort} connection={selectedConnection} onShowConnection={() => setInspectorMode('connection')} onClose={() => { setSelectedPortId(null); setSelectedConnectionId(null); }} onRefresh={refresh} onError={setError} />
        : selectedConnection
          ? <ConnectionInspector connection={selectedConnection} devices={devices} selectedPort={selectedPort} onShowPort={() => setInspectorMode('port')} onClose={() => { setSelectedConnectionId(null); setSelectedPortId(null); }} onRefresh={refresh} onError={setError} />
          : null}
    </div>
  );
}

function PortDevice({ device, connections, activeConnectionId, selectedPortId, pairedPortId, linkStartId, onPortClick }: { device: PortAwareDevice; connections: PortConnection[]; activeConnectionId: number | null; selectedPortId: number | null; pairedPortId: number | null; linkStartId: number | null; onPortClick: (port: DevicePort) => void }) {
  const automaticColumns = device.numberOfPorts <= 24 ? device.numberOfPorts : Math.ceil(device.numberOfPorts / 2);
  const columns = device.portsPerRow ?? automaticColumns;
  const twoRows = columns < device.numberOfPorts;
  const mappedPorts = new Set(connections.flatMap((connection) => [connection.sourcePortId, connection.destinationPortId]));
  const mappedCount = device.ports.filter((port) => mappedPorts.has(port.id)).length;
  const layoutDescription = twoRows ? `${columns} ports per row · 2 rows` : `${device.numberOfPorts} ports · 1 row`;
  return <article className={`ops-port-device ops-port-device--status-${portDeviceStatusTone(device.status)}`}>
    <header className="ops-port-device-header">
      <div className="ops-port-device-identity"><strong>{deviceLabel(device)}</strong><small>{device.cabinetName}{device.position ? ` · U${device.position}` : ''}{device.assetTag ? ` · ${device.assetTag}` : ''}</small></div>
      <div className="ops-port-device-network"><code>{device.managementIp || 'No management IP'}</code><small>{layoutDescription}</small></div>
      <div className="ops-port-device-state"><b>{device.status || 'unknown'}</b><small>{mappedCount}/{device.numberOfPorts} mapped</small></div>
    </header>
    <div className="ops-switch-face"><div className="ops-switch-ports" style={{ gridTemplateColumns: `repeat(${columns}, 30px)` }}>
      {device.ports.map((port) => {
        const connection = connections.find((item) => item.sourcePortId === port.id || item.destinationPortId === port.id);
        const gridPosition = twoRows ? { gridColumn: Math.ceil(port.portNumber / 2), gridRow: port.portNumber % 2 === 1 ? 1 : 2 } : undefined;
        return <button key={port.id} style={gridPosition} title={`Port ${port.portNumber}${port.patchPanel ? ` · ${port.patchPanel}` : ''}`} className={`${connection ? 'is-connected' : ''} ${connection?.id === activeConnectionId ? 'is-active' : ''} ${selectedPortId === port.id ? 'is-selected' : ''} ${pairedPortId === port.id ? 'is-paired' : ''} ${linkStartId === port.id ? 'is-link-start' : ''}`} onClick={() => onPortClick(port)}><span>{port.portNumber}</span></button>;
      })}
    </div></div>
  </article>;
}

function ConnectionInspector({ connection, devices, selectedPort, onShowPort, onClose, onRefresh, onError }: { connection: PortConnection; devices: PortAwareDevice[]; selectedPort?: (DevicePort & { device: PortAwareDevice }) | null; onShowPort?: () => void; onClose: () => void; onRefresh: () => Promise<void>; onError: (message: string) => void }) {
  const [form, setForm] = useState<ConnectionForm>(() => connectionForm(connection));
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => { setForm(connectionForm(connection)); setConfirmRemove(false); }, [connection.id, connection.updatedAt]);
  useEffect(() => {
    if (!confirmRemove) return;
    const timeout = window.setTimeout(() => setConfirmRemove(false), 5000);
    return () => window.clearTimeout(timeout);
  }, [confirmRemove]);
  const save = useMutation({ mutationFn: () => Api.portConnections.update(connection.id, { ...form, linkedAssetId: form.linkedAssetId ? Number(form.linkedAssetId) : null }), onSuccess: onRefresh, onError: (reason: Error) => onError(readApiError(reason)) });
  const remove = useMutation({ mutationFn: () => Api.portConnections.remove(connection.id), onSuccess: async () => { onClose(); await onRefresh(); }, onError: (reason: Error) => onError(readApiError(reason)) });
  const update = (key: keyof ConnectionForm, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return <aside className="ops-inspector"><div className="ops-inspector-header"><div><span className="ops-eyebrow">Connection #{connection.id}</span><h2>{connection.source.deviceType} → {connection.destination.deviceType}</h2><span className={`ops-state ops-state--${connection.status === 'connected' ? 'ok' : 'neutral'}`}>{connection.status}</span></div><button className="ops-icon-button" onClick={onClose}><OperationsIcon name="close" /></button></div>
    {selectedPort && onShowPort ? <InspectorTabs mode="connection" portNumber={selectedPort.portNumber} onShowPort={onShowPort} /> : null}
    <div className="ops-inspector-body"><div className="ops-connection-route"><EndpointCell endpoint={connection.source} /><span><OperationsIcon name="link" /></span><EndpointCell endpoint={connection.destination} /></div><div className="ops-form-grid"><label className="ops-field"><span>Tag / circuit</span><input value={form.tag} onChange={(event) => update('tag', event.target.value)} /></label><label className="ops-field"><span>VLAN</span><input value={form.vlan} onChange={(event) => update('vlan', event.target.value)} /></label><label className="ops-field ops-field--full"><span>IP address</span><input className="ops-mono" value={form.ipAddress} onChange={(event) => update('ipAddress', event.target.value)} /></label><label className="ops-field ops-field--full"><span>Linked asset</span><select value={form.linkedAssetId} onChange={(event) => update('linkedAssetId', event.target.value)}><option value="">None</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.cabinetName} · {deviceLabel(device)}</option>)}</select></label><label className="ops-field ops-field--full"><span>Status</span><select value={form.status} onChange={(event) => update('status', event.target.value)}><option value="connected">Connected</option><option value="disconnected">Disconnected</option><option value="planned">Planned</option><option value="warning">Warning</option></select></label><label className="ops-field ops-field--full"><span>Comment</span><textarea rows={4} value={form.comment} onChange={(event) => update('comment', event.target.value)} /></label></div></div>
    <div className="ops-inspector-footer ops-inspector-footer--split"><button className={`ops-button ops-button--danger ops-inline-confirm ${confirmRemove ? 'is-confirming' : ''}`} disabled={remove.isPending} onClick={() => { if (confirmRemove) remove.mutate(); else setConfirmRemove(true); }}><OperationsIcon name="trash" /> {remove.isPending ? 'Removing…' : confirmRemove ? 'Confirm removal' : 'Remove'}</button><button className="ops-button" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save connection'}</button></div></aside>;
}

function PortInspector({ item, connection, onShowConnection, onClose, onRefresh, onError }: { item: DevicePort & { device: PortAwareDevice }; connection: PortConnection | null; onShowConnection: () => void; onClose: () => void; onRefresh: () => Promise<void>; onError: (message: string) => void }) {
  const [form, setForm] = useState<PortForm>({ patchPanel: item.patchPanel, vlan: item.vlan, ipAddress: item.ipAddress, comment: item.comment });
  useEffect(() => setForm({ patchPanel: item.patchPanel, vlan: item.vlan, ipAddress: item.ipAddress, comment: item.comment }), [item.id]);
  const save = useMutation({ mutationFn: () => Api.devicePorts.update(item.device.cabinetId, item.device.id, item.portNumber, form), onSuccess: onRefresh, onError: (reason: Error) => onError(readApiError(reason)) });
  const update = (key: keyof PortForm, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return <aside className="ops-inspector"><div className="ops-inspector-header"><div><span className="ops-eyebrow">Port metadata</span><h2>{deviceLabel(item.device)} · Port {item.portNumber}</h2><span className={`ops-state ops-state--${connection ? 'ok' : 'neutral'}`}>{connection ? 'connected' : 'unmapped'}</span></div><button className="ops-icon-button" onClick={onClose}><OperationsIcon name="close" /></button></div>{connection ? <InspectorTabs mode="port" portNumber={item.portNumber} onShowConnection={onShowConnection} /> : null}<div className="ops-inspector-body"><div className="ops-form-grid"><label className="ops-field ops-field--full"><span>Patch panel label</span><input value={form.patchPanel} onChange={(event) => update('patchPanel', event.target.value)} /></label><label className="ops-field"><span>VLAN</span><input value={form.vlan} onChange={(event) => update('vlan', event.target.value)} /></label><label className="ops-field"><span>IP address</span><input value={form.ipAddress} onChange={(event) => update('ipAddress', event.target.value)} /></label><label className="ops-field ops-field--full"><span>Comment</span><textarea rows={5} value={form.comment} onChange={(event) => update('comment', event.target.value)} /></label></div><div className="ops-inspector-hint"><OperationsIcon name="link" /><p>{connection ? <>This port belongs to connection <strong>#{connection.id}</strong>. Use the Connection tab to edit or remove the link.</> : <>Enable <strong>Create link</strong>, then choose this port and a free port on the second device.</>}</p></div></div><div className="ops-inspector-footer"><button className="ops-button" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save port metadata'}</button></div></aside>;
}

function InspectorTabs({ mode, portNumber, onShowPort, onShowConnection }: { mode: InspectorMode; portNumber: number; onShowPort?: () => void; onShowConnection?: () => void }) {
  return <div className="ops-inspector-tabs" aria-label="Inspector view"><button type="button" className={mode === 'port' ? 'is-active' : ''} onClick={onShowPort}>Port {portNumber}</button><button type="button" className={mode === 'connection' ? 'is-active' : ''} onClick={onShowConnection}>Connection</button></div>;
}

function EndpointCell({ endpoint }: { endpoint: Endpoint }) { return <div className="ops-endpoint"><strong>{endpoint.deviceType}{endpoint.deviceModel ? ` · ${endpoint.deviceModel}` : ''}</strong><small>{endpoint.cabinetName} · port <span className="ops-mono">{endpoint.portNumber}</span></small></div>; }
function deviceLabel(device: PortAwareDevice) { return `${device.type}${device.model ? ` · ${device.model}` : ''}`; }
function selectionLabel(devices: PortAwareDevice[]) { if (!devices.length) return 'Select devices'; if (devices.length === 1) return deviceLabel(devices[0]); if (devices.length === 2) return `${deviceLabel(devices[0])} ↔ ${deviceLabel(devices[1])}`; return `${devices.length} devices selected`; }
function portDeviceStatusTone(status?: string) { if (status === 'online') return 'online'; if (status === 'offline') return 'offline'; if (status === 'maintenance' || status === 'warning') return 'maintenance'; if (status === 'planned') return 'planned'; return 'neutral'; }
function connectionForm(connection: PortConnection): ConnectionForm { return { tag: connection.tag, vlan: connection.vlan, ipAddress: connection.ipAddress, linkedAssetId: connection.linkedAssetId ? String(connection.linkedAssetId) : '', status: connection.status, comment: connection.comment }; }
function readApiError(error: Error) { try { return JSON.parse(error.message).error || error.message; } catch { return error.message || 'Operation failed'; } }
