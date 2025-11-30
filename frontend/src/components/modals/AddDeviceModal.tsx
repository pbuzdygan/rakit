import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ModalBase } from './ModalBase';
import { useAppStore } from '../../store';
import { Api } from '../../api';
import { SoftButton } from '../SoftButton';
import { FormSection } from '../FormSection';

export function AddDeviceModal() {
  const { modals, closeModal, selectedCabinetId, editingDevice, setEditingDevice } = useAppStore();
  const open = modals.addDevice;
  const qc = useQueryClient();
  const [type, setType] = useState('');
  const [model, setModel] = useState('');
  const [heightU, setHeightU] = useState('1');

  useEffect(() => {
    if (open && editingDevice) {
      setType(editingDevice.type ?? '');
      setModel(editingDevice.model ?? '');
      setHeightU(String(editingDevice.heightU ?? 1));
    } else if (open) {
      setType('');
      setModel('');
      setHeightU('1');
    }
  }, [open, editingDevice]);

  const reset = () => {
    setType('');
    setModel('');
    setHeightU('1');
    setEditingDevice(null);
  };

  const handleClose = () => {
    reset();
    closeModal('addDevice');
  };

  const mutation = useMutation({
    mutationFn: async ({ cabinetId, payload }: { cabinetId: number; payload: any }) => {
      if (editingDevice) {
        return Api.devices.update(cabinetId, editingDevice.id, payload);
      }
      return Api.devices.create(cabinetId, payload);
    },
    onSuccess: async (_, variables) => {
      await qc.invalidateQueries({ queryKey: ['cabinet-devices', variables.cabinetId] });
      await qc.invalidateQueries({ queryKey: ['modules'] });
      reset();
      closeModal('addDevice');
    },
  });

  const submit = async () => {
    const cabinetId = editingDevice?.cabinetId ?? selectedCabinetId;
    if (!cabinetId || !type.trim()) return;
    const parsedHeight = Math.max(1, Math.round(Number(heightU) || 1));
    await mutation.mutateAsync({
      cabinetId,
      payload: { type: type.trim(), model: model.trim() || undefined, heightU: parsedHeight || 1 },
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
            <div className="modal-footer-premium flex justify-end gap-3">
              <SoftButton variant="ghost" onClick={handleClose}>
                Cancel
              </SoftButton>
              <button
                type="button"
                className="btn px-6"
                disabled={!type.trim() || mutation.isPending}
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
