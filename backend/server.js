import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import dns from 'dns/promises';
import db from './db.js';
import { buildExportWorkbook, DEFAULT_IPDASH_FILTERS } from './export.js';
import { IpDashClient } from './ipdashClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 8011);
const APP_PIN = process.env.APP_PIN || '';
const IP_DASH_SECRET = process.env.IP_DASH_SECRET || '';
const IP_DASH_TIMEOUT_MS = Number(process.env.IP_DASH_TIMEOUT_MS || 15000);
const LOCAL_OFFLINE_MODE = 'local-offline';

const clampText = (value, max = 120) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const mapCabinetRow = (row) => ({
  id: row.id,
  name: row.name,
  symbol: row.symbol ?? '',
  location: row.location ?? '',
  sizeU: row.size_u ?? 42,
});

const mapDeviceRow = (row) => ({
  id: row.id,
  cabinetId: row.cabinet_id,
  type: row.device_type,
  model: row.model ?? '',
  heightU: row.height_u ?? 1,
  position: row.position ?? 1,
  comment: row.comment ?? '',
});

const listCabinets = () =>
  db.prepare('SELECT * FROM cabinets ORDER BY name ASC').all().map(mapCabinetRow);

const getCabinet = (cabinetId) => {
  const row = db.prepare('SELECT * FROM cabinets WHERE id=?').get(cabinetId);
  return row ? mapCabinetRow(row) : null;
};

const listDevicesForCabinet = (cabinetId) =>
  db
    .prepare('SELECT * FROM cabinet_devices WHERE cabinet_id=? ORDER BY position ASC, id ASC')
    .all(cabinetId)
    .map(mapDeviceRow);

const isRangeFree = (devices, start, height, ignoreId = null) => {
  const end = start + height - 1;
  for (const device of devices) {
    if (ignoreId && device.id === ignoreId) continue;
    const dStart = device.position;
    const dEnd = device.position + device.heightU - 1;
    if (Math.max(dStart, start) <= Math.min(dEnd, end)) return false;
  }
  return true;
};

const findFirstAvailablePosition = (cabinet, devices, height) => {
  const maxStart = cabinet.sizeU - height + 1;
  for (let start = 1; start <= maxStart; start++) {
    if (isRangeFree(devices, start, height)) return start;
  }
  return null;
};

const hasRangeConflict = (devices, start, height, ignoreId = null) => {
  const end = start + height - 1;
  for (const device of devices) {
    if (device.id === Number(ignoreId)) continue;
    const dStart = device.position;
    const dEnd = device.position + (device.heightU ?? device.heightu ?? 1) - 1;
    const overlaps = Math.max(dStart, start) <= Math.min(dEnd, end);
    if (overlaps && dStart !== start) return true;
  }
  return false;
};

const getIpDashKey = (() => {
  let cached = null;
  return () => {
    if (!IP_DASH_SECRET) throw new Error('IP_DASH_SECRET is not configured');
    if (!cached) cached = crypto.createHash('sha256').update(IP_DASH_SECRET, 'utf8').digest();
    return cached;
  };
})();

const encryptSecret = (value) => {
  if (!value) return null;
  const key = getIpDashKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${encrypted.toString('base64')}:${tag.toString('base64')}`;
};

const decryptSecret = (payload) => {
  if (!payload) return '';
  const [ivStr, dataStr, tagStr] = payload.split(':');
  if (!ivStr || !dataStr || !tagStr) return '';
  const key = getIpDashKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivStr, 'base64'));
  decipher.setAuthTag(Buffer.from(tagStr, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataStr, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
};

const normalizeHost = (value) => {
  if (!value) return '';
  const trimmed = value.trim();
  const hasScheme = /^https?:\/\//i.test(trimmed);
  const withScheme = hasScheme ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return `${url.protocol}//${url.host}`;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
};

const extractHostname = (value) => {
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.hostname;
  } catch {
    return value.replace(/^https?:\/\//i, '').split('/')[0];
  }
};

const resolveHostIp = async (value) => {
  const hostname = extractHostname(value);
  if (!hostname) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return hostname;
  try {
    const result = await dns.lookup(hostname);
    return result?.address ?? null;
  } catch {
    return null;
  }
};

const fetchProfileData = async (profileRow) => {
  if (!profileRow) throw new Error('Profile not found');
  const apiKey = decryptSecret(profileRow.api_key_encrypted);
  if (!apiKey) throw new Error('Profile API key missing');
  const host = profileRow.host;
  if (!host) throw new Error('Controller host missing');
  const client = new IpDashClient(host, apiKey, IP_DASH_TIMEOUT_MS);
  let inferredSiteId = profileRow.site_id || null;
  if (!inferredSiteId) {
    try {
      const sites = await client.listSites();
      if (sites.length === 1 && sites[0]?.id) {
        inferredSiteId = sites[0].id;
      }
    } catch {
      inferredSiteId = null;
    }
  }
  const [snapshot, controllerIp] = await Promise.all([client.loadSnapshot(inferredSiteId), resolveHostIp(host)]);
  return { ...snapshot, controllerIp };
};

const mapProfileRow = (row) => ({
  id: row.id,
  name: row.name,
  location: row.location ?? '',
  host: row.host,
  mode: row.mode ?? 'proxy',
  siteId: row.site_id || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const ipToInt = (ip) => {
  if (!ip || typeof ip !== 'string') return null;
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  if (octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
};

const intToIp = (value) => [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');

const describeCidr = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const [ipPart, maskPart] = trimmed.split('/');
  if (!ipPart || !maskPart) return null;
  const cidr = Number(maskPart);
  if (!Number.isInteger(cidr) || cidr < 1 || cidr > 30) return null;
  const ipInt = ipToInt(ipPart);
  if (ipInt == null) return null;
  const mask = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
  const networkBase = (ipInt & mask) >>> 0;
  const totalHosts = 2 ** (32 - cidr);
  if (totalHosts > 4096) return null;
  const firstHost = totalHosts <= 2 ? networkBase : (networkBase + 1) >>> 0;
  const lastHost = totalHosts <= 2 ? (networkBase + totalHosts - 1) >>> 0 : (networkBase + totalHosts - 2) >>> 0;
  return {
    cidr: `${intToIp(networkBase)}/${cidr}`,
    firstHostInt: firstHost,
    lastHostInt: lastHost,
    hostCount: Math.max(0, lastHost - firstHost + 1),
  };
};

const isIpInRange = (ip, descriptor) => {
  const int = ipToInt(ip);
  if (int == null || !descriptor) return false;
  return int >= descriptor.firstHostInt && int <= descriptor.lastHostInt;
};

const mapScopeRow = (row) => ({
  id: row.id,
  profileId: row.profile_id,
  cidr: row.cidr,
  label: row.label ?? '',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const getScopeById = (scopeId) => {
  const row =
    db
      .prepare('SELECT * FROM ipdash_scopes WHERE id=?')
      .get(scopeId) ?? null;
  return row ? mapScopeRow(row) : null;
};

const listOfflineScopes = (profileId) =>
  db
    .prepare('SELECT * FROM ipdash_scopes WHERE profile_id=? ORDER BY created_at ASC, id ASC')
    .all(profileId)
    .map(mapScopeRow);

const listOfflineHostsWithScopes = (profileId) =>
  db
    .prepare(
      `SELECT h.*, s.cidr, s.label
       FROM ipdash_scope_hosts h
       JOIN ipdash_scopes s ON s.id = h.scope_id
       WHERE h.profile_id=?
       ORDER BY h.scope_id ASC, h.ip ASC`
    )
    .all(profileId);

const buildOfflineSnapshot = (profileRow) => {
  const scopes = listOfflineScopes(profileRow.id);
  const hosts = listOfflineHostsWithScopes(profileRow.id);
  const networks = scopes.map((scope) => ({
    _id: `offline-scope-${scope.id}`,
    name: scope.label || scope.cidr,
    ip_subnet: scope.cidr,
    scope_id: scope.id,
  }));
  const users = hosts.map((host) => ({
    _id: `offline-host-${host.id}`,
    name: host.name || host.hostname || '',
    hostname: host.hostname || '',
    mac: host.mac || '',
    fixed_ip: host.ip,
    scope_id: host.scope_id,
  }));
  return {
    status: LOCAL_OFFLINE_MODE,
    profile: mapProfileRow(profileRow),
    users,
    online: [],
    networks,
    offlineScopes: scopes,
    controllerIp: null,
  };
};

const getProfileById = (id) => db.prepare('SELECT * FROM ipdash_profiles WHERE id=?').get(id);

const getLatestProfile = () =>
  db.prepare('SELECT * FROM ipdash_profiles ORDER BY created_at DESC LIMIT 1').get() ?? null;

const listProfiles = () =>
  db.prepare('SELECT * FROM ipdash_profiles ORDER BY created_at DESC').all().map(mapProfileRow);

const buildIpDashContext = async (payload = {}) => {
  const requestedId = payload?.profileId ? Number(payload.profileId) : null;
  let profileRow = requestedId ? getProfileById(requestedId) : null;
  if (!profileRow) profileRow = getLatestProfile();
  if (!profileRow) throw new Error('No IP Dash profile configured.');
  let snapshot;
  if (profileRow.mode === LOCAL_OFFLINE_MODE) {
    snapshot = buildOfflineSnapshot(profileRow);
  } else {
    const data = await fetchProfileData(profileRow);
    snapshot = { status: 'active', profile: mapProfileRow(profileRow), offlineScopes: [], ...data };
  }
  const viewMode = payload?.viewMode === 'grid' ? 'grid' : 'table';
  const groupBy = typeof payload?.groupBy === 'string' ? payload.groupBy : 'none';
  const filters = {
    ...DEFAULT_IPDASH_FILTERS,
    ...(typeof payload?.filters === 'object' ? payload.filters : {}),
  };
  const groupTags = typeof payload?.groupTags === 'object' && payload.groupTags ? payload.groupTags : {};
  const networkIndex = Number.isFinite(Number(payload?.networkIndex)) ? Number(payload.networkIndex) : 0;
  return {
    snapshot,
    viewMode,
    groupBy,
    filters,
    groupTags,
    networkIndex,
  };
};

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(morgan('dev'));

// Health check
app.get('/health', (_req,res)=> res.json({ status: 'ok' }));

// Pin verification (auto-pass if APP_PIN empty)
app.post('/api/pin/verify', (req,res)=>{
  const { pin } = req.body || {};
  if (!APP_PIN) return res.json({ ok: true });
  if (typeof pin === 'string' && pin === APP_PIN && pin.length >= 4 && pin.length <= 8) {
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: 'Wrong Pin' });
});

app.get('/api/cabinets', (_req,res)=>{
  res.json({ cabinets: listCabinets() });
});

app.post('/api/cabinets', (req,res)=>{
  const { name, symbol, location, sizeU } = req.body || {};
  const trimmedName = clampText(name, 80);
  if (!trimmedName) return res.status(400).json({ error: 'Cabinet name required' });
  const parsedSize = Number(sizeU ?? 42);
  if (!Number.isInteger(parsedSize) || parsedSize < 4 || parsedSize > 60) {
    return res.status(400).json({ error: 'Invalid sizeU' });
  }
  const payload = {
    name: trimmedName,
    symbol: clampText(symbol, 24) || null,
    location: clampText(location, 120) || null,
    size_u: parsedSize,
  };
  const info = db
    .prepare('INSERT INTO cabinets(name, symbol, location, size_u) VALUES (@name, @symbol, @location, @size_u)')
    .run(payload);
  const cabinet = getCabinet(info.lastInsertRowid);
  res.json({ ok: true, cabinet });
});

app.patch('/api/cabinets/:cabinetId', (req,res)=>{
  const { cabinetId } = req.params;
  const cabinet = getCabinet(cabinetId);
  if (!cabinet) return res.status(404).json({ error: 'Cabinet not found' });
  const payload = req.body || {};
  const sets = [];
  const values = [];
  const assign = (column, value) => {
    sets.push(`${column}=?`);
    values.push(value);
  };
  if (payload.name) assign('name', clampText(payload.name, 80));
  if ('symbol' in payload) assign('symbol', clampText(payload.symbol, 24) || null);
  if ('location' in payload) assign('location', clampText(payload.location, 120) || null);
  if ('sizeU' in payload) {
    const parsedSize = Number(payload.sizeU);
    if (!Number.isInteger(parsedSize) || parsedSize < 4 || parsedSize > 60) {
      return res.status(400).json({ error: 'Invalid sizeU' });
    }
    assign('size_u', parsedSize);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  values.push(cabinetId);
  db.prepare(`UPDATE cabinets SET ${sets.join(', ')} WHERE id=?`).run(...values);
  const updated = getCabinet(cabinetId);
  res.json({ ok: true, cabinet: updated });
});

app.delete('/api/cabinets/:cabinetId', (req,res)=>{
  const { cabinetId } = req.params;
  const info = db.prepare('DELETE FROM cabinets WHERE id=?').run(cabinetId);
  if (!info.changes) return res.status(404).json({ error: 'Cabinet not found' });
  res.json({ ok: true });
});

const ensureCabinet = (cabinetId, res) => {
  const cabinet = getCabinet(cabinetId);
  if (!cabinet && res) res.status(404).json({ error: 'Cabinet not found' });
  return cabinet;
};

app.get('/api/cabinets/:cabinetId/devices', (req,res)=>{
  const { cabinetId } = req.params;
  const cabinet = ensureCabinet(cabinetId, res);
  if (!cabinet) return;
  res.json({ cabinet, devices: listDevicesForCabinet(cabinet.id) });
});

app.post('/api/cabinets/:cabinetId/devices', (req,res)=>{
  const { cabinetId } = req.params;
  const cabinet = ensureCabinet(cabinetId, res);
  if (!cabinet) return;
  const { type, model, heightU } = req.body || {};
  const trimmedType = clampText(type, 60);
  if (!trimmedType) return res.status(400).json({ error: 'Device type required' });
  const h = Number(heightU ?? 1);
  if (!Number.isInteger(h) || h < 1 || h > cabinet.sizeU) {
    return res.status(400).json({ error: 'Invalid heightU' });
  }
  const devices = listDevicesForCabinet(cabinet.id);
  const position = findFirstAvailablePosition(cabinet, devices, h);
  if (position == null) return res.status(409).json({ error: 'No available space in cabinet' });
  const info = db
    .prepare(
      `INSERT INTO cabinet_devices(cabinet_id, device_type, model, height_u, position)
       VALUES (?,?,?,?,?)`
    )
    .run(cabinet.id, trimmedType, clampText(model, 80) || null, h, position);
  res.json({ ok: true, device: listDevicesForCabinet(cabinet.id).find((d) => d.id === info.lastInsertRowid) });
});

app.patch('/api/cabinets/:cabinetId/devices/:deviceId', (req,res)=>{
  const { cabinetId, deviceId } = req.params;
  const cabinet = ensureCabinet(cabinetId, res);
  if (!cabinet) return;
  const devices = listDevicesForCabinet(cabinet.id);
  const device = devices.find((d) => d.id === Number(deviceId));
  if (!device) return res.status(404).json({ error: 'Device not found' });
  const payload = req.body || {};
  let newHeight = device.heightU;
  let newPosition = device.position;

  if ('heightU' in payload) {
    const parsed = Number(payload.heightU);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > cabinet.sizeU) {
      return res.status(400).json({ error: 'Invalid heightU' });
    }
    newHeight = parsed;
  }
  if ('position' in payload) {
    const parsed = Number(payload.position);
    if (!Number.isInteger(parsed)) return res.status(400).json({ error: 'Invalid position' });
    newPosition = parsed;
  }

  const maxStart = cabinet.sizeU - newHeight + 1;
  if (newPosition < 1 || newPosition > maxStart) {
    return res.status(400).json({ error: 'Position out of range' });
  }
  if (hasRangeConflict(devices, newPosition, newHeight, device.id)) {
    return res.status(409).json({ error: 'Space already occupied' });
  }

  const sets = [];
  const vals = [];
  if ('type' in payload) {
    const trimmed = clampText(payload.type, 60);
    if (!trimmed) return res.status(400).json({ error: 'Device type required' });
    sets.push('device_type=?');
    vals.push(trimmed);
  }
  if ('model' in payload) {
    sets.push('model=?');
    vals.push(clampText(payload.model, 80) || null);
  }
  if ('comment' in payload) {
    sets.push('comment=?');
    vals.push(clampText(payload.comment, 400) || null);
  }
  if (newHeight !== device.heightU) {
    sets.push('height_u=?');
    vals.push(newHeight);
  }
  if (newPosition !== device.position) {
    sets.push('position=?');
    vals.push(newPosition);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(deviceId);
  db.prepare(`UPDATE cabinet_devices SET ${sets.join(', ')} WHERE id=?`).run(...vals);
  res.json({
    ok: true,
    device: listDevicesForCabinet(cabinet.id).find((d) => d.id === Number(deviceId)),
  });
});

app.delete('/api/cabinets/:cabinetId/devices/:deviceId', (req,res)=>{
  const { cabinetId, deviceId } = req.params;
  const cabinet = ensureCabinet(cabinetId, res);
  if (!cabinet) return;
  const info = db.prepare('DELETE FROM cabinet_devices WHERE id=? AND cabinet_id=?').run(deviceId, cabinet.id);
  if (!info.changes) return res.status(404).json({ error: 'Device not found' });
  res.json({ ok: true });
});
app.get('/api/ipdash/profiles', (_req,res)=>{
  res.json({ profiles: listProfiles() });
});

app.post('/api/ipdash/profiles', (req,res)=>{
  const { name, location, host, mode, apiKey, siteId } = req.body || {};
  const trimmedName = clampText(name, 120);
  if (!trimmedName) return res.status(400).json({ error: 'Profile name required' });
  const normalizedMode = mode === 'direct' ? 'direct' : mode === LOCAL_OFFLINE_MODE ? LOCAL_OFFLINE_MODE : 'proxy';
  let sanitizedHost = '';
  let encryptedKey = null;
  let normalizedSiteId = null;
  if (normalizedMode === LOCAL_OFFLINE_MODE) {
    encryptedKey = encryptSecret('local-offline');
  } else {
    sanitizedHost = normalizeHost(host);
    if (!sanitizedHost) return res.status(400).json({ error: 'Valid host required' });
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return res.status(400).json({ error: 'API key required' });
    }
    encryptedKey = encryptSecret(apiKey.trim());
    if (siteId && typeof siteId === 'string') {
      normalizedSiteId = siteId.trim() || null;
    }
  }
  try {
    const info = db
      .prepare('INSERT INTO ipdash_profiles(name, location, host, mode, site_id, api_key_encrypted) VALUES (?,?,?,?,?,?)')
      .run(trimmedName, clampText(location, 120) || null, sanitizedHost, normalizedMode, normalizedSiteId, encryptedKey);
    const profile = getProfileById(info.lastInsertRowid);
    res.json({ ok: true, profile: mapProfileRow(profile) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to store profile' });
  }
});

app.patch('/api/ipdash/profiles/:profileId', (req,res)=>{
  const { profileId } = req.params;
  const existing = getProfileById(profileId);
  if (!existing) return res.status(404).json({ error: 'Profile not found' });
  const payload = req.body || {};
  const sets = [];
  const values = [];
  let forceSiteIdNull = false;
  const assign = (column, value) => {
    sets.push(`${column}=?`);
    values.push(value);
  };
  if ('name' in payload) {
    const trimmedName = clampText(payload.name, 120);
    if (!trimmedName) return res.status(400).json({ error: 'Profile name required' });
    assign('name', trimmedName);
  }
  if ('location' in payload) assign('location', clampText(payload.location, 120) || null);
  if ('host' in payload) {
    const sanitizedHost = normalizeHost(payload.host);
    if (!sanitizedHost) return res.status(400).json({ error: 'Valid host required' });
    assign('host', sanitizedHost);
  }
  if ('mode' in payload) {
    const nextMode = payload.mode === 'direct' ? 'direct' : payload.mode === LOCAL_OFFLINE_MODE ? LOCAL_OFFLINE_MODE : 'proxy';
    assign('mode', nextMode);
    if (nextMode === LOCAL_OFFLINE_MODE) {
      assign('host', '');
      forceSiteIdNull = true;
    }
  }
  if ('apiKey' in payload) {
    if (payload.apiKey && typeof payload.apiKey === 'string') {
      try {
        assign('api_key_encrypted', encryptSecret(payload.apiKey.trim()));
      } catch (err) {
        return res.status(500).json({ error: err.message || 'Encryption failed' });
      }
    } else if (payload.apiKey === '') {
      return res.status(400).json({ error: 'API key cannot be empty' });
    }
  }
  if (forceSiteIdNull) {
    assign('site_id', null);
  } else if ('siteId' in payload && payload.siteId !== undefined) {
    const normalizedSiteId = typeof payload.siteId === 'string' ? payload.siteId.trim() || null : null;
    assign('site_id', normalizedSiteId);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  values.push(profileId);
  db.prepare(`UPDATE ipdash_profiles SET ${sets.join(', ')} WHERE id=?`).run(...values);
  const updated = getProfileById(profileId);
  res.json({ ok: true, profile: mapProfileRow(updated) });
});

app.delete('/api/ipdash/profiles/:profileId', (req,res)=>{
  const { profileId } = req.params;
  const info = db.prepare('DELETE FROM ipdash_profiles WHERE id=?').run(profileId);
  if (!info.changes) return res.status(404).json({ error: 'Profile not found' });
  res.json({ ok: true });
});

app.post('/api/ipdash/profiles/test', async (req,res)=>{
  const { host, apiKey } = req.body || {};
  const sanitizedHost = normalizeHost(host);
  if (!sanitizedHost) return res.status(400).json({ error: 'Valid host required' });
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({ error: 'API key required' });
  }
  try {
    const client = new IpDashClient(sanitizedHost, apiKey.trim(), IP_DASH_TIMEOUT_MS);
    await client.testConnection();
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Failed to reach controller' });
  }
});

app.post('/api/ipdash/sites/preview', async (req,res)=>{
  const { host, apiKey } = req.body || {};
  const sanitizedHost = normalizeHost(host);
  if (!sanitizedHost) return res.status(400).json({ error: 'Valid host required' });
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({ error: 'API key required' });
  }
  try {
    const client = new IpDashClient(sanitizedHost, apiKey.trim(), IP_DASH_TIMEOUT_MS);
    const sites = await client.listSites();
    const normalizedSites = Array.isArray(sites)
      ? sites
          .map((site) => {
            const id = site?.id || site?._id || null;
            if (!id) return null;
            const name = site?.name || site?.displayName || site?.desc || id;
            return { id, name };
          })
          .filter(Boolean)
      : [];
    res.json({ ok: true, sites: normalizedSites });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Failed to list sites' });
  }
});

app.get('/api/ipdash/data', async (req,res)=>{
  const requestedId = req.query.profileId ? Number(req.query.profileId) : null;
  let profileRow = requestedId ? getProfileById(requestedId) : null;
  if (!profileRow) profileRow = getLatestProfile();
  if (!profileRow) {
    return res.json({
      status: 'missing-profile',
      profile: null,
      users: [],
      online: [],
      networks: [],
      controllerIp: null,
    });
  }
  if (profileRow.mode === LOCAL_OFFLINE_MODE) {
    const snapshot = buildOfflineSnapshot(profileRow);
    return res.json(snapshot);
  }
  try {
    const data = await fetchProfileData(profileRow);
    res.json({ status: 'active', profile: mapProfileRow(profileRow), offlineScopes: [], ...data });
  } catch (err) {
    res.json({
      status: 'inactive',
      profile: mapProfileRow(profileRow),
      error: err.message || 'Failed to load data',
      users: [],
      online: [],
      networks: [],
      offlineScopes: [],
      controllerIp: null,
    });
  }
});

app.post('/api/ipdash/offline/scopes', (req,res)=>{
  const { profileId, cidr, label } = req.body || {};
  const profileIdNum = Number(profileId);
  if (!profileIdNum) return res.status(400).json({ error: 'Profile required' });
  const profile = getProfileById(profileIdNum);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  if (profile.mode !== LOCAL_OFFLINE_MODE) return res.status(400).json({ error: 'Profile is not Local Offline' });
  const descriptor = describeCidr(cidr);
  if (!descriptor) return res.status(400).json({ error: 'CIDR required (example 192.168.68.0/24, max 4096 hosts)' });
  const info = db
    .prepare('INSERT INTO ipdash_scopes(profile_id, cidr, label) VALUES (?,?,?)')
    .run(profileIdNum, descriptor.cidr, clampText(label, 80) || null);
  const scope = getScopeById(info.lastInsertRowid);
  res.json({ ok: true, scope });
});

app.delete('/api/ipdash/offline/scopes/:scopeId', (req,res)=>{
  const { scopeId } = req.params;
  const scope = getScopeById(scopeId);
  if (!scope) return res.status(404).json({ error: 'Scope not found' });
  const profile = getProfileById(scope.profileId);
  if (!profile || profile.mode !== LOCAL_OFFLINE_MODE) {
    return res.status(400).json({ error: 'Scope is not part of a Local Offline profile' });
  }
  db.prepare('DELETE FROM ipdash_scopes WHERE id=?').run(scopeId);
  res.json({ ok: true });
});

app.post('/api/ipdash/offline/ips', (req,res)=>{
  const { profileId, scopeId, hostname, mac, ip } = req.body || {};
  const profileIdNum = Number(profileId);
  const scopeIdNum = Number(scopeId);
  if (!profileIdNum || !scopeIdNum) return res.status(400).json({ error: 'Profile and scope required' });
  const profile = getProfileById(profileIdNum);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  if (profile.mode !== LOCAL_OFFLINE_MODE) return res.status(400).json({ error: 'Profile is not Local Offline' });
  const scope = getScopeById(scopeIdNum);
  if (!scope || scope.profileId !== profileIdNum) {
    return res.status(404).json({ error: 'Scope not found for this profile' });
  }
  const descriptor = describeCidr(scope.cidr);
  if (!descriptor) return res.status(400).json({ error: 'Scope format invalid' });
  const reservedIp = typeof ip === 'string' ? ip.trim() : '';
  if (!reservedIp) return res.status(400).json({ error: 'Reserved IP required' });
  if (!isIpInRange(reservedIp, descriptor)) {
    return res.status(400).json({ error: 'IP must belong to the selected scope' });
  }
  const conflict =
    db
      .prepare('SELECT 1 FROM ipdash_scope_hosts WHERE profile_id=? AND ip=?')
      .get(profileIdNum, reservedIp) ?? null;
  if (conflict) return res.status(409).json({ error: 'IP already defined in this profile' });
  const label = typeof hostname === 'string' ? clampText(hostname, 120) : null;
  const normalizedMac =
    typeof mac === 'string' && mac.trim() ? clampText(mac.trim().toLowerCase(), 64) : null;
  const info = db
    .prepare('INSERT INTO ipdash_scope_hosts(profile_id, scope_id, ip, name, hostname, mac) VALUES (?,?,?,?,?,?)')
    .run(profileIdNum, scopeIdNum, reservedIp, label, label, normalizedMac);
  const host =
    db
      .prepare('SELECT * FROM ipdash_scope_hosts WHERE id=?')
      .get(info.lastInsertRowid);
  res.json({ ok: true, host });
});

app.delete('/api/ipdash/offline/ips/:hostId', (req,res)=>{
  const hostId = Number(req.params.hostId);
  if (!Number.isInteger(hostId) || hostId <= 0) {
    return res.status(400).json({ error: 'Invalid host id' });
  }
  const host =
    db
      .prepare('SELECT profile_id FROM ipdash_scope_hosts WHERE id=?')
      .get(hostId) ?? null;
  if (!host) return res.status(404).json({ error: 'Host not found' });
  const profile = getProfileById(host.profile_id);
  if (!profile || profile.mode !== LOCAL_OFFLINE_MODE) {
    return res.status(400).json({ error: 'Host is not part of a Local Offline profile' });
  }
  db.prepare('DELETE FROM ipdash_scope_hosts WHERE id=?').run(hostId);
  res.json({ ok: true });
});

// Export
app.post('/api/export', async (req,res)=>{
  try {
    const { modules, ipdash } = req.body || {};
    const requestedModules = Array.isArray(modules) && modules.length ? modules : ['cabinet'];
    const includeCabinet = requestedModules.includes('cabinet');
    const includeIpDash = requestedModules.includes('ipdash');
    let ipDashContext = null;
    if (includeIpDash) {
      ipDashContext = await buildIpDashContext(ipdash);
    }
    const wb = buildExportWorkbook({ includeCabinet, ipDashContext });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="rakit_export.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Export failed', err);
    res.status(400).send(err?.message || 'Failed to build export.');
  }
});

// Static frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_req,res)=> res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, ()=> console.log('Rakit backend listening on :' + PORT));
