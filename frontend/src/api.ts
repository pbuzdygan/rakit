const BASE = (import.meta as any).env.VITE_API_BASE || '';

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const raw = await res.text();
    let message = raw || `Request failed with status ${res.status}`;
    let code: string | undefined;
    try {
      const parsed = JSON.parse(raw);
      message = parsed?.error || message;
      code = parsed?.code;
    } catch {
      // Keep the plain response text.
    }
    if (res.status === 401 && path !== '/api/pin/verify') {
      window.dispatchEvent(new CustomEvent('rakit:unauthorized'));
    }
    throw new ApiError(message, res.status, code);
  }
  return res;
}

async function api(path: string, init?: RequestInit) {
  const res = await request(path, init);
  return res.headers.get('content-type')?.includes('json') ? res.json() : res;
}

export const Api = {
  meta: () => api('/api/meta'),
  verifyPin: (pin: string) => api('/api/pin/verify', { method: 'POST', body: JSON.stringify({ pin }) }),
  session: {
    status: () => api('/api/session'),
    logout: () => api('/api/session/logout', { method: 'POST' }),
  },
  cabinets: {
    list: () => api('/api/cabinets'),
    create: (payload: any) => api('/api/cabinets', { method: 'POST', body: JSON.stringify(payload) }),
    update: (id: number, payload: any) => api(`/api/cabinets/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    remove: (id: number) => api(`/api/cabinets/${id}`, { method: 'DELETE' }),
  },
  devices: {
    all: () => api('/api/devices'),
    list: (cabinetId: number) => api(`/api/cabinets/${cabinetId}/devices`),
    create: (cabinetId: number, payload: any) =>
      api(`/api/cabinets/${cabinetId}/devices`, { method: 'POST', body: JSON.stringify(payload) }),
    update: (cabinetId: number, deviceId: number, payload: any) =>
      api(`/api/cabinets/${cabinetId}/devices/${deviceId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    place: (cabinetId: number, deviceId: number, payload: any) =>
      api(`/api/cabinets/${cabinetId}/devices/${deviceId}/place`, { method: 'POST', body: JSON.stringify(payload) }),
    remove: (cabinetId: number, deviceId: number) =>
      api(`/api/cabinets/${cabinetId}/devices/${deviceId}`, { method: 'DELETE' }),
  },
  devicePorts: {
    list: (cabinetId: number, deviceId: number) =>
      api(`/api/cabinets/${cabinetId}/devices/${deviceId}/ports`),
    update: (cabinetId: number, deviceId: number, portNumber: number, payload: any) =>
      api(`/api/cabinets/${cabinetId}/devices/${deviceId}/ports/${portNumber}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    export: async (cabinetId: number, deviceId: number) => {
      const res = await request(`/api/cabinets/${cabinetId}/devices/${deviceId}/ports/export`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `device-${deviceId}-ports.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
  },
  portHub: {
    devices: () => api('/api/porthub/devices'),
  },
  portConnections: {
    list: () => api('/api/port-connections'),
    create: (payload: any) =>
      api('/api/port-connections', { method: 'POST', body: JSON.stringify(payload) }),
    update: (id: number, payload: any) =>
      api(`/api/port-connections/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    remove: (id: number) => api(`/api/port-connections/${id}`, { method: 'DELETE' }),
  },
  wol: {
    machines: {
      list: () => api('/api/wol/machines'),
      create: (payload: any) =>
        api('/api/wol/machines', { method: 'POST', body: JSON.stringify(payload) }),
      update: (id: number, payload: any) =>
        api(`/api/wol/machines/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
      remove: (id: number) => api(`/api/wol/machines/${id}`, { method: 'DELETE' }),
      wake: (id: number) => api(`/api/wol/machines/${id}/wake`, { method: 'POST' }),
      status: (refresh = false) => api(`/api/wol/status${refresh ? '?refresh=1' : ''}`),
    },
    schedules: {
      create: (payload: any) =>
        api('/api/wol/schedules', { method: 'POST', body: JSON.stringify(payload) }),
      update: (id: number, payload: any) =>
        api(`/api/wol/schedules/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
      remove: (id: number) => api(`/api/wol/schedules/${id}`, { method: 'DELETE' }),
    },
  },
  overview: () => api('/api/overview'),
  audit: (limit = 100) => api(`/api/audit?limit=${limit}`),
  auditPage: (params: { limit?: number; cursor?: number | null; query?: string; result?: string; objectType?: string }) => {
    const search = new URLSearchParams();
    if (params.limit) search.set('limit', String(params.limit));
    if (params.cursor) search.set('cursor', String(params.cursor));
    if (params.query) search.set('query', params.query);
    if (params.result && params.result !== 'all') search.set('result', params.result);
    if (params.objectType && params.objectType !== 'all') search.set('objectType', params.objectType);
    return api(`/api/audit?${search.toString()}`);
  },
  exportAudit: async (params: { query?: string; result?: string; objectType?: string }) => {
    const search = new URLSearchParams();
    if (params.query) search.set('query', params.query);
    if (params.result && params.result !== 'all') search.set('result', params.result);
    if (params.objectType && params.objectType !== 'all') search.set('objectType', params.objectType);
    const res = await request(`/api/audit/export?${search.toString()}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'rakit_audit.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  },
  ipdash: {
    profiles: {
      list: () => api('/api/ipdash/profiles'),
      create: (payload: any) => api('/api/ipdash/profiles', { method: 'POST', body: JSON.stringify(payload) }),
      update: (id: number, payload: any) =>
        api(`/api/ipdash/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
      remove: (id: number) => api(`/api/ipdash/profiles/${id}`, { method: 'DELETE' }),
      test: (payload: any) => api('/api/ipdash/profiles/test', { method: 'POST', body: JSON.stringify(payload) }),
      resetEncrypted: (payload: any) =>
        api('/api/ipdash/profiles/reset-encrypted', { method: 'POST', body: JSON.stringify(payload) }),
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
      updateIp: (hostId: number, payload: any) => api(`/api/ipdash/offline/ips/${hostId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
      removeIp: (hostId: number) => api(`/api/ipdash/offline/ips/${hostId}`, { method: 'DELETE' }),
    },
  },
  exportWorkbook: async (payload: any) => {
    const res = await request('/api/export', {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rakit_export.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  },
};
