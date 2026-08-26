import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ModalBase } from './ModalBase';
import { useAppStore } from '../../store';
import { Api } from '../../api';
import { SoftButton } from '../SoftButton';
import { FormSection } from '../FormSection';

const MAX_PORTS = 48;

export function AddDeviceModal() {
  const { modals, closeModal, selectedCabinetId, editingDevice, setEditingDevice } = useAppStore();
  const open = modals.addDevice;
  const qc = useQueryClient();
  const [type, setType] = useState('');
  const [model, setModel] = useState('');
  const [heightU, setHeightU] = useState('1');
  const [position, setPosition] = useState('');
  const [rackLane, setRackLane] = useState('full');
  const [managementIp, setManagementIp] = useState('');
  const [assetTag, setAssetTag] = useState('');
  const [status, setStatus] = useState('unknown');
  const [face, setFace] = useState('front');
  const [portAware, setPortAware] = useState(false);
  const [numberOfPorts, setNumberOfPorts] = useState('');
  const [portsPerRow, setPortsPerRow] = useState('');
  const [formError, setFormError] = useState('');
  const [shrinkConfirmation, setShrinkConfirmation] = useState<{ pending: boolean; value: number | null }>({
    pending: false,
    value: null,
  });
  const [disableConfirmationPending, setDisableConfirmationPending] = useState(false);

  const normalizePortValue = (value: string) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) return null;
    if (parsed < 1 || parsed > MAX_PORTS) return null;
    return parsed;
  };
  const originalPortCount = editingDevice?.numberOfPorts ?? null;

  useEffect(() => {
    if (open && editingDevice) {
      setType(editingDevice.type ?? '');
      setModel(editingDevice.model ?? '');
      setHeightU(String(editingDevice.heightU ?? 1));
      setPosition(String(editingDevice.position ?? ''));
      setRackLane(editingDevice.rackLane ?? 'full');
      setManagementIp(editingDevice.managementIp ?? '');
      setAssetTag(editingDevice.assetTag ?? '');
      setStatus(editingDevice.status ?? 'unknown');
      setFace(editingDevice.face ?? 'front');
       setPortAware(Boolean(editingDevice.portAware));
       setNumberOfPorts(editingDevice.numberOfPorts ? String(editingDevice.numberOfPorts) : '');
       setPortsPerRow(editingDevice.portsPerRow ? String(editingDevice.portsPerRow) : '');
       setShrinkConfirmation({ pending: false, value: null });
       setDisableConfirmationPending(false);
       setFormError('');
    } else if (open) {
      setType('');
      setModel('');
      setHeightU('1');
      setPosition('');
      setRackLane('full');
      setManagementIp('');
      setAssetTag('');
      setStatus('unknown');
      setFace('front');
       setPortAware(false);
       setNumberOfPorts('');
       setPortsPerRow('');
       setShrinkConfirmation({ pending: false, value: null });
       setDisableConfirmationPending(false);
       setFormError('');
    }
  }, [open, editingDevice]);

  useEffect(() => {
    if (!portAware) {
      setShrinkConfirmation({ pending: false, value: null });
    }
  }, [portAware]);

  const parsedPortCount = portAware ? normalizePortValue(numberOfPorts) : null;
  const portCountInvalid = portAware && parsedPortCount == null;
  const parsedPortsPerRow = portsPerRow.trim() ? Number(portsPerRow) : null;
  const minimumPortsPerRow = parsedPortCount == null ? 1 : Math.ceil(parsedPortCount / 2);
  const portsPerRowInvalid = portAware && parsedPortsPerRow != null && (!Number.isInteger(parsedPortsPerRow) || (parsedPortsPerRow !== minimumPortsPerRow && parsedPortsPerRow !== parsedPortCount));
  const awaitingPortConfirmation = disableConfirmationPending || shrinkConfirmation.pending;

  const handlePortAwareChange = (checked: boolean) => {
    if (!checked && editingDevice?.portAware) {
      setPortAware(false);
      setDisableConfirmationPending(true);
      return;
    }
    setPortAware(checked);
    setDisableConfirmationPending(false);
  };

  const handlePortCountInput = (value: string) => {
    const numeric = Number(value);
    if (Number.isInteger(numeric) && numeric > MAX_PORTS) {
      setNumberOfPorts(String(MAX_PORTS));
    } else {
      setNumberOfPorts(value);
    }
    if (editingDevice?.portAware && originalPortCount) {
      const normalized = normalizePortValue(value);
      if (normalized != null && normalized < originalPortCount) {
        setShrinkConfirmation({ pending: true, value: normalized });
      } else {
        setShrinkConfirmation({ pending: false, value: null });
      }
    }
  };

  const confirmDisablePorts = () => {
    setDisableConfirmationPending(false);
    setNumberOfPorts('');
    setPortsPerRow('');
  };

  const cancelDisablePorts = () => {
    setPortAware(true);
    setDisableConfirmationPending(false);
  };

  const confirmShrinkPorts = () => {
    setShrinkConfirmation({ pending: false, value: null });
  };

  const cancelShrinkPorts = () => {
    if (originalPortCount) {
      setNumberOfPorts(String(originalPortCount));
    }
    setShrinkConfirmation({ pending: false, value: null });
  };

  const handleExportPorts = async () => {
    if (!editingDevice) return;
    try {
      await Api.devicePorts.export(editingDevice.cabinetId, editingDevice.id);
    } catch (err) {
      console.error(err);
    }
  };

  const reset = () => {
    setType('');
    setModel('');
    setHeightU('1');
    setPosition('');
    setRackLane('full');
    setManagementIp('');
    setAssetTag('');
    setStatus('unknown');
    setFace('front');
    setPortAware(false);
    setNumberOfPorts('');
    setPortsPerRow('');
    setShrinkConfirmation({ pending: false, value: null });
    setDisableConfirmationPending(false);
    setFormError('');
    setEditingDevice(null);
  };

  const handleClose = () => {
    reset();
    closeModal('addDevice');
  };

  const mutation = useMutation({
    mutationFn: async ({
      cabinetId,
      payload,
      deviceId,
    }: {
      cabinetId: number;
      payload: any;
      deviceId: number | null;
    }) => {
      if (deviceId) {
        return Api.devices.update(cabinetId, deviceId, payload);
      }
      return Api.devices.create(cabinetId, payload);
    },
    onSuccess: async (_, variables) => {
      await qc.invalidateQueries({ queryKey: ['cabinet-devices', variables.cabinetId] });
      await qc.invalidateQueries({ queryKey: ['modules'] });
      await qc.invalidateQueries({ queryKey: ['porthub-devices'] });
      if (variables.deviceId) {
        await qc.invalidateQueries({ queryKey: ['device-ports', variables.cabinetId, variables.deviceId] });
      }
      reset();
      closeModal('addDevice');
    },
    onError: (reason: Error) => setFormError(readApiError(reason)),
  });

  const disableSubmit = !type.trim() || mutation.isPending || portCountInvalid || portsPerRowInvalid || awaitingPortConfirmation;

  const submit = () => {
    const cabinetId = editingDevice?.cabinetId ?? selectedCabinetId;
    if (!cabinetId || !type.trim()) return;
    if (portCountInvalid || portsPerRowInvalid || awaitingPortConfirmation) return;
    const parsedHeight = Math.max(1, Math.round(Number(heightU) || 1));
    const payload: Record<string, any> = {
      type: type.trim(),
      model: model.trim() || null,
      heightU: parsedHeight || 1,
      position: position.trim() ? Math.max(1, Math.round(Number(position))) : undefined,
      rackLane,
      managementIp: managementIp.trim() || null,
      assetTag: assetTag.trim() || null,
      status,
      face,
      portAware,
    };
    if (portAware && parsedPortCount != null) {
      payload.numberOfPorts = parsedPortCount;
      payload.portsPerRow = parsedPortsPerRow;
    }
    setFormError('');
    mutation.mutate({
      cabinetId,
      payload,
      deviceId: editingDevice?.id ?? null,
    });
  };

  return (
    <ModalBase
      open={open}
      title={editingDevice ? 'Edit device' : 'Add device'}
      eyebrow="Racks"
      onClose={handleClose}
      size="lg"
    >
      <div className="stack gap-4">
        {!selectedCabinetId ? (
          <p className="type-body-sm text-textSec">
            Select a cabinet first to place devices.
          </p>
        ) : (
          <>
            <FormSection title="Device specification">
              <div className="ops-device-form-grid">
              <div className="stack-sm ops-device-field ops-device-field--type">
                <label className="field-label" htmlFor="device-type">Type</label>
                <input
                  id="device-type"
                  className="input"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                />
              </div>
              <div className="stack-sm ops-device-field ops-device-field--model">
                <label className="field-label" htmlFor="device-model">Model</label>
                <input
                  id="device-model"
                  className="input"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              </div>
              <div className="stack-sm ops-device-field ops-device-field--height">
                <label className="field-label" htmlFor="device-height">Height (U)</label>
                <input
                  id="device-height"
                  className="input"
                  type="number"
                  min={1}
                  max={60}
                  value={heightU}
                  onChange={(e) => setHeightU(e.target.value)}
                />
              </div>
              <div className="stack-sm ops-device-field ops-device-field--position">
                <label className="field-label" htmlFor="device-position">Start position (U)</label>
                <input id="device-position" className="input" type="number" min={1} max={60} value={position} onChange={(e) => setPosition(e.target.value)} />
              </div>
              <div className="stack-sm ops-device-field ops-device-field--width">
                <label className="field-label" htmlFor="device-rack-lane">Rack width</label>
                <select id="device-rack-lane" className="input" value={rackLane} onChange={(e) => setRackLane(e.target.value)}>
                  <option value="full">Full width</option><option value="left">Left half / shelf</option><option value="right">Right half / shelf</option>
                </select>
              </div>
              <div className="stack-sm ops-device-field ops-device-field--face">
                <label className="field-label" htmlFor="device-face">Rack face</label>
                <select id="device-face" className="input" value={face} onChange={(e) => setFace(e.target.value)}>
                  <option value="front">Front</option><option value="rear">Rear</option>
                </select>
              </div>
              <p className="type-caption text-textSec ops-device-field ops-device-field--full">Use left and right halves at the same U to represent two devices placed side by side on one shelf.</p>
              <div className="stack-sm ops-device-field ops-device-field--management">
                <label className="field-label" htmlFor="device-management-ip">Management IP</label>
                <input id="device-management-ip" className="input" value={managementIp} onChange={(e) => setManagementIp(e.target.value)} />
              </div>
              <div className="stack-sm ops-device-field ops-device-field--asset">
                <label className="field-label" htmlFor="device-asset-tag">Asset tag</label>
                <input id="device-asset-tag" className="input" value={assetTag} onChange={(e) => setAssetTag(e.target.value)} />
              </div>
              <div className="stack-sm ops-device-field ops-device-field--status">
                <label className="field-label" htmlFor="device-status">Status</label>
                <select id="device-status" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="unknown">Unknown</option><option value="online">Online</option><option value="offline">Offline</option><option value="maintenance">Maintenance</option><option value="planned">Planned</option>
                </select>
              </div>
              </div>
            </FormSection>
            <FormSection title="Port awareness">
              <label className={`ops-console-switch ${portAware ? 'is-enabled' : ''}`} htmlFor="device-port-aware">
                <input id="device-port-aware" type="checkbox" checked={portAware} onChange={(e) => handlePortAwareChange(e.target.checked)} />
                <span className="ops-console-switch-control" aria-hidden="true"><span /></span>
                <span className="ops-console-switch-copy"><strong>LAN port tracking</strong><small>Store Patch Panel, VLAN, IP address and comment metadata for every port.</small></span>
                <em>{portAware ? 'Enabled' : 'Disabled'}</em>
              </label>
              <div className="ops-device-port-grid">
              <div className="stack-sm">
                <label className="field-label" htmlFor="device-port-count">Number of ports</label>
                <input
                  id="device-port-count"
                  className="input"
                  type="number"
                  min={1}
                  max={MAX_PORTS}
                  disabled={!portAware}
                  value={numberOfPorts}
                  onChange={(e) => handlePortCountInput(e.target.value)}
                />
                <p className="type-caption text-textSec">Allowed range: 1–{MAX_PORTS} ports.</p>
                {portCountInvalid && portAware && (
                  <p className="type-caption text-error">Enter a valid port count between 1 and {MAX_PORTS}.</p>
                )}
              </div>
              <div className="stack-sm">
                <label className="field-label" htmlFor="device-ports-per-row">Ports per row (optional)</label>
                <input
                  id="device-ports-per-row"
                  className="input"
                  type="number"
                  min={minimumPortsPerRow}
                  max={parsedPortCount ?? MAX_PORTS}
                  disabled={!portAware || parsedPortCount == null}
                  value={portsPerRow}
                  onChange={(e) => setPortsPerRow(e.target.value)}
                />
                <p className="type-caption text-textSec">Leave empty for automatic layout: up to 24 ports in one row; larger devices split evenly into two rows.</p>
                {portsPerRowInvalid && (
                  <p className="type-caption text-error">Use {minimumPortsPerRow} for two rows or {parsedPortCount} for one row.</p>
                )}
              </div>
              </div>
              {disableConfirmationPending && (
                <div className="alert alert-warning port-warning">
                  <p>
                    Turning off Port aware device will delete all stored port fields. Export them before confirming if
                    needed.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <SoftButton variant="ghost" disabled={!editingDevice} onClick={handleExportPorts}>
                      Export ports
                    </SoftButton>
                    <SoftButton variant="ghost" onClick={cancelDisablePorts}>
                      Cancel
                    </SoftButton>
                    <SoftButton variant="danger" onClick={confirmDisablePorts}>
                      Confirm
                    </SoftButton>
                  </div>
                </div>
              )}
              {shrinkConfirmation.pending && (
                <div className="alert alert-warning port-warning">
                  <p>
                    Ports above {shrinkConfirmation.value} will be removed and their data lost. Export them before
                    confirming if you still need those details.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <SoftButton variant="ghost" disabled={!editingDevice} onClick={handleExportPorts}>
                      Export ports
                    </SoftButton>
                    <SoftButton variant="ghost" onClick={cancelShrinkPorts}>
                      Cancel
                    </SoftButton>
                    <SoftButton variant="danger" onClick={confirmShrinkPorts}>
                      Confirm
                    </SoftButton>
                  </div>
                </div>
              )}
            </FormSection>
            {formError ? <div className="alert alert-error" role="alert">{formError}</div> : null}
            <div className="modal-footer-premium flex justify-end gap-3">
              <SoftButton variant="ghost" onClick={handleClose}>
                Cancel
              </SoftButton>
              <button
                type="button"
                className="btn px-6"
                disabled={disableSubmit}
                onClick={submit}
              >
                {mutation.isPending ? 'Saving...' : editingDevice ? 'Save changes' : 'Add device'}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalBase>
  );
}

function readApiError(error: Error) {
  try {
    return JSON.parse(error.message).error || error.message;
  } catch {
    return error.message || 'Could not save the device.';
  }
}
