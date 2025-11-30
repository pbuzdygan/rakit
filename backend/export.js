import ExcelJS from 'exceljs';
import db from './db.js';

const palette = {
  accent: '60A5FA',
  accentStrong: '3B82F6',
  accentSoft: 'E0EDFF',
  text: '0F172A',
  border: 'D9E2FF',
  panel: 'FFFFFF',
  panelMuted: 'F3F6FD',
  success: '22C55E',
  warning: 'F59E0B',
};

const DEFAULT_IPDASH_FILTERS = {
  showOnline: false,
  showReserved: false,
  hideEmpty: false,
};

const toArgb = (hex) => `FF${hex.replace('#', '').toUpperCase()}`;

const border = {
  top: { style: 'thin', color: { argb: toArgb(palette.border) } },
  bottom: { style: 'thin', color: { argb: toArgb(palette.border) } },
  left: { style: 'thin', color: { argb: toArgb(palette.border) } },
  right: { style: 'thin', color: { argb: toArgb(palette.border) } },
};

const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb(palette.panelMuted) } };
const accentFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb(palette.accent) } };

function styleHeader(row) {
  row.eachCell((cell) => {
    cell.border = border;
    cell.fill = headerFill;
    cell.font = { bold: true, color: { argb: toArgb(palette.text) } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
}

function styleBody(row) {
  row.eachCell((cell, colNumber) => {
    cell.border = border;
    const horizontal = colNumber === 1 ? 'left' : 'center';
    cell.alignment = { vertical: 'middle', horizontal };
  });
}

const collectCabinets = () =>
  db
    .prepare('SELECT * FROM cabinets ORDER BY name ASC')
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      symbol: row.symbol ?? '',
      location: row.location ?? '',
      sizeU: row.size_u ?? 42,
    }));

const collectCabinetDevices = () =>
  db
    .prepare('SELECT * FROM cabinet_devices ORDER BY cabinet_id ASC, position ASC')
    .all()
    .map((row) => ({
      id: row.id,
      cabinetId: row.cabinet_id,
      type: row.device_type,
      model: row.model ?? '',
      heightU: row.height_u ?? 1,
      position: row.position ?? 1,
      comment: row.comment ?? '',
    }));

export function buildExportWorkbook({ includeCabinet = true, ipDashContext = null } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Rakit';
  workbook.created = new Date();
  workbook.modified = new Date();

  const cabinets = includeCabinet ? collectCabinets() : [];
  const devices = includeCabinet ? collectCabinetDevices() : [];
  const devicesByCab = new Map();
  devices.forEach((device) => {
    if (!devicesByCab.has(device.cabinetId)) devicesByCab.set(device.cabinetId, []);
    devicesByCab.get(device.cabinetId).push(device);
  });

  if (includeCabinet || ipDashContext) {
    addCabinetOverview(
      workbook,
      includeCabinet ? cabinets : [],
      includeCabinet ? devices : [],
      Boolean(ipDashContext),
      includeCabinet
    );
  }

  if (includeCabinet) {
    addCabinetSheets(workbook, cabinets, devicesByCab);
    addCabinetExperimentalSheet(workbook, cabinets, devicesByCab);
  }

  if (ipDashContext) {
    addIpDashSheets(workbook, ipDashContext);
  }

  if (!includeCabinet && !ipDashContext) {
    const emptySheet = workbook.addWorksheet('Overview');
    emptySheet.addRow(['No modules were selected.']);
  }

  return workbook;
}

function addCabinetOverview(workbook, cabinets, devices, includeIpDash, includeCabinets = true) {
  const overview = workbook.addWorksheet('Overview');
  overview.columns = [
    { width: 24 },
    { width: 16 },
    { width: 30 },
    { width: 30 },
  ];
  overview.addRow(['Module', 'Items', 'Metric A', 'Metric B']);
  styleHeader(overview.getRow(1));
  if (includeCabinets) {
    const cabRow = overview.addRow([
      'IT Cabinet',
      cabinets.length,
      `Devices: ${devices.length}`,
      `Capacity U: ${cabinets.reduce((sum, cab) => sum + cab.sizeU, 0)}`,
    ]);
    styleBody(cabRow);
  }
  if (includeIpDash) {
    const ipRow = overview.addRow(['IP Dash', 'See sheet', 'Live snapshot', 'Using light palette']);
    styleBody(ipRow);
  }
  overview.mergeCells('A6:D8');
  const hero = overview.getCell('A6');
  hero.value = 'Rakit export\nBranded for light mode reviews.';
  hero.fill = accentFill;
  hero.font = { bold: true, color: { argb: toArgb('#FFFFFF') }, size: 14 };
  hero.alignment = { wrapText: true, horizontal: 'center', vertical: 'middle' };
}

function addCabinetSheets(workbook, cabinets, devicesByCab) {
  const cabinetSheet = workbook.addWorksheet('Cabinets');
  cabinetSheet.columns = [
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Symbol', key: 'symbol', width: 14 },
    { header: 'Location', key: 'location', width: 28 },
    { header: 'Size (U)', key: 'sizeU', width: 12 },
    { header: 'Devices', key: 'deviceCount', width: 12 },
  ];
  styleHeader(cabinetSheet.getRow(1));
  cabinets.forEach((cabinet) => {
    const row = cabinetSheet.addRow({
      ...cabinet,
      deviceCount: (devicesByCab.get(cabinet.id) ?? []).length,
    });
    styleBody(row);
  });

  const deviceSheet = workbook.addWorksheet('Cabinet devices');
  deviceSheet.columns = [
    { header: 'Cabinet', key: 'cabinet', width: 24 },
    { header: 'Type', key: 'type', width: 22 },
    { header: 'Model', key: 'model', width: 24 },
    { header: 'Height (U)', key: 'heightU', width: 12 },
    { header: 'Start U', key: 'position', width: 10 },
    { header: 'Comment', key: 'comment', width: 40 },
  ];
  styleHeader(deviceSheet.getRow(1));
  cabinets.forEach((cabinet) => {
    (devicesByCab.get(cabinet.id) ?? []).forEach((device) => {
      const row = deviceSheet.addRow({
        cabinet: cabinet.name,
        type: device.type,
        model: device.model,
        heightU: device.heightU,
        position: device.position,
        comment: device.comment,
      });
      styleBody(row);
    });
  });
}

function addCabinetExperimentalSheet(workbook, cabinets, devicesByCab) {
  const sheet = workbook.addWorksheet('XP – Rack focus');
  sheet.columns = [
    { header: 'Cabinet', key: 'cabinet', width: 26 },
    { header: 'Location', key: 'location', width: 24 },
    { header: 'Size (U)', key: 'sizeU', width: 10 },
    { header: 'Used U', key: 'usedU', width: 10 },
    { header: 'Free U', key: 'freeU', width: 10 },
    { header: 'Usage %', key: 'usage', width: 10 },
    { header: 'Devices', key: 'deviceCount', width: 12 },
    { header: 'Tallest device', key: 'tallest', width: 24 },
  ];
  styleHeader(sheet.getRow(1));
  cabinets.forEach((cabinet) => {
    const list = devicesByCab.get(cabinet.id) ?? [];
    const usedU = list.reduce((sum, device) => sum + (device.heightU || 1), 0);
    const freeU = Math.max(0, cabinet.sizeU - usedU);
    const usage = cabinet.sizeU > 0 ? Math.round((usedU / cabinet.sizeU) * 100) : 0;
    const tallest = list.length ? list.reduce((prev, next) => (next.heightU > prev.heightU ? next : prev)).type : '—';
    const row = sheet.addRow({
      cabinet: cabinet.name,
      location: cabinet.location || '—',
      sizeU: cabinet.sizeU,
      usedU,
      freeU,
      usage: `${usage}%`,
      deviceCount: list.length,
      tallest,
    });
    styleBody(row);
  });
}

function addIpDashSheets(workbook, context) {
  const snapshot = context.snapshot || {};
  const networks = parseNetworks(snapshot.networks || []);
  if (!networks.length) {
    const sheet = workbook.addWorksheet('IP Dash');
    sheet.addRow(['No networks available. Connect a profile to export IP Dash.']);
    return;
  }
  const usersByIp = indexUsersByIp(snapshot.users || []);
  mergeOnlineDevices(usersByIp, snapshot.online || []);
  const onlineSet = buildOnlineMacSet(snapshot.online || []);
  const offlineMode = snapshot.profile?.mode === 'local-offline';
  const filters = {
    ...DEFAULT_IPDASH_FILTERS,
    ...(context.filters || {}),
  };
  const usedNames = new Set();
  networks.forEach((network, idx) => {
    const hostEntries = getHostsForRendering(network, usersByIp, filters, onlineSet, offlineMode);
    const grouped = getGroupedEntries(hostEntries, context.groupBy || 'none', context.groupTags || {});
    const baseName = `IP Dash – ${network.name || network.ipSubnet || `Network ${idx + 1}`}`;
    const sheetName = ensureUniqueSheetName(baseName, usedNames);
    const sheet = workbook.addWorksheet(sheetName);
    sheet.addRow([
      `Network ${idx + 1}/${networks.length}: ${network.name} (${network.ipSubnet})`,
      `Grouping: ${context.groupBy || 'none'}`,
      `View: ${context.viewMode || 'table'}`,
    ]);
    styleBody(sheet.getRow(1));
    sheet.addRow([]);
    if (!hostEntries.length) {
      sheet.addRow(['No host entries matched your filters.']);
      return;
    }
    if (context.viewMode === 'grid') {
      renderGridSheet(sheet, grouped, onlineSet, offlineMode);
    } else {
      renderTableSheet(sheet, grouped, onlineSet, offlineMode);
    }
  });
}

function renderTableSheet(sheet, grouped, onlineSet, offlineMode) {
  sheet.addRow(['Group', 'IP', 'Name', 'Hostname', 'MAC', 'Status']);
  styleHeader(sheet.getRow(sheet.lastRow.number));
  grouped.forEach((group) => {
    group.hosts.forEach((entry, index) => {
      const device = entry.device;
      const status = offlineMode ? '—' : device ? (isOnline(device, onlineSet) ? 'online' : 'reserved') : 'empty';
      const label = group.displayLabel ?? group.label ?? 'All';
      const row = sheet.addRow([
        index === 0 ? label : '',
        entry.ip,
        device?.name || '(no name)',
        device?.hostname || '—',
        device?.mac || '—',
        status,
      ]);
      styleBody(row);
    });
    sheet.addRow([]);
  });
  sheet.columns = [
    { width: 14 },
    { width: 16 },
    { width: 24 },
    { width: 24 },
    { width: 20 },
    { width: 12 },
  ];
}

function renderGridSheet(sheet, grouped, onlineSet, offlineMode) {
  sheet.columns = [
    { width: 20 },
    { width: 18 },
    { width: 28 },
    { width: 18 },
  ];
  sheet.addRow(['Group', 'IP', 'Tile label', 'Status']);
  styleHeader(sheet.getRow(sheet.lastRow.number));
  grouped.forEach((group) => {
    group.hosts.forEach((entry, index) => {
      const device = entry.device;
      const label = device ? device.name || device.hostname || '(unnamed)' : 'Available';
      const status = offlineMode ? '—' : device ? (isOnline(device, onlineSet) ? 'online' : 'reserved') : 'empty';
      const groupLabel = group.displayLabel ?? group.label ?? 'All';
      const row = sheet.addRow([index === 0 ? groupLabel : '', entry.ip, label, status]);
      styleBody(row);
    });
    sheet.addRow([]);
  });
}

function clampIndex(index, length) {
  if (!Number.isFinite(index)) return 0;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}

function parseNetworks(raw) {
  return raw
    .filter((record) => typeof record.ip_subnet === 'string')
    .map((record) => {
      const [ip, maskStr] = (record.ip_subnet ?? '').split('/');
      const cidr = Number(maskStr) || 24;
      const ipInt = ipToInt(ip);
      if (ipInt == null) return null;
      const mask = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
      const networkBase = (ipInt & mask) >>> 0;
      const totalHosts = 2 ** (32 - cidr);
      const firstHost = totalHosts <= 2 ? networkBase : (networkBase + 1) >>> 0;
      const lastHost = totalHosts <= 2 ? (networkBase + totalHosts - 1) >>> 0 : (networkBase + totalHosts - 2) >>> 0;
      return {
        id: record._id || record.ip_subnet,
        name: record.name || record.ip_subnet,
        ipSubnet: record.ip_subnet,
        cidr,
        firstHostInt: firstHost,
        lastHostInt: lastHost,
        hostCount: Math.max(0, lastHost - firstHost + 1),
        scopeId: record.scope_id ?? null,
      };
    })
    .filter(Boolean);
}

function ipToInt(ip) {
  if (!ip) return null;
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function intToIp(value) {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

function getHostIpsForNetwork(network) {
  const hosts = [];
  for (let current = network.firstHostInt; current <= network.lastHostInt; current++) {
    hosts.push(intToIp(current));
  }
  return hosts;
}

function indexUsersByIp(users) {
  const map = new Map();
  users.forEach((user) => {
    const addIp = (ip) => {
      if (!ip || typeof ip !== 'string') return;
      const trimmed = ip.trim();
      if (!trimmed || map.has(trimmed)) return;
      map.set(trimmed, { ...user, ip: trimmed });
    };
    addIp(user.fixed_ip);
    addIp(user.ip);
    addIp(user.last_ip);
    addIp(user.last_known_ip);
    addIp(user.noted_ip);
    addIp(user.primary_ip);
    addIp(user.ipv4);
    addIp(user.remote_ip);
    addIp(user.tunnel_ip);
    if (user.network_table) {
      user.network_table.forEach((entry) => addIp(entry?.ip));
    }
    if (user.config_networks && typeof user.config_networks === 'object') {
      Object.values(user.config_networks).forEach((cfg) => {
        addIp(cfg?.ip);
        addIp(cfg?.ipaddr);
      });
    }
  });
  return map;
}

function resolveOnlineIp(device) {
  if (!device) return null;
  const networkEntry = device.networks?.find((network) => network?.ip);
  let configIp = null;
  if (device.config_networks && typeof device.config_networks === 'object') {
    for (const value of Object.values(device.config_networks)) {
      if (!value) continue;
      if (value.ip) {
        configIp = value.ip;
        break;
      }
      if (value.ipaddr) {
        configIp = value.ipaddr;
        break;
      }
    }
  }
  return (
    device.ip ||
    device.ipv4 ||
    device.tunnel_ip ||
    device.remote_ip ||
    device.last_ip ||
    device.last_known_ip ||
    device.noted_ip ||
    device.primary_ip ||
    device.uplink?.remote_ip ||
    networkEntry?.ip ||
    configIp ||
    null
  );
}

function mergeOnlineDevices(map, devices) {
  devices.forEach((dev) => {
    const ip = resolveOnlineIp(dev);
    if (!ip) return;
    const existing = map.get(ip);
    if (existing) {
      if (!existing.mac && dev.mac) existing.mac = dev.mac;
      if (!existing.hostname && dev.hostname) existing.hostname = dev.hostname;
      if (!existing.name && (dev.name || dev.hostname)) existing.name = dev.name || dev.hostname || existing.name;
      if (dev.last_seen) existing.last_seen = dev.last_seen;
    } else {
      map.set(ip, {
        name: dev.name || dev.hostname || '',
        hostname: dev.hostname || '',
        mac: dev.mac || '',
        last_seen: dev.last_seen,
        ip,
      });
    }
  });
}

function buildOnlineMacSet(devices) {
  const set = new Set();
  devices.forEach((dev) => {
    if (dev.mac) set.add(dev.mac.toLowerCase());
  });
  return set;
}

function isOnline(device, onlineSet) {
  if (!device) return false;
  const mac = device.mac?.toLowerCase();
  if (mac && onlineSet.has(mac)) return true;
  if (!device.last_seen) return false;
  return Date.now() / 1000 - Number(device.last_seen) < 600;
}

function resolveHostVisibility(device, filters, onlineSet) {
  const { showOnline, showReserved, hideEmpty } = filters;
  if (!device) {
    if (hideEmpty) return { include: false, device: null };
    return { include: true, device: null };
  }
  if (showOnline && !isOnline(device, onlineSet)) {
    return { include: false, device: null };
  }
  if (showReserved && !device.fixed_ip) {
    return { include: false, device: null };
  }
  return { include: true, device };
}

function getHostsForRendering(network, map, filters, onlineSet, offlineMode) {
  const appliedFilters = offlineMode ? { ...filters, showOnline: false } : filters;
  const hosts = [];
  getHostIpsForNetwork(network).forEach((ip) => {
    const device = map.get(ip) ?? null;
    const visibility = resolveHostVisibility(device, appliedFilters, onlineSet);
    if (visibility.include) {
      hosts.push({ ip, device: visibility.device });
    }
  });
  return hosts;
}

function getGroupSizeValue(groupBy) {
  if (groupBy === 'none') return null;
  const parsed = Number(groupBy);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function groupLabelForIp(ip, size) {
  const lastOctet = Number(ip.split('.').pop());
  if (!Number.isFinite(lastOctet)) return null;
  const bucket = Math.floor(lastOctet / size);
  let start = bucket === 0 ? 1 : bucket * size;
  let end = start + size - 1;
  if (start < 1) start = 1;
  if (end > 254) end = 254;
  return { key: `${start}-${end}`, label: `${start}-${end}`, order: start };
}

function getGroupedEntries(hosts, groupBy, groupTags = {}) {
  const size = getGroupSizeValue(groupBy);
  if (!size) {
    return [
      {
        key: 'all',
        label: null,
        tagKey: 'all',
        hosts,
      },
    ];
  }
  const groups = new Map();
  hosts.forEach((entry) => {
    const info = groupLabelForIp(entry.ip, size);
    const key = info?.key || 'other';
    const order = info?.order ?? Number.MAX_SAFE_INTEGER;
    const tagKey = info ? `${size}:${info.key}` : key;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: info?.label || key,
        tagKey,
        order,
        hosts: [],
      });
    }
    groups.get(key).hosts.push(entry);
  });
  return Array.from(groups.values())
    .sort((a, b) => {
      if (a.order === b.order) return a.key.localeCompare(b.key);
      return a.order - b.order;
    })
    .map((entry) => ({
      ...entry,
      displayLabel: groupTags[entry.tagKey] || entry.label,
    }));
}

export { DEFAULT_IPDASH_FILTERS };

function ensureUniqueSheetName(name, used) {
  const sanitized = sanitizeWorksheetName(name);
  let finalName = sanitized;
  let counter = 2;
  while (used.has(finalName)) {
    const suffix = ` (${counter})`;
    const maxBaseLength = Math.max(0, 31 - suffix.length);
    const base = sanitized.slice(0, maxBaseLength);
    finalName = `${base}${suffix}`.trim();
    counter += 1;
  }
  if (!finalName) finalName = `Sheet${used.size + 1}`;
  used.add(finalName);
  return finalName;
}

function sanitizeWorksheetName(name) {
  if (!name || typeof name !== 'string') return 'Sheet';
  const invalid = /[\\/?*\[\]:]/g;
  let trimmed = name.replace(invalid, ' ').trim();
  if (!trimmed) trimmed = 'Sheet';
  if (trimmed.length > 31) trimmed = trimmed.slice(0, 31);
  return trimmed;
}
