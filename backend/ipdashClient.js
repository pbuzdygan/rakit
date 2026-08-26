import http from 'http';
import https from 'https';
import dns from 'dns/promises';
import net from 'net';

const LEGACY_BASE_PATH = '/proxy/network/api/s/default';
const INTEGRATION_BASE_PATH = '/proxy/network/integration/v1';
const boundedNumber = (value, fallback, minimum, maximum) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(parsed, maximum)) : fallback;
};
const DEFAULT_TIMEOUT = boundedNumber(process.env.IP_DASH_TIMEOUT_MS, 15000, 1000, 120000);
const MAX_RESPONSE_BYTES = boundedNumber(process.env.IP_DASH_MAX_RESPONSE_MB, 25, 1, 100) * 1024 * 1024;
const ALLOW_LOOPBACK = /^(1|true|yes)$/i.test(String(process.env.IP_DASH_ALLOW_LOOPBACK || 'false'));
const TLS_CERTIFICATE_ERROR_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_REJECTED',
  'CERT_SIGNATURE_FAILURE',
  'CERT_UNTRUSTED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

const normalizeTlsError = (error, { isHttps, allowSelfSigned }) => {
  if (!isHttps) return error;
  const originalMessage = String(error?.message || 'TLS connection failed');
  const certificateFailure = TLS_CERTIFICATE_ERROR_CODES.has(error?.code)
    || /certificate|self[- ]signed|issuer|unable to verify|root ca/i.test(originalMessage);
  if (!certificateFailure) return error;

  const normalized = new Error(
    allowSelfSigned
      ? `The UniFi controller TLS connection failed even though the self-signed certificate exception is enabled: ${originalMessage}`
      : 'The UniFi controller certificate is not trusted. For a trusted local controller, enable "Allow self-signed controller certificate" and retry, or install its CA certificate in the Rakit container.'
  );
  normalized.code = allowSelfSigned ? 'UNIFI_TLS_CONNECTION_FAILED' : 'UNIFI_TLS_UNTRUSTED_CERTIFICATE';
  normalized.cause = error;
  return normalized;
};

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
    if (normalized.startsWith('::ffff:')) {
      return isBlockedAddress(normalized.slice('::ffff:'.length));
    }
    return normalized === '::'
      || (!ALLOW_LOOPBACK && normalized === '::1')
      || normalized.startsWith('fe8')
      || normalized.startsWith('fe9')
      || normalized.startsWith('fea')
      || normalized.startsWith('feb')
      || normalized.startsWith('ff');
  }
  return true;
};

const assertAllowedTarget = async (target) => {
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Controller URL must use HTTP or HTTPS');
  const addresses = await dns.lookup(target.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new Error('Controller address resolves to a blocked loopback, link-local or reserved address');
  }
  return addresses;
};

const normalizeHost = (value) => {
  if (typeof value !== 'string' || !value) return '';
  const trimmed = value.trim();
  const hasScheme = /^https?:\/\//i.test(trimmed);
  const withScheme = hasScheme ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return `${url.protocol}//${url.host}`;
  } catch {
    return '';
  }
};

const buildBaseUrl = (host, suffix) => {
  if (!host) return '';
  if (host.endsWith(suffix)) return host;
  return `${host}${suffix}`;
};

const requestJson = async ({ url, headers = {}, timeout = DEFAULT_TIMEOUT, allowSelfSigned = false }) => {
  const target = new URL(url);
  const addresses = await assertAllowedTarget(target);
  return new Promise((resolve, reject) => {
    try {
      const isHttps = target.protocol === 'https:';
      const client = isHttps ? https : http;
      const options = {
        method: 'GET',
        headers,
        // Pass this to the TLS connection used by this exact request. Keeping it
        // only on a custom Agent made the profile exception needlessly indirect.
        rejectUnauthorized: isHttps ? !allowSelfSigned : undefined,
        lookup: (_hostname, lookupOptions, callback) => {
          if (lookupOptions?.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        },
      };
      const req = client.request(target, options, (res) => {
        const declaredLength = Number(res.headers['content-length']);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
          res.destroy();
          reject(new Error('Controller response exceeded the configured size limit'));
          return;
        }
        const chunks = [];
        let receivedBytes = 0;
        res.on('data', (chunk) => {
          receivedBytes += chunk.length;
          if (receivedBytes > MAX_RESPONSE_BYTES) {
            req.destroy(new Error('Controller response exceeded the configured size limit'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            return reject(new Error(`Controller returned HTTP ${res.statusCode}`));
          }
          if (!body) return resolve(null);
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(new Error(`Invalid JSON response from ${url}: ${err.message}`));
          }
        });
      });
      req.setTimeout(timeout, () => {
        req.destroy(new Error('Request timed out'));
      });
      req.on('error', (error) => reject(normalizeTlsError(error, { isHttps, allowSelfSigned })));
      req.end();
    } catch (err) {
      reject(err);
    }
  });
};

export class IpDashClient {
  constructor(host, apiKey, timeout = DEFAULT_TIMEOUT, { allowSelfSigned = false } = {}) {
    this.hostRoot = normalizeHost(host);
    if (!this.hostRoot) throw new Error('Invalid host');
    this.legacyBase = buildBaseUrl(this.hostRoot, LEGACY_BASE_PATH);
    this.integrationBase = buildBaseUrl(this.hostRoot, INTEGRATION_BASE_PATH);
    this.headers = {
      Accept: 'application/json',
      'X-API-KEY': apiKey,
    };
    this.timeout = timeout;
    this.allowSelfSigned = Boolean(allowSelfSigned);
    const slugMatch = /\/proxy\/network\/api\/s\/([^/]+)$/i.exec(this.legacyBase);
    this.siteSlug = slugMatch ? slugMatch[1] : 'default';
  }

  buildLegacyUrl(path) {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.legacyBase}${cleanPath}`;
  }

  buildIntegrationUrl(path) {
    if (!this.integrationBase) throw new Error('Integration API unavailable');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.integrationBase}${cleanPath}`;
  }

  buildV2Url(path) {
    if (!this.hostRoot) throw new Error('Invalid host');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.hostRoot}/proxy/network/v2/api${cleanPath}`;
  }

  async fetch(path) {
    const url = this.buildLegacyUrl(path);
    const json = await requestJson({
      url,
      headers: this.headers,
      timeout: this.timeout,
      allowSelfSigned: this.allowSelfSigned,
    });
    if (json?.meta?.rc && json.meta.rc !== 'ok') {
      throw new Error(`Unifi API rc ${json.meta.rc}`);
    }
    return json?.data ?? json;
  }

  async fetchIntegration(path) {
    const url = this.buildIntegrationUrl(path);
    return requestJson({
      url,
      headers: this.headers,
      timeout: this.timeout,
      allowSelfSigned: this.allowSelfSigned,
    });
  }

  async listSites() {
    try {
      const json = await this.fetchIntegration('/sites');
      if (Array.isArray(json)) return json;
      if (Array.isArray(json?.data)) return json.data;
      return [];
    } catch (err) {
      const message = err?.message || '';
      if (/NotFound/i.test(message) || /404/.test(message)) return [];
      throw err;
    }
  }

  async listClients(siteId, { limit = 200, offset = 0 } = {}) {
    if (!siteId) return [];
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    const safeSiteId = encodeURIComponent(String(siteId));
    const json = await this.fetchIntegration(`/sites/${safeSiteId}/clients?${params.toString()}`).catch((err) => {
      const message = err?.message || '';
      if (/NotFound/i.test(message) || /BAD_REQUEST/i.test(message) || /404/.test(message)) {
        return { data: [] };
      }
      throw err;
    });
    if (Array.isArray(json)) return json;
    return Array.isArray(json?.data) ? json.data : [];
  }

  async listWireguardUsers(siteSlug, networkId) {
    if (!siteSlug || !networkId) return [];
    const safeSiteSlug = encodeURIComponent(String(siteSlug));
    const safeNetworkId = encodeURIComponent(String(networkId));
    const path = `/site/${safeSiteSlug}/wireguard/${safeNetworkId}/users?networkId=${safeNetworkId}`;
    const json = await requestJson({
      url: this.buildV2Url(path),
      headers: this.headers,
      timeout: this.timeout,
      allowSelfSigned: this.allowSelfSigned,
    }).catch((err) => {
      const message = err?.message || '';
      if (/NotFound/i.test(message) || /BAD_REQUEST/i.test(message) || /404/.test(message)) {
        return { data: [] };
      }
      throw err;
    });
    if (Array.isArray(json)) return json;
    return Array.isArray(json?.data) ? json.data : [];
  }

  async loadSnapshot(siteId = null) {
    const [users, onlineClients, networks, devices, integrationClients] = await Promise.all([
      this.fetch('/rest/user'),
      this.fetch('/stat/sta').catch(() => []),
      this.fetch('/rest/networkconf').catch(() => []),
      this.fetch('/stat/device').catch(() => []),
      siteId ? this.listClients(siteId).catch(() => []) : [],
    ]);
    const wireguardPeers = await this.collectWireguardPeers(networks).catch(() => []);
    const usersWithPeers = this.mergeWireguardPeers(users, wireguardPeers);
    const normalizedDevices = Array.isArray(devices)
      ? devices
          .map((device) => {
            const ip = this.extractDeviceIp(device);
            if (!ip) return null;
            return {
              mac: device.mac || null,
              ip,
              name: device.name || device.display_name || device.model || 'UniFi device',
              hostname: device.hostname || device.name || '',
              last_seen: device.last_seen || null,
            };
          })
          .filter(Boolean)
      : [];
    const normalizedIntegrationClients = this.normalizeIntegrationClients(integrationClients);
    return {
      users: usersWithPeers,
      online: [...onlineClients, ...normalizedDevices, ...normalizedIntegrationClients],
      networks,
    };
  }

  normalizeIntegrationClients(clients) {
    if (!Array.isArray(clients)) return [];
    return clients
      .map((client) => {
        if (!client || typeof client !== 'object') return null;
        const ip = client.ipAddress || null;
        if (!ip) return null;
        const connectedAt = client.connectedAt ? Date.parse(client.connectedAt) : null;
        return {
          mac: client.macAddress || null,
          ip,
          name: client.name || client.hostname || '',
          hostname: client.name || '',
          last_seen: connectedAt ? Math.floor(connectedAt / 1000) : null,
          clientType: client.type || null,
          _integration: true,
        };
      })
      .filter(Boolean);
  }

  extractDeviceIp(device) {
    if (!device || typeof device !== 'object') return null;
    if (device.ip) return device.ip;
    if (device.primary_ip) return device.primary_ip;
    const config = device.config_networks;
    if (config && typeof config === 'object') {
      for (const value of Object.values(config)) {
        if (value && typeof value === 'object') {
          if (value.ip) return value.ip;
          if (value.ipaddr) return value.ipaddr;
        }
      }
    }
    if (Array.isArray(device.network_table)) {
      const entry = device.network_table.find((net) => net && net.ip);
      if (entry?.ip) return entry.ip;
    }
    return null;
  }

  async testConnection() {
    await this.fetch('/rest/user');
  }

  async collectWireguardPeers(networks) {
    if (!Array.isArray(networks) || !networks.length) return [];
    const siteSlug = this.siteSlug || 'default';
    if (!siteSlug) return [];
    const wireguardNetworks = networks.filter(
      (network) =>
        network &&
        (network.purpose === 'remote-user-vpn' || network.purpose === 'remote_user_vpn') &&
        (network.vpn_type === 'wireguard-server' || network.vpnType === 'wireguard-server') &&
        network._id
    );
    if (!wireguardNetworks.length) return [];
    const peers = await Promise.all(
      wireguardNetworks.map(async (network) => {
        const users = await this.listWireguardUsers(siteSlug, network._id).catch(() => []);
        if (!Array.isArray(users) || !users.length) return [];
        return users.map((peer) => ({ peer, network }));
      })
    );
    return peers.flat();
  }

  mergeWireguardPeers(users, peerEntries) {
    if (!Array.isArray(peerEntries) || !peerEntries.length) return users;
    const existingUsers = Array.isArray(users) ? [...users] : [];
    const knownIps = new Set(
      existingUsers
        .map((user) => user?.fixed_ip || user?.ip)
        .filter((ip) => typeof ip === 'string' && ip)
    );
    const additions = peerEntries
      .map(({ peer, network }) => {
        const ip = peer?.interface_ip;
        if (!ip || knownIps.has(ip)) return null;
        knownIps.add(ip);
        return {
          _id: `wireguard-peer-${peer?._id || ip}`,
          name: peer?.name || ip,
          hostname: peer?.name || ip,
          mac: '',
          fixed_ip: ip,
          vpn_network_id: network?._id || null,
          vpn_network_name: network?.name || null,
        };
      })
      .filter(Boolean);
    if (!additions.length) return existingUsers;
    return [...existingUsers, ...additions];
  }
}
