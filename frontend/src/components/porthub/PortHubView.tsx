import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient, useQueries } from '@tanstack/react-query';
import { Api } from '../../api';
import { Surface } from '../Surface';
import { SoftButton } from '../SoftButton';

type Cabinet = { id: number; name: string };

type PortAwareDevice = {
  id: number;
  cabinetId: number;
  cabinetName: string;
  type: string;
  model?: string;
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
  const queryClient = useQueryClient();

  const cabinetsQuery = useQuery({ queryKey: ['cabinets'], queryFn: Api.cabinets.list });
  const cabinets = (cabinetsQuery.data?.cabinets ?? []) as Cabinet[];

  const devicesQuery = useQuery({ queryKey: ['porthub-devices'], queryFn: Api.portHub.devices });
  const devices = (devicesQuery.data?.devices ?? []) as PortAwareDevice[];

  useEffect(() => {
    setSelectedDevices([]);
    setSelectedPorts({});
    setPortForms({});
    setStatusMessages({});
  }, [activeCabinetId]);

  const filteredDevices = useMemo(() => {
    if (activeCabinetId === 'all') return devices;
    return devices.filter((device) => device.cabinetId === activeCabinetId);
  }, [devices, activeCabinetId]);

  useEffect(() => {
    setSelectedDevices((prev) => prev.filter((id) => filteredDevices.some((device) => device.id === id)));
  }, [filteredDevices]);

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
                  const saveDisabled = !portSelected || deviceSaving;
                  return (
                    <div key={device.id} className="porthub-device-section">
                      <div className="porthub-device-meta">
                        <h3>
                          {device.type}{' '}
                          <span className="porthub-device-location">in {device.cabinetName}</span>
                        </h3>
                        {device.model ? <p className="text-textSec">{device.model}</p> : null}
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
                        {!portSelected && (
                          <p className="type-caption text-textSec">
                            Select a port to edit its metadata.
                          </p>
                        )}
                        {statusMessage && <p className="type-caption text-textSec">{statusMessage}</p>}
                        <div className="porthub-form-grid compact">
                          <label className="stack-sm">
                            <span className="field-label">Patch Panel</span>
                            <input
                              className="input"
                              value={form.patchPanel}
                              onChange={(e) =>
                                handlePortFieldChange(device.id, 'patchPanel', e.target.value)
                              }
                              disabled={saveDisabled}
                              placeholder="Panel / port"
                            />
                          </label>
                          <label className="stack-sm">
                            <span className="field-label">VLAN</span>
                            <input
                              className="input"
                              value={form.vlan}
                              onChange={(e) => handlePortFieldChange(device.id, 'vlan', e.target.value)}
                              disabled={saveDisabled}
                              placeholder="VLAN"
                            />
                          </label>
                          <label className="stack-sm">
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
                          <label className="stack-sm">
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
                        <div className="porthub-form-actions">
                          <SoftButton
                            variant="ghost"
                            onClick={() => clearPortForm(device.id)}
                            disabled={saveDisabled}
                          >
                            Clear
                          </SoftButton>
                          <SoftButton
                            onClick={() =>
                              updatePort.mutateAsync({
                                deviceId: device.id,
                                cabinetId: device.cabinetId,
                                portNumber: portSelected!,
                                payload: {
                                  patchPanel: form.patchPanel || null,
                                  vlan: form.vlan || null,
                                  comment: form.comment || null,
                                  ipAddress: form.ipAddress || null,
                                },
                              })
                            }
                            disabled={saveDisabled}
                          >
                            {deviceSaving ? 'Saving…' : 'Save'}
                          </SoftButton>
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
