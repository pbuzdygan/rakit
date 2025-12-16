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
  const [portAware, setPortAware] = useState(false);
  const [numberOfPorts, setNumberOfPorts] = useState('');
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
      setPortAware(Boolean(editingDevice.portAware));
       setNumberOfPorts(editingDevice.numberOfPorts ? String(editingDevice.numberOfPorts) : '');
       setShrinkConfirmation({ pending: false, value: null });
       setDisableConfirmationPending(false);
    } else if (open) {
      setType('');
      setModel('');
      setHeightU('1');
       setPortAware(false);
       setNumberOfPorts('');
       setShrinkConfirmation({ pending: false, value: null });
       setDisableConfirmationPending(false);
    }
  }, [open, editingDevice]);

  useEffect(() => {
    if (!portAware) {
      setShrinkConfirmation({ pending: false, value: null });
    }
  }, [portAware]);

  const parsedPortCount = portAware ? normalizePortValue(numberOfPorts) : null;
  const portCountInvalid = portAware && parsedPortCount == null;
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
    setPortAware(false);
    setNumberOfPorts('');
    setShrinkConfirmation({ pending: false, value: null });
    setDisableConfirmationPending(false);
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
  });

  const disableSubmit = !type.trim() || mutation.isPending || portCountInvalid || awaitingPortConfirmation;

  const submit = async () => {
    const cabinetId = editingDevice?.cabinetId ?? selectedCabinetId;
    if (!cabinetId || !type.trim()) return;
    if (portCountInvalid || awaitingPortConfirmation) return;
    const parsedHeight = Math.max(1, Math.round(Number(heightU) || 1));
    const payload: Record<string, any> = {
      type: type.trim(),
      model: model.trim() || undefined,
      heightU: parsedHeight || 1,
      portAware,
    };
    if (portAware && parsedPortCount != null) {
      payload.numberOfPorts = parsedPortCount;
    }
    if (!portAware) {
      payload.numberOfPorts = null;
    }
    await mutation.mutateAsync({
      cabinetId,
      payload,
      deviceId: editingDevice?.id ?? null,
    });
  };

  return (
    <ModalBase
      open={open}
      title={editingDevice ? 'Edit device' : 'Add device'}
      icon="🧩"
      onClose={handleClose}
      size="sm"
    >
      <div className="stack gap-4">
        {!selectedCabinetId ? (
          <p className="type-body-sm text-textSec">
            Select a cabinet first to place devices.
          </p>
        ) : (
          <>
            <FormSection title="Device specification">
              <div className="stack-sm">
                <label className="field-label" htmlFor="device-type">Type</label>
                <input
                  id="device-type"
                  className="input"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  placeholder="Firewall, Server..."
                />
              </div>
              <div className="stack-sm">
                <label className="field-label" htmlFor="device-model">Model</label>
                <input
                  id="device-model"
                  className="input"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="FG-601F"
                />
              </div>
              <div className="stack-sm">
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
            </FormSection>
            <FormSection title="Port awareness">
              <div className="stack-sm">
                <label className="field-label" htmlFor="device-port-aware">Port aware device</label>
                <label className="toggle-field" htmlFor="device-port-aware">
                  <input
                    id="device-port-aware"
                    type="checkbox"
                    checked={portAware}
                    onChange={(e) => handlePortAwareChange(e.target.checked)}
                  />
                  <span className="toggle-indicator" />
                  <span className="toggle-label">Enable LAN port tracking for this device.</span>
                </label>
                <p className="type-caption text-textSec">When enabled, every port can store Patch Panel, VLAN, IP and comment.</p>
              </div>
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
                  placeholder="24"
                />
                <p className="type-caption text-textSec">Allowed range: 1–{MAX_PORTS} ports.</p>
                {portCountInvalid && portAware && (
                  <p className="type-caption text-error">Enter a valid port count between 1 and {MAX_PORTS}.</p>
                )}
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
