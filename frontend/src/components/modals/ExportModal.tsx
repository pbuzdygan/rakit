import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ModalBase } from './ModalBase';
import { useAppStore } from '../../store';
import { Api } from '../../api';
import { SoftButton } from '../SoftButton';
import {
  DEFAULT_IPDASH_FILTERS,
  IPDASH_FILTER_STORAGE_KEY,
  IPDASH_GROUP_STORAGE_KEY,
  IPDASH_NETWORK_INDEX_STORAGE_KEY,
  IPDASH_TAG_STORAGE_KEY,
} from '../../constants/ipdash';

type ModuleId = 'cabinet' | 'ipdash';

type ExportStatus = 'idle' | 'preparing' | 'success' | 'error';

type IpDashPrefs = {
  filters: typeof DEFAULT_IPDASH_FILTERS;
  groupBy: string;
  groupTags: Record<string, string>;
  networkIndex: number;
};

const MODULE_OPTIONS: Array<{ id: ModuleId; label: string; description: string; icon: string }> = [
  {
    id: 'cabinet',
    label: 'IT Cabinet',
    description: 'Cabinets, devices and an experimental rack perspective.',
    icon: '🗄️',
  },
  {
    id: 'ipdash',
    label: 'IP Dash',
    description: 'Current network view with your filters, grouping and layout.',
    icon: '🌐',
  },
];

function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function loadIpDashPrefs(): IpDashPrefs {
  const filters = loadFromStorage<typeof DEFAULT_IPDASH_FILTERS>(IPDASH_FILTER_STORAGE_KEY, DEFAULT_IPDASH_FILTERS);
  const groupTags = loadFromStorage<Record<string, string>>(IPDASH_TAG_STORAGE_KEY, {});
  const groupBy =
    (typeof window !== 'undefined' && window.localStorage.getItem(IPDASH_GROUP_STORAGE_KEY)) || 'none';
  const networkIndexRaw =
    typeof window !== 'undefined' ? window.localStorage.getItem(IPDASH_NETWORK_INDEX_STORAGE_KEY) : null;
  const networkIndex = networkIndexRaw ? Number(networkIndexRaw) || 0 : 0;
  return { filters, groupBy, groupTags, networkIndex };
}

export function ExportModal() {
  const { modals, closeModal, ipDashViewMode, ipDashActiveProfileId } = useAppStore();
  const open = modals.export;
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState<ExportStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [selectedModules, setSelectedModules] = useState<ModuleId[]>(['cabinet']);
  const [ipDashPrefs, setIpDashPrefs] = useState<IpDashPrefs>(() => loadIpDashPrefs());
  const profilesQuery = useQuery({ queryKey: ['ipdash-profiles'], queryFn: Api.ipdash.profiles.list });
  const encryptionBlocked = Boolean(profilesQuery.data?.encryptionKeyMismatch);
  const encryptionMessage =
    (profilesQuery.data?.encryptionMessage as string) || 'Encryption key changed. Reset encrypted profiles to export IP Dash.';

  const canExportIpDash = Boolean(ipDashActiveProfileId) && !encryptionBlocked;

  useEffect(() => {
    if (!open) return;
    setStatus('idle');
    setStatusMessage('');
    setIpDashPrefs(loadIpDashPrefs());
    setSelectedModules(canExportIpDash ? ['cabinet', 'ipdash'] : ['cabinet']);
  }, [open, canExportIpDash]);

  const moduleSummary = useMemo(() => {
    return MODULE_OPTIONS.filter((option) => selectedModules.includes(option.id))
      .map((option) => option.label)
      .join(', ');
  }, [selectedModules]);

  const toggleModule = (id: ModuleId) => {
    setSelectedModules((prev) => {
      if (prev.includes(id)) {
        return prev.filter((value) => value !== id);
      }
      return [...prev, id];
    });
  };

  const runExport = async () => {
    if (!selectedModules.length) return;
    if (selectedModules.includes('ipdash') && encryptionBlocked) {
      setStatus('error');
      setStatusMessage(encryptionMessage);
      return;
    }
    setWorking(true);
    setStatus('preparing');
    setStatusMessage('Preparing workbook…');
    try {
      const payload: Record<string, any> = { modules: selectedModules };
      if (selectedModules.includes('ipdash')) {
        payload.ipdash = {
          profileId: ipDashActiveProfileId,
          viewMode: ipDashViewMode,
          groupBy: ipDashPrefs.groupBy || 'none',
          groupTags: ipDashPrefs.groupTags,
          filters: ipDashPrefs.filters,
          networkIndex: ipDashPrefs.networkIndex,
        };
      }
      await Api.exportWorkbook(payload);
      setStatus('success');
      setStatusMessage('Export completed – downloading rakit_export.xlsx');
    } catch (err: any) {
      setStatus('error');
      setStatusMessage(err?.message || 'Export failed. Please try again.');
    } finally {
      setWorking(false);
    }
  };

  const disableExport = !selectedModules.length || (selectedModules.includes('ipdash') && !canExportIpDash);

  return (
    <ModalBase
      open={open}
      title="Export data"
      icon="📤"
      onClose={() => closeModal('export')}
      size="md"
    >
      <div className="stack gap-4">
        <p className="type-body-sm text-textSec">
          Choose which modules to bundle into a single <strong>.xlsx</strong> file. IP Dash exports follow your current
          layout, grouping and filters, while IT Cabinet includes the registry plus experimental rack views.
        </p>

        <div className="export-module-grid">
          {MODULE_OPTIONS.map((option) => {
            const checked = selectedModules.includes(option.id);
            const disabled = option.id === 'ipdash' && !canExportIpDash;
            return (
              <label
                key={option.id}
                className={`export-module-card ${checked ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggleModule(option.id)}
                />
                <div className="export-module-icon">{option.icon}</div>
                <div className="export-module-text">
                  <span className="export-module-title">{option.label}</span>
                  <span className="export-module-desc">{option.description}</span>
                  {option.id === 'ipdash' && !canExportIpDash && (
                    <span className="export-module-note">
                      {encryptionBlocked
                        ? encryptionMessage
                        : 'Add an IP Dash profile to enable this module.'}
                    </span>
                  )}
                </div>
              </label>
            );
          })}
        </div>

        {encryptionBlocked && (
          <div className="alert alert-error">{encryptionMessage}</div>
        )}

        {status !== 'idle' && (
          <div className={`export-status export-status-${status}`}>
            {statusMessage}
          </div>
        )}

        <SoftButton block onClick={runExport} disabled={disableExport || working}>
          {working ? 'Preparing…' : 'Export'}
        </SoftButton>
        <p className="type-caption text-textSec">
          {selectedModules.length ? `Selected: ${moduleSummary}` : 'Select at least one module to enable export.'}
        </p>

        <div className="modal-footer-premium flex justify-end">
          <SoftButton variant="ghost" onClick={() => closeModal('export')} disabled={working}>
            Close
          </SoftButton>
        </div>
      </div>
    </ModalBase>
  );
}
