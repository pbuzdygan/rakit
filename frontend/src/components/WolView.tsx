import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Api } from '../api';
import { useAppStore } from '../store';
import { formatDateTime } from '../utils/dateTime';
import { OperationsIcon } from './OperationsIcon';

type WolSchedule = { id: number; machineId: number; name: string; cron: string; enabled: boolean; lastRunAt?: string | null };
type WolMachine = {
  id: number;
  name: string;
  ipAddress: string;
  macAddress: string;
  broadcastAddress: string;
  port: number;
  probePort: number | null;
  linkedDeviceId: number | null;
  linkedDeviceLabel: string;
  status: string;
  lastSeen?: string | null;
  enabled: boolean;
  schedules: WolSchedule[];
};

type MachineForm = {
  name: string;
  ipAddress: string;
  macAddress: string;
  broadcastAddress: string;
  port: string;
  probePort: string;
  linkedDeviceId: string;
  enabled: boolean;
  schedule: string;
};

const emptyForm: MachineForm = {
  name: '', ipAddress: '', macAddress: '', broadcastAddress: '255.255.255.255', port: '9', probePort: '', linkedDeviceId: '', enabled: true, schedule: '',
};

export function WolView() {
  const qc = useQueryClient();
  const timeZone = useAppStore((state) => state.timeZone);
  const machinesQuery = useQuery({ queryKey: ['wol-machines'], queryFn: Api.wol.machines.list, refetchInterval: 15_000 });
  const statusQuery = useQuery({ queryKey: ['wol-status'], queryFn: () => Api.wol.machines.status(false), refetchInterval: 20_000 });
  const devicesQuery = useQuery({ queryKey: ['porthub-devices'], queryFn: Api.portHub.devices });
  const rawMachines = (machinesQuery.data?.machines ?? []) as WolMachine[];
  const statusMap = useMemo(() => new Map<number, any>(((statusQuery.data?.statuses ?? []) as any[]).map((entry): [number, any] => [entry.machineId, entry])), [statusQuery.data]);
  const machines = useMemo(() => rawMachines.map((machine) => ({ ...machine, status: statusMap.get(machine.id)?.status || machine.status })), [rawMachines, statusMap]);
  const devices = (devicesQuery.data?.devices ?? []) as any[];
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  const [form, setForm] = useState<MachineForm>(emptyForm);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState('');

  const selected = machines.find((machine) => machine.id === selectedId) ?? null;
  const visible = useMemo(() => {
    const value = filter.trim().toLowerCase();
    if (!value) return machines;
    return machines.filter((machine) => [machine.name, machine.ipAddress, machine.macAddress, machine.linkedDeviceLabel, machine.status].some((field) => field.toLowerCase().includes(value)));
  }, [filter, machines]);

  useEffect(() => {
    if (selected) setForm(toForm(selected));
  }, [selectedId, machinesQuery.data]);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['wol-machines'] });
    await qc.invalidateQueries({ queryKey: ['wol-status'] });
    await qc.invalidateQueries({ queryKey: ['overview'] });
    await qc.invalidateQueries({ queryKey: ['audit'] });
  };

  const wakeMutation = useMutation({ mutationFn: (id: number) => Api.wol.machines.wake(id), onSuccess: refresh, onError: (reason: Error) => setError(readApiError(reason)) });
  const saveMutation = useMutation({
    mutationFn: async ({ machine, values }: { machine: WolMachine | null; values: MachineForm }) => {
      const payload = machinePayload(values);
      const result = machine ? await Api.wol.machines.update(machine.id, payload) : await Api.wol.machines.create(payload);
      const id = machine?.id ?? result.machine.id;
      const priorSchedule = machine?.schedules?.[0];
      if (values.schedule.trim()) {
        if (priorSchedule) await Api.wol.schedules.update(priorSchedule.id, { cron: values.schedule.trim(), enabled: true });
        else await Api.wol.schedules.create({ machineId: id, name: 'Automatic wake', cron: values.schedule.trim(), enabled: true });
      } else if (priorSchedule) {
        await Api.wol.schedules.remove(priorSchedule.id);
      }
      return id;
    },
    onSuccess: async (id) => { await refresh(); setCreateOpen(false); setSelectedId(id); setError(''); },
    onError: (reason: Error) => setError(readApiError(reason)),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => Api.wol.machines.remove(id),
    onSuccess: async () => { setSelectedId(null); await refresh(); },
    onError: (reason: Error) => setError(readApiError(reason)),
  });

  const saveMachine = (machine: WolMachine | null, values: MachineForm) => {
    if (values.schedule.trim() && !/^([\d*,\/-]+\s+){4}[\d*,\/-]+$/.test(values.schedule.trim())) {
      setError('Schedule must use five cron fields, for example: 30 7 * * 1-5');
      return;
    }
    setError('');
    saveMutation.mutate({ machine, values });
  };

  const toggleCheck = (id: number) => setCheckedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const wakeSelected = async () => {
    setError('');
    for (const id of checkedIds) {
      try { await Api.wol.machines.wake(id); }
      catch (reason) { setError(readApiError(reason as Error)); break; }
    }
    await refresh();
  };

  return (
    <div className={`ops-master-detail ${selected ? 'has-inspector' : ''}`}>
      <section className="ops-panel ops-table-panel">
        <div className="ops-panel-toolbar">
          <div className="ops-filter-input"><OperationsIcon name="search" /><input data-module-search value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter by name, IP or MAC…" /></div>
          <div className="ops-toolbar-spacer" />
          <button className="ops-button ops-button--secondary" disabled={statusQuery.isFetching} onClick={() => qc.fetchQuery({ queryKey: ['wol-status'], queryFn: () => Api.wol.machines.status(true) })}><OperationsIcon name="refresh" /> {statusQuery.isFetching ? 'Checking…' : 'Check status'}</button>
          <button className="ops-button ops-button--secondary" disabled={!checkedIds.size} onClick={wakeSelected}><OperationsIcon name="power" /> Wake selected</button>
          <button className="ops-button" onClick={() => { setForm(emptyForm); setError(''); setCreateOpen(true); }}><OperationsIcon name="plus" /> Add machine</button>
        </div>
        {error ? <div className="ops-error-banner">{error}<button onClick={() => setError('')}><OperationsIcon name="close" /></button></div> : null}
        <div className="ops-table-wrap">
          <table className="ops-table ops-wol-table">
            <thead><tr><th className="ops-check-col"><input type="checkbox" checked={visible.length > 0 && visible.every((m) => checkedIds.has(m.id))} onChange={(event) => setCheckedIds(event.target.checked ? new Set(visible.map((m) => m.id)) : new Set())} /></th><th>Machine</th><th>IP address</th><th>MAC address</th><th>Status</th><th>Last seen</th><th>Schedule</th><th /></tr></thead>
            <tbody>
              {visible.map((machine) => (
                <tr key={machine.id} className={selectedId === machine.id ? 'is-selected' : ''} onClick={() => setSelectedId(machine.id)}>
                  <td onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={checkedIds.has(machine.id)} onChange={() => toggleCheck(machine.id)} /></td>
                  <td><div className="ops-cell-device"><span><OperationsIcon name="server" /></span><div><strong>{machine.name}</strong><small>{machine.linkedDeviceLabel || 'Unlinked endpoint'}</small></div></div></td>
                  <td className="ops-mono">{machine.ipAddress || '—'}</td>
                  <td className="ops-mono">{machine.macAddress}</td>
                  <td><MachineStatus machine={machine} probe={statusMap.get(machine.id)} /></td>
                  <td className="ops-muted">{formatDateTime(machine.lastSeen, timeZone, 'Never')}</td>
                  <td>{machine.schedules[0] ? <span className="ops-schedule"><OperationsIcon name="activity" />{machine.schedules[0].cron}</span> : <span className="ops-muted">Manual</span>}</td>
                  <td><button className="ops-row-action" disabled={!machine.enabled || wakeMutation.isPending} onClick={(event) => { event.stopPropagation(); wakeMutation.mutate(machine.id); }}><OperationsIcon name="power" /> Wake</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!machinesQuery.isLoading && !visible.length ? <div className="ops-empty-state"><OperationsIcon name="power" /><h3>No WOL machines</h3><p>Add an endpoint to send magic packets from Rakit.</p><button className="ops-button" onClick={() => { setForm(emptyForm); setCreateOpen(true); }}><OperationsIcon name="plus" /> Add machine</button></div> : null}
        </div>
      </section>

      {selected ? (
        <MachineInspector machine={selected} form={form} setForm={setForm} devices={devices} busy={saveMutation.isPending || deleteMutation.isPending} onClose={() => setSelectedId(null)} onWake={() => wakeMutation.mutate(selected.id)} onSave={() => saveMachine(selected, form)} onDelete={() => deleteMutation.mutate(selected.id)} />
      ) : null}

      {createOpen ? (
        <div className="ops-dialog-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setCreateOpen(false); }}>
          <div className="ops-dialog">
            <div className="ops-inspector-header"><div><span className="ops-eyebrow">Wake on LAN</span><h2>Add machine</h2></div><button className="ops-icon-button" onClick={() => setCreateOpen(false)}><OperationsIcon name="close" /></button></div>
            <MachineFields form={form} setForm={setForm} devices={devices} />
            <div className="ops-inspector-footer"><button className="ops-button ops-button--secondary" onClick={() => setCreateOpen(false)}>Cancel</button><button className="ops-button" disabled={!form.name.trim() || !form.macAddress.trim() || saveMutation.isPending} onClick={() => saveMachine(null, form)}>{saveMutation.isPending ? 'Saving…' : 'Add machine'}</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MachineInspector({ machine, form, setForm, devices, busy, onClose, onWake, onSave, onDelete }: { machine: WolMachine; form: MachineForm; setForm: React.Dispatch<React.SetStateAction<MachineForm>>; devices: any[]; busy: boolean; onClose: () => void; onWake: () => void; onSave: () => void; onDelete: () => void }) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => {
    setConfirmRemove(false);
  }, [machine.id]);
  useEffect(() => {
    if (!confirmRemove) return;
    const timeout = window.setTimeout(() => setConfirmRemove(false), 5000);
    return () => window.clearTimeout(timeout);
  }, [confirmRemove]);
  return <aside className="ops-inspector">
    <div className="ops-inspector-header"><div><span className="ops-eyebrow">Machine details</span><h2>{machine.name}</h2><MachineStatus machine={machine} /></div><button className="ops-icon-button" onClick={onClose}><OperationsIcon name="close" /></button></div>
    <div className="ops-inspector-body"><MachineFields form={form} setForm={setForm} devices={devices} /></div>
    <div className="ops-inspector-footer ops-inspector-footer--split"><button className={`ops-button ops-button--danger ops-inline-confirm ${confirmRemove ? 'is-confirming' : ''}`} disabled={busy} onClick={() => { if (confirmRemove) onDelete(); else setConfirmRemove(true); }}><OperationsIcon name="trash" /> {confirmRemove ? 'Confirm removal' : 'Remove'}</button><div><button className="ops-button ops-button--secondary" disabled={busy || !machine.enabled} onClick={onWake}><OperationsIcon name="power" /> Wake</button><button className="ops-button" disabled={busy || !form.name.trim() || !form.macAddress.trim()} onClick={onSave}>Save</button></div></div>
  </aside>;
}

function MachineFields({ form, setForm, devices }: { form: MachineForm; setForm: React.Dispatch<React.SetStateAction<MachineForm>>; devices: any[] }) {
  const update = (key: keyof MachineForm, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  return <div className="ops-form-grid">
    <label className="ops-field ops-field--full"><span>Name</span><input value={form.name} onChange={(event) => update('name', event.target.value)} /></label>
    <label className="ops-field"><span>IP / hostname</span><input value={form.ipAddress} onChange={(event) => update('ipAddress', event.target.value)} /></label>
    <label className="ops-field"><span>MAC address</span><input className="ops-mono" value={form.macAddress} onChange={(event) => update('macAddress', event.target.value)} /></label>
    <label className="ops-field"><span>Broadcast address</span><input className="ops-mono" value={form.broadcastAddress} onChange={(event) => update('broadcastAddress', event.target.value)} /></label>
    <label className="ops-field"><span>UDP port</span><input type="number" min="1" max="65535" value={form.port} onChange={(event) => update('port', event.target.value)} /></label>
    <label className="ops-field"><span>TCP status probe</span><input type="number" min="1" max="65535" value={form.probePort} onChange={(event) => update('probePort', event.target.value)} placeholder="22" /><small>Optional port used to detect whether the host is online.</small></label>
    <label className="ops-field ops-field--full"><span>Linked rack device</span><select value={form.linkedDeviceId} onChange={(event) => update('linkedDeviceId', event.target.value)}><option value="">No linked device</option>{devices.map((device) => <option value={device.id} key={device.id}>{device.cabinetName} · {device.type}{device.model ? ` · ${device.model}` : ''}</option>)}</select></label>
    <label className="ops-field ops-field--full"><span>Schedule (cron, optional)</span><input className="ops-mono" value={form.schedule} onChange={(event) => update('schedule', event.target.value)} /><small>Five fields: minute, hour, day, month, weekday.</small></label>
    <label className="ops-toggle ops-field--full"><input type="checkbox" checked={form.enabled} onChange={(event) => update('enabled', event.target.checked)} /><span>Machine enabled</span></label>
  </div>;
}

function MachineStatus({ machine, probe }: { machine: WolMachine; probe?: any }) {
  const value = !machine.enabled ? 'disabled' : machine.status;
  const tone = value === 'online' ? 'ok' : value === 'wake-sent' ? 'info' : value === 'offline' ? 'danger' : 'neutral';
  const title = probe ? `${probe.reason || 'Probe completed'}${probe.latencyMs != null ? ` · ${probe.latencyMs} ms` : ''}` : undefined;
  return <span className={`ops-state ops-state--${tone}`} title={title}><span className="ops-status-dot" />{value.replace('-', ' ')}</span>;
}

function toForm(machine: WolMachine): MachineForm {
  return { name: machine.name, ipAddress: machine.ipAddress, macAddress: machine.macAddress, broadcastAddress: machine.broadcastAddress, port: String(machine.port), probePort: machine.probePort ? String(machine.probePort) : '', linkedDeviceId: machine.linkedDeviceId ? String(machine.linkedDeviceId) : '', enabled: machine.enabled, schedule: machine.schedules[0]?.cron ?? '' };
}

function machinePayload(form: MachineForm) {
  return { name: form.name.trim(), ipAddress: form.ipAddress.trim() || null, macAddress: form.macAddress.trim(), broadcastAddress: form.broadcastAddress.trim(), port: Number(form.port) || 9, probePort: form.probePort ? Number(form.probePort) : null, linkedDeviceId: form.linkedDeviceId ? Number(form.linkedDeviceId) : null, enabled: form.enabled };
}

function readApiError(error: Error) {
  try { return JSON.parse(error.message).error || error.message; } catch { return error.message || 'Operation failed'; }
}
