import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ModalBase } from './ModalBase';
import { useAppStore } from '../../store';
import { Api } from '../../api';
import { SoftButton } from '../SoftButton';

export function CommentModal() {
  const { modals, closeCommentModal } = useAppStore();
  const { open, deviceId, value, cabinetId } = modals.comment;
  const [text, setText] = useState(value ?? '');
  const qc = useQueryClient();

  useEffect(() => {
    if (open) setText(value ?? '');
  }, [open, value]);

  const mutation = useMutation({
    mutationFn: async ({ deviceId, cabinetId, comment }: { deviceId: number; cabinetId: number; comment: string | null }) =>
      Api.devices.update(cabinetId, deviceId, { comment }),
    onSuccess: async (_, vars) => {
      await qc.invalidateQueries({ queryKey: ['cabinet-devices', vars.cabinetId] });
      closeCommentModal();
    },
  });

  const handleSave = async () => {
    if (!deviceId || !cabinetId) return;
    await mutation.mutateAsync({
      deviceId,
      cabinetId,
      comment: text.trim() ? text.trim() : null,
    });
  };

  return (
    <ModalBase
      open={open}
      title="Device comment"
      icon="💬"
      onClose={closeCommentModal}
      size="sm"
    >
      <div className="stack gap-4">
        <textarea
          className="input min-h-[120px]"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a note about this device..."
        />
        <div className="modal-footer-premium flex justify-end gap-3">
          <SoftButton variant="ghost" onClick={closeCommentModal}>
            Cancel
          </SoftButton>
          <button
            type="button"
            className="btn px-6"
            disabled={mutation.isPending}
            onClick={handleSave}
          >
            {mutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </ModalBase>
  );
}
