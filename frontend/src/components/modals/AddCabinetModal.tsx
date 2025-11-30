import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ModalBase } from './ModalBase';
import { useAppStore } from '../../store';
import { Api } from '../../api';
import { SoftButton } from '../SoftButton';
import { FormSection } from '../FormSection';

export function AddCabinetModal() {
  const { modals, closeModal, setSelectedCabinetId, editingCabinetId, setEditingCabinetId } = useAppStore();
  const open = modals.addCabinet;
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [location, setLocation] = useState('');
  const [sizeU, setSizeU] = useState('42');

  const mutation = useMutation({
    mutationFn: async (payload: any) => {
      if (editingCabinetId) {
        return Api.cabinets.update(editingCabinetId, payload);
      }
      return Api.cabinets.create(payload);
    },
    onSuccess: async (data: any) => {
      await qc.invalidateQueries({ queryKey: ['cabinets'] });
      await qc.invalidateQueries({ queryKey: ['modules'] });
      if (!editingCabinetId && data?.cabinet?.id) setSelectedCabinetId(data.cabinet.id);
      reset();
      setEditingCabinetId(null);
      closeModal('addCabinet');
    },
  });

  const cabinetsData = qc.getQueryData(['cabinets']) as { cabinets: any[] } | undefined;
  const editingCabinet = editingCabinetId
    ? cabinetsData?.cabinets?.find((cab) => cab.id === editingCabinetId)
    : null;

  const reset = () => {
    setName('');
    setSymbol('');
    setLocation('');
    setSizeU('42');
  };

  const submit = async () => {
    const parsedSize = Number(sizeU);
    if (!name.trim()) return;
    await mutation.mutateAsync({
      name: name.trim(),
      symbol: symbol.trim() || undefined,
      location: location.trim() || undefined,
      sizeU: Number.isFinite(parsedSize) ? parsedSize : 42,
    });
  };

  const onClose = () => {
    setEditingCabinetId(null);
    reset();
    closeModal('addCabinet');
  };

  const title = editingCabinetId ? 'Edit cabinet' : 'Add cabinet';

  useEffect(() => {
    if (!open) return;
    if (editingCabinetId && editingCabinet) {
      setName(editingCabinet.name ?? '');
      setSymbol(editingCabinet.symbol ?? '');
      setLocation(editingCabinet.location ?? '');
      setSizeU(String(editingCabinet.sizeU ?? 42));
    } else if (!editingCabinetId) {
      reset();
    }
  }, [open, editingCabinetId, editingCabinet]);

  return (
    <ModalBase
      open={open}
      title={title}
      icon="🗄️"
      onClose={onClose}
      size="md"
    >
      <div className="stack gap-4">
        <FormSection title="Cabinet details">
          <div className="stack-sm">
            <label className="field-label" htmlFor="cab-name">Name</label>
            <input
              id="cab-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Edge Rack"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="stack-sm">
              <label className="field-label" htmlFor="cab-symbol">Symbol</label>
              <input
                id="cab-symbol"
                className="input"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="EDGE-A"
              />
            </div>
            <div className="stack-sm">
              <label className="field-label" htmlFor="cab-size">Size (U)</label>
              <input
                id="cab-size"
                className="input"
                type="number"
                min={4}
                max={60}
                value={sizeU}
                onChange={(e) => setSizeU(e.target.value)}
              />
            </div>
          </div>
          <div className="stack-sm">
            <label className="field-label" htmlFor="cab-location">Location</label>
            <input
              id="cab-location"
              className="input"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Core room A3"
            />
          </div>
        </FormSection>

        <div className="modal-footer-premium flex justify-end gap-3">
          <SoftButton variant="ghost" onClick={onClose}>
            Cancel
          </SoftButton>
          <button
            type="button"
            className="btn px-6"
            onClick={submit}
            disabled={!name.trim() || mutation.isPending}
          >
            {mutation.isPending ? 'Saving...' : editingCabinetId ? 'Save changes' : 'Add cabinet'}
          </button>
        </div>
      </div>
    </ModalBase>
  );
}
