import { useMemo, useState, useEffect } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useDraggable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Api } from '../api';
import { Surface } from './Surface';
import { SoftButton } from './SoftButton';
import { useAppStore } from '../store';

type Cabinet = {
  id: number;
  name: string;
  location?: string;
  sizeU: number;
  symbol?: string;
};

type Device = {
  id: number;
  cabinetId: number;
  type: string;
  model?: string;
  heightU: number;
  position: number;
  comment?: string;
};

const slotId = (index: number) => `slot-${index}`;
const deviceIdKey = (id: number) => `device-${id}`;

function RackSlot({ index, occupied }: { index: number; occupied: boolean }) {
  const { setNodeRef, isOver } = useDroppable({
    id: slotId(index),
    data: { type: 'slot', position: index },
  });
  return (
    <div
      ref={setNodeRef}
      className={`rack-slot ${occupied ? 'occupied' : ''} ${isOver ? 'dropping' : ''}`}
      style={{ gridRow: `${index} / span 1`, gridColumn: '2 / span 1' }}
    />
  );
}

function RackLabel({ index }: { index: number }) {
  return (
    <div className="rack-label" style={{ gridRow: `${index} / span 1`, gridColumn: '1 / span 1' }}>
      {index}
    </div>
  );
}

function RackDevice({
  device,
  onDelete,
  onComment,
  onEdit,
  confirmDelete,
  onRequestDelete,
  onCancelDelete,
  groupCount,
  groupIndex,
  reorderMode,
}: {
  device: Device;
  onDelete: (device: Device) => void;
  onComment: (device: Device) => void;
  onEdit: (device: Device) => void;
  confirmDelete: boolean;
  onRequestDelete: (device: Device) => void;
  onCancelDelete: () => void;
  groupCount: number;
  groupIndex: number;
  reorderMode: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: deviceIdKey(device.id),
    disabled: !reorderMode,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `device-drop-${device.id}`,
    data: { type: 'device', position: device.position, deviceId: device.id },
  });
  const widthPercent = 100 / groupCount;
  const baseLeft =
    groupCount > 1 ? `calc(${groupIndex} * (100% / ${groupCount}))` : undefined;
  const shellStyle: React.CSSProperties = {
    gridRow: `${device.position} / span ${device.heightU}`,
    gridColumn: '2 / span 1',
    width: `calc(${widthPercent}% - 4px)`,
    position: 'relative',
    left: baseLeft,
  };
  const cardStyle: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0 : 1,
    pointerEvents: isDragging ? 'none' : undefined,
  };
  const dragProps = reorderMode ? listeners : {};
  const dragAttributes = reorderMode ? attributes : {};

  const commentActive = Boolean(device.comment && device.comment.length);
  return (
    <div ref={setDropRef} style={shellStyle} className={`rack-device-shell ${isOver ? 'dropping' : ''}`}>
      <div
        ref={setNodeRef}
        style={cardStyle}
        className={`rack-device ${isDragging ? 'dragging' : ''} ${reorderMode ? 'reorder-mode' : ''}`}
        {...dragProps}
        {...dragAttributes}
      >
        <div className="rack-device-header">
          <span className="device-info">
            {device.type}
            {device.model ? ` · ${device.model}` : ''}
          </span>
          <div className="device-actions">
            {confirmDelete ? (
              <>
                <button
                  type="button"
                  className="device-confirm-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(device);
                  }}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  className="device-cancel-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancelDelete();
                  }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={`device-comment ${commentActive ? 'active' : ''}`}
                  onClick={(e) => {
                    if (reorderMode) return;
                    e.stopPropagation();
                    onComment(device);
                  }}
                  disabled={reorderMode}
                  aria-label={commentActive ? 'Edit comment' : 'Add comment'}
                  title={commentActive ? 'Edit comment' : 'Add comment'}
                >
                  💬
                </button>
                <button
                  type="button"
                  className="device-comment device-edit"
                  onClick={(e) => {
                    if (reorderMode) return;
                    e.stopPropagation();
                    onEdit(device);
                  }}
                  disabled={reorderMode}
                  aria-label="Edit device"
                  title="Edit device"
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="device-remove"
                  onClick={(e) => {
                    if (reorderMode) return;
                    e.stopPropagation();
                    (e.currentTarget as HTMLButtonElement).blur();
                    onRequestDelete(device);
                  }}
                  disabled={reorderMode}
                  title="Remove device"
                  aria-label="Remove device"
                >
                  ✕
                </button>
              </>
            )}
          </div>
        </div>
        {/* comment text intentionally hidden; icon state indicates presence */}
      </div>
    </div>
  );
}

export function CabinetView() {
  const queryClient = useQueryClient();
  const selectedCabinetId = useAppStore((s) => s.selectedCabinetId);
  const setSelectedCabinetId = useAppStore((s) => s.setSelectedCabinetId);
  const setEditingCabinetId = useAppStore((s) => s.setEditingCabinetId);
  const setEditingDevice = useAppStore((s) => s.setEditingDevice);
  const openCommentModal = useAppStore((s) => s.openCommentModal);
  const openModal = useAppStore((s) => s.openModal);

  const cabinetsQuery = useQuery({
    queryKey: ['cabinets'],
    queryFn: Api.cabinets.list,
  });
  const cabinets = (cabinetsQuery.data?.cabinets ?? []) as Cabinet[];
  const cabinet = cabinets.find((cab) => cab.id === selectedCabinetId) ?? null;

  const devicesQuery = useQuery({
    queryKey: ['cabinet-devices', cabinet?.id],
    queryFn: () => Api.devices.list(cabinet!.id),
    enabled: !!cabinet,
  });
  const devices = (devicesQuery.data?.devices ?? []) as Device[];

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [confirmDeviceId, setConfirmDeviceId] = useState<number | null>(null);
  const [confirmCabinetRemoval, setConfirmCabinetRemoval] = useState(false);
  const [activeDeviceId, setActiveDeviceId] = useState<number | null>(null);
  const [activeDeviceMeta, setActiveDeviceMeta] = useState<{ count: number; index: number } | null>(null);
  const [reorderMode, setReorderMode] = useState(false);
  const occupancy = useMemo(() => {
    if (!cabinet) return [];
    const rows = Array.from({ length: cabinet.sizeU }, () => ({ occupied: false, deviceId: null as number | null }));
    for (const device of devices) {
      for (let offset = 0; offset < device.heightU; offset++) {
        const index = device.position + offset - 1;
        if (rows[index]) {
          rows[index] = { occupied: true, deviceId: device.id };
        }
      }
    }
    return rows;
  }, [cabinet, devices]);

  const groupedByPosition = useMemo(() => {
    const map = new Map<number, Device[]>();
    devices.forEach((device) => {
      if (!map.has(device.position)) map.set(device.position, []);
      map.get(device.position)!.push(device);
    });
    map.forEach((list) => list.sort((a, b) => a.id - b.id));
    return map;
  }, [devices]);

  const groupMeta = useMemo(() => {
    const meta = new Map<number, { count: number; index: number }>();
    groupedByPosition.forEach((list) => {
      list.forEach((device, idx) => {
        meta.set(device.id, { count: list.length, index: idx });
      });
    });
    return meta;
  }, [groupedByPosition]);

  const isSlotAvailable = (slot: number, height: number, deviceId?: number) => {
    if (!cabinet) return false;
    const maxStart = cabinet.sizeU - height + 1;
    if (slot < 1 || slot > maxStart) return false;
    if (deviceId == null) return true;
    // allow stacking: only ensure slot within bounds
    return true;
  };

  const invalidateDevices = async () => {
    if (cabinet) {
      await queryClient.invalidateQueries({ queryKey: ['cabinet-devices', cabinet.id] });
      await queryClient.invalidateQueries({ queryKey: ['modules'] });
    }
  };

  useEffect(() => {
    setConfirmDeviceId(null);
    setConfirmCabinetRemoval(false);
  }, [cabinet?.id]);

  const handleComment = (device: Device) => {
    setConfirmDeviceId(null);
    openCommentModal(device.id, device.cabinetId, device.comment ?? '');
  };

  const handleDelete = async (device: Device) => {
    await Api.devices.remove(device.cabinetId, device.id);
    await invalidateDevices();
    setConfirmDeviceId(null);
  };

  const handleDeviceEdit = (device: Device) => {
    setConfirmDeviceId(null);
    setEditingDevice({
      id: device.id,
      cabinetId: device.cabinetId,
      type: device.type,
      model: device.model ?? '',
      heightU: device.heightU,
    });
    openModal('addDevice');
  };

  const handleDragStart = (event: DragStartEvent) => {
    const device = devices.find((d) => deviceIdKey(d.id) === event.active.id);
    setActiveDeviceId(device?.id ?? null);
    setActiveDeviceMeta(device ? (groupMeta.get(device.id) ?? null) : null);
    setConfirmDeviceId(null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDeviceId(null);
    setActiveDeviceMeta(null);
    if (!cabinet) return;
    const { active, over } = event;
    if (!over) return;
    const device = devices.find((d) => deviceIdKey(d.id) === active.id);
    if (!device) return;
    let targetPosition: number | null = null;
    const overId = String(over.id);
    const overData = over.data?.current as { position?: number } | undefined;
    if (overData?.position != null) {
      targetPosition = overData.position;
    } else if (overId.startsWith('slot-')) {
      const slot = Number(overId.replace('slot-', ''));
      targetPosition = Number.isInteger(slot) ? slot : null;
    } else if (overId.startsWith('device-drop-')) {
      const targetId = Number(overId.replace('device-drop-', ''));
      const targetDevice = devices.find((d) => d.id === targetId);
      targetPosition = targetDevice?.position ?? null;
    } else if (overId.startsWith('device-')) {
      const targetId = Number(overId.replace('device-', ''));
      const targetDevice = devices.find((d) => d.id === targetId);
      targetPosition = targetDevice?.position ?? null;
    }
    if (!targetPosition || !isSlotAvailable(targetPosition, device.heightU, device.id)) return;
    if (targetPosition !== device.position) {
      await Api.devices.update(cabinet.id, device.id, { position: targetPosition });
      await invalidateDevices();
    }
  };

  const requestDeviceRemoval = (device: Device) => {
    setConfirmDeviceId((prev) => (prev === device.id ? null : device.id));
  };

  const beginCabinetEdit = () => {
    if (!cabinet) return;
    setEditingCabinetId(cabinet.id);
    openModal('addCabinet');
  };

  const confirmCabinetRemovalAction = async () => {
    if (!cabinet) return;
    await Api.cabinets.remove(cabinet.id);
    await queryClient.invalidateQueries({ queryKey: ['cabinets'] });
    await queryClient.invalidateQueries({ queryKey: ['modules'] });
    const remaining = cabinets.find((c) => c.id !== cabinet.id);
    setSelectedCabinetId(remaining?.id ?? null);
    setConfirmCabinetRemoval(false);
  };

  if (cabinetsQuery.isLoading) {
    return (
      <Surface className="stack gap-4">
        <p className="type-body-sm text-textSec">Loading cabinets…</p>
      </Surface>
    );
  }

  if (!cabinets.length) {
    return (
      <Surface className="stack gap-4">
        <h3 className="type-title-lg">No cabinets yet</h3>
        <p className="type-body-sm text-textSec">
          Use the Add cabinet action to start building your rack layout.
        </p>
      </Surface>
    );
  }

  if (!cabinet) {
    return (
      <Surface className="stack gap-4">
        <h3 className="type-title-lg">Select a cabinet</h3>
        <p className="type-body-sm text-textSec">Use the selector in the main bar to choose a cabinet to display.</p>
      </Surface>
    );
  }

  const usedUnits = occupancy.reduce((sum, slot) => (slot.occupied ? sum + 1 : sum), 0);
  const freeUnits = Math.max(cabinet.sizeU - usedUnits, 0);

  const rackGrid = (
    <div className="rack-canvas">
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveDeviceId(null);
          setActiveDeviceMeta(null);
        }}
      >
        <div
          className="rack-grid"
          style={{ gridTemplateRows: `repeat(${cabinet.sizeU}, minmax(32px, 1fr))` }}
        >
          {Array.from({ length: cabinet.sizeU }, (_, idx) => (
            <div key={`row-${idx + 1}`} className="rack-row-wrapper">
              <RackLabel index={idx + 1} />
              <RackSlot index={idx + 1} occupied={occupancy[idx]?.occupied ?? false} />
            </div>
          ))}
          {devices.map((device) => {
            const meta = groupMeta.get(device.id) ?? { count: 1, index: 0 };
            return (
              <RackDevice
                key={device.id}
                device={device}
                onDelete={handleDelete}
                onComment={handleComment}
                onEdit={handleDeviceEdit}
                confirmDelete={confirmDeviceId === device.id}
                onRequestDelete={requestDeviceRemoval}
                onCancelDelete={() => setConfirmDeviceId(null)}
                groupCount={meta.count}
                groupIndex={meta.index}
                reorderMode={reorderMode}
              />
            );
          })}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeDeviceId
            ? (() => {
                const device = devices.find((d) => d.id === activeDeviceId);
                if (!device) return null;
                return (
                  <div
                    className="rack-device dragging"
                    style={{
                      width: activeDeviceMeta ? `calc(${100 / activeDeviceMeta.count}% - 4px)` : '220px',
                      height: `${device.heightU * 36}px`,
                    }}
                  >
                    <div className="rack-device-header">
                      <span className="device-type">{device.type}</span>
                    </div>
                    {device.model && <p className="device-model">{device.model}</p>}
                  </div>
                );
              })()
            : null}
        </DragOverlay>
      </DndContext>
    </div>
  );

  return (
    <div className="stack gap-4">
      <Surface className="stack gap-2">
        <div className="cabinet-header">
          <div className="cabinet-header-info">
            <h3 className="type-title-lg">{cabinet.name}</h3>
            <p className="type-body-sm text-textSec">
              {cabinet.location ? `${cabinet.location} • ` : ''}{cabinet.sizeU}U capacity
            </p>
          </div>
          <p className="cabinet-summary type-body-sm text-textSec">
            {devices.length} devices placed · {freeUnits} free U
          </p>
          <div className="cabinet-header-actions">
            {confirmCabinetRemoval ? (
              <>
                <SoftButton variant="danger" onClick={confirmCabinetRemovalAction}>
                  Confirm remove
                </SoftButton>
                <SoftButton variant="ghost" onClick={() => setConfirmCabinetRemoval(false)}>
                  Cancel
                </SoftButton>
              </>
            ) : (
              <>
                <SoftButton variant="ghost" onClick={beginCabinetEdit}>
                  Edit
                </SoftButton>
                <SoftButton
                  variant="ghost"
                  onClick={() => {
                    setConfirmCabinetRemoval(true);
                    setConfirmDeviceId(null);
                  }}
                >
                  Remove
                </SoftButton>
              </>
            )}
          </div>
        </div>
      </Surface>

      <Surface className="rack-surface">
        <div className="rack-toolbar">
          <SoftButton
            onClick={() => {
              setConfirmCabinetRemoval(false);
              setConfirmDeviceId(null);
              setEditingDevice(null);
              openModal('addDevice');
            }}
          >
            Add device
          </SoftButton>
          <SoftButton
            variant={reorderMode ? 'danger' : 'ghost'}
            onClick={() => {
              const next = !reorderMode;
              setReorderMode(next);
              if (!next) {
                setConfirmDeviceId(null);
              }
            }}
          >
            {reorderMode ? 'Exit mode' : 'Device reorder'}
          </SoftButton>
        </div>
        {rackGrid}
      </Surface>
    </div>
  );
}
