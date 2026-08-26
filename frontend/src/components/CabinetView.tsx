import { useEffect, useState } from 'react';
import { DndContext, DragEndEvent, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Api } from '../api';
import { useAppStore } from '../store';
import { OperationsIcon } from './OperationsIcon';
import { formatDateOnly } from '../utils/dateTime';

type Cabinet = { id: number; name: string; location?: string; sizeU: number; symbol?: string; numberingDirection?: 'bottom-up' | 'top-down' };
type RackLane = 'full' | 'left' | 'right';
type RackFace = 'front' | 'rear' | 'both';
type Device = { id: number; cabinetId: number; type: string; model?: string; heightU: number; position: number; comment?: string; portAware?: boolean; numberOfPorts?: number | null; portsPerRow?: number | null; managementIp?: string; assetTag?: string; status?: string; face?: string; rackLane?: RackLane };
type DevicePort = { id: number; portNumber: number; patchPanel: string; vlan: string; ipAddress: string; comment: string };
type PlacementProposal = { device: Device; position: number; face: RackFace; splitDevice: Device | null; availableLanes: Array<'left' | 'right'> };

export function CabinetView() {
  const qc = useQueryClient();
  const selectedCabinetId = useAppStore((state) => state.selectedCabinetId);
  const setSelectedCabinetId = useAppStore((state) => state.setSelectedCabinetId);
  const setEditingCabinetId = useAppStore((state) => state.setEditingCabinetId);
  const setEditingDevice = useAppStore((state) => state.setEditingDevice);
  const openModal = useAppStore((state) => state.openModal);
  const openCommentModal = useAppStore((state) => state.openCommentModal);
  const timeZone = useAppStore((state) => state.timeZone);
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);
  const [reorder, setReorder] = useState(false);
  const [showRear, setShowRear] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<'details' | 'ports' | 'activity'>('details');
  const [error, setError] = useState('');
  const [placementProposal, setPlacementProposal] = useState<PlacementProposal | null>(null);
  const [confirmRemoveDeviceId, setConfirmRemoveDeviceId] = useState<number | null>(null);
  const [cabinetFilter, setCabinetFilter] = useState('');
  const [cabinetSearchOpen, setCabinetSearchOpen] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const cabinetsQuery = useQuery({ queryKey: ['cabinets'], queryFn: Api.cabinets.list });
  const cabinets = (cabinetsQuery.data?.cabinets ?? []) as Cabinet[];
  useEffect(() => {
    if (!cabinets.length) return;
    if (!selectedCabinetId || !cabinets.some((cabinet) => cabinet.id === selectedCabinetId)) setSelectedCabinetId(cabinets[0].id);
  }, [cabinets, selectedCabinetId, setSelectedCabinetId]);
  const cabinet = cabinets.find((entry) => entry.id === selectedCabinetId) ?? null;
  const devicesQuery = useQuery({ queryKey: ['cabinet-devices', cabinet?.id ?? null], queryFn: () => Api.devices.list(cabinet!.id), enabled: Boolean(cabinet) });
  const allDevices = (devicesQuery.data?.devices ?? []) as Device[];
  const matchingCabinets = cabinets.filter((entry) => {
    const value = cabinetFilter.trim().toLowerCase();
    return !value || [entry.name, entry.symbol, entry.location].some((field) => String(field ?? '').toLowerCase().includes(value));
  });
  const cabinetOptions = cabinet && !matchingCabinets.some((entry) => entry.id === cabinet.id)
    ? [cabinet, ...matchingCabinets]
    : matchingCabinets;
  const selectedDevice = allDevices.find((device) => device.id === selectedDeviceId) ?? null;
  const portsQuery = useQuery({ queryKey: ['device-ports', selectedDevice?.cabinetId, selectedDevice?.id], queryFn: () => Api.devicePorts.list(selectedDevice!.cabinetId, selectedDevice!.id), enabled: Boolean(selectedDevice?.portAware) });
  const auditQuery = useQuery({ queryKey: ['audit', 100], queryFn: () => Api.audit(100), enabled: inspectorTab === 'activity' });

  useEffect(() => {
    if (selectedDeviceId && !allDevices.some((device) => device.id === selectedDeviceId)) setSelectedDeviceId(null);
  }, [allDevices, selectedDeviceId]);

  useEffect(() => {
    if (confirmRemoveDeviceId == null) return;
    const timeout = window.setTimeout(() => setConfirmRemoveDeviceId(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [confirmRemoveDeviceId]);

  const refreshCabinet = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['cabinet-devices', selectedCabinetId] }),
      qc.invalidateQueries({ queryKey: ['all-devices'] }),
      qc.invalidateQueries({ queryKey: ['porthub-devices'] }),
      qc.invalidateQueries({ queryKey: ['overview'] }),
      qc.invalidateQueries({ queryKey: ['audit'] }),
    ]);
  };
  const placeMutation = useMutation({
    mutationFn: ({ device, position, rackLane, face, splitDeviceId }: { device: Device; position: number; rackLane: RackLane; face: RackFace; splitDeviceId?: number }) => Api.devices.place(device.cabinetId, device.id, { position, rackLane, face, splitDeviceId }),
    onSuccess: async () => { setPlacementProposal(null); setError(''); await refreshCabinet(); },
    onError: (reason: Error) => setError(readApiError(reason)),
  });
  const removeDevice = useMutation({
    mutationFn: (device: Device) => Api.devices.remove(device.cabinetId, device.id),
    onSuccess: async () => { setConfirmRemoveDeviceId(null); setSelectedDeviceId(null); await refreshCabinet(); },
    onError: (reason: Error) => setError(readApiError(reason)),
  });
  const editDevice = (device: Device) => {
    setEditingDevice({ id: device.id, cabinetId: device.cabinetId, type: device.type, model: device.model, heightU: device.heightU, position: device.position, portAware: Boolean(device.portAware), numberOfPorts: device.numberOfPorts ?? null, portsPerRow: device.portsPerRow ?? null, managementIp: device.managementIp, assetTag: device.assetTag, status: device.status, face: device.face, rackLane: device.rackLane });
    openModal('addDevice');
  };

  const onDragEnd = (event: DragEndEvent) => {
    if (!event.over || !cabinet) return;
    const device = allDevices.find((entry) => entry.id === Number(event.active.data.current?.deviceId));
    const requestedPosition = Number(event.over.data.current?.position);
    const requestedLane = event.over.data.current?.rackLane;
    const requestedFace = event.over.data.current?.face;
    if (!device || !Number.isInteger(requestedPosition) || !isRackLane(requestedLane) || !isRackFace(requestedFace)) return;
    const deviceFace = device.face || 'front';
    const face: RackFace = deviceFace === 'both' ? 'both' : requestedFace;
    const position = Math.max(1, Math.min(requestedPosition, cabinet.sizeU - device.heightU + 1));
    const overlaps = allDevices.filter((entry) => entry.id !== device.id && deviceFacesConflict(face, entry.face) && rangesOverlap(position, device.heightU, entry.position, entry.heightU));

    if (requestedLane === 'full') {
      if (overlaps.length) {
        setError('Full-width placement is occupied. Drop the device on an available left or right half.');
        return;
      }
      setError('');
      if (position !== device.position || (device.rackLane || 'full') !== 'full' || face !== deviceFace) placeMutation.mutate({ device, position, rackLane: 'full', face });
      return;
    }

    const fullWidth = overlaps.filter((entry) => (entry.rackLane || 'full') === 'full');
    if (fullWidth.length > 1) {
      setError('This placement overlaps more than one full-width device. Move or resize those devices first.');
      return;
    }
    const remaining = fullWidth.length === 1 ? overlaps.filter((entry) => entry.id !== fullWidth[0].id) : overlaps;
    const availableLanes = (['left', 'right'] as const).filter((lane) => remaining.every((entry) => (entry.rackLane || 'full') !== 'full' && entry.rackLane !== lane));
    if (!availableLanes.length) {
      setError('Both sides of this rack position are occupied.');
      return;
    }
    if (!fullWidth.length) {
      if (!availableLanes.includes(requestedLane)) {
        const availableSide = availableLanes[0] === 'left' ? 'left' : 'right';
        setError(`The ${requestedLane} side is occupied. Drop the device on the ${availableSide} side.`);
        return;
      }
      setError('');
      if (position !== device.position || (device.rackLane || 'full') !== requestedLane || face !== deviceFace) placeMutation.mutate({ device, position, rackLane: requestedLane, face });
      return;
    }
    setError('');
    setPlacementProposal({ device, position, face, splitDevice: fullWidth[0] ?? null, availableLanes });
  };

  const placeOnLane = (rackLane: 'left' | 'right') => {
    if (!placementProposal) return;
    placeMutation.mutate({ device: placementProposal.device, position: placementProposal.position, rackLane, face: placementProposal.face, splitDeviceId: placementProposal.splitDevice?.id });
  };

  if (!cabinetsQuery.isLoading && !cabinets.length) {
    return <section className="ops-panel ops-empty-state ops-empty-state--large"><OperationsIcon name="rack" /><h2>No cabinets configured</h2><p>Create your first rack and choose whether U numbering starts at the top or bottom.</p><button className="ops-button" onClick={() => { setEditingCabinetId(null); openModal('addCabinet'); }}><OperationsIcon name="plus" /> Add cabinet</button></section>;
  }

  const numberingDirection = cabinet?.numberingDirection || 'bottom-up';
  const visualUnits = cabinet ? Array.from({ length: cabinet.sizeU }, (_, index) => numberingDirection === 'top-down' ? index + 1 : cabinet.sizeU - index) : [];

  return <div className={`ops-rack-layout ${selectedDevice ? 'has-inspector' : ''}`}>
    <section className="ops-rack-main">
      <div className="ops-rack-commandbar ops-panel">
        <div className="ops-cabinet-selector"><span>Cabinet</span><select value={selectedCabinetId ?? ''} onChange={(event) => { setSelectedCabinetId(Number(event.target.value)); setSelectedDeviceId(null); }} disabled={cabinetsQuery.isLoading}>{cabinetOptions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.symbol ? ` (${entry.symbol})` : ''} · {entry.location || 'No location'}</option>)}</select></div>
        <div className="ops-rack-cabinet-search">
          <div className="ops-filter-input ops-filter-input--compact"><OperationsIcon name="search" /><input data-module-search value={cabinetFilter} onFocus={() => setCabinetSearchOpen(true)} onBlur={() => window.setTimeout(() => setCabinetSearchOpen(false), 120)} onChange={(event) => { setCabinetFilter(event.target.value); setCabinetSearchOpen(true); }} onKeyDown={(event) => { if (event.key === 'Escape') { setCabinetSearchOpen(false); return; } if (event.key === 'Enter' && matchingCabinets[0]) { event.preventDefault(); setSelectedCabinetId(matchingCabinets[0].id); setSelectedDeviceId(null); setCabinetFilter(''); setCabinetSearchOpen(false); } }} placeholder="Find cabinet…" aria-label="Find cabinet" />{cabinetFilter ? <button type="button" className="ops-filter-clear" onClick={() => setCabinetFilter('')} aria-label="Clear cabinet search"><OperationsIcon name="close" /></button> : null}</div>
          {cabinetSearchOpen ? <div className="ops-cabinet-search-results" role="listbox" aria-label="Matching cabinets">
            {matchingCabinets.length ? matchingCabinets.map((entry) => <button key={entry.id} type="button" role="option" aria-selected={entry.id === selectedCabinetId} className={entry.id === selectedCabinetId ? 'is-active' : ''} onMouseDown={(event) => { event.preventDefault(); setSelectedCabinetId(entry.id); setSelectedDeviceId(null); setCabinetFilter(''); setCabinetSearchOpen(false); }}><span><strong>{entry.name}</strong><small>{[entry.location, entry.symbol].filter(Boolean).join(' · ') || 'No location'}</small></span><em>{entry.sizeU}U</em></button>) : <div className="ops-cabinet-search-empty">No matching cabinets.</div>}
          </div> : null}
        </div>
        <div className="ops-toolbar-spacer" />
        <button className={`ops-button ${showRear ? 'ops-button--active' : 'ops-button--secondary'}`} aria-pressed={showRear} onClick={() => { if (showRear && selectedDevice?.face === 'rear') setSelectedDeviceId(null); setShowRear((value) => !value); }}><OperationsIcon name="rack" /> {showRear ? 'Hide rear' : 'Show rear'}</button>
        <button className="ops-button" disabled={!cabinet} onClick={() => { setEditingDevice(null); openModal('addDevice'); }}><OperationsIcon name="plus" /> Add device</button>
        <button className={`ops-button ops-layout-toggle ${reorder ? 'ops-button--active' : 'ops-button--secondary'}`} onClick={() => setReorder((value) => !value)}><OperationsIcon name="rack" /> {reorder ? 'Confirm layout' : 'Reorder'}</button>
      </div>
      {error ? <div className="ops-error-banner">{error}<button onClick={() => setError('')}><OperationsIcon name="close" /></button></div> : null}
      {cabinet ? <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}><div className={`ops-rack-elevations ${showRear ? 'is-dual' : ''}`}>
        <RackElevation face="front" cabinet={cabinet} devices={allDevices} occupancyDevices={allDevices} visualUnits={visualUnits} numberingDirection={numberingDirection} selectedDeviceId={selectedDeviceId} reorder={reorder} onSelect={(device) => { if (!reorder) { setSelectedDeviceId(device.id); setInspectorTab('details'); } }} />
        {showRear ? <RackElevation face="rear" cabinet={cabinet} devices={allDevices} occupancyDevices={allDevices} visualUnits={visualUnits} numberingDirection={numberingDirection} selectedDeviceId={selectedDeviceId} reorder={reorder} onSelect={(device) => { if (!reorder) { setSelectedDeviceId(device.id); setInspectorTab('details'); } }} /> : null}
      </div></DndContext> : null}
    </section>

    {selectedDevice ? <aside className="ops-inspector ops-rack-inspector">
      <div className="ops-inspector-header"><div><span className="ops-eyebrow">U{selectedDevice.position}{selectedDevice.heightU > 1 ? `–U${selectedDevice.position + selectedDevice.heightU - 1}` : ''} · {selectedDevice.face || 'front'}</span><h2>{selectedDevice.type}</h2><p>{selectedDevice.model || 'Model not specified'}</p></div><button className="ops-icon-button" onClick={() => setSelectedDeviceId(null)}><OperationsIcon name="close" /></button></div>
      <div className="ops-inspector-tabs"><button className={inspectorTab === 'details' ? 'is-active' : ''} onClick={() => setInspectorTab('details')}>Details</button><button className={inspectorTab === 'ports' ? 'is-active' : ''} disabled={!selectedDevice.portAware} onClick={() => setInspectorTab('ports')}>Ports</button><button className={inspectorTab === 'activity' ? 'is-active' : ''} onClick={() => setInspectorTab('activity')}>Activity</button></div>
      <div className="ops-inspector-body">{inspectorTab === 'details' ? <DeviceDetails device={selectedDevice} /> : null}{inspectorTab === 'ports' ? <DevicePorts ports={(portsQuery.data?.ports ?? []) as DevicePort[]} loading={portsQuery.isLoading} /> : null}{inspectorTab === 'activity' ? <DeviceActivity device={selectedDevice} events={(auditQuery.data?.events ?? []) as any[]} timeZone={timeZone} /> : null}</div>
      <div className="ops-inspector-footer ops-inspector-footer--split"><button className={`ops-button ops-button--danger ops-inline-confirm ${confirmRemoveDeviceId === selectedDevice.id ? 'is-confirming' : ''}`} disabled={removeDevice.isPending} onClick={() => { if (confirmRemoveDeviceId === selectedDevice.id) removeDevice.mutate(selectedDevice); else setConfirmRemoveDeviceId(selectedDevice.id); }}><OperationsIcon name="trash" /> {removeDevice.isPending ? 'Removing…' : confirmRemoveDeviceId === selectedDevice.id ? 'Confirm removal' : 'Remove'}</button><div><button className="ops-button ops-button--secondary" onClick={() => openCommentModal(selectedDevice.id, selectedDevice.cabinetId, selectedDevice.comment || '')}>Note</button><button className="ops-button" onClick={() => editDevice(selectedDevice)}><OperationsIcon name="edit" /> Edit</button></div></div>
    </aside> : null}

    {placementProposal ? <div className="ops-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPlacementProposal(null); }}><div className="ops-dialog ops-rack-placement-dialog">
      <div className="ops-inspector-header"><div><span className="ops-eyebrow">Rack placement · U{placementProposal.position}</span><h2>Place devices side by side</h2><p>Choose the side for {placementProposal.device.type}.</p></div><button className="ops-icon-button" onClick={() => setPlacementProposal(null)}><OperationsIcon name="close" /></button></div>
      <div className="ops-placement-body"><div className="ops-placement-preview"><div className="ops-placement-unit">U{placementProposal.position}</div>{(['left', 'right'] as const).map((lane) => <button key={lane} disabled={!placementProposal.availableLanes.includes(lane) || placeMutation.isPending} onClick={() => placeOnLane(lane)}><span>{lane === 'left' ? 'Left half' : 'Right half'}</span><strong>{placementProposal.device.type}</strong><small>{placementProposal.splitDevice ? `The existing ${placementProposal.splitDevice.type} will use the opposite side.` : 'Place on the free side of this U.'}</small></button>)}</div><p>This changes both devices to half-width placement when the existing device currently occupies the full rack width.</p></div>
      <div className="ops-inspector-footer"><button className="ops-button ops-button--secondary" onClick={() => setPlacementProposal(null)}>Cancel</button></div>
    </div></div> : null}
  </div>;
}

function RackElevation({ face, cabinet, devices, occupancyDevices, visualUnits, numberingDirection, selectedDeviceId, reorder, onSelect }: { face: 'front' | 'rear'; cabinet: Cabinet; devices: Device[]; occupancyDevices: Device[]; visualUnits: number[]; numberingDirection: 'bottom-up' | 'top-down'; selectedDeviceId: number | null; reorder: boolean; onSelect: (device: Device) => void }) {
  const visibleDevices = devices.filter((device) => (device.face || 'front') === face || device.face === 'both');
  const occupiedDevices = occupancyDevices.filter((device) => (device.face || 'front') === face || device.face === 'both');
  return <div className="ops-rack-scroll"><div className="ops-rack-frame-head">
    <div className="ops-rack-frame-identity"><strong>{cabinet.name}</strong><span>{cabinet.symbol || 'RACK'}</span></div>
    <span className={`ops-rack-face-indicator ops-rack-face-indicator--${face}`}>{face}</span>
    <em>{cabinet.sizeU}U</em>
  </div><div className="ops-rack-frame" style={{ gridTemplateRows: `repeat(${cabinet.sizeU}, 24px)` }}>
    {visualUnits.map((unit, index) => <RackUnit key={unit} face={face} unit={unit} row={index + 1} occupied={occupiedDevices.some((device) => unit >= device.position && unit < device.position + device.heightU)} />)}
    {visibleDevices.map((device) => <RackDevice key={`${face}-${device.id}`} face={face} device={device} cabinetSize={cabinet.sizeU} numberingDirection={numberingDirection} selected={device.id === selectedDeviceId} reorder={reorder} onSelect={() => onSelect(device)} />)}
  </div></div>;
}

function RackUnit({ face, unit, row, occupied }: { face: 'front' | 'rear'; unit: number; row: number; occupied: boolean }) {
  const label = String(unit).padStart(2, '0');
  return <><div className="ops-rack-unit-label" style={{ gridRow: row, gridColumn: 1 }}>{label}</div><div className={`ops-rack-unit ${occupied ? 'is-occupied' : ''}`} style={{ gridRow: row, gridColumn: 2 }}><RackDropZone face={face} unit={unit} rackLane="left" /><RackDropZone face={face} unit={unit} rackLane="full" /><RackDropZone face={face} unit={unit} rackLane="right" /></div><div className="ops-rack-unit-label" style={{ gridRow: row, gridColumn: 3 }}>{label}</div></>;
}

function RackDropZone({ face, unit, rackLane }: { face: 'front' | 'rear'; unit: number; rackLane: RackLane }) {
  const { setNodeRef, isOver } = useDroppable({ id: `rack-unit-${face}-${unit}-${rackLane}`, data: { position: unit, rackLane, face } });
  return <div ref={setNodeRef} className={`ops-rack-drop-zone ops-rack-drop-zone--${rackLane} ${isOver ? 'is-over' : ''}`} data-drop-label={rackLane} />;
}

function RackDevice({ face, device, cabinetSize, numberingDirection, selected, reorder, onSelect }: { face: 'front' | 'rear'; device: Device; cabinetSize: number; numberingDirection: 'bottom-up' | 'top-down'; selected: boolean; reorder: boolean; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `rack-device-${face}-${device.id}`, data: { deviceId: device.id, face }, disabled: !reorder });
  const topRow = numberingDirection === 'top-down' ? device.position : cabinetSize - (device.position + device.heightU - 1) + 1;
  const lane = device.rackLane || 'full';
  const style: React.CSSProperties = { gridRow: `${topRow} / span ${device.heightU}`, gridColumn: 2, width: lane === 'full' ? undefined : 'calc(50% - 5px)', justifySelf: lane === 'right' ? 'end' : lane === 'left' ? 'start' : undefined, transform: transform ? `translate3d(${transform.x}px, ${transform.y}px,0)` : undefined };
  return <button ref={setNodeRef} type="button" className={`ops-rack-device ops-rack-device--status-${deviceStatusTone(device.status)} ops-rack-device--lane-${lane} ${selected ? 'is-selected' : ''} ${reorder ? 'is-reorder' : ''} ${isDragging ? 'is-dragging' : ''}`} style={style} onClick={onSelect} {...(reorder ? attributes : {})} {...(reorder ? listeners : {})}>
    <span className={`ops-rack-device-label ${device.managementIp ? 'has-meta' : ''}`}><strong>{device.type}</strong>{device.model ? <small>{device.model}</small> : null}</span>{device.managementIp ? <span className="ops-rack-device-meta">{device.managementIp}</span> : null}
  </button>;
}

function DeviceDetails({ device }: { device: Device }) {
  const rows = [['Management IP', device.managementIp || '—'], ['Asset tag', device.assetTag || '—'], ['Rack position', `U${device.position}${device.heightU > 1 ? `–U${device.position + device.heightU - 1}` : ''}`], ['Rack width', device.rackLane === 'left' ? 'Left half' : device.rackLane === 'right' ? 'Right half' : 'Full width'], ['Height', `${device.heightU}U`], ['Face', device.face || 'front'], ['Port inventory', device.portAware ? `${device.numberOfPorts ?? 0} tracked ports` : 'Not enabled']];
  const statusTone = deviceStatusTone(device.status);
  return <div className="ops-detail-list"><div className={`ops-device-status-banner ops-device-status-banner--${statusTone}`}><span className="ops-status-dot" /><div><strong>{device.status || 'Unknown status'}</strong><small>Operational state maintained with this asset.</small></div></div>{rows.map(([label, value]) => <div key={label}><span>{label}</span><strong className={label.includes('IP') ? 'ops-mono' : ''}>{value}</strong></div>)}{device.comment ? <div className="ops-detail-note"><span>Note</span><p>{device.comment}</p></div> : null}</div>;
}

function DevicePorts({ ports, loading }: { ports: DevicePort[]; loading: boolean }) { if (loading) return <div className="ops-empty-inline">Loading ports…</div>; return <div className="ops-inspector-port-list">{ports.map((port) => <div key={port.id}><span>{port.portNumber}</span><div><strong>{port.patchPanel || 'Unassigned'}</strong><small>{[port.vlan && `VLAN ${port.vlan}`, port.ipAddress].filter(Boolean).join(' · ') || 'No metadata'}</small></div></div>)}</div>; }
function DeviceActivity({ device, events, timeZone }: { device: Device; events: any[]; timeZone: string }) { const relevant = events.filter((event) => event.objectType === 'cabinet_device' && String(event.objectId) === String(device.id)); return <div className="ops-activity-list">{relevant.map((event) => <div className="ops-activity-row" key={event.id}><span className="ops-activity-glyph"><OperationsIcon name="check" /></span><div><strong>{event.action}</strong><small>{event.details || 'Device operation'}</small></div><time>{formatDateOnly(event.createdAt, timeZone)}</time></div>)}{!relevant.length ? <div className="ops-empty-inline">No recorded changes for this device.</div> : null}</div>; }
function rangesOverlap(aStart: number, aHeight: number, bStart: number, bHeight: number) { return Math.max(aStart, bStart) <= Math.min(aStart + aHeight - 1, bStart + bHeight - 1); }
function deviceFacesConflict(first?: string, second?: string) { const a = first || 'front'; const b = second || 'front'; return a === 'both' || b === 'both' || a === b; }
function isRackLane(value: unknown): value is RackLane { return value === 'full' || value === 'left' || value === 'right'; }
function isRackFace(value: unknown): value is Exclude<RackFace, 'both'> { return value === 'front' || value === 'rear'; }
function deviceStatusTone(status?: string) { if (status === 'online') return 'online'; if (status === 'offline') return 'offline'; if (status === 'maintenance' || status === 'warning') return 'maintenance'; if (status === 'planned') return 'planned'; return 'neutral'; }
function readApiError(error: Error) { try { return JSON.parse(error.message).error || error.message; } catch { return error.message || 'Operation failed'; } }
