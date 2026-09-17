import net from 'net';

const ANSIBLE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const MAX_HOSTS = 5000;
const MAX_GROUPS = 500;
const MAX_LINE_LENGTH = 2048;
const MAX_CATALOG_BYTES = 1024 * 1024;
const CATALOG_CHUNK_SIZE = 1800;
const CATALOG_MARKER = '# RAKIT_CATALOG_V1';
const BUILTIN_GROUPS = new Set(['all', 'ungrouped', 'rakit_managed']);

const normalizeAddress = (value) => {
  const address = String(value || '').trim();
  if (!address || address.length > 255 || /\s/.test(address)) return '';
  if (net.isIP(address)) return address;
  return /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,253}[a-zA-Z0-9])?$/.test(address) ? address : '';
};

const tokenize = (line) => {
  const matches = line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return matches.map((token) => {
    const quoted = (token.startsWith('"') && token.endsWith('"'))
      || (token.startsWith("'") && token.endsWith("'"));
    return quoted ? token.slice(1, -1) : token;
  });
};

const catalogText = (value, limit, fallback = '') => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error('Rakit catalog contains invalid text');
  return text || fallback;
};

const parseRakitCatalog = (source) => {
  const chunks = new Map();
  let expectedChunks = 0;
  for (const rawLine of source.split('\n')) {
    const match = rawLine.trim().match(/^# RAKIT_CATALOG_V1 (\d+)\/(\d+) ([A-Za-z0-9_-]+)$/);
    if (!match) continue;
    const index = Number(match[1]);
    const total = Number(match[2]);
    if (!Number.isInteger(index) || index < 1 || !Number.isInteger(total) || total < 1 || total > 1000 || (expectedChunks && total !== expectedChunks)) {
      throw new Error('Invalid Rakit catalog chunk metadata');
    }
    expectedChunks = total;
    if (chunks.has(index)) throw new Error('Duplicate Rakit catalog chunk');
    chunks.set(index, match[3]);
  }
  if (!expectedChunks) return null;
  if (chunks.size !== expectedChunks) throw new Error('Rakit catalog metadata is incomplete');
  const encoded = Array.from({ length: expectedChunks }, (_, index) => chunks.get(index + 1)).join('');
  let decoded;
  try {
    const buffer = Buffer.from(encoded, 'base64url');
    if (buffer.length > MAX_CATALOG_BYTES) throw new Error('Rakit catalog is too large');
    decoded = JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    if (error?.message === 'Rakit catalog is too large') throw error;
    throw new Error('Rakit catalog metadata is invalid');
  }
  if (decoded?.version !== 1 || !Array.isArray(decoded.servers) || !Array.isArray(decoded.groups)) throw new Error('Unsupported Rakit catalog metadata version');
  if (decoded.servers.length > MAX_HOSTS || decoded.groups.length > MAX_GROUPS) throw new Error('Rakit catalog exceeds import limits');

  const groupNames = new Set();
  const groups = decoded.groups.map((group) => {
    const ansibleName = catalogText(group?.ansibleName, 63).toLowerCase();
    if (!ANSIBLE_NAME_RE.test(ansibleName) || BUILTIN_GROUPS.has(ansibleName) || groupNames.has(ansibleName)) throw new Error(`Invalid or duplicate Rakit group "${ansibleName}"`);
    groupNames.add(ansibleName);
    return {
      ansibleName,
      name: catalogText(group?.name, 120, ansibleName),
      description: catalogText(group?.description, 300),
      color: catalogText(group?.color, 30),
    };
  });
  const aliases = new Set();
  const servers = decoded.servers.map((server) => {
    const alias = catalogText(server?.alias, 63).toLowerCase();
    const address = normalizeAddress(server?.primaryIp);
    const sshPort = Number(server?.sshPort ?? 22);
    if (!ANSIBLE_NAME_RE.test(alias) || aliases.has(alias)) throw new Error(`Invalid or duplicate Rakit server alias "${alias}"`);
    if (!address || !Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) throw new Error(`Invalid Rakit connection data for ${alias}`);
    aliases.add(alias);
    const memberships = [...new Set((Array.isArray(server?.groups) ? server.groups : []).map((value) => catalogText(value, 63).toLowerCase()))];
    if (memberships.some((name) => !groupNames.has(name))) throw new Error(`Rakit server ${alias} references an unknown group`);
    const sshUser = catalogText(server?.sshUser, 64);
    if (sshUser && !/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(sshUser)) throw new Error(`Invalid SSH user for ${alias}`);
    return {
      alias,
      name: catalogText(server?.name, 120, alias),
      hostname: catalogText(server?.hostname, 255),
      primaryIp: address,
      sshUser,
      sshPort,
      osFamily: catalogText(server?.osFamily, 40, 'linux'),
      osName: catalogText(server?.osName, 80),
      osVersion: catalogText(server?.osVersion, 80),
      environment: catalogText(server?.environment, 80),
      role: catalogText(server?.role, 120),
      location: catalogText(server?.location, 120),
      cockpitUrl: catalogText(server?.cockpitUrl, 500),
      notes: catalogText(server?.notes, 1000),
      ansibleEnabled: server?.ansibleEnabled === true,
      groups: memberships,
    };
  });
  return { version: 1, groups, servers };
};

export function encodeRakitCatalog(catalog) {
  const payload = Buffer.from(JSON.stringify(catalog), 'utf8');
  if (payload.length > MAX_CATALOG_BYTES) throw new Error('Rakit catalog is too large');
  const encoded = payload.toString('base64url');
  const chunks = [];
  for (let offset = 0; offset < encoded.length; offset += CATALOG_CHUNK_SIZE) chunks.push(encoded.slice(offset, offset + CATALOG_CHUNK_SIZE));
  if (!chunks.length) chunks.push(Buffer.from(JSON.stringify({ version: 1, groups: [], servers: [] }), 'utf8').toString('base64url'));
  return chunks.map((chunk, index) => `${CATALOG_MARKER} ${index + 1}/${chunks.length} ${chunk}`).join('\n');
}

export function parseSemaphoreInventory(content) {
  const source = String(content ?? '').replace(/\r\n?/g, '\n');
  if (!source.trim()) throw new Error('Remote Semaphore inventory is empty');
  if (/^\s*(?:---\s*$|all:\s*$)/m.test(source)) {
    throw new Error('YAML inventory cannot be imported yet; use a Rakit-compatible INI inventory');
  }

  const catalog = parseRakitCatalog(source);
  const hosts = new Map();
  const groups = new Map();
  let section = 'all';

  const ensureHost = (alias) => {
    if (!ANSIBLE_NAME_RE.test(alias)) throw new Error(`Unsupported host alias "${alias}"`);
    if (!hosts.has(alias)) {
      if (hosts.size >= MAX_HOSTS) throw new Error(`Inventory exceeds the ${MAX_HOSTS} host import limit`);
      hosts.set(alias, { alias, address: '', port: 22, explicitAddress: false, explicitPort: false });
    }
    return hosts.get(alias);
  };

  source.split('\n').forEach((rawLine, index) => {
    if (rawLine.length > MAX_LINE_LENGTH) throw new Error(`Inventory line ${index + 1} is too long`);
    const line = rawLine.trim().replace(/\s+[;#].*$/, '').trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) return;
    const sectionMatch = line.match(/^\[([^\]]+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      if (section.includes(':')) {
        throw new Error(`Inventory section [${section}] cannot be represented safely by Rakit`);
      }
      if (!BUILTIN_GROUPS.has(section)) {
        if (!ANSIBLE_NAME_RE.test(section)) throw new Error(`Unsupported inventory group "${section}"`);
        if (!groups.has(section)) {
          if (groups.size >= MAX_GROUPS) throw new Error(`Inventory exceeds the ${MAX_GROUPS} group import limit`);
          groups.set(section, new Set());
        }
      }
      return;
    }

    const tokens = tokenize(line);
    if (!tokens.length) return;
    const alias = tokens.shift();
    if (alias.includes('=')) throw new Error(`Invalid host entry on inventory line ${index + 1}`);
    const host = ensureHost(alias);
    for (const token of tokens) {
      const separator = token.indexOf('=');
      if (separator <= 0) throw new Error(`Unsupported host token "${token}" for ${alias}`);
      const key = token.slice(0, separator);
      const value = token.slice(separator + 1);
      if (key === 'ansible_host') {
        const address = normalizeAddress(value);
        if (!address) throw new Error(`Invalid ansible_host for ${alias}`);
        if (host.explicitAddress && host.address !== address) throw new Error(`Conflicting ansible_host values for ${alias}`);
        host.address = address;
        host.explicitAddress = true;
      } else if (key === 'ansible_port') {
        const port = Number(value);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid ansible_port for ${alias}`);
        if (host.explicitPort && host.port !== port) throw new Error(`Conflicting ansible_port values for ${alias}`);
        host.port = port;
        host.explicitPort = true;
      } else {
        throw new Error(`Host variable "${key}" for ${alias} cannot be preserved by Rakit`);
      }
    }
    if (!BUILTIN_GROUPS.has(section)) groups.get(section).add(alias);
  });

  if (!hosts.size && !catalog) throw new Error('Remote Semaphore inventory does not contain importable hosts');
  const importedHosts = [...hosts.values()].map(({ alias, address, port }) => {
    const normalizedAddress = normalizeAddress(address || alias);
    if (!normalizedAddress) throw new Error(`Host ${alias} needs a valid ansible_host value`);
    return { alias, address: normalizedAddress, port };
  });
  if (catalog) {
    const technicalHosts = new Map(importedHosts.map((host) => [host.alias, host]));
    const managedCatalogHosts = catalog.servers.filter((server) => server.ansibleEnabled);
    if (managedCatalogHosts.length !== technicalHosts.size) throw new Error('Rakit catalog and technical inventory contain different managed hosts');
    for (const server of managedCatalogHosts) {
      const technical = technicalHosts.get(server.alias);
      if (!technical || technical.address !== server.primaryIp || technical.port !== server.sshPort) throw new Error(`Rakit catalog connection data for ${server.alias} does not match the technical inventory`);
    }
    const technicalGroups = new Map([...groups.entries()].map(([name, members]) => [name, [...members].sort()]));
    for (const group of catalog.groups) {
      const expectedMembers = managedCatalogHosts.filter((server) => server.groups.includes(group.ansibleName)).map((server) => server.alias).sort();
      const actualMembers = technicalGroups.get(group.ansibleName) ?? [];
      if (expectedMembers.length !== actualMembers.length || expectedMembers.some((alias, index) => alias !== actualMembers[index])) {
        throw new Error(`Rakit catalog membership for group ${group.ansibleName} does not match the technical inventory`);
      }
    }
  }
  return {
    hosts: importedHosts,
    groups: [...groups.entries()].map(([name, members]) => ({ name, members: [...members] })),
    catalog,
  };
}
