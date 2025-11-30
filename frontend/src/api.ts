const BASE = (import.meta as any).env.VITE_API_BASE || '';

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.headers.get('content-type')?.includes('json') ? res.json() : res;
}

export const Api = {
  verifyPin: (pin: string) => api('/api/pin/verify', { method: 'POST', body: JSON.stringify({ pin }) }),
  cabinets: {
    list: () => api('/api/cabinets'),
    create: (payload: any) => api('/api/cabinets', { method: 'POST', body: JSON.stringify(payload) }),
    update: (id: number, payload: any) => api(`/api/cabinets/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    remove: (id: number) => api(`/api/cabinets/${id}`, { method: 'DELETE' }),
  },
  devices: {
    list: (cabinetId: number) => api(`/api/cabinets/${cabinetId}/devices`),
    create: (cabinetId: number, payload: any) =>
      api(`/api/cabinets/${cabinetId}/devices`, { method: 'POST', body: JSON.stringify(payload) }),
    update: (cabinetId: number, deviceId: number, payload: any) =>
      api(`/api/cabinets/${cabinetId}/devices/${deviceId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    remove: (cabinetId: number, deviceId: number) =>
      api(`/api/cabinets/${cabinetId}/devices/${deviceId}`, { method: 'DELETE' }),
  },
  ipdash: {
    profiles: {
      list: () => api('/api/ipdash/profiles'),
      create: (payload: any) => api('/api/ipdash/profiles', { method: 'POST', body: JSON.stringify(payload) }),
      update: (id: number, payload: any) =>
        api(`/api/ipdash/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
      remove: (id: number) => api(`/api/ipdash/profiles/${id}`, { method: 'DELETE' }),
      test: (payload: any) => api('/api/ipdash/profiles/test', { method: 'POST', body: JSON.stringify(payload) }),
    },
    sites: {
      preview: (payload: any) => api('/api/ipdash/sites/preview', { method: 'POST', body: JSON.stringify(payload) }),
    },
    data: (profileId?: number | null) =>
      api(profileId ? `/api/ipdash/data?profileId=${profileId}` : '/api/ipdash/data'),
    offline: {
      addScope: (payload: any) => api('/api/ipdash/offline/scopes', { method: 'POST', body: JSON.stringify(payload) }),
      removeScope: (scopeId: number) => api(`/api/ipdash/offline/scopes/${scopeId}`, { method: 'DELETE' }),
      addIp: (payload: any) => api('/api/ipdash/offline/ips', { method: 'POST', body: JSON.stringify(payload) }),
      removeIp: (hostId: number) => api(`/api/ipdash/offline/ips/${hostId}`, { method: 'DELETE' }),
    },
  },
  exportWorkbook: async (payload: any) => {
    const res = await fetch(`${BASE}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rakit_export.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  },
};
