import { useQuery } from '@tanstack/react-query';
import { Api } from '../api';
import { useAppStore, type View } from '../store';
import { OperationsIcon, type OperationsIconName } from './OperationsIcon';
import { formatRelativeTime } from '../utils/dateTime';

type Metric = { key: string; label: string; value: number; detail: string; view: View; icon: OperationsIconName };
type PhysicalCapacity = {
  id: number; name: string; symbol?: string; location?: string; deviceCount: number; sizeU: number; usedU: number; freeU: number; utilizationPercent: number; status: 'online' | 'offline' | 'maintenance' | 'planned';
};

export function OverviewView() {
  const setView = useAppStore((s) => s.setView);
  const overview = useQuery({ queryKey: ['overview'], queryFn: Api.overview, refetchInterval: 30_000 });
  const audit = useQuery({ queryKey: ['audit', 8], queryFn: () => Api.audit(8), refetchInterval: 30_000 });
  const data = overview.data ?? {};
  const physicalCapacity = (data.physicalCapacity ?? []) as PhysicalCapacity[];
  const metrics: Metric[] = [
    { key: 'racks', label: 'Racks', value: Number(data.cabinetCount ?? 0), detail: `${Number(data.deviceCount ?? 0)} managed devices`, view: 'cabinet', icon: 'rack' },
    { key: 'connections', label: 'Port connections', value: Number(data.portConnectionCount ?? 0), detail: 'Mapped physical paths', view: 'porthub', icon: 'ports' },
    { key: 'addresses', label: 'Local IP records', value: Number(data.manualIpCount ?? 0), detail: 'Alongside UniFi data', view: 'ipdash', icon: 'network' },
    { key: 'wol', label: 'WOL targets', value: Number(data.wolMachineCount ?? 0), detail: 'Remote start endpoints', view: 'wol', icon: 'power' },
  ];

  return (
    <div className="ops-overview-layout">
      <section className="ops-metric-grid" aria-label="Infrastructure summary">
        {metrics.map((metric) => (
          <button key={metric.key} type="button" className="ops-metric-card" onClick={() => setView(metric.view)}>
            <span className="ops-metric-icon"><OperationsIcon name={metric.icon} /></span>
            <span className="ops-metric-copy"><small>{metric.label}</small><strong>{overview.isLoading ? '—' : metric.value}</strong><em>{metric.detail}</em></span>
            <OperationsIcon name="chevron" className="ops-metric-arrow" />
          </button>
        ))}
      </section>

      <section className="ops-panel ops-overview-primary ops-overview-capacity">
        <div className="ops-panel-header">
          <div><span className="ops-eyebrow">Physical capacity</span><h2>Rack utilization</h2></div>
          <button className="ops-text-button" onClick={() => setView('cabinet')}>Open racks <OperationsIcon name="chevron" /></button>
        </div>
        <div className="ops-capacity-table">
          <div className="ops-capacity-row ops-capacity-row--head"><span>Cabinet</span><span>Devices</span><span>Capacity</span><span>Available</span><span>Status</span></div>
          {physicalCapacity.map((cabinet) => (
            <button key={cabinet.id} type="button" className="ops-capacity-row" onClick={() => setView('cabinet')}>
              <span><strong>{cabinet.name}</strong><small>{[cabinet.location, cabinet.symbol].filter(Boolean).join(' · ') || 'No location'}</small></span>
              <span className="ops-mono">{cabinet.deviceCount}</span>
              <span className="ops-capacity-meter"><i><b style={{ width: `${cabinet.utilizationPercent}%` }} /></i><small>{cabinet.usedU}U / {cabinet.sizeU}U</small></span>
              <strong>{cabinet.freeU}U free</strong>
              <span className={`ops-state ops-state--${capacityStateTone(cabinet.status)}`}>{cabinet.status}</span>
            </button>
          ))}
          {!overview.isLoading && !physicalCapacity.length ? <div className="ops-empty-inline">No cabinets configured yet.</div> : null}
        </div>
      </section>

      <section className="ops-panel ops-overview-activity">
        <div className="ops-panel-header">
          <div><span className="ops-eyebrow">Latest changes</span><h2>Activity</h2></div>
          <button className="ops-text-button" onClick={() => setView('audit')}>View audit log <OperationsIcon name="chevron" /></button>
        </div>
        <div className="ops-activity-list">
          {(audit.data?.events ?? []).map((event: any) => (
            <div className="ops-activity-row" key={event.id}>
              <span className={`ops-activity-marker ${event.result === 'error' ? 'is-error' : ''}`}><OperationsIcon name={activityIcon(event.objectType)} /></span>
              <div><strong>{event.action}</strong><small>{event.details || event.objectType || 'Infrastructure object'}</small></div>
              <time>{formatRelativeTime(event.createdAt)}</time>
            </div>
          ))}
          {!audit.isLoading && !(audit.data?.events ?? []).length ? <div className="ops-empty-inline">No operations recorded yet.</div> : null}
        </div>
      </section>
    </div>
  );
}

function capacityStateTone(status: PhysicalCapacity['status']) {
  if (status === 'offline') return 'danger';
  if (status === 'maintenance') return 'warning';
  if (status === 'planned') return 'neutral';
  return 'ok';
}

function activityIcon(objectType: string): OperationsIconName {
  if (objectType === 'cabinet' || objectType === 'cabinet_device') return 'rack';
  if (objectType === 'device_port' || objectType === 'port_connection') return 'ports';
  if (objectType.startsWith('ip_')) return 'network';
  if (objectType.startsWith('wol_')) return 'power';
  return 'activity';
}
