import net from 'net';

const ANSIBLE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const MAX_HOSTS = 5000;
const MAX_GROUPS = 500;
const MAX_LINE_LENGTH = 2048;
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

export function parseSemaphoreInventory(content) {
  const source = String(content ?? '').replace(/\r\n?/g, '\n');
  if (!source.trim()) throw new Error('Remote Semaphore inventory is empty');
  if (/^\s*(?:---\s*$|all:\s*$)/m.test(source)) {
    throw new Error('YAML inventory cannot be imported yet; use a Rakit-compatible INI inventory');
  }

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

  if (!hosts.size) throw new Error('Remote Semaphore inventory does not contain importable hosts');
  const importedHosts = [...hosts.values()].map(({ alias, address, port }) => {
    const normalizedAddress = normalizeAddress(address || alias);
    if (!normalizedAddress) throw new Error(`Host ${alias} needs a valid ansible_host value`);
    return { alias, address: normalizedAddress, port };
  });
  return {
    hosts: importedHosts,
    groups: [...groups.entries()].map(([name, members]) => ({ name, members: [...members] })),
  };
}
