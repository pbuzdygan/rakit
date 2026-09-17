import http from 'http';
import https from 'https';
import dns from 'dns/promises';
import net from 'net';

const boundedNumber = (value, fallback, minimum, maximum) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(parsed, maximum)) : fallback;
};

const DEFAULT_TIMEOUT = boundedNumber(process.env.SEMAPHORE_TIMEOUT_MS, 15000, 1000, 120000);
const MAX_RESPONSE_BYTES = boundedNumber(process.env.SEMAPHORE_MAX_RESPONSE_MB, 10, 1, 100) * 1024 * 1024;
const ALLOW_LOOPBACK = /^(1|true|yes)$/i.test(String(process.env.SEMAPHORE_ALLOW_LOOPBACK || 'false'));

const isBlockedAddress = (address) => {
  const version = net.isIP(address);
  if (version === 4) {
    const [first, second] = address.split('.').map(Number);
    return first === 0
      || (!ALLOW_LOOPBACK && first === 127)
      || (first === 169 && second === 254)
      || first >= 224;
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith('::ffff:')) return isBlockedAddress(normalized.slice(7));
    return normalized === '::'
      || (!ALLOW_LOOPBACK && normalized === '::1')
      || /^fe[89ab]/.test(normalized)
      || normalized.startsWith('ff');
  }
  return true;
};

const assertAllowedTarget = async (target) => {
  if (!['http:', 'https:'].includes(target.protocol)) {
    throw new Error('Semaphore URL must use HTTP or HTTPS');
  }
  const addresses = await dns.lookup(target.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new Error('Semaphore address resolves to a blocked loopback, link-local or reserved address');
  }
  return addresses;
};

export const normalizeSemaphoreUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) return '';
  const candidate = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return '';
    const pathname = url.pathname.replace(/\/+$/, '').replace(/\/api$/i, '');
    return `${url.protocol}//${url.host}${pathname === '/' ? '' : pathname}`;
  } catch {
    return '';
  }
};

const requestJson = async ({
  url,
  method = 'GET',
  headers = {},
  body,
  timeout = DEFAULT_TIMEOUT,
  allowSelfSigned = false,
  responseType = 'json',
}) => {
  const target = new URL(url);
  const addresses = await assertAllowedTarget(target);
  const payload = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');

  return new Promise((resolve, reject) => {
    const isHttps = target.protocol === 'https:';
    const client = isHttps ? https : http;
    const request = client.request(target, {
      method,
      headers: {
        Accept: responseType === 'text' ? 'text/plain' : 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        ...headers,
      },
      rejectUnauthorized: isHttps ? !allowSelfSigned : undefined,
      lookup: (_hostname, options, callback) => {
        if (options?.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
    }, (response) => {
      const declaredLength = Number(response.headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
        response.destroy();
        reject(new Error('Semaphore response exceeded the configured size limit'));
        return;
      }
      const chunks = [];
      let received = 0;
      response.on('data', (chunk) => {
        received += chunk.length;
        if (received > MAX_RESPONSE_BYTES) {
          request.destroy(new Error('Semaphore response exceeded the configured size limit'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (responseType === 'text' && response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
          resolve(raw);
          return;
        }
        let parsed = null;
        if (raw) {
          try { parsed = JSON.parse(raw); }
          catch {
            const error = new Error('Semaphore returned an invalid JSON response');
            error.status = response.statusCode;
            reject(error);
            return;
          }
        }
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          const message = parsed?.message || parsed?.error || `Semaphore returned HTTP ${response.statusCode || 500}`;
          const error = new Error(message);
          error.status = response.statusCode || 500;
          error.response = parsed;
          reject(error);
          return;
        }
        resolve(parsed);
      });
    });
    request.setTimeout(timeout, () => request.destroy(new Error('Semaphore request timed out')));
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
};

export class SemaphoreClient {
  constructor(baseUrl, token, { timeout = DEFAULT_TIMEOUT, allowSelfSigned = false } = {}) {
    this.baseUrl = normalizeSemaphoreUrl(baseUrl);
    if (!this.baseUrl) throw new Error('Invalid Semaphore URL');
    if (!token) throw new Error('Semaphore API token is missing');
    this.timeout = timeout;
    this.allowSelfSigned = Boolean(allowSelfSigned);
    this.headers = { Authorization: `Bearer ${token}` };
  }

  request(path, options = {}) {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return requestJson({
      url: `${this.baseUrl}/api${cleanPath}`,
      headers: this.headers,
      timeout: this.timeout,
      allowSelfSigned: this.allowSelfSigned,
      ...options,
    });
  }

  listProjects() { return this.request('/projects'); }
  getProject(projectId) { return this.request(`/project/${Number(projectId)}`); }
  listInventories(projectId) { return this.request(`/project/${Number(projectId)}/inventory`); }
  getInventory(projectId, inventoryId) { return this.request(`/project/${Number(projectId)}/inventory/${Number(inventoryId)}`); }
  updateInventory(projectId, inventoryId, inventory) {
    return this.request(`/project/${Number(projectId)}/inventory/${Number(inventoryId)}`, { method: 'PUT', body: inventory });
  }
  listTemplates(projectId) { return this.request(`/project/${Number(projectId)}/templates`); }
  getTemplate(projectId, templateId) { return this.request(`/project/${Number(projectId)}/templates/${Number(templateId)}`); }
  launchTask(projectId, payload) { return this.request(`/project/${Number(projectId)}/tasks`, { method: 'POST', body: payload }); }
  getTask(projectId, taskId) { return this.request(`/project/${Number(projectId)}/tasks/${Number(taskId)}`); }
  getTaskOutput(projectId, taskId) { return this.request(`/project/${Number(projectId)}/tasks/${Number(taskId)}/output`); }
  getTaskRawOutput(projectId, taskId) {
    return this.request(`/project/${Number(projectId)}/tasks/${Number(taskId)}/raw_output`, { responseType: 'text' });
  }

  async discover(projectId = null) {
    const projectsPayload = await this.listProjects();
    const projects = Array.isArray(projectsPayload) ? projectsPayload : projectsPayload?.projects ?? [];
    const selectedProjectId = Number(projectId) || Number(projects[0]?.id) || null;
    if (!selectedProjectId) return { projects, inventories: [], templates: [] };
    const [inventoriesPayload, templatesPayload] = await Promise.all([
      this.listInventories(selectedProjectId),
      this.listTemplates(selectedProjectId),
    ]);
    return {
      projects,
      inventories: Array.isArray(inventoriesPayload) ? inventoriesPayload : inventoriesPayload?.inventory ?? [],
      templates: Array.isArray(templatesPayload) ? templatesPayload : templatesPayload?.templates ?? [],
    };
  }
}
