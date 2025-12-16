import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  const [activeDeviceId, setActiveDeviceId] = useState<number | null>(null);
  const [selectedPort, setSelectedPort] = useState<number | null>(null);
  const [portForm, setPortForm] = useState(emptyPortForm);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const cabinetsQuery = useQuery({ queryKey: ['cabinets'], queryFn: Api.cabinets.list });
  const cabinets = (cabinetsQuery.data?.cabinets ?? []) as Cabinet[];

  const devicesQuery = useQuery({ queryKey: ['porthub-devices'], queryFn: Api.portHub.devices });
  const devices = (devicesQuery.data?.devices ?? []) as PortAwareDevice[];

  const activeDevice = useMemo(
    () => devices.find((device) => device.id === activeDeviceId) ?? null,
    [devices, activeDeviceId]
  );

  const portsQuery = useQuery({
    queryKey: ['device-ports', activeDevice?.cabinetId, activeDevice?.id],
    queryFn: () => Api.devicePorts.list(activeDevice!.cabinetId, activeDevice!.id),
    enabled: Boolean(activeDevice),
  });
  const ports = (portsQuery.data?.ports ?? []) as DevicePort[];

  useEffect(() => {
    setSelectedPort(null);
    setPortForm(emptyPortForm);
    setStatusMessage(null);
  }, [activeDeviceId]);

  useEffect(() => {
    if (!selectedPort) {
      setPortForm(emptyPortForm);
      return;
    }
    const port = ports.find((entry) => entry.portNumber === selectedPort);
    setPortForm({
      patchPanel: port?.patchPanel ?? '',
      vlan: port?.vlan ?? '',
      comment: port?.comment ?? '',
      ipAddress: port?.ipAddress ?? '',
    });
  }, [selectedPort, ports]);

  const handleSelectDevice = (deviceId: number) => {
    setActiveDeviceId(deviceId);
  };

  const handleSelectPort = (portNumber: number) => {
    setSelectedPort(portNumber);
    setStatusMessage(null);
  };

  const filteredDevices = useMemo(() => {
    if (activeCabinetId === 'all') return devices;
    return devices.filter((device) => device.cabinetId === activeCabinetId);
  }, [devices, activeCabinetId]);

  const updatePort = useMutation({
    mutationFn: async () => {
      if (!activeDevice || !selectedPort) return null;
      const payload = {
        patchPanel: portForm.patchPanel || null,
        vlan: portForm.vlan || null,
        comment: portForm.comment || null,
        ipAddress: portForm.ipAddress || null,
      };
      return Api.devicePorts.update(activeDevice.cabinetId, activeDevice.id, selectedPort, payload);
    },
    onSuccess: async () => {
      if (activeDevice) {
        await queryClient.invalidateQueries({ queryKey: ['device-ports', activeDevice.cabinetId, activeDevice.id] });
        setStatusMessage('Port details saved.');
      }
    },
    onError: (err: any) => {
      setStatusMessage(err?.message || 'Failed to save port.');
    },
  });

  const handlePortFieldChange = (key: keyof typeof portForm, value: string) => {
    setPortForm((prev) => ({ ...prev, [key]: value }));
  };

  const clearPortForm = () => {
    setPortForm(emptyPortForm);
  };

  const isSaving = updatePort.isPending;
  const deviceSelected = Boolean(activeDevice);
  const portSelected = deviceSelected && selectedPort != null;

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
                    className={`porthub-device ${activeDeviceId === device.id ? 'active' : ''}`}
                    onClick={() => handleSelectDevice(device.id)}
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
            {!activeDevice ? (
              <div className="porthub-empty">
                <p className="type-body-sm text-textSec">Select a device to visualize and edit its ports.</p>
              </div>
            ) : (
              <>
                <div className="porthub-device-meta">
                  <h3>
                    {activeDevice.type}{' '}
                    <span className="porthub-device-location">in {activeDevice.cabinetName}</span>
                  </h3>
                  {activeDevice.model ? <p className="text-textSec">{activeDevice.model}</p> : null}
                </div>
                <div className="porthub-port-grid">
                  {Array.from({ length: activeDevice.numberOfPorts }, (_, idx) => {
                    const portNumber = idx + 1;
                    const portData = ports.find((port) => port.portNumber === portNumber);
                    const hasData =
                      Boolean(portData?.patchPanel) ||
                      Boolean(portData?.vlan) ||
                      Boolean(portData?.comment) ||
                      Boolean(portData?.ipAddress);
                    return (
                      <button
                        key={portNumber}
                        type="button"
                        className={`porthub-port ${selectedPort === portNumber ? 'selected' : ''} ${
                          hasData ? 'has-data' : ''
                        }`}
                        onClick={() => handleSelectPort(portNumber)}
                      >
                        {portNumber}
                      </button>
                    );
                  })}
                </div>
                <div className="porthub-port-form">
                  {!portSelected && (
                    <p className="type-caption text-textSec">Select a port to edit its metadata.</p>
                  )}
                  {statusMessage && <p className="type-caption text-textSec">{statusMessage}</p>}
                  <div className="porthub-form-grid compact">
                    <label className="stack-sm">
                      <span className="field-label">Patch Panel</span>
                      <input
                        className="input"
                        value={portForm.patchPanel}
                        onChange={(e) => handlePortFieldChange('patchPanel', e.target.value)}
                        disabled={!portSelected || isSaving}
                        placeholder="Panel / port"
                      />
                    </label>
                    <label className="stack-sm">
                      <span className="field-label">VLAN</span>
                      <input
                        className="input"
                        value={portForm.vlan}
                        onChange={(e) => handlePortFieldChange('vlan', e.target.value)}
                        disabled={!portSelected || isSaving}
                        placeholder="VLAN"
                      />
                    </label>
                    <label className="stack-sm">
                      <span className="field-label">Address IP</span>
                      <input
                        className="input"
                        value={portForm.ipAddress}
                        onChange={(e) => handlePortFieldChange('ipAddress', e.target.value)}
                        disabled={!portSelected || isSaving}
                        placeholder="192.0.2.1"
                      />
                    </label>
                    <label className="stack-sm">
                      <span className="field-label">Comment</span>
                      <input
                        className="input"
                        value={portForm.comment}
                        onChange={(e) => handlePortFieldChange('comment', e.target.value)}
                        disabled={!portSelected || isSaving}
                        placeholder="Notes"
                      />
                    </label>
                  </div>
                  <div className="porthub-form-actions">
                    <SoftButton variant="ghost" onClick={clearPortForm} disabled={!portSelected || isSaving}>
                      Clear
                    </SoftButton>
                    <SoftButton onClick={() => updatePort.mutateAsync()} disabled={!portSelected || isSaving}>
                      {isSaving ? 'Saving…' : 'Save'}
                    </SoftButton>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </Surface>
    </div>
  );
}
