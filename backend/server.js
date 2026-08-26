import express from 'express';
import morgan from 'morgan';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import dns from 'dns/promises';
import dgram from 'dgram';
import net from 'net';
import { IpDashClient } from './ipdashClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const boundedNumber = (value, fallback, minimum, maximum) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(parsed, maximum)) : fallback;
};

const app = express();
const requestedPort = Number(process.env.PORT || 8011);
if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) {
  console.error('Error: PORT must be an integer between 1 and 65535');
  process.exit(1);
}
const PORT = requestedPort;
const ENV_APP_PIN = typeof process.env.APP_PIN === 'string' ? process.env.APP_PIN.trim() : '';
if (!/^\d{4,8}$/.test(ENV_APP_PIN)) {
  console.error('Error: APP_PIN must be provided (4-8 digits)');
  process.exit(1);
}
const APP_PIN = ENV_APP_PIN;
const APP_ENC_KEY = process.env.APP_ENC_KEY || '';
const ENC_KEY_PLACEHOLDERS = new Set([
  'replace_with_your_key',
  'your_enc_key_here',
  'change_me',
]);
if (APP_ENC_KEY && ENC_KEY_PLACEHOLDERS.has(APP_ENC_KEY.trim().toLowerCase())) {
  console.error('Error: APP_ENC_KEY still contains the example value from the Compose file');
  process.exit(1);
}
if (APP_ENC_KEY && APP_ENC_KEY.length < 32) {
  console.warn('[Security] APP_ENC_KEY is shorter than 32 characters. It remains accepted for compatibility; keep the existing value if profiles were already encrypted with it.');
}
const REQUESTED_APP_ORIGIN = String(process.env.APP_ORIGIN || '').trim();
const APP_ORIGIN = (() => {
  if (!REQUESTED_APP_ORIGIN) return '';
  try {
    const url = new URL(REQUESTED_APP_ORIGIN);
    if (!['http:', 'https:'].includes(url.protocol)
      || url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash) {
      throw new Error('origin must contain only scheme, hostname and optional port');
    }
    return url.origin;
  } catch (error) {
    console.error(`Error: APP_ORIGIN is invalid (${error?.message || error})`);
    process.exit(1);
  }
})();
const { buildExportWorkbook, DEFAULT_IPDASH_FILTERS } = await import('./export.js');
const APP_ENC_FINGERPRINT = APP_ENC_KEY
  ? crypto.createHash('sha256').update(APP_ENC_KEY, 'utf8').digest('hex')
  : '';
const APP_VERSION = process.env.APP_VERSION || 'dev';
const APP_REPO = process.env.APP_REPO || 'buzuser/rakit_dev';
const APP_CHANNEL = process.env.APP_CHANNEL || 'main';
const REQUESTED_TIME_ZONE = String(process.env.APP_TIME_ZONE || process.env.TZ || 'UTC').trim();
const APP_TIME_ZONE = (() => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: REQUESTED_TIME_ZONE }).format();
    return REQUESTED_TIME_ZONE;
  } catch {
    console.warn(`[Time] Invalid time zone "${REQUESTED_TIME_ZONE}"; falling back to UTC`);
    return 'UTC';
  }
})();
const IP_DASH_TIMEOUT_MS = boundedNumber(process.env.IP_DASH_TIMEOUT_MS, 15000, 1000, 120000);
const LOCAL_OFFLINE_MODE = 'local-offline';
const ENC_KEY_META_KEY = 'app_enc_key_fingerprint';
const ENCRYPTION_RESET_MESSAGE =
  'APP_ENC_KEY changed. Restore the previous key or reset encrypted profiles to continue.';
const MAX_DEVICE_PORTS = 48;
const AUDIT_RETENTION_DAYS = boundedNumber(process.env.AUDIT_RETENTION_DAYS, 0, 0, 3650);
const SESSION_COOKIE = 'rakit_session';
const SESSION_TTL_MS = boundedNumber(process.env.APP_SESSION_TTL_MINUTES, 480, 15, 10080) * 60_000;
const MAX_SESSIONS = Math.floor(boundedNumber(process.env.APP_MAX_SESSIONS, 256, 16, 4096));
const SESSION_COOKIE_SECURE = /^(1|true|yes)$/i.test(String(process.env.APP_COOKIE_SECURE || 'false'));
const PIN_ATTEMPT_LIMIT = Math.floor(boundedNumber(process.env.APP_PIN_ATTEMPT_LIMIT, 5, 3, 20));
const PIN_ATTEMPT_WINDOW_MS = boundedNumber(process.env.APP_PIN_ATTEMPT_WINDOW_MINUTES, 15, 1, 1440) * 60_000;
const PIN_BLOCK_MS = boundedNumber(process.env.APP_PIN_BLOCK_MINUTES, 15, 1, 1440) * 60_000;
const sessions = new Map();
const pinAttempts = new Map();

if (/^(1|true|yes)$/i.test(String(process.env.TRUST_PROXY || 'false'))) {
  app.set('trust proxy', 1);
}

const { default: db } = await import('./db.js');

const getMetaValueStmt = db.prepare('SELECT value FROM app_meta WHERE key=?');
const upsertMetaValueStmt = db.prepare(
  'INSERT INTO app_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
);
const deleteMetaValueStmt = db.prepare('DELETE FROM app_meta WHERE key=?');
const ipdashProfileCountStmt = db.prepare('SELECT COUNT(1) AS c FROM ipdash_profiles');

const getMetaValue = (key) => {
  const row = getMetaValueStmt.get(key);
  return row ? row.value : null;
};

const setMetaValue = (key, value) => {
  upsertMetaValueStmt.run(key, value);
};

const deleteMetaValue = (key) => {
  deleteMetaValueStmt.run(key);
};

const getEncryptedProfileCount = () => Number(ipdashProfileCountStmt.get()?.c ?? 0);

let encryptionKeyMismatch = false;
let encryptionState = 'unknown';
const logEncryptionState = (state, meta = '') => {
  if (state === encryptionState) return;
  encryptionState = state;
  const detail = meta ? ` – ${meta}` : '';
  const prefix = '[Encryption]';
  if (state.startsWith('blocked')) {
    console.warn(`${prefix} ${state}${detail}`);
  } else {
    console.log(`${prefix} ${state}${detail}`);
  }
};

const refreshEncryptionKeyState = () => {
  const profileCount = getEncryptedProfileCount();
  const storedFingerprint = getMetaValue(ENC_KEY_META_KEY);
  if (!profileCount) {
    if (storedFingerprint != null) deleteMetaValue(ENC_KEY_META_KEY);
    encryptionKeyMismatch = false;
    logEncryptionState('idle', 'No encrypted profiles in database');
    return;
  }
  if (!APP_ENC_KEY) {
    encryptionKeyMismatch = true;
    logEncryptionState('blocked-missing-key', 'APP_ENC_KEY is not configured but encrypted profiles exist');
    return;
  }
  if (!storedFingerprint) {
    if (APP_ENC_FINGERPRINT) setMetaValue(ENC_KEY_META_KEY, APP_ENC_FINGERPRINT);
    encryptionKeyMismatch = false;
    logEncryptionState('ready', 'Fingerprint recorded for existing encrypted profiles');
    return;
  }
  encryptionKeyMismatch = storedFingerprint !== APP_ENC_FINGERPRINT;
  if (encryptionKeyMismatch) {
    logEncryptionState('blocked-mismatch', 'Stored fingerprint does not match current APP_ENC_KEY');
  } else {
    logEncryptionState('ready', 'APP_ENC_KEY fingerprint matches stored value');
  }
};

const guardEncryptionReady = (res) => {
  if (!APP_ENC_KEY) {
    console.warn('[Encryption] Blocked request – APP_ENC_KEY missing');
    res.status(500).json({ error: 'APP_ENC_KEY is not configured' });
    return false;
  }
  if (encryptionKeyMismatch) {
    console.warn('[Encryption] Blocked request – fingerprint mismatch detected');
    res.status(409).json({ error: ENCRYPTION_RESET_MESSAGE, code: 'ENCRYPTION_KEY_MISMATCH' });
    return false;
  }
  return true;
};

const markEncryptionKeyInUse = () => {
  if (!APP_ENC_FINGERPRINT) return;
  const storedFingerprint = getMetaValue(ENC_KEY_META_KEY);
  if (!storedFingerprint) {
    setMetaValue(ENC_KEY_META_KEY, APP_ENC_FINGERPRINT);
  }
};

refreshEncryptionKeyState();

const clampText = (value, max = 120) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const hashSessionToken = (token) => crypto.createHash('sha256').update(token, 'utf8').digest('base64url');

const parseCookies = (header = '') =>
  header.split(';').reduce((cookies, part) => {
    const separator = part.indexOf('=');
    if (separator < 1) return cookies;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name) return cookies;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
    return cookies;
  }, {});

const pruneSessions = (now = Date.now()) => {
  for (const [tokenHash, expiresAt] of sessions) {
    if (expiresAt <= now) sessions.delete(tokenHash);
  }
};

const issueSession = (res) => {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  pruneSessions();
  while (sessions.size >= MAX_SESSIONS) {
    const oldestSession = sessions.keys().next().value;
    if (!oldestSession) break;
    sessions.delete(oldestSession);
  }
  sessions.set(hashSessionToken(token), expiresAt);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: SESSION_COOKIE_SECURE,
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
  return expiresAt;
};

const clearSessionCookie = (res) => {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'strict',
    secure: SESSION_COOKIE_SECURE,
    path: '/',
  });
};

const getSession = (req) => {
  const token = parseCookies(req.headers.cookie || '')[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const expiresAt = sessions.get(tokenHash);
  if (!expiresAt || expiresAt <= Date.now()) {
    sessions.delete(tokenHash);
    return null;
  }
  return { tokenHash, expiresAt };
};

const requireSession = (req, res, next) => {
  const session = getSession(req);
  if (!session) {
    clearSessionCookie(res);
    return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
  }
  req.rakitSession = session;
  return next();
};

const isPinEqual = (candidate) => {
  if (typeof candidate !== 'string' || !/^\d{4,8}$/.test(candidate)) return false;
  const candidateBuffer = Buffer.from(candidate, 'utf8');
  const expectedBuffer = Buffer.from(APP_PIN, 'utf8');
  return candidateBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
};

const getPinAttemptState = (clientKey, now = Date.now()) => {
  const existing = pinAttempts.get(clientKey);
  if (!existing) return { attempts: 0, windowStartedAt: now, blockedUntil: 0 };
  if (existing.blockedUntil > now) return existing;
  if (now - existing.windowStartedAt >= PIN_ATTEMPT_WINDOW_MS) {
    pinAttempts.delete(clientKey);
    return { attempts: 0, windowStartedAt: now, blockedUntil: 0 };
  }
  return existing;
};

const recordFailedPin = (clientKey, now = Date.now()) => {
  if (pinAttempts.size >= 2048) {
    for (const [key, attempt] of pinAttempts) {
      if (attempt.blockedUntil <= now && now - attempt.windowStartedAt >= PIN_ATTEMPT_WINDOW_MS) {
        pinAttempts.delete(key);
      }
    }
    while (pinAttempts.size >= 2048) {
      const oldestClient = pinAttempts.keys().next().value;
      if (!oldestClient) break;
      pinAttempts.delete(oldestClient);
    }
  }
  const state = getPinAttemptState(clientKey, now);
  const attempts = state.attempts + 1;
  const next = {
    attempts,
    windowStartedAt: state.windowStartedAt,
    blockedUntil: attempts >= PIN_ATTEMPT_LIMIT ? now + PIN_BLOCK_MS : 0,
  };
  pinAttempts.set(clientKey, next);
  return next;
};

const requireSameOrigin = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  try {
    const originUrl = new URL(origin);
    const allowed = APP_ORIGIN
      ? originUrl.origin === APP_ORIGIN
      : originUrl.host === req.get('host');
    if (allowed) return next();
  } catch {
    // Handled as a rejected origin below.
  }
  return res.status(403).json({ error: 'Origin is not allowed', code: 'ORIGIN_REJECTED' });
};

const toUtcISOString = (value) => {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  const explicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const normalized = explicitZone ? raw : `${raw.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? raw : date.toISOString();
};

const mapCabinetRow = (row) => ({
  id: row.id,
  name: row.name,
  symbol: row.symbol ?? '',
  location: row.location ?? '',
  sizeU: row.size_u ?? 42,
  numberingDirection: row.numbering_direction === 'top-down' ? 'top-down' : 'bottom-up',
});

const mapDeviceRow = (row) => ({
  id: row.id,
  cabinetId: row.cabinet_id,
  type: row.device_type,
  model: row.model ?? '',
  heightU: row.height_u ?? 1,
  position: row.position ?? 1,
  comment: row.comment ?? '',
  portAware: Boolean(row.port_aware),
  numberOfPorts: row.number_of_ports ?? null,
  portsPerRow: row.ports_per_row ?? null,
  managementIp: row.management_ip ?? '',
  assetTag: row.asset_tag ?? '',
  status: row.status ?? 'unknown',
  face: row.face ?? 'front',
  rackLane: row.rack_lane ?? 'full',
});

const describeDevice = (device) => [device?.type ?? device?.device_type, device?.model].filter(Boolean).join(' · ') || 'Device';

const mapPortRow = (row) => ({
  id: row.id,
  deviceId: row.device_id,
  portNumber: row.port_number,
  patchPanel: row.patch_panel ?? '',
  vlan: row.vlan ?? '',
  comment: row.comment ?? '',
  ipAddress: row.ip_address ?? '',
});

const PORT_CONNECTION_SELECT = `
  SELECT pc.*,
    sp.device_id AS source_device_id, sp.port_number AS source_port_number,
    dp.device_id AS destination_device_id, dp.port_number AS destination_port_number,
    sd.device_type AS source_device_type, sd.model AS source_device_model,
    dd.device_type AS destination_device_type, dd.model AS destination_device_model,
    sc.id AS source_cabinet_id, sc.name AS source_cabinet_name,
    dc.id AS destination_cabinet_id, dc.name AS destination_cabinet_name,
    linked.device_type AS linked_asset_type, linked.model AS linked_asset_model
  FROM port_connections pc
  JOIN device_ports sp ON sp.id = pc.source_port_id
  JOIN device_ports dp ON dp.id = pc.destination_port_id
  JOIN cabinet_devices sd ON sd.id = sp.device_id
  JOIN cabinet_devices dd ON dd.id = dp.device_id
  JOIN cabinets sc ON sc.id = sd.cabinet_id
  JOIN cabinets dc ON dc.id = dd.cabinet_id
  LEFT JOIN cabinet_devices linked ON linked.id = pc.linked_asset_id
`;

const mapPortConnectionRow = (row) => ({
  id: row.id,
  sourcePortId: row.source_port_id,
  destinationPortId: row.destination_port_id,
  source: {
    deviceId: row.source_device_id,
    deviceType: row.source_device_type,
    deviceModel: row.source_device_model ?? '',
    cabinetId: row.source_cabinet_id,
    cabinetName: row.source_cabinet_name,
    portNumber: row.source_port_number,
  },
  destination: {
    deviceId: row.destination_device_id,
    deviceType: row.destination_device_type,
    deviceModel: row.destination_device_model ?? '',
    cabinetId: row.destination_cabinet_id,
    cabinetName: row.destination_cabinet_name,
    portNumber: row.destination_port_number,
  },
  tag: row.tag ?? '',
  vlan: row.vlan ?? '',
  ipAddress: row.ip_address ?? '',
  linkedAssetId: row.linked_asset_id ?? null,
  linkedAssetLabel: row.linked_asset_id
    ? [row.linked_asset_type, row.linked_asset_model].filter(Boolean).join(' · ')
    : '',
  status: row.status ?? 'connected',
  comment: row.comment ?? '',
  createdAt: toUtcISOString(row.created_at),
  updatedAt: toUtcISOString(row.updated_at),
});

const listPortConnections = () =>
  db.prepare(`${PORT_CONNECTION_SELECT} ORDER BY sc.name, sd.device_type, sp.port_number`).all().map(mapPortConnectionRow);

const getPortConnection = (id) => {
  const row = db.prepare(`${PORT_CONNECTION_SELECT} WHERE pc.id=?`).get(id);
  return row ? mapPortConnectionRow(row) : null;
};

const describeConnectionEndpoint = (endpoint) => {
  const device = [endpoint?.deviceType, endpoint?.deviceModel].filter(Boolean).join(' · ') || 'Device';
  return [endpoint?.cabinetName, `${device} / ${endpoint?.portNumber ?? '?'}`].filter(Boolean).join(' · ');
};

const describePortConnection = (connection) => connection
  ? `${describeConnectionEndpoint(connection.source)} → ${describeConnectionEndpoint(connection.destination)}`
  : '';

const mapWolScheduleRow = (row) => ({
  id: row.id,
  machineId: row.machine_id,
  name: row.name ?? '',
  cron: row.cron,
  enabled: Boolean(row.enabled),
  lastRunAt: toUtcISOString(row.last_run_at),
});

const mapWolMachineRow = (row) => ({
  id: row.id,
  name: row.name,
  ipAddress: row.ip_address ?? '',
  macAddress: row.mac_address,
  broadcastAddress: row.broadcast_address,
  port: row.port,
  probePort: row.probe_port ?? null,
  linkedDeviceId: row.linked_device_id ?? null,
  linkedDeviceLabel: row.linked_device_id
    ? [row.cabinet_name, row.linked_device_type, row.linked_device_model].filter(Boolean).join(' · ')
    : '',
  status: row.status ?? 'unknown',
  lastSeen: toUtcISOString(row.last_seen),
  enabled: Boolean(row.enabled),
  createdAt: toUtcISOString(row.created_at),
  updatedAt: toUtcISOString(row.updated_at),
  schedules: [],
});

const listWolMachines = () => {
  const machines = db.prepare(`
    SELECT wm.*, d.device_type AS linked_device_type, d.model AS linked_device_model,
      c.name AS cabinet_name
    FROM wol_machines wm
    LEFT JOIN cabinet_devices d ON d.id = wm.linked_device_id
    LEFT JOIN cabinets c ON c.id = d.cabinet_id
    ORDER BY wm.name COLLATE NOCASE
  `).all().map(mapWolMachineRow);
  const schedules = db.prepare('SELECT * FROM wol_schedules ORDER BY id').all().map(mapWolScheduleRow);
  const byMachine = new Map(machines.map((machine) => [machine.id, machine]));
  schedules.forEach((schedule) => byMachine.get(schedule.machineId)?.schedules.push(schedule));
  return machines;
};

const getWolMachine = (id) => listWolMachines().find((machine) => machine.id === Number(id)) ?? null;

const recordAudit = ({ action, objectType = null, objectId = null, details = null, result = 'success', actor = 'admin' }) => {
  try {
    db.prepare(`
      INSERT INTO audit_events(actor, action, object_type, object_id, details, result)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(actor, action, objectType, objectId == null ? null : String(objectId), details, result);
  } catch (error) {
    console.warn('[Audit] Failed to record event', error?.message || error);
  }
};

const normalizeLinkedDeviceId = (value) => {
  if (value == null || value === '') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0 || !db.prepare('SELECT 1 FROM cabinet_devices WHERE id=?').get(id)) {
    return undefined;
  }
  return id;
};

const normalizeMacAddress = (value) => {
  const compact = clampText(value, 32).replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  if (!/^[A-F0-9]{12}$/.test(compact)) return null;
  return compact.match(/.{2}/g).join(':');
};

const normalizeWolTarget = (value) => {
  const target = clampText(value, 64) || '255.255.255.255';
  return net.isIP(target) === 4 ? target : null;
};

const sendMagicPacket = (machine) => new Promise((resolve, reject) => {
  const normalizedMac = normalizeMacAddress(machine.macAddress ?? machine.mac_address);
  const address = normalizeWolTarget(machine.broadcastAddress ?? machine.broadcast_address);
  const port = Number(machine.port ?? 9);
  if (!normalizedMac || !address || !Number.isInteger(port) || port < 1 || port > 65535) {
    reject(new Error('Invalid Wake-on-LAN target'));
    return;
  }
  const macBytes = Buffer.from(normalizedMac.replace(/:/g, ''), 'hex');
  const packet = Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => macBytes)]);
  const socket = dgram.createSocket('udp4');
  const finish = (error) => {
    try { socket.close(); } catch {}
    if (error) reject(error);
    else resolve();
  };
  socket.once('error', finish);
  socket.bind(() => {
    try {
      socket.setBroadcast(true);
      socket.send(packet, port, address, finish);
    } catch (error) {
      finish(error);
    }
  });
});

const wolWakeAttempts = new Map();
const WOL_WAKE_MIN_INTERVAL_MS = 3000;
const WOL_PROBE_TIMEOUT_MS = boundedNumber(process.env.WOL_PROBE_TIMEOUT_MS, 1200, 250, 5000);
const WOL_STATUS_CACHE_MS = boundedNumber(process.env.WOL_STATUS_CACHE_MS, 20000, 1000, 300000);
const wolStatusCache = new Map();

const probeWolMachine = (machine, force = false) => new Promise((resolve) => {
  const cached = wolStatusCache.get(machine.id);
  if (!force && cached && Date.now() - cached.checkedAtMs < WOL_STATUS_CACHE_MS) {
    resolve(cached.value);
    return;
  }
  if (!machine.enabled) {
    const value = { machineId: machine.id, status: 'disabled', checkedAt: new Date().toISOString(), latencyMs: null, reason: 'Machine disabled' };
    wolStatusCache.set(machine.id, { checkedAtMs: Date.now(), value });
    resolve(value);
    return;
  }
  if (!machine.ipAddress || !machine.probePort) {
    const value = { machineId: machine.id, status: machine.status || 'unknown', checkedAt: new Date().toISOString(), latencyMs: null, reason: 'TCP probe not configured' };
    wolStatusCache.set(machine.id, { checkedAtMs: Date.now(), value });
    resolve(value);
    return;
  }
  const startedAt = Date.now();
  let settled = false;
  const socket = net.createConnection({ host: machine.ipAddress, port: machine.probePort });
  const finish = (status, reason) => {
    if (settled) return;
    settled = true;
    socket.destroy();
    const checkedAt = new Date().toISOString();
    const latencyMs = Date.now() - startedAt;
    const value = { machineId: machine.id, status, checkedAt, latencyMs, reason };
    wolStatusCache.set(machine.id, { checkedAtMs: Date.now(), value });
    if (status === 'online') {
      db.prepare("UPDATE wol_machines SET status='online', last_seen=CURRENT_TIMESTAMP WHERE id=?").run(machine.id);
    } else if (status === 'offline') {
      db.prepare("UPDATE wol_machines SET status='offline' WHERE id=?").run(machine.id);
    }
    resolve(value);
  };
  socket.setTimeout(WOL_PROBE_TIMEOUT_MS);
  socket.once('connect', () => finish('online', 'TCP connection accepted'));
  socket.once('timeout', () => finish('offline', 'Probe timed out'));
  socket.once('error', (error) => {
    if (error?.code === 'ECONNREFUSED') finish('online', 'Host reachable; TCP port closed');
    else if (error?.code === 'ENOTFOUND' || error?.code === 'EAI_AGAIN') finish('unknown', 'Host name could not be resolved');
    else finish('offline', error?.code || 'Connection failed');
  });
});

const mapWithConcurrency = async (items, limit, mapper) => {
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

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

const listDevicePorts = (deviceId) =>
  db
    .prepare('SELECT * FROM device_ports WHERE device_id=? ORDER BY port_number ASC')
    .all(deviceId)
    .map(mapPortRow);

const normalizePortCount = (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_DEVICE_PORTS) return null;
  return parsed;
};

const normalizePortsPerRow = (value, numberOfPorts) => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  const minimum = Math.ceil(numberOfPorts / 2);
  if (!Number.isInteger(parsed) || (parsed !== minimum && parsed !== numberOfPorts)) return null;
  return parsed;
};

const createDevicePorts = (deviceId, count, startFrom = 1) => {
  const insert = db.prepare('INSERT INTO device_ports(device_id, port_number) VALUES (?, ?)');
  for (let port = startFrom; port <= count; port += 1) {
    insert.run(deviceId, port);
  }
};

const deleteDevicePorts = (deviceId) => {
  db.prepare('DELETE FROM device_ports WHERE device_id=?').run(deviceId);
};

const deletePortsAbove = (deviceId, threshold) => {
  db.prepare('DELETE FROM device_ports WHERE device_id=? AND port_number>?').run(deviceId, threshold);
};

const rangesOverlap = (aStart, aHeight, bStart, bHeight) => {
  const aEnd = aStart + aHeight - 1;
  const bEnd = bStart + bHeight - 1;
  return Math.max(aStart, bStart) <= Math.min(aEnd, bEnd);
};

const lanesConflict = (first, second) => first === 'full' || second === 'full' || first === second;
const facesConflict = (first = 'front', second = 'front') => first === 'both' || second === 'both' || first === second;

const isRangeFree = (devices, start, height, ignoreId = null, lane = 'full', face = 'front') => {
  for (const device of devices) {
    if (ignoreId && device.id === ignoreId) continue;
    if (rangesOverlap(start, height, device.position, device.heightU)
      && lanesConflict(lane, device.rackLane || 'full')
      && facesConflict(face, device.face || 'front')) return false;
  }
  return true;
};

const findFirstAvailablePosition = (cabinet, devices, height, lane = 'full', face = 'front') => {
  const maxStart = cabinet.sizeU - height + 1;
  for (let start = 1; start <= maxStart; start++) {
    if (isRangeFree(devices, start, height, null, lane, face)) return start;
  }
  return null;
};

const hasRangeConflict = (devices, start, height, ignoreId = null, lane = 'full', face = 'front') =>
  !isRangeFree(devices, start, height, ignoreId, lane, face);

const getIpDashKey = (() => {
  let cached = null;
  return () => {
    if (!APP_ENC_KEY) throw new Error('APP_ENC_KEY is not configured');
    if (!cached) cached = crypto.createHash('sha256').update(APP_ENC_KEY, 'utf8').digest();
    return cached;
  };
})();

const encryptSecret = (value) => {
  if (!value) return null;
  if (encryptionKeyMismatch) throw new Error(ENCRYPTION_RESET_MESSAGE);
  const key = getIpDashKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  markEncryptionKeyInUse();
  return `${iv.toString('base64')}:${encrypted.toString('base64')}:${tag.toString('base64')}`;
};

const decryptSecret = (payload) => {
  if (!payload) return '';
  const [ivStr, dataStr, tagStr] = payload.split(':');
  if (!ivStr || !dataStr || !tagStr) return '';
  if (encryptionKeyMismatch) throw new Error(ENCRYPTION_RESET_MESSAGE);
  const key = getIpDashKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivStr, 'base64'));
  decipher.setAuthTag(Buffer.from(tagStr, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataStr, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
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
  const client = new IpDashClient(host, apiKey, IP_DASH_TIMEOUT_MS, {
    allowSelfSigned: Boolean(profileRow.allow_self_signed),
  });
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
  allowSelfSigned: Boolean(row.allow_self_signed),
  createdAt: toUtcISOString(row.created_at),
  updatedAt: toUtcISOString(row.updated_at),
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
  createdAt: toUtcISOString(row.created_at),
  updatedAt: toUtcISOString(row.updated_at),
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
      `SELECT h.*, s.cidr, s.label, d.device_type AS linked_device_type,
        d.model AS linked_device_model, c.name AS linked_cabinet_name
       FROM ipdash_scope_hosts h
       JOIN ipdash_scopes s ON s.id = h.scope_id
       LEFT JOIN cabinet_devices d ON d.id = h.linked_device_id
       LEFT JOIN cabinets c ON c.id = d.cabinet_id
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
    linked_device_id: host.linked_device_id ?? null,
    linked_device_label: host.linked_device_id
      ? [host.linked_cabinet_name, host.linked_device_type, host.linked_device_model].filter(Boolean).join(' · ')
      : '',
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

app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'", 'https://api.github.com'],
        fontSrc: ["'self'", 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        upgradeInsecureRequests: SESSION_COOKIE_SECURE ? [] : null,
      },
    },
    strictTransportSecurity: SESSION_COOKIE_SECURE ? undefined : false,
  })
);
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
});
app.use('/api', requireSameOrigin);
app.use('/api/pin/verify', express.json({ limit: '2kb' }));

// Health check
app.get('/health', (_req,res)=> res.json({ status: 'ok' }));

app.get('/api/meta', (_req,res)=>{
  res.json({ version: APP_VERSION, repo: APP_REPO, channel: APP_CHANNEL, timeZone: APP_TIME_ZONE, serverTime: new Date().toISOString() });
});

app.post('/api/pin/verify', (req,res)=>{
  const { pin } = req.body || {};
  const clientKey = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const state = getPinAttemptState(clientKey, now);
  if (state.blockedUntil > now) {
    const retryAfter = Math.max(1, Math.ceil((state.blockedUntil - now) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ ok: false, error: 'Too many failed attempts. Try again later.', retryAfter });
  }
  if (isPinEqual(pin)) {
    pinAttempts.delete(clientKey);
    const expiresAt = issueSession(res);
    return res.json({ ok: true, expiresAt: new Date(expiresAt).toISOString(), expiresInMs: SESSION_TTL_MS });
  }
  const failed = recordFailedPin(clientKey, now);
  if (failed.blockedUntil > now) {
    const retryAfter = Math.max(1, Math.ceil((failed.blockedUntil - now) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ ok: false, error: 'Too many failed attempts. Try again later.', retryAfter });
  }
  return res.status(401).json({ ok: false, error: 'Invalid PIN' });
});

app.use('/api', requireSession);
app.use('/api', express.json({ limit: '64kb' }));

app.get('/api/session', (req, res) => {
  res.json({
    ok: true,
    expiresAt: new Date(req.rakitSession.expiresAt).toISOString(),
    expiresInMs: Math.max(0, req.rakitSession.expiresAt - Date.now()),
  });
});

app.post('/api/session/logout', (req, res) => {
  sessions.delete(req.rakitSession.tokenHash);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/cabinets', (_req,res)=>{
  res.json({ cabinets: listCabinets() });
});

app.get('/api/devices', (_req,res)=>{
  const devices = db.prepare(`
    SELECT d.*, c.name AS cabinet_name, c.location AS cabinet_location
    FROM cabinet_devices d
    JOIN cabinets c ON c.id=d.cabinet_id
    ORDER BY c.name COLLATE NOCASE, d.position, d.id
  `).all().map((row) => ({
    ...mapDeviceRow(row),
    cabinetName: row.cabinet_name ?? '',
    cabinetLocation: row.cabinet_location ?? '',
  }));
  res.json({ devices });
});

app.post('/api/cabinets', (req,res)=>{
  const { name, symbol, location, sizeU, numberingDirection } = req.body || {};
  const trimmedName = clampText(name, 80);
  if (!trimmedName) return res.status(400).json({ error: 'Cabinet name required' });
  const parsedSize = Number(sizeU ?? 42);
  if (!Number.isInteger(parsedSize) || parsedSize < 4 || parsedSize > 60) {
    return res.status(400).json({ error: 'Invalid sizeU' });
  }
  const normalizedNumbering = numberingDirection === 'top-down' ? 'top-down' : 'bottom-up';
  const payload = {
    name: trimmedName,
    symbol: clampText(symbol, 24) || null,
    location: clampText(location, 120) || null,
    size_u: parsedSize,
    numbering_direction: normalizedNumbering,
  };
  const info = db
    .prepare('INSERT INTO cabinets(name, symbol, location, size_u, numbering_direction) VALUES (@name, @symbol, @location, @size_u, @numbering_direction)')
    .run(payload);
  const cabinet = getCabinet(info.lastInsertRowid);
  recordAudit({ action: 'Cabinet created', objectType: 'cabinet', objectId: cabinet.id, details: cabinet.name });
  res.json({ ok: true, cabinet });
});

app.patch('/api/cabinets/:cabinetId', (req,res)=>{
  const { cabinetId } = req.params;
  const cabinet = getCabinet(cabinetId);
  if (!cabinet) return res.status(404).json({ error: 'Cabinet not found' });
  const payload = req.body || {};
  const sets = [];
  const values = [];
  let targetSize = cabinet.sizeU;
  let targetNumberingDirection = cabinet.numberingDirection;
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
    targetSize = parsedSize;
    assign('size_u', parsedSize);
  }
  if ('numberingDirection' in payload) {
    if (!['bottom-up', 'top-down'].includes(payload.numberingDirection)) {
      return res.status(400).json({ error: 'Invalid numberingDirection' });
    }
    targetNumberingDirection = payload.numberingDirection;
    assign('numbering_direction', payload.numberingDirection);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

  const devices = listDevicesForCabinet(cabinet.id);
  const numberingChanged = targetNumberingDirection !== cabinet.numberingDirection;
  const placements = devices.map((device) => ({
    id: device.id,
    heightU: device.heightU,
    position: numberingChanged
      ? cabinet.sizeU - device.position - device.heightU + 2
      : device.position,
  }));
  if (placements.some((device) => device.position < 1 || device.position + device.heightU - 1 > targetSize)) {
    return res.status(409).json({ error: 'Cabinet size would place an existing device outside the available U range' });
  }

  values.push(cabinetId);
  const updateCabinet = db.prepare(`UPDATE cabinets SET ${sets.join(', ')} WHERE id=?`);
  const updateDevicePosition = db.prepare('UPDATE cabinet_devices SET position=? WHERE id=?');
  const updateCabinetLayout = db.transaction(() => {
    updateCabinet.run(...values);
    if (numberingChanged) {
      placements.forEach((device) => updateDevicePosition.run(device.position, device.id));
    }
  });
  updateCabinetLayout();
  const updated = getCabinet(cabinetId);
  recordAudit({ action: 'Cabinet updated', objectType: 'cabinet', objectId: cabinetId, details: updated.name });
  res.json({ ok: true, cabinet: updated });
});

app.delete('/api/cabinets/:cabinetId', (req,res)=>{
  const { cabinetId } = req.params;
  const cabinet = getCabinet(cabinetId);
  const removedDevices = cabinet ? listDevicesForCabinet(cabinet.id) : [];
  const info = db.prepare('DELETE FROM cabinets WHERE id=?').run(cabinetId);
  if (!info.changes) return res.status(404).json({ error: 'Cabinet not found' });
  const deviceLabels = removedDevices.map(describeDevice);
  const removedSummary = deviceLabels.length
    ? `${deviceLabels.slice(0, 8).join(', ')}${deviceLabels.length > 8 ? ` +${deviceLabels.length - 8} more` : ''}`
    : '';
  recordAudit({
    action: 'Cabinet removed',
    objectType: 'cabinet',
    objectId: cabinetId,
    details: [cabinet?.name, removedSummary ? `devices: ${removedSummary}` : 'empty cabinet'].filter(Boolean).join(' · '),
  });
  res.json({ ok: true });
});

const ensureCabinet = (cabinetId, res) => {
  const cabinet = getCabinet(cabinetId);
  if (!cabinet && res) res.status(404).json({ error: 'Cabinet not found' });
  return cabinet;
};

const ensureDeviceInCabinet = (cabinetId, deviceId, res) => {
  const row = db.prepare('SELECT * FROM cabinet_devices WHERE id=? AND cabinet_id=?').get(deviceId, cabinetId);
  if (!row && res) res.status(404).json({ error: 'Device not found' });
  return row ? mapDeviceRow(row) : null;
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
  const {
    type,
    model,
    heightU,
    portAware: portAwareRaw,
    numberOfPorts,
    portsPerRow,
    managementIp,
    assetTag,
    status,
    face,
    position: requestedPosition,
    rackLane: rackLaneRaw,
  } = req.body || {};
  const trimmedType = clampText(type, 60);
  if (!trimmedType) return res.status(400).json({ error: 'Device type required' });
  const h = Number(heightU ?? 1);
  if (!Number.isInteger(h) || h < 1 || h > cabinet.sizeU) {
    return res.status(400).json({ error: 'Invalid heightU' });
  }
  const portAware = Boolean(portAwareRaw);
  const normalizedPorts = portAware ? normalizePortCount(numberOfPorts) : null;
  if (portAware && normalizedPorts == null) {
    return res.status(400).json({ error: `numberOfPorts must be between 1 and ${MAX_DEVICE_PORTS}` });
  }
  const normalizedPortsPerRow = portAware && normalizedPorts != null ? normalizePortsPerRow(portsPerRow, normalizedPorts) : null;
  if (portAware && portsPerRow != null && portsPerRow !== '' && normalizedPortsPerRow == null) {
    return res.status(400).json({ error: `portsPerRow must be ${Math.ceil(normalizedPorts / 2)} for two rows or ${normalizedPorts} for one row` });
  }
  const rackLane = ['full', 'left', 'right'].includes(rackLaneRaw) ? rackLaneRaw : 'full';
  const deviceFace = ['front', 'rear', 'both'].includes(face) ? face : 'front';
  const devices = listDevicesForCabinet(cabinet.id);
  let position = requestedPosition == null || requestedPosition === '' ? null : Number(requestedPosition);
  if (position != null && (!Number.isInteger(position) || position < 1 || position > cabinet.sizeU - h + 1)) {
    return res.status(400).json({ error: 'Position out of range' });
  }
  if (position != null && hasRangeConflict(devices, position, h, null, rackLane, deviceFace)) {
    return res.status(409).json({ error: `Space already occupied in the ${rackLane} rack lane` });
  }
  if (position == null) position = findFirstAvailablePosition(cabinet, devices, h, rackLane, deviceFace);
  if (position == null) return res.status(409).json({ error: 'No available space in cabinet' });
  const createDevice = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO cabinet_devices(
          cabinet_id, device_type, model, height_u, position, port_aware, number_of_ports, ports_per_row,
          management_ip, asset_tag, status, face, rack_lane
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        cabinet.id,
        trimmedType,
        clampText(model, 80) || null,
        h,
        position,
        portAware ? 1 : 0,
        portAware ? normalizedPorts : null,
        portAware ? normalizedPortsPerRow : null,
        clampText(managementIp, 64) || null,
        clampText(assetTag, 64) || null,
        ['online', 'offline', 'warning', 'unknown', 'passive', 'maintenance', 'planned'].includes(status) ? status : 'unknown',
        deviceFace,
        rackLane
      );
    if (portAware && normalizedPorts != null) {
      createDevicePorts(info.lastInsertRowid, normalizedPorts);
    }
    return info.lastInsertRowid;
  });
  const newDeviceId = createDevice();
  recordAudit({
    action: 'Device created',
    objectType: 'cabinet_device',
    objectId: newDeviceId,
    details: `${cabinet.name} · ${describeDevice({ type: trimmedType, model })}`,
  });
  res.json({ ok: true, device: listDevicesForCabinet(cabinet.id).find((d) => d.id === newDeviceId) });
});

app.post('/api/cabinets/:cabinetId/devices/:deviceId/place', (req,res)=>{
  const { cabinetId, deviceId } = req.params;
  const cabinet = ensureCabinet(cabinetId, res);
  if (!cabinet) return;
  const devices = listDevicesForCabinet(cabinet.id);
  const device = devices.find((entry) => entry.id === Number(deviceId));
  if (!device) return res.status(404).json({ error: 'Device not found' });
  const position = Number(req.body?.position);
  const rackLane = clampText(req.body?.rackLane, 12).toLowerCase() || device.rackLane || 'full';
  const face = clampText(req.body?.face, 12).toLowerCase() || device.face || 'front';
  if (!Number.isInteger(position) || position < 1 || position > cabinet.sizeU - device.heightU + 1) {
    return res.status(400).json({ error: 'Position out of range' });
  }
  if (!['full', 'left', 'right'].includes(rackLane)) return res.status(400).json({ error: 'Invalid rackLane' });
  if (!['front', 'rear', 'both'].includes(face)) return res.status(400).json({ error: 'Invalid device face' });

  const splitDeviceId = req.body?.splitDeviceId == null ? null : Number(req.body.splitDeviceId);
  if (splitDeviceId != null) {
    const splitDevice = devices.find((entry) => entry.id === splitDeviceId && entry.id !== device.id);
    if (!splitDevice) return res.status(404).json({ error: 'Side-by-side device not found' });
    if (splitDevice.rackLane !== 'full') return res.status(409).json({ error: 'Only a full-width device can be split automatically' });
    if (!['left', 'right'].includes(rackLane)) return res.status(400).json({ error: 'Choose left or right rack lane' });
    if (!facesConflict(face, splitDevice.face || 'front')) {
      return res.status(400).json({ error: 'Devices must share the same rack face to be placed side by side' });
    }
    if (!rangesOverlap(position, device.heightU, splitDevice.position, splitDevice.heightU)) {
      return res.status(400).json({ error: 'Devices must overlap in rack units to be placed side by side' });
    }
    const splitRackLane = rackLane === 'left' ? 'right' : 'left';
    const remaining = devices.filter((entry) => entry.id !== device.id && entry.id !== splitDevice.id);
    if (!isRangeFree(remaining, position, device.heightU, null, rackLane, face)
      || !isRangeFree(remaining, splitDevice.position, splitDevice.heightU, null, splitRackLane, splitDevice.face || 'front')) {
      return res.status(409).json({ error: 'The selected rack side is already occupied' });
    }
    const placeSideBySide = db.transaction(() => {
      db.prepare('UPDATE cabinet_devices SET rack_lane=? WHERE id=?').run(splitRackLane, splitDevice.id);
      db.prepare('UPDATE cabinet_devices SET position=?, rack_lane=?, face=? WHERE id=?').run(position, rackLane, face, device.id);
    });
    placeSideBySide();
    recordAudit({
      action: 'Devices placed side by side',
      objectType: 'cabinet_device',
      objectId: device.id,
      details: `${cabinet.name} · ${describeDevice(device)} + ${describeDevice(splitDevice)} · ${face} · U${position}`,
    });
    return res.json({ ok: true, devices: listDevicesForCabinet(cabinet.id) });
  }

  if (hasRangeConflict(devices, position, device.heightU, device.id, rackLane, face)) {
    return res.status(409).json({ error: `Space already occupied in the ${rackLane} rack lane` });
  }
  db.prepare('UPDATE cabinet_devices SET position=?, rack_lane=?, face=? WHERE id=?').run(position, rackLane, face, device.id);
  recordAudit({
    action: 'Device placed',
    objectType: 'cabinet_device',
    objectId: device.id,
    details: `${cabinet.name} · ${describeDevice(device)} · ${face} · U${position} · ${rackLane}`,
  });
  res.json({ ok: true, device: listDevicesForCabinet(cabinet.id).find((entry) => entry.id === device.id) });
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
  let newRackLane = device.rackLane || 'full';
  let newFace = device.face || 'front';
  const prevPortAware = Boolean(device.portAware);
  const prevNumberOfPorts = device.numberOfPorts ?? null;
  const prevPortsPerRow = device.portsPerRow ?? null;
  let nextPortAware = prevPortAware;
  let nextNumberOfPorts = prevNumberOfPorts;
  let nextPortsPerRow = prevPortsPerRow;

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
  if ('rackLane' in payload) {
    const rackLane = clampText(payload.rackLane, 12).toLowerCase();
    if (!['full', 'left', 'right'].includes(rackLane)) return res.status(400).json({ error: 'Invalid rackLane' });
    newRackLane = rackLane;
  }
  if ('face' in payload) {
    const face = clampText(payload.face, 12).toLowerCase();
    if (!['front', 'rear', 'both'].includes(face)) return res.status(400).json({ error: 'Invalid device face' });
    newFace = face;
  }

  const maxStart = cabinet.sizeU - newHeight + 1;
  if (newPosition < 1 || newPosition > maxStart) {
    return res.status(400).json({ error: 'Position out of range' });
  }
  if (hasRangeConflict(devices, newPosition, newHeight, device.id, newRackLane, newFace)) {
    return res.status(409).json({ error: `Space already occupied in the ${newRackLane} rack lane` });
  }
  if ('portAware' in payload) {
    nextPortAware = Boolean(payload.portAware);
    if (!nextPortAware) {
      nextNumberOfPorts = null;
      nextPortsPerRow = null;
    }
  }
  if ('numberOfPorts' in payload) {
    const clearsPortCount = payload.numberOfPorts == null || payload.numberOfPorts === '';
    if (clearsPortCount) {
      if (nextPortAware) {
        return res
          .status(400)
          .json({ error: `numberOfPorts must be provided (1-${MAX_DEVICE_PORTS}) when port aware device is enabled` });
      }
      nextNumberOfPorts = null;
    } else {
      if (!nextPortAware) {
        return res.status(400).json({ error: 'Enable port aware device before setting numberOfPorts' });
      }
      const normalized = normalizePortCount(payload.numberOfPorts);
      if (normalized == null) {
        return res
          .status(400)
          .json({ error: `numberOfPorts must be between 1 and ${MAX_DEVICE_PORTS}` });
      }
      nextNumberOfPorts = normalized;
    }
  }
  if (nextPortAware && nextNumberOfPorts == null) {
    return res
      .status(400)
      .json({ error: `numberOfPorts must be provided (1-${MAX_DEVICE_PORTS}) when port aware device is enabled` });
  }
  if ('portsPerRow' in payload) {
    const clearsRowSize = payload.portsPerRow == null || payload.portsPerRow === '';
    if (clearsRowSize) {
      nextPortsPerRow = null;
    } else {
      if (!nextPortAware || nextNumberOfPorts == null) {
        return res.status(400).json({ error: 'Enable port aware device before setting portsPerRow' });
      }
      const normalized = normalizePortsPerRow(payload.portsPerRow, nextNumberOfPorts);
      if (normalized == null) {
        return res.status(400).json({ error: `portsPerRow must be ${Math.ceil(nextNumberOfPorts / 2)} for two rows or ${nextNumberOfPorts} for one row` });
      }
      nextPortsPerRow = normalized;
    }
  }
  if (nextPortsPerRow != null && nextNumberOfPorts != null && normalizePortsPerRow(nextPortsPerRow, nextNumberOfPorts) == null) {
    return res.status(400).json({ error: `portsPerRow must be ${Math.ceil(nextNumberOfPorts / 2)} for two rows or ${nextNumberOfPorts} for one row` });
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
  if ('managementIp' in payload) {
    sets.push('management_ip=?');
    vals.push(clampText(payload.managementIp, 64) || null);
  }
  if ('assetTag' in payload) {
    sets.push('asset_tag=?');
    vals.push(clampText(payload.assetTag, 64) || null);
  }
  if ('status' in payload) {
    const status = clampText(payload.status, 20).toLowerCase();
    if (!['online', 'offline', 'warning', 'unknown', 'passive', 'maintenance', 'planned'].includes(status)) {
      return res.status(400).json({ error: 'Invalid device status' });
    }
    sets.push('status=?');
    vals.push(status);
  }
  if (newFace !== (device.face || 'front')) {
    sets.push('face=?');
    vals.push(newFace);
  }
  if (newHeight !== device.heightU) {
    sets.push('height_u=?');
    vals.push(newHeight);
  }
  if (newPosition !== device.position) {
    sets.push('position=?');
    vals.push(newPosition);
  }
  if (newRackLane !== (device.rackLane || 'full')) {
    sets.push('rack_lane=?');
    vals.push(newRackLane);
  }
  if (nextPortAware !== prevPortAware) {
    sets.push('port_aware=?');
    vals.push(nextPortAware ? 1 : 0);
  }
  if (nextNumberOfPorts !== prevNumberOfPorts) {
    sets.push('number_of_ports=?');
    vals.push(nextNumberOfPorts ?? null);
  }
  if (nextPortsPerRow !== prevPortsPerRow) {
    sets.push('ports_per_row=?');
    vals.push(nextPortsPerRow ?? null);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(deviceId);
  const syncPorts = db.transaction(() => {
    db.prepare(`UPDATE cabinet_devices SET ${sets.join(', ')} WHERE id=?`).run(...vals);
    if (!prevPortAware && nextPortAware && nextNumberOfPorts != null) {
      deleteDevicePorts(device.id);
      createDevicePorts(device.id, nextNumberOfPorts);
    } else if (prevPortAware && !nextPortAware) {
      deleteDevicePorts(device.id);
    } else if (prevPortAware && nextPortAware && nextNumberOfPorts != null && prevNumberOfPorts != null) {
      if (nextNumberOfPorts > prevNumberOfPorts) {
        createDevicePorts(device.id, nextNumberOfPorts, prevNumberOfPorts + 1);
      } else if (nextNumberOfPorts < prevNumberOfPorts) {
        deletePortsAbove(device.id, nextNumberOfPorts);
      }
    }
  });
  syncPorts();
  recordAudit({
    action: 'Device updated',
    objectType: 'cabinet_device',
    objectId: device.id,
    details: `${cabinet.name} · ${describeDevice(device)}`,
  });
  res.json({
    ok: true,
    device: listDevicesForCabinet(cabinet.id).find((d) => d.id === Number(deviceId)),
  });
});

app.delete('/api/cabinets/:cabinetId/devices/:deviceId', (req,res)=>{
  const { cabinetId, deviceId } = req.params;
  const cabinet = ensureCabinet(cabinetId, res);
  if (!cabinet) return;
  const device = ensureDeviceInCabinet(cabinet.id, deviceId, res);
  if (!device) return;
  const info = db.prepare('DELETE FROM cabinet_devices WHERE id=? AND cabinet_id=?').run(deviceId, cabinet.id);
  if (!info.changes) return res.status(404).json({ error: 'Device not found' });
  recordAudit({ action: 'Device removed', objectType: 'cabinet_device', objectId: deviceId, details: `${cabinet.name} · ${describeDevice(device)}` });
  res.json({ ok: true });
});

app.get('/api/porthub/devices', (_req,res)=>{
  const rows = db
    .prepare(
      `SELECT d.*, c.name AS cabinet_name
       FROM cabinet_devices d
       JOIN cabinets c ON c.id = d.cabinet_id
       WHERE d.port_aware=1
       ORDER BY c.name ASC, d.device_type ASC, d.id ASC`
    )
    .all();
  const devices = rows.map((row) => ({
    ...mapDeviceRow(row),
    cabinetName: row.cabinet_name ?? '',
    ports: listDevicePorts(row.id),
  }));
  res.json({ devices });
});

app.get('/api/cabinets/:cabinetId/devices/:deviceId/ports', (req,res)=>{
  const { cabinetId, deviceId } = req.params;
  const cabinet = ensureCabinet(cabinetId, res);
  if (!cabinet) return;
  const device = ensureDeviceInCabinet(cabinet.id, deviceId, res);
  if (!device) return;
  if (!device.portAware) return res.status(400).json({ error: 'Device is not port aware' });
  res.json({ device, ports: listDevicePorts(device.id) });
});

app.get('/api/cabinets/:cabinetId/devices/:deviceId/ports/export', (req,res)=>{
  const { cabinetId, deviceId } = req.params;
  const cabinet = ensureCabinet(cabinetId, res);
  if (!cabinet) return;
  const device = ensureDeviceInCabinet(cabinet.id, deviceId, res);
  if (!device) return;
  if (!device.portAware) return res.status(400).json({ error: 'Device is not port aware' });
  const payload = { device, ports: listDevicePorts(device.id) };
  const body = JSON.stringify(payload, null, 2);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=device-${device.id}-ports.json`);
  res.send(body);
});

app.patch('/api/cabinets/:cabinetId/devices/:deviceId/ports/:portNumber', (req,res)=>{
  const { cabinetId, deviceId, portNumber } = req.params;
  const cabinet = ensureCabinet(cabinetId, res);
  if (!cabinet) return;
  const device = ensureDeviceInCabinet(cabinet.id, deviceId, res);
  if (!device) return;
  if (!device.portAware || !device.numberOfPorts) {
    return res.status(400).json({ error: 'Device is not port aware' });
  }
  const numericPort = Number(portNumber);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > device.numberOfPorts) {
    return res.status(400).json({ error: 'Invalid port number' });
  }
  const payload = req.body || {};
  const sets = [];
  const vals = [];
  const assign = (column, value) => {
    sets.push(`${column}=?`);
    vals.push(value);
  };
  if ('patchPanel' in payload) assign('patch_panel', clampText(payload.patchPanel, 120) || null);
  if ('vlan' in payload) assign('vlan', clampText(payload.vlan, 60) || null);
  if ('comment' in payload) assign('comment', clampText(payload.comment, 400) || null);
  if ('ipAddress' in payload) assign('ip_address', clampText(payload.ipAddress, 60) || null);
  if (!sets.length) return res.status(400).json({ error: 'No port fields to update' });
  vals.push(device.id, numericPort);
  const info = db
    .prepare(`UPDATE device_ports SET ${sets.join(', ')} WHERE device_id=? AND port_number=?`)
    .run(...vals);
  if (!info.changes) return res.status(404).json({ error: 'Port not found' });
  const updated = db.prepare('SELECT * FROM device_ports WHERE device_id=? AND port_number=?').get(device.id, numericPort);
  recordAudit({ action: 'Port metadata updated', objectType: 'device_port', objectId: updated.id, details: `${describeDevice(device)} · port ${numericPort}` });
  res.json({ ok: true, port: mapPortRow(updated) });
});

app.get('/api/port-connections', (_req,res)=>{
  res.json({ connections: listPortConnections() });
});

app.post('/api/port-connections', (req,res)=>{
  const sourcePortId = Number(req.body?.sourcePortId);
  const destinationPortId = Number(req.body?.destinationPortId);
  if (!Number.isInteger(sourcePortId) || !Number.isInteger(destinationPortId) || sourcePortId <= 0 || destinationPortId <= 0) {
    return res.status(400).json({ error: 'Valid sourcePortId and destinationPortId are required' });
  }
  if (sourcePortId === destinationPortId) {
    return res.status(400).json({ error: 'A port cannot be connected to itself' });
  }
  const ports = db.prepare(`
    SELECT p.id, p.device_id, p.port_number, d.device_type
    FROM device_ports p JOIN cabinet_devices d ON d.id=p.device_id
    WHERE p.id IN (?, ?)
  `).all(sourcePortId, destinationPortId);
  if (ports.length !== 2) return res.status(404).json({ error: 'One or both ports were not found' });
  if (ports[0].device_id === ports[1].device_id) {
    return res.status(400).json({ error: 'Select ports on two different devices' });
  }
  const occupiedPort = db.prepare(`
    SELECT id FROM port_connections
    WHERE source_port_id IN (?, ?) OR destination_port_id IN (?, ?)
    LIMIT 1
  `).get(sourcePortId, destinationPortId, sourcePortId, destinationPortId);
  if (occupiedPort) {
    return res.status(409).json({ error: 'One of the selected ports is already connected' });
  }
  const linkedAssetId = req.body?.linkedAssetId == null ? null : Number(req.body.linkedAssetId);
  if (linkedAssetId != null && (!Number.isInteger(linkedAssetId) || !db.prepare('SELECT 1 FROM cabinet_devices WHERE id=?').get(linkedAssetId))) {
    return res.status(400).json({ error: 'Invalid linkedAssetId' });
  }
  const status = clampText(req.body?.status, 20).toLowerCase() || 'connected';
  if (!['connected', 'disconnected', 'planned', 'warning'].includes(status)) {
    return res.status(400).json({ error: 'Invalid connection status' });
  }
  try {
    const info = db.prepare(`
      INSERT INTO port_connections(
        source_port_id, destination_port_id, tag, vlan, ip_address, linked_asset_id, status, comment
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sourcePortId,
      destinationPortId,
      clampText(req.body?.tag, 120) || null,
      clampText(req.body?.vlan, 60) || null,
      clampText(req.body?.ipAddress, 64) || null,
      linkedAssetId,
      status,
      clampText(req.body?.comment, 400) || null
    );
    const connection = getPortConnection(info.lastInsertRowid);
    recordAudit({
      action: 'Port connection created',
      objectType: 'port_connection',
      objectId: info.lastInsertRowid,
      details: describePortConnection(connection),
    });
    res.json({ ok: true, connection });
  } catch (error) {
    if (String(error?.code || '').startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'One of the selected ports is already connected' });
    }
    throw error;
  }
});

app.patch('/api/port-connections/:connectionId', (req,res)=>{
  const connectionId = Number(req.params.connectionId);
  const existing = getPortConnection(connectionId);
  if (!existing) return res.status(404).json({ error: 'Port connection not found' });
  const payload = req.body || {};
  const sets = [];
  const values = [];
  const assign = (column, value) => { sets.push(`${column}=?`); values.push(value); };
  if ('tag' in payload) assign('tag', clampText(payload.tag, 120) || null);
  if ('vlan' in payload) assign('vlan', clampText(payload.vlan, 60) || null);
  if ('ipAddress' in payload) assign('ip_address', clampText(payload.ipAddress, 64) || null);
  if ('comment' in payload) assign('comment', clampText(payload.comment, 400) || null);
  if ('linkedAssetId' in payload) {
    const linkedAssetId = payload.linkedAssetId == null ? null : Number(payload.linkedAssetId);
    if (linkedAssetId != null && (!Number.isInteger(linkedAssetId) || !db.prepare('SELECT 1 FROM cabinet_devices WHERE id=?').get(linkedAssetId))) {
      return res.status(400).json({ error: 'Invalid linkedAssetId' });
    }
    assign('linked_asset_id', linkedAssetId);
  }
  if ('status' in payload) {
    const status = clampText(payload.status, 20).toLowerCase();
    if (!['connected', 'disconnected', 'planned', 'warning'].includes(status)) {
      return res.status(400).json({ error: 'Invalid connection status' });
    }
    assign('status', status);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  values.push(connectionId);
  db.prepare(`UPDATE port_connections SET ${sets.join(', ')} WHERE id=?`).run(...values);
  recordAudit({ action: 'Port connection updated', objectType: 'port_connection', objectId: connectionId, details: describePortConnection(existing) });
  res.json({ ok: true, connection: getPortConnection(connectionId) });
});

app.delete('/api/port-connections/:connectionId', (req,res)=>{
  const connectionId = Number(req.params.connectionId);
  const existing = getPortConnection(connectionId);
  if (!existing) return res.status(404).json({ error: 'Port connection not found' });
  db.prepare('DELETE FROM port_connections WHERE id=?').run(connectionId);
  recordAudit({ action: 'Port connection removed', objectType: 'port_connection', objectId: connectionId, details: describePortConnection(existing) });
  res.json({ ok: true });
});

app.get('/api/ipdash/profiles', (_req,res)=>{
  res.json({
    profiles: listProfiles(),
    encryptionKeyMismatch,
    requiresPinForReset: Boolean(APP_PIN),
    encryptionMessage: ENCRYPTION_RESET_MESSAGE,
    appEncKeyConfigured: Boolean(APP_ENC_KEY),
  });
});

app.post('/api/ipdash/profiles', (req,res)=>{
  if (!guardEncryptionReady(res)) return;
  const { name, location, host, mode, apiKey, siteId, allowSelfSigned } = req.body || {};
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
      .prepare('INSERT INTO ipdash_profiles(name, location, host, mode, site_id, allow_self_signed, api_key_encrypted) VALUES (?,?,?,?,?,?,?)')
      .run(
        trimmedName,
        clampText(location, 120) || null,
        sanitizedHost,
        normalizedMode,
        normalizedSiteId,
        normalizedMode === LOCAL_OFFLINE_MODE ? 0 : allowSelfSigned === true ? 1 : 0,
        encryptedKey
      );
    const profile = getProfileById(info.lastInsertRowid);
    refreshEncryptionKeyState();
    res.json({ ok: true, profile: mapProfileRow(profile) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to store profile' });
  }
});

app.patch('/api/ipdash/profiles/:profileId', (req,res)=>{
  if (!guardEncryptionReady(res)) return;
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
      assign('allow_self_signed', 0);
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
  if ('allowSelfSigned' in payload) assign('allow_self_signed', payload.allowSelfSigned === true ? 1 : 0);
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
  if (!guardEncryptionReady(res)) return;
  const { profileId } = req.params;
  const info = db.prepare('DELETE FROM ipdash_profiles WHERE id=?').run(profileId);
  if (!info.changes) return res.status(404).json({ error: 'Profile not found' });
  refreshEncryptionKeyState();
  res.json({ ok: true });
});

app.post('/api/ipdash/profiles/test', async (req,res)=>{
  if (!guardEncryptionReady(res)) return;
  const { host, apiKey, allowSelfSigned } = req.body || {};
  const sanitizedHost = normalizeHost(host);
  if (!sanitizedHost) return res.status(400).json({ error: 'Valid host required' });
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({ error: 'API key required' });
  }
  try {
    const client = new IpDashClient(sanitizedHost, apiKey.trim(), IP_DASH_TIMEOUT_MS, {
      allowSelfSigned: allowSelfSigned === true,
    });
    await client.testConnection();
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({
      error: err.message || 'Failed to reach controller',
      ...(err?.code ? { code: err.code } : {}),
    });
  }
});

app.post('/api/ipdash/sites/preview', async (req,res)=>{
  if (!guardEncryptionReady(res)) return;
  const { host, apiKey, allowSelfSigned } = req.body || {};
  const sanitizedHost = normalizeHost(host);
  if (!sanitizedHost) return res.status(400).json({ error: 'Valid host required' });
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({ error: 'API key required' });
  }
  try {
    const client = new IpDashClient(sanitizedHost, apiKey.trim(), IP_DASH_TIMEOUT_MS, {
      allowSelfSigned: allowSelfSigned === true,
    });
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
    res.status(502).json({
      error: err.message || 'Failed to list sites',
      ...(err?.code ? { code: err.code } : {}),
    });
  }
});

app.post('/api/ipdash/profiles/reset-encrypted', (req,res)=>{
  if (!encryptionKeyMismatch) {
    return res.status(400).json({ error: 'Encryption key is already in sync' });
  }
  const { confirm, pin } = req.body || {};
  if (confirm !== 'RESET') {
    return res.status(400).json({ error: "Type RESET to confirm deletion of encrypted profiles." });
  }
  if (APP_PIN) {
    if (!isPinEqual(pin)) {
      return res.status(401).json({ error: 'PIN required to reset encrypted profiles.' });
    }
  }
  const deleted = db.prepare('DELETE FROM ipdash_profiles').run();
  deleteMetaValue(ENC_KEY_META_KEY);
  refreshEncryptionKeyState();
  console.warn('[Encryption] Encrypted IP Dash profiles were reset by request');
  res.json({
    ok: true,
    deletedProfiles: deleted?.changes ?? 0,
    message: 'Encrypted IP Dash profiles have been cleared. Add new profiles to use the current APP_ENC_KEY.',
  });
});

app.get('/api/ipdash/data', async (req,res)=>{
  if (!guardEncryptionReady(res)) return;
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
  if (!guardEncryptionReady(res)) return;
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
  recordAudit({ action: 'IP scope created', objectType: 'ip_scope', objectId: scope.id, details: scope.cidr });
  res.json({ ok: true, scope });
});

app.delete('/api/ipdash/offline/scopes/:scopeId', (req,res)=>{
  if (!guardEncryptionReady(res)) return;
  const { scopeId } = req.params;
  const scope = getScopeById(scopeId);
  if (!scope) return res.status(404).json({ error: 'Scope not found' });
  const profile = getProfileById(scope.profileId);
  if (!profile || profile.mode !== LOCAL_OFFLINE_MODE) {
    return res.status(400).json({ error: 'Scope is not part of a Local Offline profile' });
  }
  db.prepare('DELETE FROM ipdash_scopes WHERE id=?').run(scopeId);
  recordAudit({ action: 'IP scope removed', objectType: 'ip_scope', objectId: scopeId, details: scope.cidr });
  res.json({ ok: true });
});

app.post('/api/ipdash/offline/ips', (req,res)=>{
  if (!guardEncryptionReady(res)) return;
  const { profileId, scopeId, hostname, mac, ip, linkedDeviceId: linkedDeviceIdRaw } = req.body || {};
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
  const linkedDeviceId = normalizeLinkedDeviceId(linkedDeviceIdRaw);
  if (linkedDeviceId === undefined) return res.status(400).json({ error: 'Invalid linkedDeviceId' });
  const info = db
    .prepare('INSERT INTO ipdash_scope_hosts(profile_id, scope_id, ip, name, hostname, mac, linked_device_id) VALUES (?,?,?,?,?,?,?)')
    .run(profileIdNum, scopeIdNum, reservedIp, label, label, normalizedMac, linkedDeviceId);
  const host =
    db
      .prepare('SELECT * FROM ipdash_scope_hosts WHERE id=?')
      .get(info.lastInsertRowid);
  recordAudit({ action: 'IP reservation created', objectType: 'ip_reservation', objectId: info.lastInsertRowid, details: `${reservedIp}${label ? ` · ${label}` : ''}` });
  res.json({ ok: true, host });
});

app.patch('/api/ipdash/offline/ips/:hostId', (req,res)=>{
  if (!guardEncryptionReady(res)) return;
  const hostId = Number(req.params.hostId);
  if (!Number.isInteger(hostId) || hostId <= 0) return res.status(400).json({ error: 'Invalid host id' });
  const host = db.prepare('SELECT * FROM ipdash_scope_hosts WHERE id=?').get(hostId);
  if (!host) return res.status(404).json({ error: 'Host not found' });
  const profile = getProfileById(host.profile_id);
  if (!profile || profile.mode !== LOCAL_OFFLINE_MODE) {
    return res.status(400).json({ error: 'Host is not part of a Local Offline profile' });
  }
  const payload = req.body || {};
  const sets = [];
  const values = [];
  const assign = (column, value) => { sets.push(`${column}=?`); values.push(value); };
  if ('hostname' in payload || 'name' in payload) {
    const name = clampText(payload.hostname ?? payload.name, 120) || null;
    assign('name', name);
    assign('hostname', name);
  }
  if ('mac' in payload) assign('mac', clampText(payload.mac, 64).toLowerCase() || null);
  if ('linkedDeviceId' in payload) {
    const linkedDeviceId = normalizeLinkedDeviceId(payload.linkedDeviceId);
    if (linkedDeviceId === undefined) return res.status(400).json({ error: 'Invalid linkedDeviceId' });
    assign('linked_device_id', linkedDeviceId);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  values.push(hostId);
  db.prepare(`UPDATE ipdash_scope_hosts SET ${sets.join(', ')} WHERE id=?`).run(...values);
  const updated = db.prepare('SELECT * FROM ipdash_scope_hosts WHERE id=?').get(hostId);
  recordAudit({ action: 'IP reservation updated', objectType: 'ip_reservation', objectId: hostId, details: `${updated.ip}${updated.name ? ` · ${updated.name}` : ''}` });
  res.json({ ok: true, host: updated });
});

app.delete('/api/ipdash/offline/ips/:hostId', (req,res)=>{
  if (!guardEncryptionReady(res)) return;
  const hostId = Number(req.params.hostId);
  if (!Number.isInteger(hostId) || hostId <= 0) {
    return res.status(400).json({ error: 'Invalid host id' });
  }
  const host =
    db
      .prepare('SELECT profile_id, ip, name FROM ipdash_scope_hosts WHERE id=?')
      .get(hostId) ?? null;
  if (!host) return res.status(404).json({ error: 'Host not found' });
  const profile = getProfileById(host.profile_id);
  if (!profile || profile.mode !== LOCAL_OFFLINE_MODE) {
    return res.status(400).json({ error: 'Host is not part of a Local Offline profile' });
  }
  db.prepare('DELETE FROM ipdash_scope_hosts WHERE id=?').run(hostId);
  recordAudit({ action: 'IP reservation removed', objectType: 'ip_reservation', objectId: hostId, details: `${host.ip}${host.name ? ` · ${host.name}` : ''}` });
  res.json({ ok: true });
});

const normalizeMachineHost = (value) => {
  const host = clampText(value, 255);
  if (!host) return null;
  if (net.isIP(host)) return host;
  return /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,253}[a-zA-Z0-9])?$/.test(host) ? host : null;
};

const validateLinkedDevice = (value) => {
  return normalizeLinkedDeviceId(value);
};

app.get('/api/wol/machines', (_req,res)=>{
  res.json({ machines: listWolMachines() });
});

app.get('/api/wol/status', async (req,res)=>{
  const force = req.query.refresh === '1' || req.query.refresh === 'true';
  const machines = listWolMachines();
  const statuses = await mapWithConcurrency(machines, 5, (machine) => probeWolMachine(machine, force));
  res.json({ statuses });
});

app.post('/api/wol/machines', (req,res)=>{
  const payload = req.body || {};
  const name = clampText(payload.name, 120);
  const macAddress = normalizeMacAddress(payload.macAddress);
  const ipAddress = payload.ipAddress ? normalizeMachineHost(payload.ipAddress) : null;
  const broadcastAddress = normalizeWolTarget(payload.broadcastAddress || '255.255.255.255');
  const port = Number(payload.port ?? 9);
  const probePort = payload.probePort == null || payload.probePort === '' ? null : Number(payload.probePort);
  const linkedDeviceId = validateLinkedDevice(payload.linkedDeviceId);
  if (!name) return res.status(400).json({ error: 'Machine name is required' });
  if (!macAddress) return res.status(400).json({ error: 'Invalid MAC address' });
  if (payload.ipAddress && !ipAddress) return res.status(400).json({ error: 'Invalid IP address or hostname' });
  if (!broadcastAddress) return res.status(400).json({ error: 'Broadcast address must be IPv4' });
  if (!Number.isInteger(port) || port < 1 || port > 65535) return res.status(400).json({ error: 'Invalid UDP port' });
  if (probePort !== null && (!Number.isInteger(probePort) || probePort < 1 || probePort > 65535)) return res.status(400).json({ error: 'Invalid TCP probe port' });
  if (linkedDeviceId === undefined) return res.status(400).json({ error: 'Invalid linkedDeviceId' });
  try {
    const info = db.prepare(`
      INSERT INTO wol_machines(name, ip_address, mac_address, broadcast_address, port, probe_port, linked_device_id, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, ipAddress, macAddress, broadcastAddress, port, probePort, linkedDeviceId, payload.enabled === false ? 0 : 1);
    recordAudit({ action: 'WOL machine created', objectType: 'wol_machine', objectId: info.lastInsertRowid, details: name });
    res.json({ ok: true, machine: getWolMachine(info.lastInsertRowid) });
  } catch (error) {
    if (String(error?.code || '').startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'A machine with this MAC address already exists' });
    }
    throw error;
  }
});

app.patch('/api/wol/machines/:machineId', (req,res)=>{
  const machineId = Number(req.params.machineId);
  const machine = getWolMachine(machineId);
  if (!machine) return res.status(404).json({ error: 'WOL machine not found' });
  const payload = req.body || {};
  const sets = [];
  const values = [];
  const assign = (column, value) => { sets.push(`${column}=?`); values.push(value); };
  if ('name' in payload) {
    const name = clampText(payload.name, 120);
    if (!name) return res.status(400).json({ error: 'Machine name is required' });
    assign('name', name);
  }
  if ('ipAddress' in payload) {
    const ipAddress = payload.ipAddress ? normalizeMachineHost(payload.ipAddress) : null;
    if (payload.ipAddress && !ipAddress) return res.status(400).json({ error: 'Invalid IP address or hostname' });
    assign('ip_address', ipAddress);
  }
  if ('macAddress' in payload) {
    const macAddress = normalizeMacAddress(payload.macAddress);
    if (!macAddress) return res.status(400).json({ error: 'Invalid MAC address' });
    assign('mac_address', macAddress);
  }
  if ('broadcastAddress' in payload) {
    const broadcastAddress = normalizeWolTarget(payload.broadcastAddress);
    if (!broadcastAddress) return res.status(400).json({ error: 'Broadcast address must be IPv4' });
    assign('broadcast_address', broadcastAddress);
  }
  if ('port' in payload) {
    const port = Number(payload.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return res.status(400).json({ error: 'Invalid UDP port' });
    assign('port', port);
  }
  if ('probePort' in payload) {
    const probePort = payload.probePort == null || payload.probePort === '' ? null : Number(payload.probePort);
    if (probePort !== null && (!Number.isInteger(probePort) || probePort < 1 || probePort > 65535)) return res.status(400).json({ error: 'Invalid TCP probe port' });
    assign('probe_port', probePort);
  }
  if ('linkedDeviceId' in payload) {
    const linkedDeviceId = validateLinkedDevice(payload.linkedDeviceId);
    if (linkedDeviceId === undefined) return res.status(400).json({ error: 'Invalid linkedDeviceId' });
    assign('linked_device_id', linkedDeviceId);
  }
  if ('enabled' in payload) assign('enabled', payload.enabled ? 1 : 0);
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  values.push(machineId);
  try {
    db.prepare(`UPDATE wol_machines SET ${sets.join(', ')} WHERE id=?`).run(...values);
    wolStatusCache.delete(machineId);
    recordAudit({ action: 'WOL machine updated', objectType: 'wol_machine', objectId: machineId, details: machine.name });
    res.json({ ok: true, machine: getWolMachine(machineId) });
  } catch (error) {
    if (String(error?.code || '').startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'A machine with this MAC address already exists' });
    }
    throw error;
  }
});

app.delete('/api/wol/machines/:machineId', (req,res)=>{
  const machineId = Number(req.params.machineId);
  const machine = getWolMachine(machineId);
  if (!machine) return res.status(404).json({ error: 'WOL machine not found' });
  db.prepare('DELETE FROM wol_machines WHERE id=?').run(machineId);
  wolWakeAttempts.delete(machineId);
  wolStatusCache.delete(machineId);
  recordAudit({ action: 'WOL machine removed', objectType: 'wol_machine', objectId: machineId, details: machine.name });
  res.json({ ok: true });
});

app.post('/api/wol/machines/:machineId/wake', async (req,res)=>{
  const machineId = Number(req.params.machineId);
  const machine = getWolMachine(machineId);
  if (!machine) return res.status(404).json({ error: 'WOL machine not found' });
  if (!machine.enabled) return res.status(409).json({ error: 'WOL machine is disabled' });
  const lastAttempt = wolWakeAttempts.get(machineId) ?? 0;
  if (Date.now() - lastAttempt < WOL_WAKE_MIN_INTERVAL_MS) {
    return res.status(429).json({ error: 'Wait a few seconds before waking this machine again' });
  }
  wolWakeAttempts.set(machineId, Date.now());
  try {
    await sendMagicPacket(machine);
    db.prepare("UPDATE wol_machines SET status='wake-sent' WHERE id=?").run(machineId);
    wolStatusCache.delete(machineId);
    recordAudit({ action: 'Wake packet sent', objectType: 'wol_machine', objectId: machineId, details: `${machine.name} · ${machine.macAddress}` });
    res.json({ ok: true, machine: getWolMachine(machineId) });
  } catch (error) {
    recordAudit({ action: 'Wake packet failed', objectType: 'wol_machine', objectId: machineId, details: `${machine.name} · ${error?.message || 'Unknown error'}`, result: 'error' });
    res.status(400).json({ error: error?.message || 'Failed to send Wake-on-LAN packet' });
  }
});

const isValidCronField = (field, min, max) => field.split(',').every((part) => {
  const [rangePart, stepPart] = part.split('/');
  const step = stepPart == null ? 1 : Number(stepPart);
  if (!Number.isInteger(step) || step < 1) return false;
  if (rangePart === '*') return true;
  const values = rangePart.split('-').map(Number);
  if (values.some((entry) => !Number.isInteger(entry))) return false;
  const start = values[0];
  const end = values.length === 1 ? start : values[1];
  return values.length <= 2 && start >= min && end <= max && start <= end;
});

const isValidCron = (value) => {
  const cron = clampText(value, 120);
  if (!cron || cron.split(/\s+/).length !== 5) return false;
  const fields = cron.split(/\s+/);
  if (!fields.every((field) => /^[\d*,\/-]+$/.test(field))) return false;
  return isValidCronField(fields[0], 0, 59)
    && isValidCronField(fields[1], 0, 23)
    && isValidCronField(fields[2], 1, 31)
    && isValidCronField(fields[3], 1, 12)
    && isValidCronField(fields[4], 0, 6);
};

app.post('/api/wol/schedules', (req,res)=>{
  const machineId = Number(req.body?.machineId);
  const cron = clampText(req.body?.cron, 120);
  const machine = getWolMachine(machineId);
  if (!machine) return res.status(404).json({ error: 'WOL machine not found' });
  if (!isValidCron(cron)) return res.status(400).json({ error: 'Cron must use five standard fields' });
  const info = db.prepare(`
    INSERT INTO wol_schedules(machine_id, name, cron, enabled) VALUES (?, ?, ?, ?)
  `).run(machineId, clampText(req.body?.name, 120) || null, cron, req.body?.enabled === false ? 0 : 1);
  recordAudit({ action: 'WOL schedule created', objectType: 'wol_schedule', objectId: info.lastInsertRowid, details: [machine.name, clampText(req.body?.name, 120), cron].filter(Boolean).join(' · ') });
  const row = db.prepare('SELECT * FROM wol_schedules WHERE id=?').get(info.lastInsertRowid);
  res.json({ ok: true, schedule: mapWolScheduleRow(row) });
});

app.patch('/api/wol/schedules/:scheduleId', (req,res)=>{
  const scheduleId = Number(req.params.scheduleId);
  const schedule = db.prepare('SELECT * FROM wol_schedules WHERE id=?').get(scheduleId);
  if (!schedule) return res.status(404).json({ error: 'WOL schedule not found' });
  const payload = req.body || {};
  const sets = [];
  const values = [];
  if ('name' in payload) { sets.push('name=?'); values.push(clampText(payload.name, 120) || null); }
  if ('cron' in payload) {
    const cron = clampText(payload.cron, 120);
    if (!isValidCron(cron)) return res.status(400).json({ error: 'Cron must use five standard fields' });
    sets.push('cron=?'); values.push(cron);
  }
  if ('enabled' in payload) { sets.push('enabled=?'); values.push(payload.enabled ? 1 : 0); }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  values.push(scheduleId);
  db.prepare(`UPDATE wol_schedules SET ${sets.join(', ')} WHERE id=?`).run(...values);
  recordAudit({ action: 'WOL schedule updated', objectType: 'wol_schedule', objectId: scheduleId, details: [getWolMachine(schedule.machine_id)?.name || 'WOL machine', schedule.name, schedule.cron].filter(Boolean).join(' · ') });
  res.json({ ok: true, schedule: mapWolScheduleRow(db.prepare('SELECT * FROM wol_schedules WHERE id=?').get(scheduleId)) });
});

app.delete('/api/wol/schedules/:scheduleId', (req,res)=>{
  const scheduleId = Number(req.params.scheduleId);
  const schedule = db.prepare('SELECT * FROM wol_schedules WHERE id=?').get(scheduleId);
  if (!schedule) return res.status(404).json({ error: 'WOL schedule not found' });
  db.prepare('DELETE FROM wol_schedules WHERE id=?').run(scheduleId);
  recordAudit({ action: 'WOL schedule removed', objectType: 'wol_schedule', objectId: scheduleId, details: [getWolMachine(schedule.machine_id)?.name || 'WOL machine', schedule.name, schedule.cron].filter(Boolean).join(' · ') });
  res.json({ ok: true });
});

const mapAuditRow = (row) => ({
    id: row.id,
    actor: row.actor,
    action: row.action,
    objectType: row.object_type ?? '',
    objectId: row.object_id ?? '',
    details: row.details ?? '',
    result: row.result,
    createdAt: toUtcISOString(row.created_at),
});

const buildAuditFilter = (query) => {
  const where = [];
  const values = [];
  const cursor = Number(query.cursor);
  if (Number.isInteger(cursor) && cursor > 0) { where.push('id < ?'); values.push(cursor); }
  const search = clampText(query.query, 160);
  if (search) {
    where.push("(actor LIKE ? OR action LIKE ? OR object_type LIKE ? OR object_id LIKE ? OR details LIKE ?)");
    const pattern = `%${search}%`;
    values.push(pattern, pattern, pattern, pattern, pattern);
  }
  const result = clampText(query.result, 20).toLowerCase();
  if (result && result !== 'all') { where.push('result=?'); values.push(result); }
  const objectType = clampText(query.objectType, 80);
  if (objectType && objectType !== 'all') { where.push('object_type=?'); values.push(objectType); }
  return { sql: where.length ? ` WHERE ${where.join(' AND ')}` : '', values };
};

app.get('/api/audit', (req,res)=>{
  const requestedLimit = Number(req.query.limit ?? 100);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 250) : 100;
  const filter = buildAuditFilter(req.query);
  const rows = db.prepare(`SELECT * FROM audit_events${filter.sql} ORDER BY id DESC LIMIT ?`).all(...filter.values, limit + 1);
  const hasMore = rows.length > limit;
  const events = rows.slice(0, limit).map(mapAuditRow);
  const totalFilter = buildAuditFilter({ ...req.query, cursor: undefined });
  const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM audit_events${totalFilter.sql}`).get(...totalFilter.values)?.count ?? 0);
  const objectTypes = db.prepare("SELECT DISTINCT object_type FROM audit_events WHERE object_type IS NOT NULL AND object_type <> '' ORDER BY object_type").all().map((row) => row.object_type);
  res.json({ events, nextCursor: hasMore ? events.at(-1)?.id ?? null : null, total, objectTypes });
});

const csvCell = (value) => {
  const raw = String(value ?? '');
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
};
app.get('/api/audit/export', (req,res)=>{
  const filter = buildAuditFilter({ ...req.query, cursor: undefined });
  const events = db.prepare(`SELECT * FROM audit_events${filter.sql} ORDER BY id DESC LIMIT 5000`).all(...filter.values).map(mapAuditRow);
  const rows = [['Time', 'Actor', 'Operation', 'Object type', 'Object ID', 'Details', 'Result'], ...events.map((event) => [event.createdAt, event.actor, event.action, event.objectType, event.objectId, event.details, event.result])];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="rakit_audit.csv"');
  res.send(`\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`);
});

app.get('/api/overview', (_req,res)=>{
  const cabinetCount = Number(db.prepare('SELECT COUNT(*) AS c FROM cabinets').get()?.c ?? 0);
  const deviceCount = Number(db.prepare('SELECT COUNT(*) AS c FROM cabinet_devices').get()?.c ?? 0);
  const portConnectionCount = Number(db.prepare('SELECT COUNT(*) AS c FROM port_connections').get()?.c ?? 0);
  const wolMachineCount = Number(db.prepare('SELECT COUNT(*) AS c FROM wol_machines').get()?.c ?? 0);
  const manualIpCount = Number(db.prepare('SELECT COUNT(*) AS c FROM ipdash_scope_hosts').get()?.c ?? 0);
  const attentionCount = Number(db.prepare("SELECT COUNT(*) AS c FROM audit_events WHERE result='error' AND created_at >= datetime('now', '-1 day')").get()?.c ?? 0);
  const physicalCapacity = listCabinets().map((cabinet) => {
    const devices = listDevicesForCabinet(cabinet.id);
    const occupiedUnits = new Set();
    devices.forEach((device) => {
      for (let unit = device.position; unit < device.position + device.heightU; unit += 1) occupiedUnits.add(unit);
    });
    const usedU = occupiedUnits.size;
    const status = devices.some((device) => device.status === 'offline')
      ? 'offline'
      : devices.some((device) => device.status === 'maintenance')
      ? 'maintenance'
      : devices.length > 0 && devices.every((device) => device.status === 'planned')
      ? 'planned'
      : 'online';
    return {
      id: cabinet.id,
      name: cabinet.name,
      symbol: cabinet.symbol,
      location: cabinet.location,
      deviceCount: devices.length,
      sizeU: cabinet.sizeU,
      usedU,
      freeU: Math.max(0, cabinet.sizeU - usedU),
      utilizationPercent: cabinet.sizeU ? Math.round((usedU / cabinet.sizeU) * 100) : 0,
      status,
    };
  });
  res.json({ cabinetCount, deviceCount, portConnectionCount, wolMachineCount, manualIpCount, attentionCount, physicalCapacity });
});

const cronFieldMatches = (field, value, min, max) => {
  const matchesPart = (part) => {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart == null ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) return false;
    let start = min;
    let end = max;
    if (rangePart !== '*') {
      if (rangePart.includes('-')) {
        const [rawStart, rawEnd] = rangePart.split('-');
        start = Number(rawStart);
        end = Number(rawEnd);
      } else {
        start = Number(rangePart);
        end = start;
      }
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) return false;
    return value >= start && value <= end && (value - start) % step === 0;
  };
  return field.split(',').some(matchesPart);
};

const CRON_WEEKDAY_VALUES = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const getZonedCronValues = (date, timeZone = APP_TIME_ZONE) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    minute: 'numeric',
    hour: 'numeric',
    day: 'numeric',
    month: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    minute: Number(values.minute),
    hour: Number(values.hour),
    day: Number(values.day),
    month: Number(values.month),
    weekday: CRON_WEEKDAY_VALUES[values.weekday],
  };
};

const cronMatches = (expression, date, timeZone = APP_TIME_ZONE) => {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const values = getZonedCronValues(date, timeZone);
  return cronFieldMatches(fields[0], values.minute, 0, 59)
    && cronFieldMatches(fields[1], values.hour, 0, 23)
    && cronFieldMatches(fields[2], values.day, 1, 31)
    && cronFieldMatches(fields[3], values.month, 1, 12)
    && cronFieldMatches(fields[4], values.weekday, 0, 6);
};

const cleanupAuditEvents = () => {
  if (!Number.isFinite(AUDIT_RETENTION_DAYS) || AUDIT_RETENTION_DAYS <= 0) return 0;
  return db.prepare("DELETE FROM audit_events WHERE created_at < datetime('now', ?)").run(`-${Math.floor(AUDIT_RETENTION_DAYS)} days`).changes;
};

let lastScheduleMinute = '';
const runWolSchedules = async () => {
  const now = new Date();
  const minuteKey = Math.floor(now.getTime() / 60_000);
  if (minuteKey === lastScheduleMinute) return;
  lastScheduleMinute = minuteKey;
  const rows = db.prepare(`
    SELECT ws.*, wm.name AS machine_name, wm.mac_address, wm.broadcast_address, wm.port, wm.enabled AS machine_enabled
    FROM wol_schedules ws JOIN wol_machines wm ON wm.id=ws.machine_id
    WHERE ws.enabled=1 AND wm.enabled=1
  `).all();
  for (const row of rows) {
    if (!cronMatches(row.cron, now)) continue;
    try {
      await sendMagicPacket(row);
      db.prepare("UPDATE wol_machines SET status='wake-sent' WHERE id=?").run(row.machine_id);
      wolStatusCache.delete(row.machine_id);
      db.prepare('UPDATE wol_schedules SET last_run_at=CURRENT_TIMESTAMP WHERE id=?').run(row.id);
      recordAudit({ action: 'Scheduled wake packet sent', objectType: 'wol_schedule', objectId: row.id, details: `${row.machine_name} · ${row.cron}`, actor: 'system' });
    } catch (error) {
      recordAudit({ action: 'Scheduled wake packet failed', objectType: 'wol_schedule', objectId: row.id, details: error?.message || 'Unknown error', result: 'error', actor: 'system' });
    }
  }
};

// Export
app.post('/api/export', async (req,res)=>{
  try {
    const { modules, ipdash } = req.body || {};
    const requestedModules = Array.isArray(modules) && modules.length ? modules : ['cabinet'];
    const includeCabinet = requestedModules.includes('cabinet');
    const includeConnections = requestedModules.includes('connections');
    const includeWol = requestedModules.includes('wol');
    const includeIpDash = requestedModules.includes('ipdash');
    if (includeIpDash && !guardEncryptionReady(res)) return;
    let ipDashContext = null;
    if (includeIpDash) {
      ipDashContext = await buildIpDashContext(ipdash);
    }
    const wb = buildExportWorkbook({ includeCabinet, includeConnections, includeWol, ipDashContext });
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
app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found' }));
const publicDirectory = path.join(__dirname, 'public');
app.get('/sw.js', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(publicDirectory, 'sw.js'), { cacheControl: false });
});
app.get('/manifest.webmanifest', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(publicDirectory, 'manifest.webmanifest'), { cacheControl: false });
});
app.use(
  '/assets',
  express.static(path.join(publicDirectory, 'assets'), { immutable: true, maxAge: '1y' })
);
app.use(
  express.static(publicDirectory, {
    maxAge: 0,
    setHeaders: (res, filePath) => {
      if (path.basename(filePath) === 'index.html') res.setHeader('Cache-Control', 'no-cache');
    },
  })
);
app.use((_req,res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(publicDirectory, 'index.html'), { cacheControl: false });
});

app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request payload is too large', code: 'PAYLOAD_TOO_LARGE' });
  }
  if (err?.type === 'entity.parse.failed' || (err instanceof SyntaxError && err?.status === 400)) {
    return res.status(400).json({ error: 'Invalid JSON payload', code: 'INVALID_JSON' });
  }
  console.error('Unhandled request error', err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, ()=> {
  console.log('Rakit backend listening on :' + PORT);
  const removedAuditEvents = cleanupAuditEvents();
  if (removedAuditEvents) console.log(`[Audit] Removed ${removedAuditEvents} events outside the ${AUDIT_RETENTION_DAYS}-day retention window`);
  if (!SESSION_COOKIE_SECURE) console.warn('[Security] Session cookie Secure flag is disabled; use HTTPS and APP_COOKIE_SECURE=true when possible');
  runWolSchedules().catch((error) => console.warn('[WOL] Schedule runner failed', error?.message || error));
});

const wolScheduleTimer = setInterval(() => {
  runWolSchedules().catch((error) => console.warn('[WOL] Schedule runner failed', error?.message || error));
}, 30_000);
wolScheduleTimer.unref();

const auditCleanupTimer = setInterval(cleanupAuditEvents, 24 * 60 * 60 * 1000);
auditCleanupTimer.unref();

let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Runtime] ${signal} received; closing HTTP server`);
  clearInterval(wolScheduleTimer);
  clearInterval(auditCleanupTimer);
  server.close(() => {
    try {
      db.close();
    } catch (error) {
      console.warn('[Runtime] Database close failed', error?.message || error);
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
