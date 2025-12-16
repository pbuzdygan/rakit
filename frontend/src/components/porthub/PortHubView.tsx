import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient, useQueries } from '@tanstack/react-query';
import { Api } from '../../api';
import { Surface } from '../Surface';
import { SoftButton } from '../SoftButton';
import { useAppStore } from '../../store';
import { IconComment, IconEdit, IconTrash } from '../icons';

type Cabinet = { id: number; name: string };

type PortAwareDevice = {
  id: number;
  cabinetId: number;
  cabinetName: string;
  type: string;
  model?: string | null;
  comment?: string | null;
  heightU: number;
  numberOfPorts: number;
};

type DevicePort = {
  id: number;
  deviceId: number;
  portNumber: number;
  patchPanel: string;
  vlan: string;
  comment: string;
  ipAddress: string;
};

const emptyPortForm = { patchPanel: '', vlan: '', comment: '', ipAddress: '' };

export function PortHubView() {
  const [activeCabinetId, setActiveCabinetId] = useState<number | 'all'>('all');
  const [selectedDevices, setSelectedDevices] = useState<number[]>([]);
  const [selectedPorts, setSelectedPorts] = useState<Record<number, number | null>>({});
  const [portForms, setPortForms] = useState<Record<number, typeof emptyPortForm>>({});
  const [statusMessages, setStatusMessages] = useState<Record<number, string | null>>({});
  const [deleteConfirmationId, setDeleteConfirmationId] = useState<number | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const queryClient = useQueryClient();
  const openCommentModal = useAppStore((s) => s.openCommentModal);
  const setEditingDevice = useAppStore((s) => s.setEditingDevice);
  const openModal = useAppStore((s) => s.openModal);

  const cabinetsQuery = useQuery({ queryKey: ['cabinets'], queryFn: Api.cabinets.list });
  const cabinets = (cabinetsQuery.data?.cabinets ?? []) as Cabinet[];

  const devicesQuery = useQuery({ queryKey: ['porthub-devices'], queryFn: Api.portHub.devices });
  const devices = (devicesQuery.data?.devices ?? []) as PortAwareDevice[];

  useEffect(() => {
    setSelectedDevices([]);
    setSelectedPorts({});
    setPortForms({});
    setStatusMessages({});
    setDeleteConfirmationId(null);
    setLinkMode(false);
  }, [activeCabinetId]);

  const filteredDevices = useMemo(() => {
    if (activeCabinetId === 'all') return devices;
    return devices.filter((device) => device.cabinetId === activeCabinetId);
  }, [devices, activeCabinetId]);

  useEffect(() => {
    setSelectedDevices((prev) => prev.filter((id) => filteredDevices.some((device) => device.id === id)));
  }, [filteredDevices]);

  useEffect(() => {
    if (!selectedDevices.length) {
      setLinkMode(false);
    }
  }, [selectedDevices.length]);

  const toggleDeviceSelection = (deviceId: number) => {
    setSelectedDevices((prev) => {
      if (prev.includes(deviceId)) {
        const next = prev.filter((id) => id !== deviceId);
        setSelectedPorts((ports) => {
          const copy = { ...ports };
          delete copy[deviceId];
          return copy;
        });
        setPortForms((forms) => {
          const copy = { ...forms };
          delete copy[deviceId];
          return copy;
        });
        setStatusMessages((messages) => {
          const copy = { ...messages };
          delete copy[deviceId];
          return copy;
        });
        return next;
      }
      setSelectedPorts((ports) => ({ ...ports, [deviceId]: null }));
      setPortForms((forms) => ({ ...forms, [deviceId]: emptyPortForm }));
      setStatusMessages((messages) => ({ ...messages, [deviceId]: null }));
      return [...prev, deviceId];
    });
  };

  const portQueries = useQueries({
    queries: selectedDevices.map((deviceId) => {
      const device = devices.find((entry) => entry.id === deviceId);
      return {
        queryKey: ['device-ports', device?.cabinetId, deviceId],
        queryFn: () => Api.devicePorts.list(device!.cabinetId, deviceId),
        enabled: Boolean(device),
      };
    }),
  });

  const getPortsForDevice = (deviceId: number) => {
    const index = selectedDevices.indexOf(deviceId);
    if (index === -1) return [];
    const query = portQueries[index];
    return ((query?.data?.ports ?? []) as DevicePort[]) || [];
  };

  const handleSelectPort = (deviceId: number, portNumber: number) => {
    setSelectedPorts((prev) => ({ ...prev, [deviceId]: portNumber }));
    const ports = getPortsForDevice(deviceId);
    const port = ports.find((entry) => entry.portNumber === portNumber);
    setPortForms((prev) => ({
      ...prev,
      [deviceId]: {
        patchPanel: port?.patchPanel ?? '',
        vlan: port?.vlan ?? '',
        comment: port?.comment ?? '',
        ipAddress: port?.ipAddress ?? '',
      },
    }));
    setStatusMessages((prev) => ({ ...prev, [deviceId]: null }));
  };

  const handlePortFieldChange = (deviceId: number, key: keyof typeof portForm, value: string) => {
    setPortForms((prev) => ({
      ...prev,
      [deviceId]: { ...(prev[deviceId] ?? emptyPortForm), [key]: value },
    }));
  };

  const clearPortForm = (deviceId: number) => {
    setPortForms((prev) => ({ ...prev, [deviceId]: emptyPortForm }));
    setStatusMessages((prev) => ({ ...prev, [deviceId]: null }));
  };

  const updatePort = useMutation({
    mutationFn: async ({
      deviceId,
      cabinetId,
      portNumber,
      payload,
    }: {
      deviceId: number;
      cabinetId: number;
      portNumber: number;
      payload: any;
    }) => Api.devicePorts.update(cabinetId, deviceId, portNumber, payload),
    onSuccess: async (_, variables) => {
      if (!variables) return;
      const { deviceId, cabinetId } = variables;
      await queryClient.invalidateQueries({ queryKey: ['device-ports', cabinetId, deviceId] });
      setStatusMessages((prev) => ({ ...prev, [deviceId]: 'Port details saved.' }));
    },
    onError: (err: any, variables) => {
      if (!variables) return;
      setStatusMessages((prev) => ({ ...prev, [variables.deviceId]: err?.message || 'Failed to save port.' }));
    },
  });

  const deleteDevice = useMutation({
    mutationFn: ({ cabinetId, deviceId }: { cabinetId: number; deviceId: number }) =>
      Api.devices.remove(cabinetId, deviceId),
    onSuccess: async (_, vars) => {
      await queryClient.invalidateQueries({ queryKey: ['porthub-devices'] });
      await queryClient.invalidateQueries({ queryKey: ['cabinet-devices', vars.cabinetId] });
      await queryClient.invalidateQueries({ queryKey: ['modules'] });
      setSelectedDevices((prev) => prev.filter((id) => id !== vars.deviceId));
      setSelectedPorts((prev) => {
        const next = { ...prev };
        delete next[vars.deviceId];
        return next;
      });
      setPortForms((prev) => {
        const next = { ...prev };
        delete next[vars.deviceId];
        return next;
      });
      setStatusMessages((prev) => {
        const next = { ...prev };
        delete next[vars.deviceId];
        return next;
      });
      setDeleteConfirmationId(null);
    },
  });

  const handleCommentDevice = (device: PortAwareDevice) => {
    setDeleteConfirmationId(null);
    openCommentModal(device.id, device.cabinetId, device.comment ?? '');
  };

  const handleEditDevice = (device: PortAwareDevice) => {
    setDeleteConfirmationId(null);
    setEditingDevice({
      id: device.id,
      cabinetId: device.cabinetId,
      type: device.type,
      model: device.model ?? '',
      heightU: device.heightU,
      portAware: true,
      numberOfPorts: device.numberOfPorts ?? null,
    });
    openModal('addDevice');
  };

  const handleRequestDelete = (deviceId: number) => {
    setDeleteConfirmationId((prev) => (prev === deviceId ? null : deviceId));
  };

  const handleDeleteDevice = async (device: PortAwareDevice) => {
    await deleteDevice.mutateAsync({ cabinetId: device.cabinetId, deviceId: device.id });
  };

  const toggleLinkMode = () => {
    setDeleteConfirmationId(null);
    setLinkMode((prev) => !prev);
  };

  const filterButtons: Array<{ id: 'all' | number; label: string }> = [
    { id: 'all', label: 'All Devices' },
    ...cabinets.map((cabinet) => ({ id: cabinet.id, label: cabinet.name })),
  ];

  return (
    <div className="stack gap-4">
      <Surface className="stack gap-4">
        <div className="porthub-toolbar">
          {filterButtons.map((button) => (
            <SoftButton
              key={button.id}
              variant={activeCabinetId === button.id ? 'solid' : 'ghost'}
              onClick={() => setActiveCabinetId(button.id)}
            >
              {button.label}
            </SoftButton>
          ))}
        </div>
        <div className="porthub-shell">
          <div className="porthub-sidebar">
            <h3 className="porthub-heading">Port aware devices</h3>
            <div className="porthub-device-list">
              {filteredDevices.length === 0 ? (
                <p className="type-body-sm text-textSec">No devices with Port aware device enabled.</p>
              ) : (
                filteredDevices.map((device) => (
                  <button
                    key={device.id}
                    type="button"
                    className={`porthub-device ${selectedDevices.includes(device.id) ? 'active' : ''}`}
                    onClick={() => toggleDeviceSelection(device.id)}
                    title={`Cabinet: ${device.cabinetName}`}
                  >
                    <div className="device-title">
                      <span className="device-type">{device.type}</span>
                      {device.model ? <span className="device-model">{device.model}</span> : null}
                    </div>
                    <span className="device-ports-count">{device.numberOfPorts || 0} ports</span>
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="porthub-main">
            {selectedDevices.length === 0 ? (
              <div className="porthub-empty">
                <p className="type-body-sm text-textSec">Select devices to visualize and edit their ports.</p>
              </div>
            ) : (
              selectedDevices
                .map((id) => devices.find((device) => device.id === id))
                .filter((device): device is PortAwareDevice => Boolean(device))
                .map((device) => {
                  const devicePorts = getPortsForDevice(device.id);
                  const portSelected = selectedPorts[device.id] ?? null;
                  const form = portForms[device.id] ?? emptyPortForm;
                  const statusMessage = statusMessages[device.id] ?? null;
                  const deviceSaving =
                    updatePort.isPending && updatePort.variables?.deviceId === device.id;
                  const deletingThisDevice =
                    deleteDevice.isPending && deleteDevice.variables?.deviceId === device.id;
                  const hasFormValue =
                    Boolean(form.patchPanel) ||
                    Boolean(form.vlan) ||
                    Boolean(form.ipAddress) ||
                    Boolean(form.comment);
                  const saveDisabled = !portSelected || deviceSaving;
                  const handleSavePort = () => {
                    if (!portSelected || saveDisabled) return;
                    updatePort.mutateAsync({
                      deviceId: device.id,
                      cabinetId: device.cabinetId,
                      portNumber: portSelected,
                      payload: {
                        patchPanel: form.patchPanel || null,
                        vlan: form.vlan || null,
                        comment: form.comment || null,
                        ipAddress: form.ipAddress || null,
                      },
                    });
                  };
                  return (
                    <div key={device.id} className="porthub-device-section">
                      <div className="porthub-device-meta">
                        <div className="porthub-device-head">
                          <div className="porthub-device-text">
                            <h3>
                              {device.type}{' '}
                              <span className="porthub-device-location">in {device.cabinetName}</span>
                            </h3>
                            {device.model ? <p className="text-textSec">{device.model}</p> : null}
                          </div>
                          <div className="device-actions device-actions--compact">
                            <button
                              type="button"
                              className={`device-link-mode ${linkMode ? 'active' : ''}`}
                              onClick={toggleLinkMode}
                              aria-pressed={linkMode}
                            >
                              {linkMode ? 'Exit mode' : 'Link mode'}
                            </button>
                            <button
                              type="button"
                              className={`device-save-button ${hasFormValue && !saveDisabled ? 'dirty' : ''}`}
                              onClick={handleSavePort}
                              disabled={saveDisabled}
                            >
                              {deviceSaving ? 'Saving…' : 'Save'}
                            </button>
                            {deleteConfirmationId === device.id ? (
                              <>
                                <button
                                  type="button"
                                  className="device-confirm-remove"
                                  onClick={() => handleDeleteDevice(device)}
                                  disabled={
                                    deleteDevice.isPending && deleteDevice.variables?.deviceId === device.id
                                  }
                                >
                                  {deleteDevice.isPending && deleteDevice.variables?.deviceId === device.id
                                    ? 'Removing…'
                                    : 'Confirm'}
                                </button>
                                <button
                                  type="button"
                                  className="device-cancel-remove"
                                  onClick={() => setDeleteConfirmationId(null)}
                                  disabled={deleteDevice.isPending}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className={`device-comment ${device.comment ? 'active' : ''}`}
                                  onClick={() => handleCommentDevice(device)}
                                  aria-label={device.comment ? 'Edit comment' : 'Add comment'}
                                  title={device.comment ? 'Edit comment' : 'Add comment'}
                                  disabled={deletingThisDevice}
                                >
                                  <IconComment className="device-action-icon" />
                                </button>
                                <button
                                  type="button"
                                  className="device-comment device-edit"
                                  onClick={() => handleEditDevice(device)}
                                  aria-label="Edit device"
                                  title="Edit device"
                                  disabled={deletingThisDevice}
                                >
                                  <IconEdit className="device-action-icon" />
                                </button>
                                <button
                                  type="button"
                                  className="device-remove"
                                  onClick={() => handleRequestDelete(device.id)}
                                  aria-label="Remove device"
                                  title="Remove device"
                                  disabled={deletingThisDevice}
                                >
                                  <IconTrash className="device-action-icon" />
                                </button>
                                <button
                                  type="button"
                                  className="device-clear-button"
                                  onClick={() => clearPortForm(device.id)}
                                  disabled={saveDisabled}
                                >
                                  Clear
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="porthub-port-grid">
                        {Array.from({ length: device.numberOfPorts }, (_, idx) => {
                          const portNumber = idx + 1;
                          const portData = devicePorts.find((port) => port.portNumber === portNumber);
                          const hasData =
                            Boolean(portData?.patchPanel) ||
                            Boolean(portData?.vlan) ||
                            Boolean(portData?.comment) ||
                            Boolean(portData?.ipAddress);
                          return (
                            <button
                              key={portNumber}
                              type="button"
                              className={`porthub-port ${
                                portSelected === portNumber ? 'selected' : ''
                              } ${hasData ? 'has-data' : ''}`}
                              onClick={() => handleSelectPort(device.id, portNumber)}
                            >
                              {portNumber}
                            </button>
                          );
                        })}
                      </div>
                      <div className="porthub-port-form">
                        {statusMessage && <p className="type-caption text-textSec">{statusMessage}</p>}
                        <div className="porthub-form-grid compact with-actions">
                          <label className="stack-sm porthub-field-narrow">
                            <span className="field-label">Tag</span>
                            <input
                              className="input"
                              value={form.patchPanel}
                              onChange={(e) =>
                                handlePortFieldChange(device.id, 'patchPanel', e.target.value)
                              }
                              disabled={saveDisabled}
                              placeholder="Tag"
                            />
                          </label>
                          <label className="stack-sm porthub-field-narrow">
                            <span className="field-label">VLAN</span>
                            <input
                              className="input"
                              value={form.vlan}
                              onChange={(e) => handlePortFieldChange(device.id, 'vlan', e.target.value)}
                              disabled={saveDisabled}
                              placeholder="VLAN"
                            />
                          </label>
                          <label className="stack-sm porthub-field-narrow">
                            <span className="field-label">Address IP</span>
                            <input
                              className="input"
                              value={form.ipAddress}
                              onChange={(e) =>
                                handlePortFieldChange(device.id, 'ipAddress', e.target.value)
                              }
                              disabled={saveDisabled}
                              placeholder="192.0.2.1"
                            />
                          </label>
                          <label className="stack-sm porthub-field-comment">
                            <span className="field-label">Comment</span>
                            <input
                              className="input"
                              value={form.comment}
                              onChange={(e) =>
                                handlePortFieldChange(device.id, 'comment', e.target.value)
                              }
                              disabled={saveDisabled}
                              placeholder="Notes"
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </div>
      </Surface>
    </div>
  );
}
