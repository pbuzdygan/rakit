import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Api } from '../api';
import { useAppStore, type View } from '../store';
import { OperationsIcon, type OperationsIconName } from './OperationsIcon';
import { IpDashProfileMenu } from './ipdash/IpDashProfileMenu';
import { VersionIndicator } from './VersionIndicator';

const NAV_ITEMS: Array<{ id: View; label: string; icon: OperationsIconName }> = [
  { id: 'overview', label: 'Overview', icon: 'overview' },
  { id: 'cabinet', label: 'Racks', icon: 'rack' },
  { id: 'ipdash', label: 'IP Addressing', icon: 'network' },
  { id: 'porthub', label: 'Port Map', icon: 'ports' },
  { id: 'wol', label: 'Wake on LAN', icon: 'power' },
  { id: 'audit', label: 'Audit Log', icon: 'audit' },
];

const PAGE_META: Record<View, { section: string; title: string; description: string }> = {
  overview: { section: 'Operations', title: 'Overview', description: 'Infrastructure status and recent activity' },
  cabinet: { section: 'Infrastructure', title: 'Racks', description: 'Cabinet capacity and physical equipment layout' },
  ipdash: { section: 'Network', title: 'IP Addressing', description: 'UniFi leases, scopes and local reservations' },
  porthub: { section: 'Network', title: 'Port Map', description: 'Physical port mapping and endpoint connections' },
  wol: { section: 'Operations', title: 'Wake on LAN', description: 'Remote start targets and schedules' },
  audit: { section: 'System', title: 'Audit Log', description: 'Recorded infrastructure changes and operations' },
};

export function OperationsSidebar() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const connection = useAppStore((s) => s.ipDashConnectionStatus);

  const selectView = (nextView: View) => {
    setView(nextView);
    if (window.matchMedia('(max-width: 820px)').matches && !collapsed) {
      useAppStore.setState({ sidebarCollapsed: true });
    }
  };

  return (
    <aside id="ops-primary-navigation" className={`ops-sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="ops-brand">
        <img className="ops-brand-mark" src="/favicon-192x192.png" alt="" aria-hidden="true" />
        <div className="ops-brand-copy"><strong>RAKIT</strong><span>INFRA MGMT</span></div>
      </div>

      <nav className="ops-nav" aria-label="Primary navigation">
        <div className="ops-nav-label">Workspace</div>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`ops-nav-item ${view === item.id ? 'is-active' : ''}`}
            onClick={() => selectView(item.id)}
            title={collapsed ? item.label : undefined}
          >
            <OperationsIcon name={item.icon} />
            <span className="ops-nav-text">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="ops-sidebar-footer">
        <div className="ops-system-state">
          <span className={`ops-status-dot ${connection.status === 'inactive' ? 'is-danger' : ''}`} />
          <span>{connection.status === 'active' ? 'UniFi connected' : 'System ready'}</span>
        </div>
        <VersionIndicator compact />
      </div>
    </aside>
  );
}

export function OperationsTopbar() {
  const qc = useQueryClient();
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const setPinSession = useAppStore((s) => s.setPinSession);
  const openModal = useAppStore((s) => s.openModal);
  const ipDashViewMode = useAppStore((s) => s.ipDashViewMode);
  const setIpDashViewMode = useAppStore((s) => s.setIpDashViewMode);
  const triggerIpDashRefresh = useAppStore((s) => s.triggerIpDashRefresh);
  const selectedCabinetId = useAppStore((s) => s.selectedCabinetId);
  const setSelectedCabinetId = useAppStore((s) => s.setSelectedCabinetId);
  const setEditingCabinetId = useAppStore((s) => s.setEditingCabinetId);
  const [confirmRemoveCabinetId, setConfirmRemoveCabinetId] = useState<number | null>(null);
  const meta = PAGE_META[view];
  const cabinetsQuery = useQuery({ queryKey: ['cabinets'], queryFn: Api.cabinets.list, enabled: view === 'cabinet' });
  const cabinets = (cabinetsQuery.data?.cabinets ?? []) as any[];
  const activeCabinet = cabinets.find((cabinet) => cabinet.id === selectedCabinetId) ?? cabinets[0] ?? null;
  const rackDevicesQuery = useQuery({ queryKey: ['cabinet-devices', activeCabinet?.id ?? null], queryFn: () => Api.devices.list(activeCabinet!.id), enabled: view === 'cabinet' && Boolean(activeCabinet) });
  const rackDevices = (rackDevicesQuery.data?.devices ?? []) as any[];
  const occupiedUnits = new Set<number>();
  rackDevices.forEach((device) => { for (let unit = device.position; unit < device.position + device.heightU; unit += 1) occupiedUnits.add(unit); });
  const rackFreeUnits = activeCabinet ? Math.max(0, activeCabinet.sizeU - occupiedUnits.size) : 0;
  const removeCabinet = useMutation({
    mutationFn: (id: number) => Api.cabinets.remove(id),
    onSuccess: async () => {
      setConfirmRemoveCabinetId(null);
      setSelectedCabinetId(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['cabinets'] }),
        qc.invalidateQueries({ queryKey: ['overview'] }),
      ]);
    },
    onError: (reason: Error) => window.alert(readApiError(reason)),
  });

  useEffect(() => {
    setConfirmRemoveCabinetId(null);
  }, [activeCabinet?.id, view]);

  useEffect(() => {
    if (confirmRemoveCabinetId == null) return;
    const timeout = window.setTimeout(() => setConfirmRemoveCabinetId(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [confirmRemoveCabinetId]);

  const lockSession = () => {
    void Api.session.logout().finally(() => setPinSession(false));
  };

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      const moduleSearch = document.querySelector<HTMLInputElement>('[data-module-search]');
      if (!moduleSearch) return;
      moduleSearch.focus();
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  return (
    <>
      <header className="ops-topbar">
        <button
          type="button"
          className="ops-icon-button ops-navigation-toggle"
          onClick={toggleSidebar}
          aria-label={collapsed ? 'Open navigation' : 'Close navigation'}
          aria-controls="ops-primary-navigation"
          aria-expanded={!collapsed}
          title={collapsed ? 'Show navigation' : 'Hide navigation'}
        >
          <OperationsIcon name="menu" />
        </button>
        <div className="ops-breadcrumb"><span>{meta.section}</span><OperationsIcon name="chevron" /><strong>{meta.title}</strong></div>
        <div className="ops-topbar-actions">
          <button className="ops-icon-button" type="button" title="Export snapshot" onClick={() => openModal('export')}>
            <OperationsIcon name="download" />
          </button>
          <button
            className="ops-icon-button"
            type="button"
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            <OperationsIcon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <button className="ops-icon-button" type="button" title="Lock session" onClick={lockSession}>
            <OperationsIcon name="lock" />
          </button>
        </div>
      </header>

      <div className="ops-page-heading">
        <div>
          <span className="ops-page-eyebrow">{view === 'cabinet' ? `Racks / ${activeCabinet?.location || 'Infrastructure'}` : meta.section}</span>
          <h1>{view === 'cabinet' && activeCabinet ? activeCabinet.name : meta.title}</h1>
          {view === 'cabinet' && activeCabinet ? (activeCabinet.symbol ? <p>{activeCabinet.symbol}</p> : null) : <p>{meta.description}</p>}
        </div>
        {view === 'cabinet' && activeCabinet ? <div className="ops-page-metrics"><div><strong>{activeCabinet.sizeU}U</strong><span>Capacity</span></div><div><strong>{rackDevices.length}</strong><span>Devices</span></div><div><strong>{rackFreeUnits}U</strong><span>Free</span></div></div> : null}
        {view === 'cabinet' ? <div className="ops-page-actions">
          <button className="ops-button ops-button--secondary" onClick={() => { setEditingCabinetId(null); openModal('addCabinet'); }}><OperationsIcon name="plus" /> Add cabinet</button>
          <button className="ops-button ops-button--secondary" disabled={!activeCabinet} onClick={() => { if (activeCabinet) { setEditingCabinetId(activeCabinet.id); openModal('addCabinet'); } }}><OperationsIcon name="edit" /> Edit rack</button>
          <button
            className={`ops-button ops-button--danger ops-remove-cabinet ${activeCabinet && confirmRemoveCabinetId === activeCabinet.id ? 'is-confirming' : ''}`}
            disabled={!activeCabinet || removeCabinet.isPending}
            onClick={() => {
              if (!activeCabinet) return;
              if (confirmRemoveCabinetId === activeCabinet.id) removeCabinet.mutate(activeCabinet.id);
              else setConfirmRemoveCabinetId(activeCabinet.id);
            }}
          ><OperationsIcon name="trash" /> {removeCabinet.isPending ? 'Removing…' : activeCabinet && confirmRemoveCabinetId === activeCabinet.id ? 'Confirm removal' : 'Remove cabinet'}</button>
        </div> : null}
        {view === 'ipdash' ? (
          <div className="ops-page-actions">
            <div className="ops-segmented">
              <button className={ipDashViewMode === 'table' ? 'is-active' : ''} onClick={() => setIpDashViewMode('table')}>Table</button>
              <button className={ipDashViewMode === 'grid' ? 'is-active' : ''} onClick={() => setIpDashViewMode('grid')}>Grid</button>
            </div>
            <button className="ops-button ops-button--secondary" onClick={triggerIpDashRefresh}><OperationsIcon name="refresh" /> Refresh</button>
            <IpDashProfileMenu />
          </div>
        ) : null}
      </div>
    </>
  );
}

function readApiError(error: Error) {
  try {
    return JSON.parse(error.message).error || error.message;
  } catch {
    return error.message || 'Operation failed';
  }
}
